const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const book = require("../electron/book.cjs");
const { startWebAccess } = require("../electron/web-access.cjs");

async function setup(t, options = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "aw-web-test-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = await book.createBook(parent, "The Shared Draft", "Test Author");
  const dist = path.join(parent, "dist");
  await fs.mkdir(path.join(dist, "assets"), { recursive: true });
  await fs.writeFile(path.join(dist, "web.html"), "<title>Browser companion</title>");
  await fs.writeFile(path.join(dist, "index.html"), "<title>Desktop only</title>");
  await fs.writeFile(path.join(dist, "assets", "web.js"), "export {};");
  const id = (await book.loadManifest(root)).chapters[0].id;
  const server = await startWebAccess({ root, dist, host: "127.0.0.1", port: 0, ...options });
  t.after(() => server.stop());
  const { url } = server.status();
  const chapter = "/api/chapters/" + id;
  async function request(endpoint, { method = "GET", body, cookie, origin = url } = {}) {
    return fetch(url + endpoint, {
      method, headers: {
        ...(method !== "GET" && origin ? { Origin: origin } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function pair(code = server.status().code) {
    const response = await request("/api/pair", { method: "POST", body: { code } });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  }
  return { parent, root, id, url, chapter, server, request, pair };
}

function saveBody(chapter, body) {
  return { body, revision: chapter.revision, manifestRevision: chapter.manifestRevision };
}

test("only serves the companion UI and requires pairing for books and chapter saves", async (t) => {
  const { url, request, chapter, server } = await setup(t);
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Browser companion/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal((await request("/assets/web.js")).status, 200);
  assert.equal((await request("/index.html")).status, 404);
  assert.equal((await request("/assets/%2e%2e/index.html")).status, 404);
  assert.equal((await request("/api/book")).status, 401);
  assert.equal((await request(chapter, { method: "PUT", body: {} })).status, 401);
  assert.equal((await request("/api/pair", { method: "POST", body: { code: server.status().code }, origin: "http://other.example" })).status, 403);
  assert.equal((await request("/api/pair", { method: "POST", body: { code: server.status().code }, origin: "" })).status, 403);

  const forgedHost = await new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: "untrusted.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(forgedHost, 403);
});

test("one-time pairing, attempt lockout, expiry, logout and desktop revocation", async (t) => {
  let time = Date.now();
  const { request, server, pair } = await setup(t, { now: () => time });
  const code = server.status().code;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await request("/api/pair", { method: "POST", body: { code: "not-the-code" } });
    assert.equal(response.status, 401);
  }
  assert.equal((await request("/api/pair", { method: "POST", body: { code } })).status, 429);
  const expiredCode = server.renewCode().code;
  time += 5 * 60 * 1000 + 1;
  assert.equal((await request("/api/pair", { method: "POST", body: { code: expiredCode } })).status, 429);
  const nextCode = server.renewCode().code;
  const response = await request("/api/pair", { method: "POST", body: { code: nextCode } });
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie");
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  const cookie = header.split(";")[0];
  assert.equal((await request("/api/pair", { method: "POST", body: { code: nextCode } })).status, 429);
  assert.equal(server.status().devices, 1);
  assert.equal((await request("/api/logout", { method: "POST", cookie })).status, 200);
  assert.equal((await request("/api/book", { cookie })).status, 401);
  server.renewCode();
  const second = await pair();
  time += 12 * 60 * 60 * 1000 + 1;
  assert.equal((await request("/api/book", { cookie: second })).status, 401);
  server.renewCode();
  const third = await pair();
  server.disconnect();
  assert.equal(server.status().devices, 0);
  assert.equal((await request("/api/book", { cookie: third })).status, 401);
});

test("saves real Markdown, refuses stale revisions, and never returns book paths or notes", async (t) => {
  const notices = [];
  const { root, id, request, pair, chapter } = await setup(t, { onSave: (saved) => notices.push(saved) });
  const cookie = await pair();
  const library = await (await request("/api/book", { cookie })).json();
  assert.equal(library.title, "The Shared Draft");
  assert.deepEqual(library.chapters, [{ id, title: "Chapter 1" }]);
  assert.ok(!JSON.stringify(library).includes(root));
  assert.equal((await request("/api/notes", { cookie })).status, 404);
  assert.equal((await request("/api/chapters/" + encodeURIComponent("../notes/book.md"), { cookie })).status, 404);

  const initial = await (await request(chapter, { cookie })).json();
  const manifestBefore = await fs.readFile(path.join(root, "book.json"), "utf8");
  assert.equal((await request(chapter, { method: "PUT", cookie, body: { body: "No revision" } })).status, 400);
  assert.equal((await request(chapter, { method: "PUT", cookie, origin: "http://other.example", body: saveBody(initial, "Blocked") })).status, 403);
  const updated = await request(chapter, { method: "PUT", cookie, body: { ...saveBody(initial, "The **browser** arrived."), root: "/outside", title: "Ignored" } });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).title, "Chapter 1");
  assert.equal((await book.readBook(root)).chapters[0].body, "The **browser** arrived.");
  assert.equal(await fs.readFile(path.join(root, "book.json"), "utf8"), manifestBefore);
  assert.equal(notices.length, 1);
  assert.equal((await request(chapter, { method: "PUT", cookie, body: saveBody(initial, "A stale draft.") })).status, 409);
  assert.equal((await book.readBook(root)).chapters[0].body, "The **browser** arrived.");
});

test("the shared write queue rejects a desktop save racing a browser save", async (t) => {
  const { root, id, chapter, request, pair } = await setup(t);
  const cookie = await pair();
  const initial = await (await request(chapter, { cookie })).json();
  let enter, release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const desktop = book.withBookOperation(root, async () => {
    enter();
    await gate;
    return book.saveChapter(root, id, "Desktop wins this save.", initial.title, initial.revision, initial.manifestRevision);
  });
  await entered;
  const browser = request(chapter, { method: "PUT", cookie, body: saveBody(initial, "Browser keeps this draft.") });
  release();
  await desktop;
  assert.equal((await browser).status, 409);
  assert.equal((await book.readBook(root)).chapters[0].body, "Desktop wins this save.");
  const next = await (await request(chapter, { cookie })).json();
  const results = await Promise.all([
    request(chapter, { method: "PUT", cookie, body: saveBody(next, "First tab.") }),
    request(chapter, { method: "PUT", cookie, body: saveBody(next, "Second tab.") }),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
});

test("a linked chapter cannot expose or replace a file outside the shared book", { skip: process.platform === "win32" }, async (t) => {
  const { parent, root, request, pair, chapter } = await setup(t);
  const cookie = await pair();
  const initial = await (await request(chapter, { cookie })).json();
  const external = path.join(parent, "outside.md");
  const file = path.join(root, "chapters", "chapter-01.md");
  await fs.writeFile(external, "# Private\n\nExternal contents.\n");
  await fs.unlink(file);
  await fs.symlink(external, file);
  const read = await request(chapter, { cookie });
  assert.equal(read.status, 500);
  assert.ok(!(await read.text()).includes("External contents."));
  assert.equal((await request(chapter, { method: "PUT", cookie, body: saveBody(initial, "Blocked") })).status, 500);
  assert.equal(await fs.readFile(external, "utf8"), "# Private\n\nExternal contents.\n");
  assert.ok((await fs.lstat(file)).isSymbolicLink());
});
