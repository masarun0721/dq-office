// Re-encrypt public/data.enc.json from OLD_PASSPHRASE to OFFICE_PASSPHRASE.
// A new salt is generated, so keys remembered on a device stop working.

import { decryptPayload, encryptPayload, normalizePassphrase } from "./crypto.mjs";
import { DATA_FILE, assertOfficeData, readEnvelope, requirePassphrase, writeEnvelope } from "./data-file.mjs";

const oldPass = requirePassphrase("OLD_PASSPHRASE");
const newPass = requirePassphrase("OFFICE_PASSPHRASE");
if (normalizePassphrase(oldPass) === normalizePassphrase(newPass)) {
  console.error("OLD_PASSPHRASE and OFFICE_PASSPHRASE are the same");
  process.exit(1);
}

const envelope = readEnvelope(DATA_FILE);
let opened;
try {
  opened = await decryptPayload(envelope, oldPass);
} catch {
  console.error("decryption with OLD_PASSPHRASE failed");
  process.exit(1);
}

const data = assertOfficeData(opened.data);
const sales = data.sales.length;
const next = await encryptPayload(data, newPass);
writeEnvelope(DATA_FILE, next);

const check = await decryptPayload(readEnvelope(DATA_FILE), newPass);
if (assertOfficeData(check.data).sales.length !== sales) {
  console.error("sales count changed during rotate");
  process.exit(1);
}
console.log(`re-encrypted; sales kept: ${sales}`);
