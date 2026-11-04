// Decrypt the office file to a path OUTSIDE this repo.
//   OFFICE_PASSPHRASE=... node scripts/decrypt.mjs <output.json> [in.enc.json]
// Refuses to write plaintext inside the working tree.

import fs from "node:fs";
import path from "node:path";
import { decryptPayload } from "./crypto.mjs";
import { DATA_FILE, readEnvelope, requirePassphrase } from "./data-file.mjs";

const [outPath, inPath = DATA_FILE] = process.argv.slice(2);
if (!outPath) {
  console.error("usage: OFFICE_PASSPHRASE=... node scripts/decrypt.mjs <output.json> [in.enc.json]");
  process.exit(1);
}

const resolved = path.resolve(outPath);
const root = path.resolve(".");
if (resolved === root || resolved.startsWith(root + path.sep)) {
  console.error("refusing to write plaintext inside the repo");
  process.exit(1);
}

const passphrase = requirePassphrase("OFFICE_PASSPHRASE");
try {
  const { data } = await decryptPayload(readEnvelope(inPath), passphrase);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(data, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error && error.message === "auth" ? "decryption failed" : "could not decrypt");
  process.exit(1);
}
console.log(`wrote ${resolved}`);
