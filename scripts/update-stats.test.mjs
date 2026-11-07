// Regression checks for the stats writer. Uses fake ids only.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decryptPayload, encryptPayload } from "./crypto.mjs";

const pass = "test-pass-123";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "office-stats-"));
let failures = 0;

function check(name, ok) {
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) failures += 1;
}

function baseData() {
  return {
    updatedAt: "2026-11-07 02:56",
    sales: [{ date: "2026-11-01", member: "hero", item: "keep", amount: 5 }],
    members: [
      { id: "hero", job: "せんし", tag: "t", bot: "b", place: "p", account: "demo", joined: true, works: 0, pending: 0, verb: "きじ", status: "s" },
      { id: "other", job: "まどうし", tag: "t", bot: "b", place: "p", account: "-", joined: true, works: 0, pending: 0, verb: "きじ", status: "s" },
    ],
    noteFollowers: { demo: 1 },
    articles: [{ account: "demo", key: "n1", title: "old", price: 100, likes: 0 }],
    log: ["x"],
  };
}

function catalog({ likes = 0, followers = 1, total = 1, pages = null, explode = false, extraId = false }) {
  const pageList = pages ?? [[{ key: "n1", name: "old", price: 100, likeCount: likes }]];
  return { likes, followers, total, pageList, explode, extraId };
}

const scriptPath = new URL("./update-stats.mjs", import.meta.url).pathname;
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

async function runCase(name, data, api, noteAccounts = "") {
  const file = path.join(root, `${name}.enc.json`);
  fs.writeFileSync(file, `${JSON.stringify(await encryptPayload(data, pass))}\n`);
  const before = fs.readFileSync(file);
  const mock = path.join(root, `${name}.mock.mjs`);
  fs.writeFileSync(mock, `
const api = ${JSON.stringify(api)};
function specFor(id) {
  return (api.byId && api.byId[id]) || api;
}
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const id = u.pathname.split("/").filter(Boolean).at(-1) === "contents"
    ? u.pathname.split("/").filter(Boolean).at(-2)
    : u.pathname.split("/").filter(Boolean).at(-1);
  const spec = specFor(id);
  if (api.explode || spec.explode) throw new Error("down");
  if (!u.pathname.endsWith("/contents")) {
    return new Response(JSON.stringify({ data: { followerCount: spec.followers } }), { status: 200 });
  }
  if (u.searchParams.get("per") !== "20") throw new Error("missing per");
  const page = Number(u.searchParams.get("page") || "1");
  const slice = spec.pageList[page - 1] ?? [];
  const collectedBefore = spec.pageList.slice(0, page - 1).reduce((sum, items) => sum + items.length, 0);
  const last = page >= spec.pageList.length;
  return new Response(JSON.stringify({
    data: {
      contents: slice,
      isLastPage: last && spec.total <= collectedBefore + slice.length,
      totalCount: spec.total,
    },
  }), { status: 200 });
};
await import(${JSON.stringify(scriptPath)});
`);
  const result = spawnSync("node", [mock], {
    cwd: repoRoot,
    env: { ...process.env, OFFICE_PASSPHRASE: pass, OFFICE_DATA_FILE: file, NOTE_ACCOUNTS: noteAccounts },
    encoding: "utf8",
  });
  return { result, before, file };
}

const same = await runCase("same", baseData(), catalog({}));
check("no-change exits 0", same.result.status === 0);
check("no-change rewrites file", !fs.readFileSync(same.file).equals(same.before));
let opened = await decryptPayload(JSON.parse(fs.readFileSync(same.file, "utf8")), pass);
check("no-change keeps changedAt", opened.data.changedAt === "2026-11-07 02:56");
check("no-change moves checkedAt", opened.data.checkedAt !== "2026-11-07 02:56" && opened.data.checkedAt === opened.data.updatedAt);
check("no-change keeps sale", opened.data.sales[0].amount === 5 && opened.data.sales[0].item === "keep");
check("no-change keeps likes", opened.data.articles[0].likes === 0);
check("log mentions both times", same.result.stdout.includes(`checked ${opened.data.checkedAt} changed 2026-11-07 02:56 statsChanged false`));

const changed = await runCase("changed", baseData(), catalog({ likes: 4 }));
check("change exits 0", changed.result.status === 0);
opened = await decryptPayload(JSON.parse(fs.readFileSync(changed.file, "utf8")), pass);
check("change moves changedAt", opened.data.changedAt === opened.data.checkedAt && opened.data.changedAt !== "2026-11-07 02:56");
check("change updates likes", opened.data.articles[0].likes === 4);
check("change keeps sale", opened.data.sales[0].amount === 5);

const failed = await runCase("fail", baseData(), catalog({ explode: true }));
check("failed fetch exits 1", failed.result.status === 1);
check("failed fetch keeps bytes", fs.readFileSync(failed.file).equals(failed.before));

const shortData = baseData();
const short = await runCase("short", shortData, catalog({
  total: 40,
  pages: [[{ key: "n1", name: "old", price: 100, likeCount: 0 }]],
}));
check("short catalog exits 1", short.result.status === 1);
check("short catalog keeps bytes", fs.readFileSync(short.file).equals(short.before));

const withMember = baseData();
withMember.members.push({ id: "new", job: "そうりょ", tag: "t", bot: "b", place: "p", account: "extra", joined: true, works: 0, pending: 0, verb: "きじ", status: "s" });
const added = await runCase("added", withMember, catalog({
  total: 1,
  pages: [[{ key: "n9", name: "fresh", price: 10, likeCount: 2 }]],
}));
check("member id is fetched", added.result.status === 0 && added.result.stdout.includes("statsChanged true"));
opened = await decryptPayload(JSON.parse(fs.readFileSync(added.file, "utf8")), pass);
check("new id stored", opened.data.noteFollowers.extra === 1 && opened.data.articles.some((article) => article.account === "extra"));
check("old sale still there", opened.data.sales.length === 1 && opened.data.sales[0].amount === 5);

const many = Array.from({ length: 25 }, (_, index) => ({
  key: `p${index}`,
  name: "t",
  price: 1,
  likeCount: index === 24 ? 3 : 0,
}));
const paged = await runCase("paged", baseData(), catalog({
  total: 25,
  followers: 1,
  pages: [many.slice(0, 20), many.slice(20)],
}));
check("full pages exit 0", paged.result.status === 0);
opened = await decryptPayload(JSON.parse(fs.readFileSync(paged.file, "utf8")), pass);
check("full pages keep the older article and add every page", opened.data.articles.length === 26);
check("full pages apply the last page like", opened.data.articles.some((article) => article.likes === 3));
check("full pages keep the sale", opened.data.sales[0].amount === 5 && opened.data.sales.length === 1);

const four = baseData();
four.members.push({ id: "clerk", job: "しょうにん", tag: "t", bot: "b", place: "p", account: "-", joined: false, works: 0, pending: 0, verb: "きじ", status: "まだ" });
const extraArticles = Array.from({ length: 15 }, (_, index) => ({
  key: `e${index}`,
  name: "t",
  price: 100,
  likeCount: index === 0 ? 1 : 0,
}));
const backfill = await runCase("backfill", four, {
  followers: 1,
  total: 1,
  pageList: [[{ key: "n1", name: "old", price: 100, likeCount: 0 }]],
  byId: {
    extra: { followers: 1, total: 15, pageList: [extraArticles] },
  },
}, "clerk:extra");
check("backfill exits 0", backfill.result.status === 0 && backfill.result.stdout.includes("accounts 2"));
opened = await decryptPayload(JSON.parse(fs.readFileSync(backfill.file, "utf8")), pass);
const linked = opened.data.members.find((member) => member.id === "clerk");
check("backfill links the member", linked.joined === true && linked.account === "extra" && linked.works === 15);
check("backfill keeps member order", opened.data.members.map((member) => member.id).join(",") === "hero,other,clerk");
check("backfill stores both catalogs", Object.keys(opened.data.noteFollowers).length === 2 && opened.data.articles.length === 16);
check("backfill moves the change time", opened.data.changedAt === opened.data.checkedAt);
check("backfill keeps the sale in place", opened.data.sales.length === 1 && opened.data.sales[0].item === "keep" && opened.data.sales[0].amount === 5);

const blocked = await runCase("backfill-fail", four, {
  followers: 1,
  total: 1,
  pageList: [[{ key: "n1", name: "old", price: 100, likeCount: 0 }]],
  byId: { extra: { explode: true, followers: 0, total: 0, pageList: [] } },
}, "clerk:extra");
check("backfill failure exits 1", blocked.result.status === 1);
check("backfill failure keeps bytes", fs.readFileSync(blocked.file).equals(blocked.before));

if (failures) {
  console.error(`FAILED ${failures}`);
  process.exit(1);
}
console.log("all stats policy checks passed");
