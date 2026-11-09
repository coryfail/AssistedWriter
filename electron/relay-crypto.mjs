// Both peers use the same Web Crypto primitives. The relay never receives the
// key in the link fragment. Direction and request nonce bind each response.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const relayIdPattern = /^[a-f0-9]{64}$/;
const noncePattern = /^[a-f0-9]{24}$/;

export function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  return Uint8Array.from(value.match(/../g), (byte) => parseInt(byte, 16));
}

function toBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function relayKey(secret) {
  if (!relayIdPattern.test(secret)) throw new Error("Invalid sharing link.");
  return crypto.subtle.importKey("raw", fromHex(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const requestContext = (room) => "assisted-writer/v1/request/" + room;
export const responseContext = (room, nonce) => "assisted-writer/v1/response/" + room + "/" + nonce;

export async function seal(key, context, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    key, encoder.encode(JSON.stringify(value)),
  );
  return { nonce: toHex(iv), data: toBase64(new Uint8Array(ciphertext)) };
}

export async function unseal(key, context, envelope) {
  if (!envelope || typeof envelope.nonce !== "string" || !noncePattern.test(envelope.nonce) ||
      typeof envelope.data !== "string") throw new Error("Invalid encrypted message.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromHex(envelope.nonce), additionalData: encoder.encode(context) },
    key, fromBase64(envelope.data),
  );
  return JSON.parse(decoder.decode(plaintext));
}
