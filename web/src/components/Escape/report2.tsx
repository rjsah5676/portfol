"use client";

import { useState } from "react";
import { HintBox, hintCount, mmss } from "./EscapeApp";
import type { Blank, Room, Section, State } from "./types";

/*
 * 보고서 v2 — 노트의 질문이 그대로 구간. 빈칸 문장 + 증거 하나.
 *  - 구간마다 "확인": 다 맞으면 잠김, 한 칸만 틀리면 "거의 맞음" (어느 칸인지는 안 알려 줌)
 *  - 틀린 확인은 등급에만 반영 (엔딩은 막지 않음). 덤 구간은 틀려도 무관
 *  - 현장 다시 둘러보기 · 보고서 힌트
 */

const BATANG = { fontFamily: "'Gowun Batang', serif" } as const;
const blanks = (sec: Section) => sec.parts.filter((p): p is Blank => typeof p !== "string");

/** S: 힌트 0 · 오답 0 / A: 오답 1 이하 · 힌트 2 이하 / B: 오답 3 이하 또는 힌트 5 이하 / C */
export function grade(s: State) {
  const h = hintCount(s);
  const m = s.miss ?? 0;
  if (!h && !m) return "S";
  if (m <= 1 && h <= 2) return "A";
  if (m <= 3 || h <= 5) return "B";
  return "C";
}

export function Report2({ room, s, setS }: { room: Room; s: State; setS: (fn: (s: State) => State) => void }) {
  const R = room.report2!;
  const fill = s.fill ?? {};
  const locks = s.locks ?? [];
  const [fb, setFb] = useState<Record<string, string>>({});
  const [hintOpen, setHintOpen] = useState(false);
  const [giveUp, setGiveUp] = useState(false);
  const seen = R.evidence.filter((e) => e.seen(s));
  const main = R.sections.filter((x) => !x.bonus);
  const allDone = main.every((x) => locks.includes(x.id));
  const current = room.hints.find((h) => h.report && !h.done(s));

  const put = (k: string, v: string) => setS((x) => ({ ...x, fill: { ...(x.fill ?? {}), [k]: v } }));
  const check = (sec: Section) => {
    const bs = blanks(sec);
    if (bs.some((b) => !fill[b.id])) return setFb((f) => ({ ...f, [sec.id]: "빈칸을 다 채워 주세요." }));
    const wrong = bs.filter((b) => !b.answer.includes(fill[b.id])).length;
    if (!wrong) {
      setS((x) => ({ ...x, locks: [...(x.locks ?? []), sec.id] }));
      setFb((f) => ({ ...f, [sec.id]: "" }));
      return;
    }
    if (!sec.bonus) setS((x) => ({ ...x, miss: (x.miss ?? 0) + 1 }));
    setFb((f) => ({ ...f, [sec.id]: wrong === 1 ? "거의 맞았어요 — 한 칸이 틀렸어요." : `틀린 칸이 ${wrong}개 있어요.` }));
  };
  const finish = (truth: boolean) => setS((x) => ({ ...x, phase: "end", result: { culprit: "", status: "", evidence: [], truth } }));

  return (
    <div className="mx-auto max-w-[680px] text-[#e9e4d8]">
      <div className="rounded-2xl border border-[#3a302a] bg-[#18151a] p-5">
        <p className="text-center text-[13px] tracking-[0.3em] text-[#b49b6a]">ESCAPED · {mmss((s.t1 ?? s.t0) - s.t0)}</p>
        <h2 className="mt-1 text-center text-[22px] font-black">사건 보고서</h2>
        <p className="mt-1 text-center text-[13px] text-[#a9a29a]" style={BATANG}>
          {R.intro}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => setS((x) => ({ ...x, phase: "review", open: null, sel: null }))}
            className="rounded-lg border border-[#5a4a2a] px-3 py-1.5 text-[13px] text-[#e9c46a]"
          >
            🔍 현장 다시 둘러보기 (시간 안 흐름)
          </button>
          <button onClick={() => setHintOpen((v) => !v)} className="rounded-lg border border-[#5a4a2a] px-3 py-1.5 text-[13px] text-[#e9c46a]">
            💡 힌트 {hintCount(s) ? `(${hintCount(s)})` : ""}
          </button>
        </div>
        {hintOpen && (
          <div className="mt-3">
            <HintBox current={current} s={s} setS={setS} />
          </div>
        )}

        {R.sections.map((sec, i) => {
          const locked = locks.includes(sec.id);
          return (
            <div key={sec.id} className={`mt-4 rounded-xl border p-3.5 ${locked ? "border-[#3d5a3a] bg-[#151c14]" : "border-[#33302f] bg-[#1d1a1e]"}`}>
              <p className="mb-2 text-[13px] font-bold text-[#e3b7a6]">
                {sec.bonus ? "덤" : `${i + 1}`}. {sec.title}
                {locked && <span className="ml-2 text-[#9fd18b]">✔ 확정</span>}
              </p>
              <p className="text-[15px] leading-[2.3]" style={BATANG}>
                {sec.parts.map((p, j) =>
                  typeof p === "string" ? (
                    <span key={j}>{p}</span>
                  ) : (
                    <select
                      key={p.id}
                      value={fill[p.id] ?? ""}
                      disabled={locked}
                      onChange={(e) => {
                        put(p.id, e.target.value);
                        setFb((f) => ({ ...f, [sec.id]: "" }));
                      }}
                      className={`mx-1 max-w-full rounded-md border px-1.5 py-0.5 text-[14px] ${
                        locked ? "border-[#3d5a3a] bg-[#1e2a1c] text-[#cfe8c4]" : "border-[#6b4a3a] bg-[#2a2220] text-[#f3e3c8]"
                      }`}
                    >
                      <option value="">{p.pick === "evidence" ? "( 증거 )" : "(      )"}</option>
                      {(p.pick === "evidence" ? seen : (p.options ?? [])).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )
                )}
              </p>
              {!locked && (
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => check(sec)} className="rounded-lg bg-[#c0392b] px-3 py-1 text-[13px] font-bold text-white">
                    확인
                  </button>
                  {fb[sec.id] && <span className="text-[13px] text-[#f0b8a8]">{fb[sec.id]}</span>}
                </div>
              )}
            </div>
          );
        })}
        <p className="mt-2 text-[12px] text-[#8f8676]">증거 칸에는 수색하면서 본 것만 나와요. 틀린 확인은 등급에만 반영돼요.</p>

        {allDone ? (
          <button onClick={() => finish(true)} className="mt-4 w-full rounded-xl bg-[#e9c46a] py-3 font-bold text-[#1d1a12]">
            보고 마치기
          </button>
        ) : giveUp ? (
          <div className="mt-4 rounded-xl border border-[#5a3a33] p-3 text-center text-[14px]">
            <p>못 채운 구간이 있어요. 이대로 보고하면 노멀 엔딩이에요.</p>
            <div className="mt-2 flex justify-center gap-2">
              <button onClick={() => finish(false)} className="rounded-lg border border-[#5a3a33] px-3 py-1.5">
                이대로 보고
              </button>
              <button onClick={() => setGiveUp(false)} className="rounded-lg bg-[#e9c46a] px-3 py-1.5 font-bold text-[#1d1a12]">
                더 써 보기
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setGiveUp(true)} className="mt-4 w-full rounded-xl border border-[#3a3326] py-2.5 text-[14px] text-[#a9a29a]">
            여기까지만 보고하기
          </button>
        )}
      </div>
    </div>
  );
}

/** 떡밥 회수: 처음 깔린 곳 → 그 뜻 */
export function Payoffs({ room }: { room: Room }) {
  return (
    <div className="mt-4 rounded-xl border border-[#3a302a] bg-[#141114] p-3.5">
      <p className="mb-2 text-[13px] font-bold tracking-wider text-[#e3b7a6]">🧷 떡밥 회수</p>
      <ul className="space-y-2 text-[14px] leading-snug" style={BATANG}>
        {room.report2!.payoffs.map((p, i) => (
          <li key={i}>
            <p className="text-[#a9a29a]">“{p.clue}”</p>
            <p className="pl-3 text-[#f0e6d6]">→ {p.meaning}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
