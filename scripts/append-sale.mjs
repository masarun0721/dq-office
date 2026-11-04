// Append one sale and re-encrypt with the same salt (remembered keys keep working).
// Sales are append-only: this script never deletes or reorders them.
//   OFFICE_PASSPHRASE=... node scripts/append-sale.mjs \
//     --date YYYY-MM-DD --member MEMBER_ID --amount 500 --item "name"

import { decryptPayload, encryptPayload } from "./crypto.mjs";
import { DATA_FILE, assertOfficeData, readEnvelope, requirePassphrase, writeEnvelope } from "./data-file.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1] || process.argv[i + 1].startsWith("--")) return "";
  return process.argv[i + 1];
}

const date = arg("date");
const member = arg("member");
const item = arg("item");
const amount = Number(arg("amount"));
const file = arg("file") || DATA_FILE;

if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !member || !item || !Number.isInteger(amount) || amount < 0) {
  console.error("usage: OFFICE_PASSPHRASE=... node scripts/append-sale.mjs --date YYYY-MM-DD --member ID --amount N --item TEXT");
  process.exit(1);
}

const passphrase = requirePassphrase("OFFICE_PASSPHRASE");
const envelope = readEnvelope(file);
let opened;
try {
  opened = await decryptPayload(envelope, passphrase);
} catch {
  console.error("decryption failed");
  process.exit(1);
}

const data = assertOfficeData(opened.data);
if (!data.members.some((m) => m && m.id === member)) {
  console.error("unknown member id");
  process.exit(1);
}

const sales = data.sales;
sales.push({ date, member, item, amount });
data.sales = sales;
const next = await encryptPayload(data, passphrase, envelope.salt);
writeEnvelope(file, next);
console.log(`appended 1 sale; total ${data.sales.length}`);
