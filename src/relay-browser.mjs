import { relayIdPattern, relayKey, requestContext, responseContext, seal, unseal } from "../electron/relay-crypto.mjs";

const roomPath = /^\/remote\/([a-f0-9]{64})$/;

export function privateLinkForOrigin(value, origin) {
  try {
    const link = new URL(value.trim());
    if (link.origin === origin && roomPath.test(link.pathname) && !link.search &&
        !link.username && !link.password && relayIdPattern.test(link.hash.slice(1))) return link;
  } catch { /* Invalid URL. */ }
  return null;
}

export function browserRelay() {
  const room = location.pathname.match(roomPath)?.[1];
  if (!room) return null;
  const storageKey = "assisted-writer:relay:" + room;
  let secret = location.hash.slice(1);
  // Leave the fragment in the address so Home Screen shortcuts save the full link.
  if (relayIdPattern.test(secret)) {
    try { sessionStorage.setItem(storageKey, secret); } catch { /* Keep it in memory for this page. */ }
  } else {
    try { secret = sessionStorage.getItem(storageKey) || ""; } catch { secret = ""; }
  }
  let key = relayIdPattern.test(secret) ? relayKey(secret).catch(() => null) : null;
  return {
    get hasKey() { return key !== null; },
    forget() {
      key = null;
      if (location.hash) history.replaceState(null, "", location.pathname);
      try { sessionStorage.removeItem(storageKey); } catch { /* Already forgotten in memory. */ }
    },
    async request(path, method, body, signal) {
      const imported = await key;
      if (!imported) throw Object.assign(new Error("This shortcut is missing its private link. Copy the link from Web Access on your Mac."), { status: 401 });
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
