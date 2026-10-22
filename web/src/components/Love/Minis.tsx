"use client";

/*
 * 올인 러브 미니게임 (전부 2~3분 안, 스킵 가능, 실패해도 이야기는 진행)
 *  DealMini — 딜링 근무: 돌아가는 불빛이 금색 자리에 올 때 「딜」
 *  TellMini — 텔 읽기: 히로인 말이 진심인지 블러프인지
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TellSpec } from "@/lib/love/types";
import { CARD_BACK, NAME } from "@/lib/love/assets";

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
