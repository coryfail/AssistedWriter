const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { isIP } = require("node:net");
const { WebSocketServer, WebSocket } = require("ws");
const { relayOrigin } = require("../electron/relay-origin.cjs");

const MAX_FRAME = 5 * 1024 * 1024;
const MAX_HOSTS = 48;
const MAX_PENDING = 16;
const MAX_HOSTS_PER_IP = 6;
const DAILY_PAYLOAD_LIMIT = 1024 * 1024 * 1024;
const TIMEOUT = 8500;
const MIME = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png",
};

function validEnvelope(value) {
  return value && typeof value.nonce === "string" && /^[a-f0-9]{24}$/.test(value.nonce) &&
    typeof value.data === "string" && value.data.length >= 24 && value.data.length <= MAX_FRAME - 1024;
}
const httpError = (status, message) => Object.assign(new Error(message), { status });

async function readEnvelope(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw httpError(415, "Invalid relay request.");
  if (Number(req.headers["content-length"]) > MAX_FRAME) throw httpError(413, "This request is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_FRAME) { req.resume(); throw httpError(413, "This request is too large."); }
    chunks.push(chunk);
  }
  let envelope;
  try { envelope = JSON.parse(Buffer.concat(chunks, size)); }
  catch { throw httpError(400, "Invalid encrypted request."); }
  if (!validEnvelope(envelope)) throw httpError(400, "Invalid encrypted request.");
  return { nonce: envelope.nonce, data: envelope.data };
}

async function createRelay({ dist, origin, host = "127.0.0.1", port = 48732,
  trustFlyProxy = false, dailyPayloadLimit = DAILY_PAYLOAD_LIMIT } = {}) {
  const configured = origin ? relayOrigin(origin, { allowLocal: host === "127.0.0.1" }) : null;
  if (!configured && host !== "127.0.0.1") throw new Error("RELAY_PUBLIC_ORIGIN must be set for a hosted relay.");
  const html = (await fs.readFile(path.join(dist, "web.html"), "utf8")).replace(/(["'])\.\/assets\//g, "$1/assets/");
  const assets = new Map();
  for (const item of await fs.readdir(path.join(dist, "assets"), { withFileTypes: true })) {
    const type = MIME[path.extname(item.name)];
    if (item.isFile() && type) assets.set("/assets/" + item.name, { type, file: path.join(dist, "assets", item.name) });
  }
  const hosts = new Map();
  const peers = new Map();
  const ws = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  let publicOrigin = configured;
  let pending = 0;
  let closing = false;
  let trafficDay = -1;
  let trafficBytes = 0;
  const authority = () => new URL(publicOrigin).host;

  function peerOf(req) {
    const forwarded = req.headers["fly-client-ip"];
    return trustFlyProxy && typeof forwarded === "string" && isIP(forwarded)
      ? forwarded : (req.socket.remoteAddress || "unknown");
  }

  function rateAllowed(peer, kind, limit) {
    const minute = Math.floor(Date.now() / 60000);
    let bucket = peers.get(peer);
    if (!bucket || bucket.minute !== minute) {
      if (!bucket && peers.size >= 4096) return false;
      bucket = { minute, connections: 0, requests: 0 };
      peers.set(peer, bucket);
    }
    return ++bucket[kind] <= limit;
  }

  function chargePayload(bytes) {
    const day = Math.floor(Date.now() / 86400000);
    if (trafficDay !== day) { trafficDay = day; trafficBytes = 0; }
    if (trafficBytes + bytes > dailyPayloadLimit)
      throw httpError(429, "The relay has reached its daily traffic limit. Your draft is still on this device.");
    trafficBytes += bytes;
    return trafficDay;
  }

  function respond(res, status, value) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  }

  async function route(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.method === "GET" && req.url === "/health") return respond(res, 200, { ok: true });
    if (closing || req.headers.host !== authority()) throw httpError(403, "Use the address in the sharing link.");
    const url = req.url || "";
    if (["GET", "HEAD"].includes(req.method) && /^\/remote\/[a-f0-9]{64}$/.test(url)) {
      if (req.method === "GET") chargePayload(Buffer.byteLength(html));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(req.method === "HEAD" ? undefined : html);
    }
    if (["GET", "HEAD"].includes(req.method) && assets.has(url)) {
      const asset = assets.get(url);
      const content = req.method === "HEAD" ? undefined : await fs.readFile(asset.file);
      if (content) chargePayload(content.length);
      res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "public, max-age=31536000, immutable" });
      return res.end(content);
    }
    const route = url.match(/^\/api\/relay\/([a-f0-9]{64})$/);
    if (req.method !== "POST" || !route) throw httpError(404, "Page not found.");
    if (req.headers.origin !== publicOrigin ||
        (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin"))
      throw httpError(403, "Open the link directly in this browser.");
    if (!rateAllowed(peerOf(req), "requests", 180)) throw httpError(429, "Too many requests from this connection. Try again in a minute.");
    const channel = hosts.get(route[1]);
    if (!channel || channel.socket.readyState !== WebSocket.OPEN)
      throw httpError(503, "The desktop is offline or this link has expired.");
    if (pending >= MAX_PENDING || channel.active >= 3) throw httpError(429, "The connection is busy. Try again.");
    const now = Date.now();
    if (now - channel.minute >= 60000) { channel.minute = now; channel.requests = 0; }
    if (++channel.requests > 120) throw httpError(429, "Too many requests. Try again in a minute.");
    pending++;
    channel.active++;
    let id, timer, reservedDay, usedReply = 0;
    try {
      const envelope = await readEnvelope(req);
      if (channel.socket.readyState !== WebSocket.OPEN || res.destroyed)
        throw httpError(503, "The desktop is disconnected.");
      id = randomUUID();
      const frame = JSON.stringify({ id, envelope });
      // Reserve enough room for the response before forwarding a possible
      // write, so hitting the cap cannot mask a successful save.
      reservedDay = chargePayload(Buffer.byteLength(frame) + MAX_FRAME);
      const result = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(httpError(504, "The desktop took too long to answer.")), TIMEOUT);
        channel.inflight.set(id, { resolve, reject });
        channel.socket.send(frame, (error) => {
          if (error) reject(httpError(503, "The desktop is disconnected."));
        });
      });
      usedReply = Buffer.byteLength(JSON.stringify(result));
      respond(res, 200, result);
    } finally {
      if (reservedDay === trafficDay) trafficBytes -= MAX_FRAME - usedReply;
      clearTimeout(timer);
      if (id) channel.inflight.delete(id);
      pending--;
      channel.active--;
    }
  }

  const server = http.createServer({ headersTimeout: 8000, requestTimeout: 12000 }, (req, res) => {
    route(req, res).catch((error) => respond(res, error.status || 500, { error: error.status ? error.message : "The relay could not complete this request." }));
  });
  server.setTimeout(14000, (socket) => socket.destroy());
  server.maxConnections = 160;
  server.on("upgrade", (req, socket, head) => {
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (closing || req.url !== "/host" || req.headers.host !== authority() || req.headers.origin || !token) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    const room = createHash("sha256").update(token).digest("hex");
    const peer = peerOf(req);
    const peerHosts = [...hosts.entries()].filter(([id, channel]) => id !== room && channel.peer === peer).length;
    if (!rateAllowed(peer, "connections", 20) || peerHosts >= MAX_HOSTS_PER_IP) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\nConnection: close\r\n\r\n"); return;
    }
    if (!hosts.has(room) && hosts.size >= MAX_HOSTS) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"); return;
    }
    ws.handleUpgrade(req, socket, head, (client) => {
      hosts.get(room)?.socket.terminate();
      const channel = { peer, socket: client, inflight: new Map(), active: 0, minute: Date.now(), requests: 0, alive: true };
      hosts.set(room, channel);
      client.on("error", () => {});
      client.on("pong", () => { channel.alive = true; });
      client.on("message", (raw) => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return; }
        const task = channel.inflight.get(message?.id);
        if (!task) return;
        if (message.rejected === true) task.reject(httpError(401, "This private link is invalid or expired."));
        else if (validEnvelope(message.envelope)) task.resolve({ nonce: message.envelope.nonce, data: message.envelope.data });
      });
      client.once("close", () => {
        if (hosts.get(room) === channel) hosts.delete(room);
        for (const task of channel.inflight.values()) task.reject(httpError(503, "The desktop disconnected."));
      });
    });
  });
  const heartbeat = setInterval(() => {
    const minute = Math.floor(Date.now() / 60000);
    for (const [peer, bucket] of peers) if (bucket.minute < minute) peers.delete(peer);
    for (const { socket, alive } of hosts.values()) if (!alive) socket.terminate();
    for (const channel of hosts.values()) if (channel.socket.readyState === WebSocket.OPEN) {
      channel.alive = false;
      channel.socket.ping();
    }
  }, 20000);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => { server.removeListener("error", reject); resolve(); });
    });
  } catch (error) { clearInterval(heartbeat); throw error; }
  publicOrigin ||= "http://127.0.0.1:" + server.address().port;
  return {
    origin: publicOrigin,
    stop() {
      closing = true;
      clearInterval(heartbeat);
      for (const channel of hosts.values()) channel.socket.terminate();
      ws.close();
      return new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}

if (require.main === module) {
  createRelay({
    dist: path.resolve(__dirname, "../dist"),
    origin: process.env.RELAY_PUBLIC_ORIGIN,
    host: process.env.RELAY_PUBLIC_ORIGIN ? "0.0.0.0" : "127.0.0.1",
    port: Number(process.env.PORT || 48732),
    trustFlyProxy: Boolean(process.env.FLY_APP_NAME),
  }).then((relay) => {
    console.log("Assisted Writer relay ready.");
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => relay.stop());
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createRelay };
