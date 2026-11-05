"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";

/*
 * 오늘의 조합 — 재료 두 개를 골라 합치면 AI 연금술사가 결과를 정함 (같은 두 재료는 누구에게나 늘 같은 결과).
 *  - 오늘의 목표: 물 · 불 · 바람 · 흙 4개에서 시작해 목표 원소를 최소 조합으로. 골프식 타수 (기준 타수 = 서버가 계산한 최단)
 *  - 자유 조합: 지금까지 만든 원소 전부로 마음대로 (타수 없음). 만든 원소는 도감에 쌓임
 *  - 처음 만든 원소엔 최초 발견자 이름이 남음
 * 진행은 브라우저(localStorage)에만. 서버엔 조합 결과 · 오늘 클리어 기록만.
 */

interface El {
  name: string;
  emoji: string;
}
interface Today {
  enabled: boolean;
  day: string;
  starters: El[];
  target: El | null;
  par: number | null;
  stats: { solved: number; avg: number | null };
}
interface CombineRes {
  result: El & { firstBy: string | null };
  newRecipe: boolean;
  newElement: boolean;
}
/** 조합 기록 한 줄: [a, b, 결과, 나한테 새로 생긴 원소였나] */
type Step = [string, string, string, boolean];
interface DayState {
  day: string;
  have: string[];
  log: Step[];
  hints: number;
  /** 받은 힌트 문구 */
  hintText: string[];
  done: boolean;
}

/** 힌트 값 (타수): 1번째 = 다음 원소 이름, 2번째 = 재료까지 */
const HINT_COST = [2, 3];
const DAY_KEY = "craft.day";
const BOOK_KEY = "craft.book";
const FIRST_KEY = "craft.firsts";
const CID_KEY = "craft.cid";

const load = <T,>(k: string, def: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
};
const store = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // 저장 안 되면 이번 창에서만
  }
};
const clientId = () => {
  let id = load<string>(CID_KEY, "");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    store(CID_KEY, id);
  }
  return id;
};
const hintCost = (n: number) => HINT_COST.slice(0, n).reduce((a, b) => a + b, 0);

/** 목표까지 실제로 거친 조합만 골라냄 (내 기록에서 각 원소를 처음 만든 줄 기준) */
function myPath(log: Step[], target: string, starters: Set<string>) {
  const madeBy = new Map<string, Step>();
  for (const s of log) if (s[3] && !madeBy.has(s[2])) madeBy.set(s[2], s);
  const out: Step[] = [];
  const seen = new Set<string>();
  const walk = (x: string) => {
    if (starters.has(x) || seen.has(x)) return;
    seen.add(x);
    const s = madeBy.get(x);
    if (!s) return;
    walk(s[0]);
    walk(s[1]);
    out.push(s);
  };
  walk(target);
  return out;
}

export default function CraftApp() {
  const [today, setToday] = useState<Today | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"daily" | "free">("daily");
  const [book, setBook] = useState<Record<string, string>>({});
  const [firsts, setFirsts] = useState<string[]>([]);
  const [st, setSt] = useState<DayState | null>(null);
  const [slot, setSlot] = useState<[string | null, string | null]>([null, null]);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<(CombineRes & { a: string; b: string }) | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "abc">("new");
  const [showClear, setShowClear] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // 처음: 오늘 정보 + 저장된 진행
  useEffect(() => {
    api<Today>("/api/craft/today")
      .then((t) => {
        const saved = load<DayState | null>(DAY_KEY, null);
        const bk = load<Record<string, string>>(BOOK_KEY, {});
        for (const s of t.starters) bk[s.name] = s.emoji;
        setBook(bk);
        setFirsts(load(FIRST_KEY, []));
        setSt(saved && saved.day === t.day ? saved : { day: t.day, have: [], log: [], hints: 0, hintText: [], done: false });
        setToday(t);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "불러오지 못했어요."));
  }, []);

  useEffect(() => {
    if (st) store(DAY_KEY, st);
  }, [st]);
  useEffect(() => {
    if (Object.keys(book).length) store(BOOK_KEY, book);
  }, [book]);
  useEffect(() => {
    if (today) store(FIRST_KEY, firsts);
  }, [firsts, today]);

  const starters = useMemo(() => new Set(today?.starters.map((s) => s.name) ?? []), [today]);
  const emojiOf = useCallback((n: string) => book[n] ?? "✨", [book]);

  /** 지금 모드의 재료 목록 (발견 순) */
  const inventory = useMemo(() => {
    if (!today || !st) return [] as string[];
    const base = today.starters.map((s) => s.name);
    const list = mode === "daily" ? [...base, ...st.have] : [...base, ...Object.keys(book).filter((n) => !starters.has(n))];
    return [...new Set(list)];
  }, [today, st, mode, book, starters]);

  const shown = useMemo(() => {
    const k = q.trim();
    const xs = k ? inventory.filter((n) => n.includes(k)) : inventory;
    return sort === "abc" ? [...xs].sort((a, b) => a.localeCompare(b, "ko")) : [...xs].reverse();
  }, [inventory, q, sort]);

  const score = (st?.log.length ?? 0) + hintCost(st?.hints ?? 0);

  const combine = useCallback(
    async (a: string, b: string) => {
      if (!today || !st) return;
      setBusy(true);
      try {
        const r = await api<CombineRes>("/api/craft/combine", { method: "POST", body: { a, b }, auth: true, timeoutMs: 30_000 });
        const name = r.result.name;
        setLast({ ...r, a, b });
        setBook((bk) => (bk[name] ? bk : { ...bk, [name]: r.result.emoji }));
        if (r.newElement) setFirsts((f) => (f.includes(name) ? f : [...f, name]));
        if (mode === "daily" && !st.done) {
          const fresh = !starters.has(name) && !st.have.includes(name);
          const next: DayState = { ...st, have: fresh ? [...st.have, name] : st.have, log: [...st.log, [a, b, name, fresh]] };
          if (today.target && name === today.target.name) {
            next.done = true;
            api<{ stats: Today["stats"] }>("/api/craft/done", {
              method: "POST",
              body: { day: today.day, crafts: next.log.length + hintCost(next.hints), hints: next.hints, clientId: clientId() },
              auth: true,
            })
              .then((d) => setToday((t) => (t ? { ...t, stats: d.stats } : t)))
              .catch(() => {});
            setTimeout(() => setShowClear(true), 700);
          }
          setSt(next);
        }
      } catch (e) {
        say(e instanceof ApiError ? e.message : "합치지 못했어요. 다시 해 주세요.");
      } finally {
        setBusy(false);
        setSlot([null, null]);
      }
    },
    [today, st, mode, starters, say]
  );

  const tap = (n: string) => {
    if (busy) return;
    if (!slot[0]) setSlot([n, null]);
    else {
      setSlot([slot[0], n]);
      void combine(slot[0], n);
    }
  };

  const hint = async () => {
    if (!today || !st || st.done || st.hints >= 2) return;
    const level = (st.hints + 1) as 1 | 2;
    try {
      const r = await api<{ hint: { name: string; emoji: string; from?: [string, string] } | null }>("/api/craft/hint", {
        method: "POST",
        body: { day: today.day, have: st.have, level },
      });
      if (!r.hint) return say("지금 가진 재료로 바로 목표를 만들 수 있어요!");
      const h = r.hint;
      const text = h.from ? `${h.emoji} ${h.name} = ${h.from[0]} + ${h.from[1]}` : `다음엔 ${h.emoji} ${h.name}을(를) 만들어 보세요`;
      setSt({ ...st, hints: st.hints + 1, hintText: [...st.hintText, text] });
    } catch (e) {
      say(e instanceof ApiError ? e.message : "힌트를 못 받았어요.");
    }
  };

  const squares = (log: Step[], target: string) => log.map((s) => (s[2] === target ? "🎯" : s[3] ? "🟩" : "⬜")).join("");
  const share = async () => {
    if (!today?.target || !st) return;
    const t = `오늘의 조합 ${today.day.slice(5).replace("-", "/")}\n${today.target.emoji} ${today.target.name} · ${score}타 (기준 ${today.par})${st.hints ? ` · 힌트 ${st.hints}` : ""}\n${squares(st.log, today.target.name)}\nhttps://gunmo.my/games/craft`;
    try {
      if (navigator.share) await navigator.share({ text: t });
      else {
        await navigator.clipboard.writeText(t);
        say("결과를 복사했어요.");
      }
    } catch {
      // 공유 취소
    }
  };

  if (err) return <p className="py-16 text-center text-[15px] text-[#c9b9a0]">{err}</p>;
  if (!today || !st) return <p className="py-16 text-center text-[15px] text-[#c9b9a0]">작업대 펴는 중…</p>;

  const target = today.target;
  const done = st.done;
  const path = done && target ? myPath(st.log, target.name, starters) : [];

  return (
    <div className="mx-auto w-full max-w-[1040px] text-[#EDE6D6]">
      {/* 모드 */}
      <div className="mb-3 flex gap-1 rounded-xl bg-[#1b1d24] p-1 text-[14px] font-semibold">
        {(["daily", "free"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setSlot([null, null]);
              setLast(null);
            }}
            className={`flex-1 rounded-lg py-2 transition ${mode === m ? "bg-[#E9B949] text-[#1b1406]" : "text-[#a99f8c] hover:text-[#EDE6D6]"}`}
          >
            {m === "daily" ? "🎯 오늘의 목표" : `📖 자유 조합 · 도감 ${Object.keys(book).length}`}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* 왼쪽: 목표 · 작업대 · 기록 */}
        <div className="flex flex-col gap-3">
          {mode === "daily" && (
            <section className="rounded-2xl border border-[#3a3326] bg-gradient-to-br from-[#231f17] to-[#17181d] p-4">
              {target ? (
                <div className="flex items-center gap-4">
                  <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-[#0f1014] text-[44px] shadow-inner">{target.emoji}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] tracking-[0.2em] text-[#b49b6a]">TODAY · {today.day.slice(5).replace("-", "/")}</p>
                    <h2 className="truncate text-[26px] leading-tight font-black">{target.name}</h2>
                    <p className="mt-0.5 text-[13px] text-[#a99f8c]">
                      물 · 불 · 바람 · 흙에서 시작 · 기준 <b className="text-[#E9B949]">{today.par}타</b>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-[#a99f8c]">내 타수</p>
                    <p className={`text-[30px] leading-none font-black ${done ? "text-[#7ed39a]" : ""}`}>{score}</p>
                  </div>
                </div>
              ) : (
                <p className="text-[14px] text-[#c9b9a0]">오늘 목표를 준비하고 있어요. 그동안 자유 조합으로 놀아 주세요.</p>
              )}
              {target && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                  {!done && (
                    <button
                      onClick={hint}
                      disabled={st.hints >= 2}
                      className="rounded-lg border border-[#5a4a2a] px-3 py-1.5 text-[#E9B949] hover:bg-[#2a2418] disabled:opacity-40"
                    >
                      💡 힌트 {st.hints < 2 ? `(+${HINT_COST[st.hints]}타)` : "다 씀"}
                    </button>
                  )}
                  {done && (
                    <button onClick={() => setShowClear(true)} className="rounded-lg bg-[#7ed39a] px-3 py-1.5 font-bold text-[#0d1f14]">
                      🎉 클리어 · 결과 보기
                    </button>
                  )}
                  <span className="text-[#8f8676]">
                    오늘 {today.stats.solved}명 클리어{today.stats.avg != null ? ` · 평균 ${today.stats.avg}타` : ""}
                  </span>
                </div>
              )}
              {st.hintText.length > 0 && (
                <ul className="mt-2 space-y-1 text-[13px] text-[#E9B949]">
                  {st.hintText.map((t, i) => (
                    <li key={i}>💡 {t}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* 작업대 */}
          <section className="sticky top-2 z-10 rounded-2xl border border-[#2c2f3a] bg-[#14161c]/95 p-3 backdrop-blur">
            <div className="flex items-center justify-center gap-1.5 sm:gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-center gap-1.5 sm:gap-3">
                  {i === 1 && <span className="text-[20px] text-[#6d6658]">+</span>}
                  <button
                    onClick={() => !busy && setSlot(i === 0 ? [null, null] : [slot[0], null])}
                    className={`grid h-[72px] w-[84px] place-items-center rounded-xl border-2 border-dashed text-center sm:w-[104px] ${
                      slot[i] ? "border-[#E9B949] bg-[#221d12]" : "border-[#363a47] text-[#5c5a52]"
                    }`}
                  >
                    {slot[i] ? (
                      <span>
                        <span className="block text-[26px] leading-none">{emojiOf(slot[i]!)}</span>
                        <span className="mt-1 block max-w-[80px] truncate text-[13px] font-bold sm:max-w-[96px]">{slot[i]}</span>
                      </span>
                    ) : (
                      <span className="text-[12px]">재료 {i + 1}</span>
                    )}
                  </button>
                </div>
              ))}
              <span className="text-[20px] text-[#6d6658]">=</span>
              <div
                className={`grid h-[72px] w-[92px] place-items-center rounded-xl sm:w-[116px] ${
                  busy ? "animate-pulse bg-[#221d12]" : last ? "bg-[#1f2a22]" : "bg-[#1b1d24]"
                }`}
              >
                {busy ? (
                  <span className="text-center text-[12px] text-[#E9B949]">
                    연금술사가
                    <br />
                    생각 중…
                  </span>
                ) : last ? (
                  <span key={`${last.a}+${last.b}`} className="craft-pop text-center">
                    <span className="block text-[30px] leading-none">{last.result.emoji}</span>
                    <span className="mt-1 block max-w-[86px] truncate text-[14px] font-black sm:max-w-[106px]">{last.result.name}</span>
                  </span>
                ) : (
                  <span className="text-[12px] text-[#5c5a52]">결과</span>
                )}
              </div>
            </div>
            <p className="mt-2 min-h-[18px] text-center text-[12px] text-[#a99f8c]">
              {busy
                ? "처음 나온 조합이에요. 잠깐만요"
                : last
                  ? last.newElement
                    ? "★ 최초 발견! 이 원소를 세상에서 처음 만들었어요"
                    : last.newRecipe
                      ? "✨ 아무도 안 해 본 조합이었어요"
                      : last.result.firstBy
                        ? `처음 만든 사람: ${last.result.firstBy}`
                        : `${last.a} + ${last.b}`
                  : slot[0]
                    ? "하나 더 고르세요 (같은 걸 또 골라도 돼요)"
                    : "아래 재료를 두 개 골라 합쳐 보세요"}
            </p>
          </section>

          {mode === "daily" && st.log.length > 0 && (
            <section className="hidden rounded-2xl border border-[#2c2f3a] bg-[#14161c] p-3 lg:block">
              <p className="mb-2 text-[12px] tracking-[0.15em] text-[#8f8676]">오늘 조합 기록 · {st.log.length}번</p>
              <ol className="max-h-[260px] space-y-1 overflow-y-auto pr-1 text-[13px]">
                {[...st.log].reverse().map((s, i) => (
                  <li key={i} className={s[3] ? "" : "text-[#7d7668]"}>
                    {emojiOf(s[0])} {s[0]} + {emojiOf(s[1])} {s[1]} → <b>{emojiOf(s[2])} {s[2]}</b>
                    {!s[3] && " (이미 있음)"}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {/* 오른쪽: 재료 */}
        <section className="rounded-2xl border border-[#2c2f3a] bg-[#14161c] p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`재료 ${inventory.length}개에서 찾기`}
              className="min-w-0 flex-1 rounded-lg border border-[#2c2f3a] bg-[#0f1014] px-3 py-2 text-[14px] outline-none focus:border-[#E9B949]"
            />
            <button
              onClick={() => setSort(sort === "new" ? "abc" : "new")}
              className="shrink-0 rounded-lg border border-[#2c2f3a] px-3 py-2 text-[13px] text-[#a99f8c]"
            >
              {sort === "new" ? "최근순" : "가나다"}
            </button>
          </div>
          <div className="flex max-h-[62vh] flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
            {shown.map((n) => (
              <button
                key={n}
                onClick={() => tap(n)}
                disabled={busy}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[14px] font-semibold transition active:scale-95 ${
                  slot[0] === n ? "border-[#E9B949] bg-[#2a2418]" : "border-[#2f3340] bg-[#1b1d24] hover:border-[#5a4a2a]"
                }`}
              >
                <span className="text-[17px] leading-none">{emojiOf(n)}</span>
                {n}
                {firsts.includes(n) && <span className="text-[10px] text-[#E9B949]">★</span>}
              </button>
            ))}
            {!shown.length && <p className="p-3 text-[13px] text-[#7d7668]">없어요.</p>}
          </div>
          <p className="mt-2 text-[11px] text-[#6d6658]">★ = 내가 최초 발견 · 같은 두 재료는 누가 합쳐도 늘 같은 결과예요</p>
        </section>
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#2a2418] px-4 py-2.5 text-[14px] text-[#EDE6D6] shadow-lg">{toast}</div>}

      {/* 클리어 */}
      {showClear && target && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setShowClear(false)}>
          <div className="craft-pop w-full max-w-[420px] rounded-2xl border border-[#3a3326] bg-[#17181d] p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-[13px] tracking-[0.2em] text-[#b49b6a]">CLEAR</p>
            <p className="mt-1 text-center text-[52px] leading-none">{target.emoji}</p>
            <h3 className="mt-1 text-center text-[24px] font-black">{target.name} 완성!</h3>
            <p className="mt-1 text-center text-[15px]">
              <b className="text-[#7ed39a]">{score}타</b>{" "}
              <span className="text-[#a99f8c]">
                (기준 {today.par}타{st.hints ? ` · 힌트 ${st.hints}` : ""})
              </span>
            </p>
            <p className="mt-3 text-center text-[20px] tracking-[2px] break-all">{squares(st.log, target.name)}</p>
            {path.length > 0 && (
              <ol className="mt-3 space-y-0.5 rounded-xl bg-[#0f1014] p-3 text-[13px]">
                {path.map((s, i) => (
                  <li key={i}>
                    {s[0]} + {s[1]} → <b>{emojiOf(s[2])} {s[2]}</b>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-center text-[12px] text-[#8f8676]">
              오늘 {today.stats.solved}명 클리어{today.stats.avg != null ? ` · 평균 ${today.stats.avg}타` : ""}
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={share} className="flex-1 rounded-xl bg-[#E9B949] py-2.5 font-bold text-[#1b1406]">
                결과 공유
              </button>
              <button
                onClick={() => {
                  setShowClear(false);
                  setMode("free");
                }}
                className="flex-1 rounded-xl border border-[#3a3326] py-2.5 text-[#EDE6D6]"
              >
                자유 조합 하러 가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
