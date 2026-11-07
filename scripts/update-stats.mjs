// Refresh public note follower counts and article likes, then re-encrypt.
// Sales, member notes, and the log are left untouched.
// Note ids are read from the decrypted file. Nothing identifying is printed.

import { decryptPayload, encryptPayload } from "./crypto.mjs";
import { DATA_FILE, assertOfficeData, readEnvelope, requirePassphrase, writeEnvelope } from "./data-file.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_SIZE = 20;
const MAX_PAGES = 40;

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
const beforeStats = statsSignature(data);
const bindings = configuredBindings(process.env.NOTE_ACCOUNTS);
const ids = [...new Set([...noteIds(data), ...bindings.map((binding) => binding.noteId)])];
if (ids.length === 0) {
  console.log("no note ids; file left untouched");
  process.exit(0);
}

let failedAccounts = 0;
for (const id of ids) {
  try {
    const creator = await fetchJson(`https://note.com/api/v2/creators/${encodeURIComponent(id)}`);
    const followers = creator?.data?.followerCount;
    if (typeof followers === "number" && followers >= 0) data.noteFollowers[id] = followers;
    else if (!(id in data.noteFollowers)) throw new Error("incomplete");

    const hadArticles = data.articles.some((article) => article.account === id);
    const notes = await fetchAllContents(id, hadArticles);
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
    await sleep(400);
  } catch {
    failedAccounts += 1;
    console.error("account refresh failed");
  }
}

if (failedAccounts > 0) {
  console.error(`source fetch incomplete; file left untouched; failed ${failedAccounts}`);
  process.exit(1);
}

if (data.sales !== sales) {
  console.error("sales were modified; file not written");
  process.exit(1);
}
linkConfiguredMembers(data, bindings);

const statsChanged = statsSignature(data) !== beforeStats;
const now = formatJst(new Date());
const previousChange = typeof data.changedAt === "string" ? data.changedAt : data.updatedAt;
data.checkedAt = now;
data.changedAt = statsChanged ? now : previousChange;
data.updatedAt = now;
const next = await encryptPayload(data, passphrase, envelope.salt);
writeEnvelope(DATA_FILE, next);
console.log(`checked ${data.checkedAt} changed ${data.changedAt} statsChanged ${statsChanged} accounts ${ids.length} articles ${data.articles.length} sales ${sales.length}`);

function configuredBindings(raw) {
  const bindings = [];
  const seen = new Set();
  for (const part of String(raw ?? "").split(/[\s,]+/)) {
    if (!part) continue;
    const colon = part.indexOf(":");
    if (colon === -1) {
      if (!validNoteId(part) || seen.has(part)) continue;
      seen.add(part);
      bindings.push({ memberId: null, noteId: part });
      continue;
    }
    const memberId = part.slice(0, colon);
    const noteId = part.slice(colon + 1);
    if (!validNoteId(memberId) || !validNoteId(noteId) || seen.has(noteId)) continue;
    seen.add(noteId);
    bindings.push({ memberId, noteId });
  }
  return bindings;
}

function linkConfiguredMembers(office, bindings) {
  for (const binding of bindings) {
    if (!binding.memberId) continue;
    const member = office.members.find((item) => item && item.id === binding.memberId);
    if (!member) continue;
    const already = member.joined === true && member.account === binding.noteId;
    const count = office.articles.filter((article) => article.account === binding.noteId).length;
    member.account = binding.noteId;
    member.joined = true;
    member.works = count;
    if (!already) member.status = `${count}ほんの きじを こうかいした`;
  }
}

function noteIds(office) {
  const ids = new Set();
  for (const id of Object.keys(office.noteFollowers ?? {})) if (validNoteId(id)) ids.add(id);
  for (const member of office.members ?? []) {
    if (member && validNoteId(member.account)) ids.add(member.account);
  }
  return [...ids];
}

function validNoteId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_][A-Za-z0-9_-]{1,63}$/.test(id);
}

async function fetchAllContents(id, hadArticles) {
  const all = [];
  const seen = new Set();
  let total = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await fetchJson(`https://note.com/api/v2/creators/${encodeURIComponent(id)}/contents?kind=note&page=${page}&per=${PAGE_SIZE}`);
    const payload = body?.data ?? {};
    const contents = Array.isArray(payload.contents) ? payload.contents : [];
    if (typeof payload.totalCount === "number") total = payload.totalCount;
    if (page === 1 && total === 0 && contents.length === 0) {
      if (hadArticles) throw new Error("incomplete");
      return [];
    }
    let added = 0;
    for (const note of contents) {
      if (!note || typeof note.key !== "string" || note.key === "" || seen.has(note.key)) continue;
      seen.add(note.key);
      all.push(note);
      added += 1;
    }
    if (total !== null && all.length >= total) return all;
    if (contents.length === 0 || added === 0) break;
    await sleep(300);
  }
  if (total === null || all.length < total) throw new Error("incomplete");
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

function statsSignature(office) {
  const followers = Object.keys(office.noteFollowers)
    .sort()
    .map((id) => [id, office.noteFollowers[id]]);
  const articles = office.articles
    .map((article) => [article.account, article.key, article.title, article.price, article.likes])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  return JSON.stringify({ followers, articles });
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
