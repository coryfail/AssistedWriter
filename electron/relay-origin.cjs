function relayOrigin(value, { allowLocal = false } = {}) {
  if (!value) return null;
  const url = new URL(value);
  const local = allowLocal && url.protocol === "http:" && url.hostname === "127.0.0.1";
  if ((!local && url.protocol !== "https:") || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The Web Access relay must be a root HTTPS address.");
  }
  return url.origin;
}
module.exports = { relayOrigin };
