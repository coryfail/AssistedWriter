const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes, randomInt, timingSafeEqual } = require("node:crypto");
const book = require("./book.cjs");

const WEB_PORT = 48731;
const PAIR_MS = 5 * 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_SESSIONS = 8;
const MAX_JSON = 3 * 1024 * 1024;
const SESSION_COOKIE = "aw_session";
const hash = /^[a-f0-9]{64}$/;
const types = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function privateIPv4(address) {
  const octets = String(address).split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = octets.map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}

function networkAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    entries.filter((entry) => entry.family === "IPv4" && !entry.internal && privateIPv4(entry.address))
      .map(({ address }) => ({ name, address })));
}

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readJSON(req) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json")
    throw error(415, "Send JSON to this endpoint.");
  if (Number(req.headers["content-length"]) > MAX_JSON)
    throw error(413, "This draft is too large to send.");
  const buffers = [];
  let size = 0;
  // Do not destroy the request socket on an oversized streamed body: return 413.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_JSON) {
      req.resume();
      throw error(413, "This draft is too large to send.");
    }
    buffers.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(buffers).toString("utf8")); }
  catch { throw error(400, "Invalid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw error(400, "Invalid request.");
  return value;
}

async function startWebAccess({ root, host, dist, port = WEB_PORT, onSave = () => {}, now = Date.now }) {
  if (host !== "127.0.0.1" && !privateIPv4(host)) throw new Error("Choose a private network address.");
  const sharedRoot = await fs.realpath(root);
  const initialBook = await book.withBookOperation(sharedRoot, book.sharedBook);
  const assets = new Map([["/", { file: path.join(dist, "web.html"), type: "text/html; charset=utf-8" }]]);
  await fs.access(assets.get("/").file);
  for (const entry of await fs.readdir(path.join(dist, "assets"), { withFileTypes: true })) {
    const type = types[path.extname(entry.name)];
    if (entry.isFile() && type) assets.set("/assets/" + entry.name, { file: path.join(dist, "assets", entry.name), type });
  }

  let pairing, closed = false, origin, authority;
  const sessions = new Map();
  function renewCode() {
    if (closed) throw new Error("Web Access is off.");
    pairing = { code: String(randomInt(100_000_000)).padStart(8, "0"), expires: now() + PAIR_MS, attempts: 0 };
    return status();
  }
  function prune() {
    for (const [token, expires] of sessions) if (expires <= now()) sessions.delete(token);
  }
  function status() {
    prune();
    const valid = pairing && pairing.expires > now() && pairing.attempts < MAX_ATTEMPTS;
    return { enabled: !closed, url: origin, bookTitle: initialBook.title, code: valid ? pairing.code : null,
      codeExpires: valid ? pairing.expires : null, devices: sessions.size };
  }
  function session(req) {
    prune();
    const token = req.headers.cookie?.match(/(?:^|;\s*)aw_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (closed || !token || !sessions.has(token))
      throw error(401, "Pair with the desktop to continue.");
    return token;
  }
  function setCookie(res, token, age) {
    res.setHeader("Set-Cookie", SESSION_COOKIE + "=" + token + "; Path=/api; HttpOnly; SameSite=Strict; Max-Age=" + age);
  }
  function json(res, code, value) {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  }

  async function route(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (closed) throw error(503, "Web Access is off.");
    if (req.headers.host !== authority) throw error(403, "Open the address shown in the desktop app.");
    const peer = req.socket.remoteAddress;
    if (peer !== "127.0.0.1" && !privateIPv4(peer)) throw error(403, "Web Access is limited to the local network.");
    if (!req.url?.startsWith("/") || req.url.startsWith("//") || req.url.includes("\\"))
      throw error(400, "Invalid address.");
    const url = new URL(req.url, origin);
    const route = url.pathname;
    if (url.origin !== origin) throw error(403, "Invalid origin.");

    if (!route.startsWith("/api/")) {
      const asset = assets.get(route);
      if (!asset || !["GET", "HEAD"].includes(req.method)) throw error(404, "Page not found.");
      const data = await fs.readFile(asset.file);
      res.writeHead(200, { "Content-Type": asset.type, "Content-Length": data.length });
      res.end(req.method === "HEAD" ? undefined : data);
      return;
    }

    if ((req.headers.origin && req.headers.origin !== origin) ||
        (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") ||
        (req.method !== "GET" && req.headers.origin !== origin))
      throw error(403, "Open this page directly from the desktop app’s address.");

    if (req.method === "POST" && route === "/api/pair") {
      const { code } = await readJSON(req);
      if (closed || !pairing || pairing.expires <= now() || pairing.attempts >= MAX_ATTEMPTS)
        throw error(429, "Get a new pairing code from the desktop.");
      pairing.attempts++;
      if (typeof code !== "string" || !/^\d{8}$/.test(code) ||
          !timingSafeEqual(Buffer.from(code), Buffer.from(pairing.code)))
        throw error(401, "That pairing code is incorrect.");
      prune();
      if (sessions.size >= MAX_SESSIONS) throw error(429, "Disconnect devices on the desktop before pairing another.");
      pairing = null;
      const token = randomBytes(32).toString("hex");
      sessions.set(token, now() + SESSION_MS);
      setCookie(res, token, SESSION_MS / 1000);
      return json(res, 200, { paired: true });
    }

    session(req);
    if (req.method === "POST" && route === "/api/logout") {
      sessions.delete(session(req));
      setCookie(res, "", 0);
      return json(res, 200, { paired: false });
    }
    if (req.method === "GET" && route === "/api/book") {
      const data = await book.withBookOperation(sharedRoot, (root) => {
        session(req);
        if (root !== sharedRoot) throw error(404, "The shared book moved.");
        return book.sharedBook(root);
      });
      return json(res, 200, data);
    }
    const chapter = route.match(/^\/api\/chapters\/([^/]+)$/);
    if (chapter && ["GET", "PUT"].includes(req.method)) {
      let id;
      try { id = decodeURIComponent(chapter[1]); } catch { throw error(400, "Invalid chapter."); }
      if (!id || id.length > 256) throw error(400, "Invalid chapter.");
      let draft;
      if (req.method === "PUT") {
        const { body, revision, manifestRevision } = await readJSON(req);
        if (typeof body !== "string" || typeof revision !== "string" || typeof manifestRevision !== "string" ||
            !hash.test(revision) || !hash.test(manifestRevision))
          throw error(400, "A chapter and its original revision are required.");
        draft = { body, revision, manifestRevision };
      }
      const data = await book.withBookOperation(sharedRoot, (root) => {
        session(req);
        if (root !== sharedRoot) throw error(404, "The shared book moved.");
        return book.sharedChapter(root, id, draft);
      });
      if (draft) onSave(sharedRoot);
      return json(res, 200, data);
    }
    throw error(404, "Page not found.");
  }

  const server = http.createServer({ headersTimeout: 8000, requestTimeout: 15000, keepAliveTimeout: 3000 }, (req, res) => {
    route(req, res).catch((cause) => {
      if (res.destroyed || res.headersSent) return;
      if (cause.code === "BOOK_CONFLICT")
        return json(res, 409, { error: "The saved chapter changed. Your browser draft has not been overwritten." });
      if (cause.code === "CHAPTER_MISSING")
        return json(res, 404, { error: "This chapter is no longer in the book." });
      if (cause.code === "CHAPTER_TOO_LARGE") return json(res, 413, { error: cause.message });
      json(res, cause.status || 500, { error: cause.status ? cause.message : "The desktop could not access this book. Check the desktop app." });
    });
  });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 120;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  authority = host + ":" + server.address().port;
  origin = "http://" + authority;
  renewCode();

  return {
    status, renewCode,
    disconnect() { sessions.clear(); return renewCode(); },
    stop() {
      closed = true;
      pairing = null;
      sessions.clear();
      return new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}

module.exports = { networkAddresses, privateIPv4, startWebAccess };
