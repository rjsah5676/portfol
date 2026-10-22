"use client";

/*
 * 올인 러브 미니게임 (전부 2~3분 안, 스킵 가능, 실패해도 이야기는 진행)
 *  DealMini — 딜링 근무: 돌아가는 불빛이 금색 자리에 올 때 「딜」
 *  TellMini — 텔 읽기: 히로인 말이 진심인지 블러프인지
 */
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { TellSpec } from "@/lib/love/types";
import { BG, CARD_BACK, NAME, STAND } from "@/lib/love/assets";

const SEATS = [
  { x: 50, y: 84 },
  { x: 18, y: 66 },
  { x: 22, y: 26 },
  { x: 50, y: 14 },
  { x: 78, y: 26 },
  { x: 82, y: 66 },
];
const ROUNDS = 5;

export function DealMini({
  onDone,
  play,
}: {
  onDone: (score: number) => void;
  play: (id: "deal" | "chip" | "lose") => void;
}) {
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
      <div
        onClick={() => (started ? hit() : setStarted(true))}
        className="relative mt-2 aspect-[16/10] w-[62%] cursor-pointer rounded-[50%] border-[6px] border-[#5a3a1c] bg-[radial-gradient(ellipse_at_center,#1f6b46,#0e3b26)] shadow-[0_0_0_3px_#c9a25a_inset,0_20px_50px_#0009]"
      >
        {SEATS.map((p, i) => (
          <div
            key={i}
            className={`absolute grid h-[15%] w-[10%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-[clamp(10px,1.2vw,15px)] font-bold transition-all duration-100 ${
              i === 0
                ? "border-white/40 bg-white/10 text-white/70"
                : i === target
                  ? "border-[#ffd27a] bg-[#ffd27a]/25 text-[#ffd27a] shadow-[0_0_18px_#ffd27a]"
                  : "border-white/25 bg-black/20 text-white/50"
            } ${i === cur && started && !done ? "scale-125 !bg-white/80 !text-black" : ""}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {i === 0 ? "딜러" : i}
          </div>
        ))}
        {fly !== null && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={CARD_BACK}
            alt=""
            className="lv-fly absolute h-[16%] -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${SEATS[fly].x}%`, top: `${SEATS[fly].y}%` }}
          />
        )}
        {flash && (
          <div
            className={`absolute inset-0 grid place-items-center text-[clamp(18px,3vw,40px)] font-black ${flash === "hit" ? "text-[#ffd27a]" : "text-[#ff6b6b]"}`}
          >
            {flash === "hit" ? "NICE DEAL" : "MISS"}
          </div>
        )}
      </div>
      <div className="mt-3 text-[clamp(11px,1.3vw,16px)] text-white/80">
        {!started
          ? "불빛이 금색 자리에 왔을 때 「딜」 (스페이스 · 화면 터치)"
          : done
            ? `결과 ${score} / ${ROUNDS}`
            : `${round + 1} / ${ROUNDS} · ${target}번 자리에 카드를!`}
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

  const img = STAND[tell.who as keyof typeof STAND]?.base;
  const ready = shown >= tell.cues.length;

  return (
    <div
      className="lv-mini lv-sp absolute inset-0 z-40 overflow-hidden"
      style={{ backgroundImage: BG.pub ? `url("${BG.pub}")` : undefined }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/20 to-black/60" />
      {/* 얼굴 가까이 (거리 2단계와 같은 느낌) */}
      {img && (
        <img
          src={img}
          alt=""
          className="lv-sp-opp lv-breathe"
          style={{ height: "235%", top: "-4%" }}
        />
      )}
      <div className="absolute left-[2%] top-[3%] flex flex-col items-start gap-[0.5cqw]">
        <div className="lv-sp-badge text-[1.5cqw]">
          <span className="mr-[0.6cqw] text-[#ffd27a]">◈</span>텔 읽기
        </div>
        <div className="lv-sp-badge px-[1.4cqw] text-[0.95cqw] tracking-[0.3em] text-[#e9d9b0]">
          {ready ? (res === null ? `◆ ${left}초 ◆` : "◆ 판정 ◆") : "◆ 관찰 중 ◆"}
        </div>
      </div>
      {/* 읽기 노트: 단서가 하나씩 쌓임 */}
      <div className="lv-sp-note absolute right-[2%] top-[3%] w-[30%]">
        <div className="mb-[0.5cqw] text-[1cqw] font-bold tracking-[0.15em] text-[#ffd27a]">
          ✎ 읽기 노트
        </div>
        <ul className="space-y-[0.5cqw] text-[1.15cqw] leading-[1.5] text-white/90">
          {tell.cues.slice(0, shown).map((c) => (
            <li key={c} className="lv-cue">
              · {c}
            </li>
          ))}
          {!ready && <li className="text-white/40">…</li>}
        </ul>
      </div>
      {res !== null && (
        <div
          className={`lv-sp-result absolute left-1/2 top-[45%] -translate-x-1/2 text-[4cqw] font-black ${res ? "text-[#ffd27a]" : "text-white/80"}`}
        >
          {res ? "읽었다" : "모르겠다"}
        </div>
      )}
      <div className="lv-sp-box absolute bottom-[3%] left-[2%] w-[44%]">
        <div className="lv-sp-name">{NAME[tell.who]}</div>
        <div className="text-[1.4cqw] leading-[1.55] text-white">{tell.claim}</div>
      </div>
      <div className="absolute bottom-[4%] right-[2%] flex gap-[0.7cqw]">
        {res === null ? (
          <>
            <button
              className="lv-sp-btn disabled:opacity-40"
              disabled={!ready}
              onClick={() => answer("true")}
            >
              <span className="text-[#ff6b7f]">♥</span> 진심이다
            </button>
            <button
              className="lv-sp-btn disabled:opacity-40"
              disabled={!ready}
              onClick={() => answer("bluff")}
            >
              <span className="text-[#e9d9b0]">♠</span> 블러프다
            </button>
          </>
        ) : (
          <button className="lv-sp-btn" onClick={() => onDone(res ? 1 : 0)}>
            <span className="text-[#ffd27a]">▶</span> 계속
          </button>
        )}
      </div>
    </div>
  );
}

// ================= 스토리 포커 =================
const SUIT: Record<string, { s: string; red: boolean }> = {
  s: { s: "♠", red: false },
  h: { s: "♥", red: true },
  d: { s: "♦", red: true },
  c: { s: "♣", red: false },
};
/** 카드 한 장. w = 폭(cqw). 글자 크기도 폭에 맞춰 줄어듦 */
function Card({
  c,
  back,
  w = 5.6,
  dim,
  style,
}: {
  c?: string;
  back?: boolean;
  w?: number;
  dim?: boolean;
  style?: CSSProperties;
}) {
  const box: CSSProperties = { width: `${w}cqw`, ...style };
  if (back || !c)
    return (
      <img
        src={CARD_BACK}
        alt=""
        style={box}
        className={`aspect-[5/7] rounded-[0.4cqw] shadow-[0_0.3cqw_0.8cqw_#0009] transition-opacity ${dim ? "opacity-30" : ""}`}
      />
    );
  const r = c[0] === "T" ? "10" : c[0];
  const su = SUIT[c[1]];
  return (
    <div
      style={box}
      className={`lv-card aspect-[5/7] ${su.red ? "text-[#d0263b]" : "text-[#16181f]"}`}
    >
      <span
        className="absolute left-[9%] top-[5%] flex flex-col items-center font-black leading-none"
        style={{ fontSize: `${w * 0.27}cqw` }}
      >
        {r}
        <span style={{ fontSize: `${w * 0.2}cqw` }}>{su.s}</span>
      </span>
      <span className="leading-none" style={{ fontSize: `${w * 0.46}cqw` }}>
        {su.s}
      </span>
      <span
        className="absolute bottom-[5%] right-[9%] flex rotate-180 flex-col items-center font-black leading-none"
        style={{ fontSize: `${w * 0.27}cqw` }}
      >
        {r}
        <span style={{ fontSize: `${w * 0.2}cqw` }}>{su.s}</span>
      </span>
    </div>
  );
}
const PHASE: Record<number, string> = { 0: "PREFLOP", 3: "FLOP", 4: "TURN", 5: "RIVER" };
const ACT_SUIT = ["♠", "♥", "♦", "♣"];

export function StoryPoker({
  spec,
  onDone,
  play,
  bg,
}: {
  spec: import("@/lib/love/types").PokerSpec;
  onDone: (score: number, eff?: import("@/lib/love/types").Eff) => void;
  play: (id: "deal" | "chip" | "lose" | "win") => void;
  /** 그 장면 배경 (VIP 룸 · 빈 펍 등) — 없으면 펍 */
  bg?: import("@/lib/love/types").BgId;
}) {
  const bgUrl = (bg && BG[bg]) || BG.pub;
  const [st, setSt] = useState(0);
  const [react, setReact] = useState<{ say?: string; think?: string } | null>(null);
  const [res, setRes] = useState<{ r: "win" | "lose" | "fold" | "split"; score: number } | null>(
    null
  );
  const eff = useRef<Record<string, number>>({});
  const street = spec.streets[st];
  const shown = res ? (res.r === "fold" ? street.board : 5) : street.board;

  const choose = (a: import("@/lib/love/types").PokerAct) => {
    if (react) return;
    play(a.result === "fold" ? "deal" : "chip");
    if (a.eff)
      for (const [k, n] of Object.entries(a.eff)) eff.current[k] = (eff.current[k] ?? 0) + n;
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
      a.say || a.think ? 1500 : 350
    );
  };

  const RES_TXT = { win: "이겼다", lose: "졌다", fold: "접었다", split: "비겼다" } as const;

  // 대사창: 상대 반응 > 결과 문장 > 거리별 상대 대사. 읽기 노트: 텔(손버릇) 또는 내 속마음
  const line = react?.say ?? (res ? spec.ending?.[res.r] : street.opp) ?? "";
  const speaker = react?.say || (!res && street.opp) ? NAME[spec.opp] : "";
  const note = react?.think
    ? { k: "속마음", t: react.think }
    : !res && street.tell
      ? { k: "읽기 노트", t: street.tell }
      : null;
  const phase = res ? "SHOWDOWN" : (PHASE[street.board] ?? "");
  const oppImg = STAND[spec.opp]?.base;
  const theirsOpen = !!res && res.r !== "fold";

  return (
    <div
      className="lv-mini lv-sp absolute inset-0 z-40 overflow-hidden"
      style={{ backgroundImage: bgUrl ? `url("${bgUrl}")` : undefined }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/50" />
      {/* 상대: 테이블 너머 허리 위 */}
      {oppImg && <img src={oppImg} alt="" className="lv-sp-opp lv-breathe" />}
      {/* 테이블 */}
      <div className="lv-sp-table" />
      {/* 칩 더미 */}
      <img
        src="/poker/card/chip-red-stack.webp"
        alt=""
        className="lv-sp-chip left-[13%] top-[60%] w-[5.5cqw]"
      />
      <img
        src="/poker/card/chip-black-stack.webp"
        alt=""
        className="lv-sp-chip left-[19%] top-[64%] w-[4.6cqw]"
      />
      <img
        src="/poker/card/chip-blue-stack.webp"
        alt=""
        className="lv-sp-chip right-[13%] top-[62%] w-[5.5cqw]"
      />
      <img
        src="/poker/card/chip-gold-stack.webp"
        alt=""
        className="lv-sp-chip right-[20%] top-[66%] w-[4.4cqw]"
      />
      {/* 상대 카드 (그녀 손 앞) */}
      <div className="absolute left-1/2 top-[57.5%] flex -translate-x-1/2 gap-[0.4cqw]">
        <Card c={spec.theirs[0]} back={!theirsOpen} w={theirsOpen ? 4.6 : 3.6} />
        <Card c={spec.theirs[1]} back={!theirsOpen} w={theirsOpen ? 4.6 : 3.6} />
      </div>
      {/* 보드 */}
      <div className="absolute left-1/2 top-[66%] flex -translate-x-1/2 items-center gap-[0.6cqw]">
        {spec.board.map((c, i) => (
          <Card key={i} c={c} back={i >= shown} dim={i >= shown} w={6.2} />
        ))}
        {spec.pot > 0 && (
          <span className="ml-[0.8cqw] rounded-full border border-[#c9a25a]/60 bg-black/50 px-[0.9cqw] py-[0.3cqw] text-[1.1cqw] font-bold text-[#ffd27a]">
            POT {spec.pot.toLocaleString()}
          </span>
        )}
      </div>
      {/* 내 손패 */}
      <div className="absolute bottom-[-3%] left-1/2 flex -translate-x-1/2 items-end">
        <Card
          c={spec.mine[0]}
          w={10}
          style={{
            transform: "rotate(-7deg) translateX(1.6cqw)",
            transformOrigin: "bottom center",
          }}
        />
        <Card
          c={spec.mine[1]}
          w={10}
          style={{
            transform: "rotate(6deg) translateX(-1.6cqw)",
            transformOrigin: "bottom center",
          }}
        />
      </div>
      {/* 왼쪽 위: 판 제목 · 단계 */}
      <div className="absolute left-[2%] top-[3%] flex flex-col items-start gap-[0.5cqw]">
        <div className="lv-sp-badge text-[1.5cqw]">
          <span className="mr-[0.6cqw] text-[#ffd27a]">♠</span>
          {spec.title}
        </div>
        <div className="lv-sp-badge px-[1.4cqw] text-[0.95cqw] tracking-[0.4em] text-[#e9d9b0]">
          ◆ {phase} ◆
        </div>
      </div>
      {/* 오른쪽 위: 읽기 노트 */}
      {note && (
        <div key={note.t} className="lv-sp-note absolute right-[2%] top-[3%] w-[27%]">
          <div className="mb-[0.4cqw] text-[1cqw] font-bold tracking-[0.15em] text-[#ffd27a]">
            {note.k === "속마음" ? "◇ 속마음" : "✎ 읽기 노트"}
          </div>
          <div className="text-[1.15cqw] leading-[1.5] text-white/90">{note.t}</div>
        </div>
      )}
      {/* 결과 */}
      {res && (
        <div
          className={`lv-sp-result absolute left-1/2 top-[45%] -translate-x-1/2 text-[4.2cqw] font-black ${res.r === "win" ? "text-[#ffd27a]" : res.r === "lose" ? "text-[#ff8a8a]" : "text-white/85"}`}
        >
          {RES_TXT[res.r]}
        </div>
      )}
      {/* 왼쪽 아래: 대사창 */}
      {line && (
        <div className="lv-sp-box absolute bottom-[3%] left-[2%] w-[38%]">
          {speaker && <div className="lv-sp-name">{speaker}</div>}
          <div className="text-[1.35cqw] leading-[1.55] text-white">{line}</div>
        </div>
      )}
      {/* 오른쪽 아래: 행동 버튼 */}
      <div className="absolute bottom-[4%] right-[2%] flex gap-[0.7cqw]">
        {res ? (
          <button className="lv-sp-btn" onClick={() => onDone(res.score, eff.current)}>
            <span className="text-[#ffd27a]">▶</span> 계속
          </button>
        ) : (
          street.acts.map((a, i) => (
            <button
              key={a.label}
              className="lv-sp-btn disabled:opacity-40"
              disabled={!!react}
              onClick={() => choose(a)}
            >
              <span className={i % 2 ? "text-[#ff6b7f]" : "text-[#e9d9b0]"}>{ACT_SUIT[i % 4]}</span>{" "}
              {a.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
