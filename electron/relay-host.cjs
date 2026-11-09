const { randomBytes, createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const WebSocket = require("ws");
const book = require("./book.cjs");
const { relayOrigin } = require("./relay-origin.cjs");

const MAX_FRAME = 5 * 1024 * 1024;
const WINDOW_MS = 120000;
const validHash = /^[a-f0-9]{64}$/;

async function startRelayHost({ root, relayUrl, allowLocal = false, onSave = () => {} }) {
  const origin = relayOrigin(relayUrl, { allowLocal });
  if (!origin) throw new Error("Internet access is not configured for this build.");
  const sharedRoot = await fs.realpath(root);
  const initialBook = await book.withBookOperation(sharedRoot, book.sharedBook);
  const crypt = await import("./relay-crypto.mjs");
  const token = randomBytes(32).toString("hex");
  const room = createHash("sha256").update(token).digest("hex");
  const secret = randomBytes(32).toString("hex");
  const key = await crypt.relayKey(secret);
  const url = origin + "/remote/" + room + "#" + secret;
  const endpoint = origin.replace(/^http/, "ws") + "/host";
  const seen = new Map();
  let socket, timer, closed = false, connected = false, retry = 500, heartbeat;
  let firstConnection = true;

  function status() {
    return { enabled: !closed, mode: "remote", connected, url, bookTitle: initialBook.title };
  }

  async function dispatch(request, active) {
    if (!request || !["GET", "PUT"].includes(request.method) || typeof request.path !== "string")
      return { status: 400, body: { error: "Invalid request." } };
    const match = request.path.match(/^\/api\/chapters\/([^/]+)$/);
    let draft, chapterId;
    if (match) {
      try { chapterId = decodeURIComponent(match[1]); }
      catch { return { status: 400, body: { error: "Invalid chapter." } }; }
      if (!chapterId || chapterId.length > 256) return { status: 400, body: { error: "Invalid chapter." } };
      if (request.method === "PUT") {
        const { body, revision, manifestRevision } = request.body || {};
        if (typeof body !== "string" || Buffer.byteLength(body) > 2 * 1024 * 1024 ||
            typeof revision !== "string" || !validHash.test(revision) ||
            typeof manifestRevision !== "string" || !validHash.test(manifestRevision))
          return { status: 400, body: { error: "A chapter and its original revision are required." } };
        draft = { body, revision, manifestRevision };
      }
    } else if (!(request.method === "GET" && request.path === "/api/book")) {
      return { status: 404, body: { error: "Page not found." } };
    }
    try {
      const body = await book.withBookOperation(sharedRoot, (canonical) => {
        if (closed || active !== socket || active.readyState !== WebSocket.OPEN)
          throw Object.assign(new Error("Web Access is disconnected."), { code: "LINK_DISCONNECTED" });
        if (canonical !== sharedRoot) throw new Error("The shared book moved.");
        return match ? book.sharedChapter(canonical, chapterId, draft) : book.sharedBook(canonical);
      });
      if (draft) onSave(sharedRoot);
      return { status: 200, body };
    } catch (error) {
      if (error.code === "BOOK_CONFLICT") return { status: 409, body: { error: "The saved chapter changed. Your browser draft has not been overwritten." } };
      if (error.code === "CHAPTER_MISSING") return { status: 404, body: { error: "This chapter is no longer in the book." } };
      if (error.code === "CHAPTER_TOO_LARGE") return { status: 413, body: { error: error.message } };
      return { status: 503, body: { error: "The desktop could not access this book. Check the desktop app." } };
    }
  }

  async function receive(active, data) {
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (typeof message?.id !== "string" || !/^[a-f0-9-]{36}$/.test(message.id)) return;
    const send = (result) => {
      if (active.readyState === WebSocket.OPEN && active === socket)
        active.send(JSON.stringify({ id: message.id, ...result }), () => {});
    };
    let request;
    try { request = await crypt.unseal(key, crypt.requestContext(room), message.envelope); }
    catch { send({ rejected: true }); return; }
    const nonce = message.envelope.nonce;
    const now = Date.now();
    for (const [value, expires] of seen) if (expires <= now) seen.delete(value);
    if (!Number.isFinite(request?.at) || Math.abs(now - request.at) > WINDOW_MS || seen.has(nonce) || seen.size >= 2048) {
      send({ rejected: true });
      return;
    }
    seen.set(nonce, request.at + WINDOW_MS);
    const result = await dispatch(request, active);
    const envelope = await crypt.seal(key, crypt.responseContext(room, nonce), result);
    send({ envelope });
  }

  function connect() {
    if (closed) return Promise.reject(new Error("Internet sharing has stopped."));
    return new Promise((resolve, reject) => {
      const active = new WebSocket(endpoint, { headers: { Authorization: "Bearer " + token },
        maxPayload: MAX_FRAME, handshakeTimeout: 7000, perMessageDeflate: false });
      socket = active;
      active.once("open", () => {
        connected = true;
        firstConnection = false;
        retry = 500;
        let alive = true;
        active.on("pong", () => { alive = true; });
        heartbeat = setInterval(() => {
          if (!alive) { active.terminate(); return; }
          alive = false;
          active.ping();
        }, 15000);
        resolve();
      });
      active.on("message", (data) => { receive(active, data).catch(() => {}); });
      active.on("error", () => {
        if (firstConnection) reject(new Error("Could not reach the Internet relay. Try again in a moment."));
      });
      active.once("close", () => {
        clearInterval(heartbeat);
        connected = false;
        if (firstConnection) reject(new Error("Could not reach the Internet relay. Try again in a moment."));
        else if (!closed) {
          timer = setTimeout(() => connect().catch(() => {}), retry);
          retry = Math.min(10000, retry * 2);
        }
      });
    });
  }

  async function stop() {
    closed = true;
    connected = false;
    clearTimeout(timer);
    clearInterval(heartbeat);
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      await new Promise((resolve) => {
        socket.once("close", resolve);
        socket.terminate();
      });
    }
  }

  try { await connect(); }
  catch (error) { await stop(); throw error; }
  return { status, stop };
}

module.exports = { startRelayHost };
