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

async function runCase(name, data, api) {
  const file = path.join(root, `${name}.enc.json`);
  fs.writeFileSync(file, `${JSON.stringify(await encryptPayload(data, pass))}\n`);
  const before = fs.readFileSync(file);
  const mock = path.join(root, `${name}.mock.mjs`);
  fs.writeFileSync(mock, `
const api = ${JSON.stringify(api)};
globalThis.fetch = async (url) => {
  if (api.explode) throw new Error("down");
  const u = new URL(String(url));
  const id = u.pathname.split("/").filter(Boolean).at(-1) === "contents"
    ? u.pathname.split("/").filter(Boolean).at(-2)
    : u.pathname.split("/").filter(Boolean).at(-1);
  if (!u.pathname.endsWith("/contents")) {
    return new Response(JSON.stringify({ data: { followerCount: api.followers } }), { status: 200 });
  }
  if (!u.searchParams.get("per")) throw new Error("missing per");
  const page = Number(u.searchParams.get("page") || "1");
  const slice = api.pageList[page - 1] ?? [];
  const last = page >= api.pageList.length;
  return new Response(JSON.stringify({ data: { contents: slice, isLastPage: last && api.total <= slice.length + (page - 1) * 20, totalCount: api.total } }), { status: 200 });
};
await import(${JSON.stringify(path.join("/workspace/scripts/update-stats.mjs"))});
`);
  const result = spawnSync("node", [mock], {
    cwd: "/workspace",
    env: { ...process.env, OFFICE_PASSPHRASE: pass, OFFICE_DATA_FILE: file },
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

if (failures) {
  console.error(`FAILED ${failures}`);
  process.exit(1);
}
console.log("all stats policy checks passed");
