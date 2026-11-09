const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const book = require("../electron/book.cjs");
const { createRelay } = require("../relay/server.cjs");
const { startRelayHost } = require("../electron/relay-host.cjs");

test("an encrypted Internet share edits chapters and notes with conflict protection and stops on revocation", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aw-relay-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = await book.createBook(dir, "Relay test book", "QA");
  const dist = path.join(dir, "dist");
  await fs.mkdir(path.join(dist, "assets"), { recursive: true });
  await fs.writeFile(path.join(dist, "web.html"), '<script type="module" src="./assets/fixture.js"></script>');
  await fs.writeFile(path.join(dist, "assets", "fixture.js"), "export {};");

  const relay = await createRelay({ dist, port: 0 });
  t.after(() => relay.stop());
  const host = await startRelayHost({ root, relayUrl: relay.origin, allowLocal: true });
  t.after(() => host.stop());
  const link = new URL(host.status().url);
  const secret = link.hash.slice(1), room = link.pathname.split("/").at(-1);
  const crypto = await import("../electron/relay-crypto.mjs");
  const key = await crypto.relayKey(secret);
  const endpoint = "/api/relay/" + room;
  assert.equal(host.status().connected, true);
  assert.match(await (await fetch(link)).text(), /src="\/assets\/fixture.js"/);
  assert.equal((await fetch(relay.origin + "/assets/fixture.js")).status, 200);

  async function send(envelope, origin = relay.origin) {
    return fetch(relay.origin + endpoint, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(envelope),
    });
  }
  const encrypt = (value, withKey = key) => crypto.seal(withKey, crypto.requestContext(room), { at: Date.now(), ...value });
  async function request(value) {
    const envelope = await encrypt(value);
    const response = await send(envelope);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes("Relay test book"));
    assert.ok(!text.includes("An encrypted edit."));
    assert.ok(!text.includes("An encrypted note."));
    return crypto.unseal(key, crypto.responseContext(room, envelope.nonce), JSON.parse(text));
  }

  const library = await request({ path: "/api/book", method: "GET" });
  assert.equal(library.body.title, "Relay test book");
  const chapter = "/api/chapters/" + library.body.chapters[0].id;
  const { body: current } = await request({ path: chapter, method: "GET" });
  const edit = { path: chapter, method: "PUT", body: { body: "An encrypted edit.", revision: current.revision, manifestRevision: current.manifestRevision } };
  const encrypted = await encrypt(edit);
  assert.ok(!JSON.stringify(encrypted).includes(edit.body.body));
  assert.equal((await send(encrypted, "https://untrusted.example")).status, 403);
  assert.equal((await send(await encrypt(edit, await crypto.relayKey("1".repeat(64))))).status, 401);
  assert.equal((await send({ ...encrypted, data: encrypted.data + "x" })).status, 401);
  assert.equal((await send(encrypted)).status, 200);
  assert.equal((await book.readBook(root)).chapters[0].body, "An encrypted edit.");
  assert.equal((await send(encrypted)).status, 401);
  assert.equal((await request(edit)).status, 409);
  assert.equal(library.body.notesAvailable, true);
  for (const [notePath, original] of [["/api/notes/book", "# Book Notes\n\n"],
    ["/api/notes" + chapter.slice("/api".length), "# Notes for Chapter 1\n\n"]]) {
    const note = await request({ path: notePath, method: "GET" });
    assert.equal(note.status, 200);
    assert.equal(note.body.body, original);
    const { revision, manifestRevision } = note.body;
    const update = { path: notePath, method: "PUT", body: { revision, manifestRevision, body: "An encrypted note." } };
    assert.equal((await request(update)).status, 200);
    assert.equal((await request(update)).status, 409);
  }
  const onDisk = await book.readBook(root);
  assert.equal(onDisk.bookNotes, "An encrypted note.");
  assert.equal(onDisk.chapters[0].notes, "An encrypted note.");
  assert.equal((await request({ path: "/api/notes/ai-context", method: "GET" })).status, 404);

  await host.stop();
  const stopped = await send(await encrypt({ path: "/api/notes/book", method: "GET" }));
  assert.equal(stopped.status, 503);
});

test("multiple peers can share concurrently while one peer cannot monopolize host slots", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aw-relay-peers-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, "assets"));
  await fs.writeFile(path.join(dir, "web.html"), "<title>Browser companion</title>");
  const relay = await createRelay({ dist: dir, port: 0, trustFlyProxy: true });
  t.after(() => relay.stop());
  const { WebSocket } = require("ws");
  const { randomBytes, createHash } = require("node:crypto");
  const connected = [];

  function open(ip) {
    return new Promise((resolve, reject) => {
      const token = randomBytes(32).toString("hex");
      const room = createHash("sha256").update(token).digest("hex");
      const ws = new WebSocket(relay.origin.replace(/^http/, "ws") + "/host", {
        headers: { Authorization: "Bearer " + token, "Fly-Client-IP": ip },
      });
      ws.on("error", reject);
      ws.on("unexpected-response", (_request, response) => {
        response.resume();
        ws.terminate();
        reject(new Error("Upgrade rejected: " + response.statusCode));
      });
      ws.once("open", () => {
        ws.on("message", (data) => {
          const { id, envelope } = JSON.parse(data);
          ws.send(JSON.stringify({ id, envelope }));
        });
        connected.push({ ws, room });
        resolve();
      });
    });
  }
  await Promise.all(Array.from({ length: 6 }, () => open("192.0.2.11")));
  await assert.rejects(open("192.0.2.11"), /429/);
  await Promise.all(Array.from({ length: 6 }, () => open("192.0.2.12")));
  const responses = await Promise.all(connected.map(({ room }, i) => fetch(relay.origin + "/api/relay/" + room, {
    method: "POST",
    headers: { Origin: relay.origin, "Content-Type": "application/json", "Fly-Client-IP": "192.0.2.13" },
    body: JSON.stringify({ nonce: i.toString(16).padStart(24, "0"), data: Buffer.alloc(24, i).toString("base64") }),
  })));
  assert.ok(responses.every((response) => response.status === 200));
  const replies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(new Set(replies.map((reply) => reply.nonce)).size, 12);
});

test("a bounded payload budget refuses more content without taking the health check offline", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aw-relay-budget-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, "assets"));
  await fs.writeFile(path.join(dir, "web.html"), "a".repeat(60));
  const relay = await createRelay({ dist: dir, port: 0, dailyPayloadLimit: 100 });
  t.after(() => relay.stop());
  const link = relay.origin + "/remote/" + "a".repeat(64);
  assert.equal((await fetch(link)).status, 200);
  assert.equal((await fetch(link)).status, 429);
  assert.equal((await fetch(relay.origin + "/health")).status, 200);
});
