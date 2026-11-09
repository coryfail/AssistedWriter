const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const book = require("../electron/book.cjs");
const { createRelay } = require("../relay/server.cjs");
const { startRelayHost } = require("../electron/relay-host.cjs");

test("an encrypted Internet share opens a chapter, saves with conflict protection, and stops on revocation", async (t) => {
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
  assert.equal((await request({ path: "/api/notes", method: "GET" })).status, 404);

  await host.stop();
  const stopped = await send(await encrypt({ path: "/api/book", method: "GET" }));
  assert.equal(stopped.status, 503);
});
