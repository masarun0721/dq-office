import fs from "node:fs";

export const DATA_FILE = process.env.OFFICE_DATA_FILE || "public/data.enc.json";

export function readEnvelope(path = DATA_FILE) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function writeEnvelope(path, envelope) {
  fs.writeFileSync(path, `${JSON.stringify(envelope)}\n`);
}

export function requirePassphrase(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

export function assertOfficeData(data) {
  if (!data || typeof data !== "object") throw new Error("shape");
  if (typeof data.updatedAt !== "string") throw new Error("shape");
  if (!Array.isArray(data.sales) || !Array.isArray(data.members)) throw new Error("shape");
  if (!Array.isArray(data.articles) || !Array.isArray(data.log)) throw new Error("shape");
  if (!data.noteFollowers || typeof data.noteFollowers !== "object" || Array.isArray(data.noteFollowers)) {
    throw new Error("shape");
  }
  return data;
}
