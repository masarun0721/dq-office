import { decryptWithRawKey, type Envelope } from "../scripts/crypto.mjs";
import { isOfficeData, type OfficeData } from "./types";

const KEY_STORE = "office-key";

export function loadRememberedKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
}

export function saveRememberedKey(raw: string) {
  localStorage.setItem(KEY_STORE, raw);
}

export function clearRememberedKey() {
  try {
    localStorage.removeItem(KEY_STORE);
  } catch {
    /* private mode */
  }
}

export function clearLiveOverlay() {
  try {
    localStorage.removeItem("office-live-view");
  } catch {
    /* private mode */
  }
}

export async function fetchEnvelope(): Promise<Envelope> {
  const url = new URL("data.enc.json", document.baseURI);
  url.searchParams.set("t", String(Date.now()));
  const response = await fetch(url.href, { cache: "no-store" });
  if (!response.ok) throw new Error("fetch");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("format");
  return body as Envelope;
}

export async function openWithRememberedKey(envelope: Envelope, raw: string): Promise<{ data: OfficeData; key: CryptoKey }> {
  const opened = await decryptWithRawKey(envelope, raw);
  if (!isOfficeData(opened.data)) throw new Error("format");
  return { data: opened.data, key: opened.key };
}
