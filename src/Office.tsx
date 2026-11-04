import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { decryptWithRawKey, exportRawKey } from "../scripts/crypto.mjs";
import { mergeLiveNote, saveLiveOverlay, viewFromFile } from "./live-note";
import { fetchEnvelope, loadRememberedKey, saveRememberedKey } from "./session";
import { isOfficeData, type Article, type Member, type OfficeData, type Sale } from "./types";

const COMMANDS = ["しらべる", "つよさ", "ゴールド", "たたかう", "ひろば", "はなす"] as const;
type Cmd = (typeof COMMANDS)[number];
type Msg = { t: string; g?: number; fight?: boolean };

const MONSTERS = ["ぷるしずく", "ほねけんし", "いわゴーレム"];
const SEEN_KEY = "office-battled";
const TORCHES: [number, number][] = [[31.8, 6.5], [71.5, 6.5]];
const SPARKLES: [number, number, number][] = [[7.3, 15, 0], [90.4, 15, 1.3], [51.5, 5, 2.1], [51.5, 30, 0.7], [76, 47, 2.8], [84, 66, 1.8]];

const sumOf = (list: Sale[]) => list.reduce((total, sale) => total + sale.amount, 0);
const saleId = (sale: Sale, index: number) => `${index}|${sale.date}|${sale.member}|${sale.amount}`;

function loadSeen(memory: string[]): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return memory;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return memory;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return memory;
  }
}

function saveSeen(memory: { current: string[] }, ids: string[]) {
  memory.current = ids;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    /* keep the in-memory copy */
  }
}

export function Office({
  data,
  cryptoKey,
  onData,
  onLock,
}: {
  data: OfficeData;
  cryptoKey: CryptoKey;
  onData: (data: OfficeData, key: CryptoKey) => void;
  onLock: (message?: string) => void;
}) {
  const total = sumOf(data.sales);
  const rootRef = useRef<HTMLDivElement>(null);
  const seenMemory = useRef<string[]>([]);
  const keyRef = useRef(cryptoKey);
  keyRef.current = cryptoKey;

  const [scene, setScene] = useState<"office" | "battle">("office");
  const [cmd, setCmd] = useState<Cmd>("しらべる");
  const [cur, setCur] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>(data.log.map((t) => ({ t })));
  const [mi, setMi] = useState(0);
  const [chars, setChars] = useState(0);
  const [blink, setBlink] = useState(true);
  const [fightKey, setFightKey] = useState(0);
  const [fighting, setFighting] = useState(false);
  const [shownG, setShownG] = useState(total);
  const [targetG, setTargetG] = useState(total);
  const [refreshing, setRefreshing] = useState(false);

  const sales = [...data.sales].sort((a, b) => (a.date < b.date ? 1 : -1));
  const monthKey = data.updatedAt.slice(0, 7);
  const months: Record<string, number> = { [monthKey]: 0 };
  for (const sale of data.sales) {
    const key = sale.date.slice(0, 7);
    months[key] = (months[key] ?? 0) + sale.amount;
  }
  const goldOf = (id: string) => sumOf(data.sales.filter((sale) => sale.member === id));
  const artsOf = (account: string) => data.articles.filter((article) => article.account === account);
  const likesOf = (account: string) => artsOf(account).reduce((n, article) => n + article.likes, 0);
  const isNote = (member: Member) => Object.prototype.hasOwnProperty.call(data.noteFollowers, member.account);
  const memberOf = (id: string) => data.members.find((member) => member.id === id);
  const partyTop = data.members.filter((member) => member.joined).slice(0, 4);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setBlink((value) => !value), 420);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (shownG === targetG) return undefined;
    const step = Math.max(1, Math.ceil(Math.abs(targetG - shownG) / 12));
    const id = window.setTimeout(() => {
      setShownG((gold) => (gold < targetG ? Math.min(targetG, gold + step) : Math.max(targetG, gold - step)));
    }, 45);
    return () => window.clearTimeout(id);
  }, [shownG, targetG]);

  const curMsg = msgs[mi];
  const text = curMsg?.t ?? "";
  useEffect(() => {
    if (chars === 0 && curMsg) {
      if (curMsg.g !== undefined) setTargetG(curMsg.g);
      if (curMsg.fight) setFightKey((value) => value + 1);
    }
    if (chars < text.length) {
      const id = window.setTimeout(() => setChars((count) => count + 1), 60);
      return () => window.clearTimeout(id);
    }
    if (mi < msgs.length - 1) {
      const id = window.setTimeout(() => {
        setMi((index) => index + 1);
        setChars(0);
      }, 1500);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [chars, text, mi, msgs, curMsg]);

  function say(list: Msg[]) {
    setMsgs(list);
    setMi(0);
    setChars(0);
  }

  function battleScript(list: Sale[], startGold: number): Msg[] {
    const out: Msg[] = [];
    let gold = startGold;
    for (const sale of list) {
      const member = memberOf(sale.member);
      const index = Math.max(0, data.members.findIndex((item) => item.id === sale.member));
      const monster = MONSTERS[index % MONSTERS.length] ?? MONSTERS[0];
      gold += sale.amount;
      out.push({ t: `${monster}が あらわれた！`, fight: true });
      out.push({ t: `${member?.job ?? "なかま"}が ${member?.verb ?? "しょうひん"}を うった！（${sale.item}）` });
      out.push({ t: `${monster}を やっつけた！` });
      out.push({ t: `${sale.amount}ゴールドを てにいれた！`, g: gold });
    }
    return out;
  }

  function fight() {
    setScene("battle");
    const seen = loadSeen(seenMemory.current);
    const fresh = data.sales
      .map((sale, index) => ({ sale, id: saleId(sale, index) }))
      .filter((entry) => !seen.includes(entry.id));
    if (fresh.length === 0) {
      setFighting(false);
      setShownG(total);
      setTargetG(total);
      say([{ t: "まものの けはいを さぐった…" }, { t: "しかし なにも あらわれなかった…" }]);
      return;
    }
    const gained = fresh.reduce((sum, entry) => sum + entry.sale.amount, 0);
    const start = total - gained;
    setFighting(true);
    setShownG(start);
    setTargetG(start);
    saveSeen(seenMemory, [...seen, ...fresh.map((entry) => entry.id)]);
    say([
      { t: "まものの むれが あらわれた！" },
      ...battleScript(fresh.map((entry) => entry.sale), start),
      { t: `ぜんぶで ${gained}ゴールドを てにいれた！ いまの ゴールドは ${total}G。`, g: total },
    ]);
  }

  function replay(sale: Sale) {
    setScene("battle");
    setFighting(true);
    setShownG(total - sale.amount);
    setTargetG(total - sale.amount);
    say([{ t: "おもいでの たたかい…" }, ...battleScript([sale], total - sale.amount)]);
  }

  function run(command: Cmd) {
    setCmd(command);
    if (command === "たたかう") {
      fight();
      return;
    }
    setShownG(total);
    setTargetG(total);
    if (command === "ひろば") {
      setScene("office");
      setFighting(false);
      say([{ t: "おうさまは ぎょくざに もどった。" }, ...data.log.map((line) => ({ t: line }))]);
    } else if (command === "しらべる") {
      say([
        { t: "おうさまは あたりを しらべた。" },
        { t: `noteの きじは ${data.articles.length}ほん。 ゴールドは ぜんぶで ${total}G。` },
      ]);
    } else if (command === "つよさ") {
      const joined = data.members.filter((member) => member.joined).length;
      say([{ t: "なかまの つよさを みた。" }, { t: `いま なかまは ${joined}にん。` }]);
    } else if (command === "ゴールド") {
      say([
        { t: "ゴールドの きろくを ひらいた。" },
        { t: sales[0] ? `さいごに ${sales[0].amount}Gを てにいれた。 きろくを えらぶと もういちど たたかえる。` : "まだ ゴールドは ふくろの なかに ない。" },
      ]);
    } else {
      say([
        { t: "だいじん「noteの うりあげは まいつき 2かに かくていしますぞ。」" },
        { t: "だいじん「1000えん いじょうで ひきだせます。 てすうりょうは 270えん。」" },
        { t: "だいじん「180にち そのままだと Amazonギフトけんに なりますぞ。」" },
      ]);
    }
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      setCur((index) => (index + 1) % COMMANDS.length);
      event.preventDefault();
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      setCur((index) => (index + COMMANDS.length - 1) % COMMANDS.length);
      event.preventDefault();
    } else if (event.key === "Enter" || event.key === " ") {
      const selected = COMMANDS[cur];
      if (selected) run(selected);
      event.preventDefault();
    }
  }

  function advance() {
    if (chars < text.length) setChars(text.length);
    else if (mi < msgs.length - 1) {
      setMi(mi + 1);
      setChars(0);
    }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    say([{ t: "よみこみ ちゅう…" }]);
    try {
      const envelope = await fetchEnvelope(true);
      const raw = await exportRawKey(keyRef.current);
      const opened = await decryptWithRawKey(envelope, raw);
      if (!isOfficeData(opened.data)) throw new Error("format");
      if (loadRememberedKey()) saveRememberedKey(raw);
      const file = opened.data;
      let view = file;
      let live = false;
      try {
        view = await mergeLiveNote(file);
        if (view.sales !== file.sales) throw new Error("live");
        saveLiveOverlay(view);
        live = true;
      } catch {
        view = viewFromFile(file);
      }
      onData(view, opened.key);
      const nextTotal = sumOf(view.sales);
      setShownG(nextTotal);
      setTargetG(nextTotal);
      say(live
        ? [
          { t: "さいしんの じょうほうを よみこんだ！" },
          { t: `${view.updatedAt} いまの きろくだ。` },
        ]
        : [
          { t: "きろくを よみこんだ。" },
          { t: `この きろくは ${file.updatedAt} のものだ。` },
          { t: `さいしんは けさ 6:45に とどきます。この きろくは ${file.updatedAt} だ。` },
        ]);
    } catch (error) {
      if (error instanceof Error && error.message === "auth") {
        onLock("しかし あいことばが ちがうようだ…");
        return;
      }
      say([{ t: "じょうほうを よみこめなかった…" }]);
    } finally {
      setRefreshing(false);
    }
  }

  const sceneFile = scene === "office" ? "./scenes/office.webp" : "./scenes/battle.webp";

  return (
    <div className="app" lang="ja" tabIndex={0} ref={rootRef} onKeyDown={onKey}>
      <div className="layout">
        <div className="stage-col">
          <div key={scene === "battle" ? fightKey : "office"} className={scene === "battle" && fighting ? "stage fighting" : "stage"}>
            {scene === "office" ? (
              <>
                <img src={sceneFile} alt="ふくぎょう オフィス" width={1280} height={720} />
                {TORCHES.map(([x, y], index) => (
                  <div
                    key={index}
                    className="torch"
                    style={{ left: `${x}%`, top: `${y}%`, animation: `flick ${1.1 + index * 0.37}s steps(4) infinite` }}
                  />
                ))}
                {SPARKLES.map(([x, y, delay], index) => (
                  <div key={index} className="spark" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s` }}>✦</div>
                ))}
                <div className="vignette" />
              </>
            ) : (
              <>
                <img className={fighting ? undefined : "dim"} src={sceneFile} alt="せんとう" width={1280} height={720} />
                {!fighting ? <div className="breath" /> : null}
                <div className="battle-hud">
                  <div className="win battle-party">
                    {partyTop.map((member) => (
                      <div key={member.id}>
                        <div>{member.job}</div>
                        <div>G {goldOf(member.id)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="win battle-gold">G {shownG}</div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="side-col">
          <div className="win">
            <div className="commands">
              {COMMANDS.map((command, index) => (
                <button
                  key={command}
                  type="button"
                  className="cmd"
                  onClick={() => {
                    setCur(index);
                    run(command);
                  }}
                  onMouseEnter={() => setCur(index)}
                >
                  <span className="cursor" style={{ visibility: cur === index && blink ? "visible" : "hidden" }}>▶</span>
                  {command}
                </button>
              ))}
            </div>
          </div>
          <div className="win">
            <div className="record-time">きろく {data.updatedAt}</div>
            <button type="button" className="text-btn" onClick={() => void refresh()} disabled={refreshing}>
              『さいしんの じょうほうを よみこむ』
            </button>
            <button type="button" className="text-btn quiet" onClick={() => onLock()}>
              あいことばを わすれる
            </button>
          </div>
          <div className="win gold-line">
            <span className="gold-mark">G</span>
            <span>{shownG.toLocaleString("ja-JP")}</span>
          </div>
          <div className="win">
            <div>おう（ボス）</div>
            {data.members.map((member) => (
              <div key={member.id} className={member.joined ? "party-row" : "party-row away"}>
                <span>{member.job}</span>
                <span className="party-meta">{member.joined ? `${member.tag} ${goldOf(member.id)}G` : "まだ"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="message win" onClick={advance}>
          <div>{text.slice(0, chars)}</div>
          <div className="more" style={{ visibility: chars >= text.length && mi < msgs.length - 1 && blink ? "visible" : "hidden" }}>▼</div>
        </div>

        <div className="detail win">
          {(cmd === "しらべる" || cmd === "はなす") && (
            <div>
              <div className="section">▶ ばしょの ようす（{data.updatedAt} げんざい）</div>
              {data.members.map((member) => (
                <div key={member.id} className="row">
                  <span>
                    {member.job}｜{member.place}{member.account !== "-" ? `（${member.account}）` : ""}
                  </span>
                  <span className="grow">
                    {member.status}
                    {isNote(member) ? ` ／ フォロワー${data.noteFollowers[member.account] ?? 0}・スキ${likesOf(member.account)}` : ""}
                  </span>
                  <span>{goldOf(member.id)}G</span>
                </div>
              ))}
              <div className="section">▶ noteの きじいちらん</div>
              {data.articles.map((article: Article) => {
                const member = data.members.find((item) => item.account === article.account);
                return (
                  <div key={article.key} className="row">
                    <span className="party-meta">{member?.job ?? article.account}</span>
                    <span className="grow">{article.title}</span>
                    <span className="party-meta">{article.price}えん・スキ{article.likes}</span>
                  </div>
                );
              })}
              <div className="footnote">
                noteの うりあげ：まいつき2かに かくてい・1000えん いじょうで ひきだし（てすうりょう270えん）・180にち すぎると Amazonギフトけんに なる
              </div>
            </div>
          )}
          {cmd === "つよさ" && (
            <div className="cards">
              {data.members.map((member) => (
                <div key={member.id} className={member.joined ? "card" : "card away"}>
                  <div className="job">{member.job}</div>
                  <div className="bot">{member.bot}</div>
                  <div>レベル {1 + data.sales.filter((sale) => sale.member === member.id).length}</div>
                  <div>しごと {member.works}</div>
                  <div>へんじまち {member.pending}</div>
                  {isNote(member) ? <div>フォロワー {data.noteFollowers[member.account] ?? 0}</div> : null}
                  {isNote(member) ? <div>スキ {likesOf(member.account)}</div> : null}
                  <div>ゴールド {goldOf(member.id)}</div>
                  {!member.joined ? <div className="soon">まだ なかまに なっていない</div> : null}
                </div>
              ))}
            </div>
          )}
          {cmd === "ゴールド" && (
            <div>
              <div className="section">▶ つきごとの ゴールド</div>
              {Object.keys(months).sort().reverse().map((key) => (
                <div key={key} className="row">
                  <span>{key.replace("-", "ねん ")}がつ</span>
                  <span>{months[key]}G</span>
                </div>
              ))}
              {sales.map((sale, index) => (
                <button key={`${sale.date}-${index}`} type="button" className="row" onClick={() => replay(sale)}>
                  <span>▶ {sale.date}</span>
                  <span>{memberOf(sale.member)?.job}</span>
                  <span className="grow">{sale.item}</span>
                  <span>{sale.amount}G</span>
                </button>
              ))}
            </div>
          )}
          {(cmd === "たたかう" || cmd === "ひろば") && (
            <div>
              <div className="section">▶ きょうの できごと</div>
              {data.log.map((line, index) => (
                <div key={index}>・{line}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
