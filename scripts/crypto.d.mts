export const KDF_ITERS: number;

export type Envelope = {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
};

export function normalizePassphrase(value: unknown): string;
export function bytesToB64(bytes: Uint8Array): string;
export function b64ToBytes(value: string): Uint8Array;
export function deriveAesKey(passphrase: string, saltBytes: Uint8Array, iterations: number, extractable?: boolean): Promise<CryptoKey>;
export function encryptPayload(data: unknown, passphrase: string, saltB64?: string | null): Promise<Envelope>;
export function decryptPayload(envelope: Envelope, passphrase: string): Promise<{ data: unknown; key: CryptoKey }>;
export function decryptWithRawKey(envelope: Envelope, rawB64: string): Promise<{ data: unknown; key: CryptoKey }>;
export function exportRawKey(key: CryptoKey): Promise<string>;
