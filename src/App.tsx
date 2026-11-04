import { useEffect, useState, type FormEvent } from "react";
import { decryptPayload, exportRawKey, type Envelope } from "../scripts/crypto.mjs";
import { Office } from "./Office";
import { clearLiveOverlay, viewFromFile } from "./live-note";
import { clearRememberedKey, fetchEnvelope, loadRememberedKey, openWithRememberedKey, saveRememberedKey } from "./session";
import { isOfficeData, type OfficeData } from "./types";

type Session = { data: OfficeData; key: CryptoKey };

export function App() {
  const [ready, setReady] = useState(false);
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [gateError, setGateError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const file = await fetchEnvelope(false);
        if (cancel) return;
        setEnvelope(file);
        const remembered = loadRememberedKey();
        if (!remembered) return;
        try {
          const opened = await openWithRememberedKey(file, remembered);
          if (cancel) return;
          setSession({ data: viewFromFile(opened.data), key: opened.key });
        } catch {
          clearRememberedKey();
          if (!cancel) setGateError("しかし あいことばが ちがうようだ…");
        }
      } catch {
        if (!cancel) setGateError("じょうほうを よみこめなかった…");
      } finally {
        if (!cancel) setReady(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setGateError("");
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const file = envelope ?? await fetchEnvelope(true);
      setEnvelope(file);
      const opened = await decryptPayload(file, passphrase);
      if (!isOfficeData(opened.data)) throw new Error("format");
      if (remember) saveRememberedKey(await exportRawKey(opened.key));
      else clearRememberedKey();
      setPassphrase("");
      setSession({ data: viewFromFile(opened.data), key: opened.key });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setGateError(code === "format"
        ? "じょうほうが よめなかった…"
        : code === "fetch"
          ? "じょうほうを よみこめなかった…"
          : "しかし あいことばが ちがうようだ…");
    } finally {
      setBusy(false);
    }
  }

  function lock(message = "") {
    clearRememberedKey();
    clearLiveOverlay();
    setSession(null);
    setGateError(message);
  }

  if (!ready) {
    return (
      <main className="gate">
        <section className="win gate-card">よみこみ ちゅう…</section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="gate">
        <form className="win gate-card" onSubmit={unlock}>
          <h1>『あいことば を いれてください』</h1>
          <input
            type="password"
            name="passphrase"
            value={passphrase}
            autoFocus
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            aria-label="あいことば"
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <button className="submit" type="submit" disabled={busy}>
            {busy ? "たしかめている…" : "けってい"}
          </button>
          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            この きかいに おぼえる
          </label>
          {gateError ? <p className="gate-error">{gateError}</p> : null}
        </form>
      </main>
    );
  }

  return (
    <Office
      data={session.data}
      cryptoKey={session.key}
      onData={(data, key) => setSession({ data, key })}
      onLock={lock}
    />
  );
}
