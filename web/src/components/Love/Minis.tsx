"use client";

/*
 * 올인 러브 미니게임 (전부 2~3분 안, 스킵 가능, 실패해도 이야기는 진행)
 *  DealMini — 딜링 근무: 돌아가는 불빛이 금색 자리에 올 때 「딜」
 *  TellMini — 텔 읽기: 히로인 말이 진심인지 블러프인지
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TellSpec } from "@/lib/love/types";
import { CARD_BACK, FACE_ICON, NAME } from "@/lib/love/assets";

const SEATS = [
  { x: 50, y: 84 },
  { x: 18, y: 66 },
  { x: 22, y: 26 },
  { x: 50, y: 14 },
  { x: 78, y: 26 },
  { x: 82, y: 66 },
];
const ROUNDS = 5;

export function DealMini({ onDone, play }: { onDone: (score: number) => void; play: (id: "deal" | "chip" | "lose") => void }) {
  const [round, setRound] = useState(0);
  const [cur, setCur] = useState(0);
  const [target, setTarget] = useState(() => 1 + Math.floor(Math.random() * 5));
  const [score, setScore] = useState(0);
  const [flash, setFlash] = useState<"hit" | "miss" | null>(null);
  const [fly, setFly] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const lock = useRef(false);
  const done = round >= ROUNDS;

  // 불빛이 자리를 도는 속도: 라운드마다 빨라짐
  useEffect(() => {
    if (!started || done) return;
    const ms = 420 - round * 45;
    const id = window.setInterval(() => setCur((c) => (c + 1) % SEATS.length), ms);
    return () => window.clearInterval(id);
  }, [started, round, done]);

  const hit = useCallback(() => {
    if (!started || done || lock.current) return;
    lock.current = true;
    const ok = cur === target;
    play(ok ? "deal" : "lose");
    setFlash(ok ? "hit" : "miss");
    setFly(cur);
    if (ok) setScore((n) => n + 1);
    window.setTimeout(() => {
      setFlash(null);
      setFly(null);
      setRound((r) => r + 1);
      setTarget((t) => {
        let n = t;
        while (n === t) n = 1 + Math.floor(Math.random() * 5);
        return n;
      });
      lock.current = false;
    }, 650);
  }, [started, done, cur, target, play]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (!started) setStarted(true);
        else hit();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [hit, started]);

  return (
    <div className="lv-mini absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/70 backdrop-blur-[2px]">
      <div className="lv-mini-title">딜링 근무</div>
      <div onClick={() => (started ? hit() : setStarted(true))} className="relative mt-2 aspect-[16/10] w-[62%] cursor-pointer rounded-[50%] border-[6px] border-[#5a3a1c] bg-[radial-gradient(ellipse_at_center,#1f6b46,#0e3b26)] shadow-[0_0_0_3px_#c9a25a_inset,0_20px_50px_#0009]">
        {SEATS.map((p, i) => (
          <div
            key={i}
            className={`absolute grid h-[15%] w-[10%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-[clamp(10px,1.2vw,15px)] font-bold transition-all duration-100 ${
              i === 0 ? "border-white/40 bg-white/10 text-white/70" : i === target ? "border-[#ffd27a] bg-[#ffd27a]/25 text-[#ffd27a] shadow-[0_0_18px_#ffd27a]" : "border-white/25 bg-black/20 text-white/50"
            } ${i === cur && started && !done ? "scale-125 !bg-white/80 !text-black" : ""}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {i === 0 ? "딜러" : i}
          </div>
        ))}
        {fly !== null && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={CARD_BACK} alt="" className="lv-fly absolute h-[16%] -translate-x-1/2 -translate-y-1/2" style={{ left: `${SEATS[fly].x}%`, top: `${SEATS[fly].y}%` }} />
        )}
        {flash && <div className={`absolute inset-0 grid place-items-center text-[clamp(18px,3vw,40px)] font-black ${flash === "hit" ? "text-[#ffd27a]" : "text-[#ff6b6b]"}`}>{flash === "hit" ? "NICE DEAL" : "MISS"}</div>}
      </div>
      <div className="mt-3 text-[clamp(11px,1.3vw,16px)] text-white/80">
        {!started ? "불빛이 금색 자리에 왔을 때 「딜」 (스페이스 · 화면 터치)" : done ? `결과 ${score} / ${ROUNDS}` : `${round + 1} / ${ROUNDS} · ${target}번 자리에 카드를!`}
      </div>
      <div className="mt-3 flex gap-3">
        {!done ? (
          <button className="lv-btn-gold" onClick={() => (started ? hit() : setStarted(true))}>
            {started ? "딜!" : "시작"}
          </button>
        ) : (
          <button className="lv-btn-gold" onClick={() => onDone(score)}>
            계속
          </button>
        )}
        {!done && (
          <button className="lv-btn-ghost" onClick={() => onDone(3)}>
            건너뛰기
          </button>
        )}
      </div>
    </div>
  );
}

export function TellMini({ tell, onDone }: { tell: TellSpec; onDone: (correct: number) => void }) {
  const [shown, setShown] = useState(0);
  const [left, setLeft] = useState(12);
  const [res, setRes] = useState<boolean | null>(null);

  useEffect(() => {
    if (shown >= tell.cues.length) return;
    const id = window.setTimeout(() => setShown((n) => n + 1), 1300);
    return () => window.clearTimeout(id);
  }, [shown, tell.cues.length]);

  useEffect(() => {
    if (res !== null || shown < tell.cues.length) return;
    if (left <= 0) {
      setRes(false);
      return;
    }
    const id = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left, res, shown, tell.cues.length]);

  const answer = (a: "true" | "bluff") => setRes(a === tell.truth);

  return (
    <div className="lv-mini absolute inset-x-0 bottom-0 z-40 flex h-[46%] flex-col items-center justify-start bg-gradient-to-t from-black/90 via-black/80 to-transparent px-[6%] pt-[2%]">
      <div className="lv-mini-title">텔 읽기</div>
      <div className="mt-1 text-[clamp(13px,1.7vw,22px)] font-semibold text-white">
        {NAME[tell.who]} : 「{tell.claim}」
      </div>
      <ul className="mt-2 space-y-1 text-[clamp(11px,1.3vw,16px)] text-[#d8cfa8]">
        {tell.cues.slice(0, shown).map((c) => (
          <li key={c} className="lv-cue">
            · {c}
          </li>
        ))}
      </ul>
      {res === null ? (
        <div className="mt-3 flex items-center gap-3">
          <button className="lv-btn-gold" disabled={shown < tell.cues.length} onClick={() => answer("true")}>
            진심이다
          </button>
          <button className="lv-btn-gold" disabled={shown < tell.cues.length} onClick={() => answer("bluff")}>
            블러프다
          </button>
          {shown >= tell.cues.length && <span className="text-[clamp(11px,1.2vw,14px)] text-white/60">{left}초</span>}
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-2">
          <div className={`text-[clamp(14px,2vw,26px)] font-black ${res ? "text-[#ffd27a]" : "text-white/70"}`}>{res ? "읽었다." : "…모르겠다."}</div>
          <button className="lv-btn-gold" onClick={() => onDone(res ? 1 : 0)}>
            계속
          </button>
        </div>
      )}
    </div>
  );
}

// ================= 스토리 포커 =================
const SUIT: Record<string, { s: string; red: boolean }> = { s: { s: "♠", red: false }, h: { s: "♥", red: true }, d: { s: "♦", red: true }, c: { s: "♣", red: false } };
function Card({ c, back, big, dim }: { c?: string; back?: boolean; big?: boolean; dim?: boolean }) {
  const w = big ? "w-[5.6cqw]" : "w-[4.4cqw]";
  if (back || !c)
    return (
      <img src={CARD_BACK} alt="" className={`${w} aspect-[5/7] rounded-[0.4cqw] shadow-[0_0.3cqw_0.8cqw_#0009] transition-opacity ${dim ? "opacity-25" : ""}`} />
    );
  const r = c[0] === "T" ? "10" : c[0];
  const su = SUIT[c[1]];
  return (
    <div className={`lv-card ${w} aspect-[5/7] ${su.red ? "text-[#d0263b]" : "text-[#16181f]"}`}>
      <span className="absolute left-[8%] top-[4%] text-[1.5cqw] font-black leading-none">{r}</span>
      <span className="text-[2.6cqw] leading-none">{su.s}</span>
      <span className="absolute bottom-[4%] right-[8%] rotate-180 text-[1.5cqw] font-black leading-none">{r}</span>
    </div>
  );
}

export function StoryPoker({
  spec,
  onDone,
  play,
}: {
  spec: import("@/lib/love/types").PokerSpec;
  onDone: (score: number, eff?: import("@/lib/love/types").Eff) => void;
  play: (id: "deal" | "chip" | "lose" | "win") => void;
}) {
  const [st, setSt] = useState(0);
  const [react, setReact] = useState<{ say?: string; think?: string } | null>(null);
  const [res, setRes] = useState<{ r: "win" | "lose" | "fold" | "split"; score: number } | null>(null);
  const eff = useRef<Record<string, number>>({});
  const street = spec.streets[st];
  const shown = res ? (res.r === "fold" ? street.board : 5) : street.board;

  const choose = (a: import("@/lib/love/types").PokerAct) => {
    if (react) return;
    play(a.result === "fold" ? "deal" : "chip");
    if (a.eff) for (const [k, n] of Object.entries(a.eff)) eff.current[k] = (eff.current[k] ?? 0) + n;
    setReact({ say: a.say, think: a.think });
    window.setTimeout(
      () => {
        setReact(null);
        if (a.to !== undefined) {
          play("deal");
          setSt(a.to);
        } else {
          const r = a.result ?? "fold";
          if (r === "win") play("win");
          if (r === "lose") play("lose");
          setRes({ r, score: a.score ?? (r === "win" ? 2 : r === "lose" ? 0 : 1) });
        }
      },
      a.say || a.think ? 1500 : 350,
    );
  };

  const RES_TXT = { win: "이겼다", lose: "졌다", fold: "접었다", split: "비겼다" } as const;

  return (
    <div className="lv-mini absolute inset-x-0 bottom-0 z-40 flex h-[84%] flex-col items-center bg-gradient-to-t from-black/95 via-black/80 to-transparent pt-[1.5%]">
      <div className="absolute left-[2.5%] top-[2%] rounded-full border border-[#c9a25a]/50 bg-black/60 px-[1.2cqw] py-[0.4cqw] text-[1.15cqw] font-black tracking-[0.12em] text-[#ffd27a]">♠ {spec.title}</div>
      <div className="relative mt-[2.2cqw] flex w-[70%] flex-1 flex-col items-center justify-between rounded-[50%/40%] border-[0.35cqw] border-[#5a3a1c] bg-[radial-gradient(ellipse_at_center,#1f6b46,#0d3a25)] px-[4%] py-[1.2cqw] shadow-[0_0_0_0.2cqw_#c9a25a_inset,0_1cqw_3cqw_#000a]">
        {/* 상대 */}
        <div className="flex items-center gap-[0.5cqw]">
          <img src={FACE_ICON[spec.opp]} alt="" className="h-[3.4cqw] w-[3.4cqw] rounded-full border-[0.2cqw] border-[#c9a25a] object-cover object-top" />
          <span className="mr-[0.6cqw] text-[1.2cqw] font-bold text-white/80">{NAME[spec.opp]}</span>
          <Card c={spec.theirs[0]} back={!res || res.r === "fold"} />
          <Card c={spec.theirs[1]} back={!res || res.r === "fold"} />
        </div>
        {/* 보드 */}
        <div className="flex items-center gap-[0.5cqw]">
          {spec.board.map((c, i) => (
            <Card key={i} c={c} back={i >= shown} dim={i >= shown} big />
          ))}
          {spec.pot > 0 && <span className="ml-[1cqw] rounded-full bg-black/40 px-[0.9cqw] py-[0.3cqw] text-[1.1cqw] text-[#ffd27a]">POT {spec.pot.toLocaleString()}</span>}
        </div>
        {/* 나 */}
        <div className="flex items-center gap-[0.5cqw]">
          <Card c={spec.mine[0]} big />
          <Card c={spec.mine[1]} big />
        </div>
      </div>
      <div className="mt-[0.6cqw] min-h-[4.2cqw] w-[70%] text-center">
        {react ? (
          <>
            {react.say && (
              <div className="text-[1.45cqw] text-white">
                {NAME[spec.opp]} : 「{react.say}」
              </div>
            )}
            {react.think && <div className="text-[1.3cqw] text-[#cfc6b0]">({react.think})</div>}
          </>
        ) : res ? (
          <div className="text-[1.45cqw] text-white/90">{spec.ending?.[res.r] ?? ""}</div>
        ) : (
          <>
            {street.opp && (
              <div className="text-[1.45cqw] text-white">
                {NAME[spec.opp]} : 「{street.opp}」
              </div>
            )}
            {street.tell && <div className="lv-cue text-[1.25cqw] italic text-[#ffd27a]">◈ {street.tell}</div>}
          </>
        )}
      </div>
      <div className="mb-[1.4cqw] mt-[0.4cqw] flex gap-[0.8cqw]">
        {res ? (
          <>
            <span className={`mr-[1cqw] self-center text-[2cqw] font-black ${res.r === "win" ? "text-[#ffd27a]" : res.r === "lose" ? "text-[#ff7b7b]" : "text-white/80"}`}>{RES_TXT[res.r]}</span>
            <button className="lv-btn-gold" onClick={() => onDone(res.score, eff.current)}>
              계속
            </button>
          </>
        ) : (
          street.acts.map((a) => (
            <button key={a.label} className="lv-btn-gold disabled:opacity-40" disabled={!!react} onClick={() => choose(a)}>
              {a.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
