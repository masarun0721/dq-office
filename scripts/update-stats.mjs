// Refresh public note follower counts and article likes, then re-encrypt.
// Sales, member notes, and the log are left untouched.
// Note ids are read from the decrypted file. Nothing identifying is printed.

import { decryptPayload, encryptPayload } from "./crypto.mjs";
import { DATA_FILE, assertOfficeData, readEnvelope, requirePassphrase, writeEnvelope } from "./data-file.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_PAGES = 20;

const passphrase = requirePassphrase("OFFICE_PASSPHRASE");
const envelope = readEnvelope(DATA_FILE);
let opened;
try {
  opened = await decryptPayload(envelope, passphrase);
} catch {
  console.error("decryption failed");
  process.exit(1);
}

const data = assertOfficeData(opened.data);
const sales = data.sales;
const ids = Object.keys(data.noteFollowers).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
let updatedAccounts = 0;
let failedAccounts = ids.length === 0 ? 0 : Object.keys(data.noteFollowers).length - ids.length;

for (const id of ids) {
  try {
    const creator = await fetchJson(`https://note.com/api/v2/creators/${encodeURIComponent(id)}`);
    const followers = creator?.data?.followerCount;
    if (typeof followers === "number" && followers >= 0) data.noteFollowers[id] = followers;

    const notes = await fetchAllContents(id);
    for (const note of notes) {
      if (!note || typeof note.key !== "string" || note.key === "") continue;
      const title = typeof note.name === "string" ? note.name : "";
      const price = Number.isFinite(note.price) ? note.price : 0;
      const likes = Number.isFinite(note.likeCount) ? note.likeCount : 0;
      const found = data.articles.find((article) => article.account === id && article.key === note.key);
      if (found) {
        found.title = title;
        found.price = price;
        found.likes = likes;
      } else {
        data.articles.push({ account: id, key: note.key, title, price, likes });
      }
    }
    updatedAccounts += 1;
    await sleep(400);
  } catch {
    failedAccounts += 1;
    console.error("account refresh failed");
  }
}

if (ids.length > 0 && updatedAccounts === 0) {
  console.error("every account refresh failed; file not written");
  process.exit(1);
}

if (data.sales !== sales) {
  console.error("sales were modified; file not written");
  process.exit(1);
}
data.updatedAt = formatJst(new Date());
const next = await encryptPayload(data, passphrase, envelope.salt);
writeEnvelope(DATA_FILE, next);
console.log(`updated ${updatedAccounts} accounts, failed ${failedAccounts}, sales kept ${sales.length}, articles ${data.articles.length}`);

async function fetchAllContents(id) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await fetchJson(`https://note.com/api/v2/creators/${encodeURIComponent(id)}/contents?kind=note&page=${page}`);
    const contents = Array.isArray(body?.data?.contents) ? body.data.contents : [];
    all.push(...contents);
    if (contents.length === 0 || body?.data?.isLastPage === true) break;
    await sleep(400);
  }
  return all;
}

async function fetchJson(url) {
  let status = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    status = response.status;
    if (response.status === 429 || response.status >= 500) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`http ${status}`);
    return response.json();
  }
  throw new Error(`http ${status}`);
}

function formatJst(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
