export type Sale = {
  date: string;
  member: string;
  item: string;
  amount: number;
};

export type Member = {
  id: string;
  job: string;
  tag: string;
  bot: string;
  place: string;
  account: string;
  joined: boolean;
  works: number;
  pending: number;
  verb: string;
  status: string;
};

export type Article = {
  account: string;
  key: string;
  title: string;
  price: number;
  likes: number;
};

export type OfficeData = {
  updatedAt: string;
  sales: Sale[];
  members: Member[];
  noteFollowers: Record<string, number>;
  articles: Article[];
  log: string[];
};

export function isOfficeData(value: unknown): value is OfficeData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<OfficeData>;
  return typeof data.updatedAt === "string"
    && Array.isArray(data.sales)
    && Array.isArray(data.members)
    && Array.isArray(data.articles)
    && Array.isArray(data.log)
    && !!data.noteFollowers
    && typeof data.noteFollowers === "object"
    && !Array.isArray(data.noteFollowers);
}
