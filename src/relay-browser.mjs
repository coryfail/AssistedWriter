import { relayIdPattern, relayKey, requestContext, responseContext, seal, unseal } from "../electron/relay-crypto.mjs";

export function browserRelay() {
  const room = location.pathname.match(/^\/remote\/([a-f0-9]{64})$/)?.[1];
  if (!room) return null;
  const storageKey = "assisted-writer:relay:" + room;
  let secret = location.hash.slice(1);
  if (relayIdPattern.test(secret)) {
    try { sessionStorage.setItem(storageKey, secret); } catch { /* Keep it in memory for this page. */ }
    history.replaceState(null, "", location.pathname);
  } else {
    try { secret = sessionStorage.getItem(storageKey) || ""; } catch { secret = ""; }
  }
  let key = relayIdPattern.test(secret) ? relayKey(secret).catch(() => null) : null;
  return {
    forget() {
      key = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* Already forgotten in memory. */ }
    },
    async request(path, method, body, signal) {
      const imported = await key;
      if (!imported) throw Object.assign(new Error("Open the full private link from the desktop."), { status: 401 });
      const envelope = await seal(imported, requestContext(room), { path, method, body, at: Date.now() });
      const response = await fetch("/api/relay/" + room, {
        method: "POST", credentials: "omit", signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(envelope),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw Object.assign(new Error(data?.error || "The desktop connection is unavailable."), { status: response.status });
      const reply = await unseal(imported, responseContext(room, envelope.nonce), data);
      if (reply.status !== 200) throw Object.assign(new Error(reply.body?.error || "The request did not complete."), { status: reply.status });
      return reply.body;
    },
  };
}
