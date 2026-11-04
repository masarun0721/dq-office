// Encrypt a plaintext office JSON file.
//   OFFICE_PASSPHRASE=... node scripts/encrypt.mjs <plaintext.json> [out.enc.json]
// The passphrase is read from the environment, never from argv.
// Default output is public/data.enc.json. Do not commit the plaintext.

import fs from "node:fs";
import { encryptPayload } from "./crypto.mjs";
import { DATA_FILE, assertOfficeData, requirePassphrase, writeEnvelope } from "./data-file.mjs";

const [inPath, outPath = DATA_FILE] = process.argv.slice(2);
if (!inPath) {
  console.error("usage: OFFICE_PASSPHRASE=... node scripts/encrypt.mjs <plaintext.json> [out.enc.json]");
  process.exit(1);
}

const passphrase = requirePassphrase("OFFICE_PASSPHRASE");
const data = assertOfficeData(JSON.parse(fs.readFileSync(inPath, "utf8")));
const envelope = await encryptPayload(data, passphrase);
writeEnvelope(outPath, envelope);
console.log(`encrypted ${data.sales.length} sales, ${data.members.length} members -> ${outPath}`);
