// Shared by the Node scripts and the browser bundle.
// Envelope: PBKDF2-SHA256 → AES-GCM. Salt stays with the passphrase so a
// remembered AES key still opens the file after a stats update. A passphrase
// change generates a new salt. The IV is random for every write.

export const KDF_ITERS = 600_000;

export function normalizePassphrase(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function bytesToB64(bytes) {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function b64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function deriveAesKey(passphrase, saltBytes, iterations, extractable = true) {
  const pass = normalizePassphrase(passphrase);
  if (!pass) throw new Error("empty");
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_500_000) {
    throw new Error("iter");
  }
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pass),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    extractable,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPayload(data, passphrase, saltB64 = null) {
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("salt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, KDF_ITERS, false);
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter: KDF_ITERS,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ct: bytesToB64(ct),
  };
}

export async function decryptPayload(envelope, passphrase) {
  assertEnvelope(envelope);
  const salt = b64ToBytes(envelope.salt);
  const iv = b64ToBytes(envelope.iv);
  const ct = b64ToBytes(envelope.ct);
  const key = await deriveAesKey(passphrase, salt, envelope.iter, true);
  return decode(key, iv, ct);
}

export async function decryptWithRawKey(envelope, rawB64) {
  assertEnvelope(envelope);
  const raw = b64ToBytes(rawB64);
  if (raw.length !== 32) throw new Error("key");
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["decrypt"]);
  return decode(key, b64ToBytes(envelope.iv), b64ToBytes(envelope.ct));
}

export async function exportRawKey(key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return bytesToB64(raw);
}

function assertEnvelope(envelope) {
  if (!envelope || envelope.v !== 1 || envelope.kdf !== "PBKDF2-SHA256") throw new Error("format");
  if (typeof envelope.salt !== "string" || typeof envelope.iv !== "string" || typeof envelope.ct !== "string") {
    throw new Error("format");
  }
}

async function decode(key, iv, ct) {
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    throw new Error("auth");
  }
  try {
    return { data: JSON.parse(new TextDecoder().decode(plain)), key };
  } catch {
    throw new Error("format");
  }
}
