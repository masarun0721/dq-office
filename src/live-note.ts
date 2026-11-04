import type { Article, OfficeData } from "./types";

const LIVE_KEY = "office-live-view";

type LiveOverlay = {
  updatedAt: string;
  noteFollowers: Record<string, number>;
  articles: Article[];
};

type NoteContent = {
  key?: string;
  name?: string;
  price?: number;
  likeCount?: number;
};

export function formatJst(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

export function clearLiveOverlay() {
  try {
    localStorage.removeItem(LIVE_KEY);
  } catch {
    /* private mode */
  }
}

export function viewFromFile(file: OfficeData): OfficeData {
  const saved = loadLiveOverlay();
  if (!saved || saved.updatedAt <= file.updatedAt) {
    if (saved) clearLiveOverlay();
    return file;
  }
  return {
    ...file,
    updatedAt: saved.updatedAt,
    noteFollowers: saved.noteFollowers,
    articles: saved.articles,
  };
}

export function saveLiveOverlay(data: OfficeData) {
  const overlay: LiveOverlay = {
    updatedAt: data.updatedAt,
    noteFollowers: data.noteFollowers,
    articles: data.articles,
  };
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify(overlay));
  } catch {
    /* quota or private mode */
  }
}

// Public note stats, merged in memory only. Sales stay the file's array.
// note.com does not send Access-Control-Allow-Origin, so this throws in the browser.
export async function mergeLiveNote(file: OfficeData): Promise<OfficeData> {
  const ids = Object.keys(file.noteFollowers).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
  if (ids.length === 0) throw new Error("live");
  const noteFollowers = { ...file.noteFollowers };
  const articles = file.articles.map((article) => ({ ...article }));
  let updated = 0;
  for (const id of ids) {
    const creator = await fetchJson(`/creators/${encodeURIComponent(id)}`);
    const followers = numberOf(creator?.data?.followerCount);
    if (followers !== null && followers >= 0) noteFollowers[id] = followers;
    const page = await fetchJson(`/creators/${encodeURIComponent(id)}/contents?kind=note&page=1`);
    const list = Array.isArray(page?.data?.contents) ? page.data.contents : [];
    for (const note of list) mergeArticle(articles, id, note);
    updated += 1;
  }
  if (updated === 0) throw new Error("live");
  return {
    ...file,
    noteFollowers,
    articles,
    sales: file.sales,
    updatedAt: formatJst(new Date()),
  };
}

function mergeArticle(articles: Article[], account: string, note: NoteContent) {
  if (!note || typeof note.key !== "string" || note.key === "") return;
  const title = typeof note.name === "string" ? note.name : "";
  const price = numberOf(note.price) ?? 0;
  const likes = numberOf(note.likeCount) ?? 0;
  const found = articles.find((article) => article.account === account && article.key === note.key);
  if (found) {
    found.title = title;
    found.price = price;
    found.likes = likes;
    return;
  }
  articles.push({ account, key: note.key, title, price, likes });
}

async function fetchJson(path: string): Promise<{ data?: { followerCount?: unknown; contents?: NoteContent[] } }> {
  const response = await fetch(`https://note.com/api/v2${path}`, { mode: "cors", cache: "no-store" });
  if (!response.ok) throw new Error("live");
  return response.json() as Promise<{ data?: { followerCount?: unknown; contents?: NoteContent[] } }>;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function loadLiveOverlay(): LiveOverlay | null {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const overlay = parsed as Partial<LiveOverlay>;
    if (typeof overlay.updatedAt !== "string" || !overlay.noteFollowers || !Array.isArray(overlay.articles)) return null;
    return overlay as LiveOverlay;
  } catch {
    return null;
  }
}
