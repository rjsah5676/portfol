"use client";

/*
 * 올인 러브 미니게임 (전부 2~3분 안, 스킵 가능, 실패해도 이야기는 진행)
 *  DealMini — 딜링 근무: 돌아가는 불빛이 금색 자리에 올 때 「딜」
 *  TellMini — 텔 읽기: 히로인 말이 진심인지 블러프인지
 *  StoryPoker — 정해진 패 한 판 (결과는 단계별 연출)
 *  HeadsUp — 진짜 헤즈업 (무작위 카드 · 칩 싸움 · 버릇 단서)
 */
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { BgId, CharKey, Eff, Face, MatchSpec, Outfit, PokerAct, PokerSpec, SfxId, TellSpec, Vars } from "@/lib/love/types";
import { BG, CARD_BACK, FACE_NEAR, NAME, OUTFITS, STAND } from "@/lib/love/assets";
import { bestFive, madeOf } from "@/lib/poker/cards";
import { check } from "@/lib/love/engine";
import { TELLS, tellById, tellKnown } from "@/lib/love/tells";
import {
  type ActKind,
  type Hand,
  type Seat,
  CHAT,
  PERSONA,
  READ_TXT,
  act,
  aiAct,
  cueFor,
  nameOf,
  newHand,
  nextStreet,
  options,
  pick,
  settle,
  streetDone,
  toCall,
} from "@/lib/love/holdem";
import { PlayingCard } from "@/components/Poker/parts";

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
  play: (id: SfxId) => void;
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

// ================= 공용: 카드 · 상대 그림 · 족보표 · 읽기 노트 =================
/** "Ah" → ANIME POKER 카드 번호 (숫자 × 4 + 무늬, 무늬 순서 s h d c) */
const toCard = (c: string) => "23456789TJQKA".indexOf(c[0]) * 4 + "shdc".indexOf(c[1]);
/** 카드 한 장 — ANIME POKER 와 같은 앞면 · 뒷면. w = 폭(cqw). n = 카드 번호(문자열 대신) */
function Card({
  c,
  n,
  back,
  w = 5.6,
  dim,
  win,
  style,
}: {
  c?: string;
  n?: number;
  back?: boolean;
  w?: number;
  dim?: boolean;
  win?: boolean;
  style?: CSSProperties;
}) {
  const id = n ?? (c ? toCard(c) : null);
  return (
    <PlayingCard
      card={back || id === null ? null : id}
      tier={2}
      dim={dim}
      win={win}
      deal
      className="lv-pk"
      style={{ "--w": `${w}cqw`, ...style } as CSSProperties}
    />
  );
}
const PHASE: Record<number, string> = { 0: "PREFLOP", 3: "FLOP", 4: "TURN", 5: "RIVER" };
const ACT_SUIT = ["♠", "♥", "♦", "♣"];

/** 상대 그림: 지금 옷 · 표정 (없는 표정은 가까운 것 → 기본) */
function oppImg(who: CharKey, face?: Face, outfit?: Outfit) {
  const set = (outfit && OUTFITS[who]?.[outfit]) || STAND[who];
  if (!set) return undefined;
  if (!face) return set.base || undefined;
  const f = [face, ...(FACE_NEAR[face] ?? [])].find((x) => set.faces[x]);
  return (f && set.faces[f]) || set.base || undefined;
}

/** 이긴 쪽 강조 카드 (족보를 이루는 카드) */
function winCards(hole: number[], board: number[]): Set<number> {
  return new Set(madeOf(bestFive([...hole, ...board])));
}

const RANK_TABLE = [
  ["로열 플러시", "같은 무늬 10 J Q K A"],
  ["스트레이트 플러시", "같은 무늬 연속 5장"],
  ["포카드", "같은 숫자 4장"],
  ["풀하우스", "트리플 + 원페어"],
  ["플러시", "같은 무늬 5장"],
  ["스트레이트", "연속 숫자 5장"],
  ["트리플", "같은 숫자 3장"],
  ["투페어", "페어 두 개"],
  ["원페어", "같은 숫자 2장"],
  ["하이카드", "아무것도 없으면 높은 카드"],
];
function RankHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="lv-sp-help" onClick={onClose}>
      <div className="lv-sp-help-in" onClick={(e) => e.stopPropagation()}>
        <div className="mb-[0.8cqw] text-[1.5cqw] font-bold text-[#ffd27a]">♠ 족보 (위가 셈)</div>
        {RANK_TABLE.map(([a, b]) => (
          <div key={a} className="flex justify-between gap-[2cqw] text-[1.2cqw] leading-[1.9]">
            <span className="font-bold text-white">{a}</span>
            <span className="text-white/65">{b}</span>
          </div>
        ))}
        <div className="mt-[1cqw] text-[1.05cqw] leading-[1.6] text-white/60">
          내 카드 2장 + 가운데 5장 중 가장 센 5장으로 겨뤄요. 상대 버릇은 오른쪽 읽기 노트에 쌓여요.
        </div>
        <button className="lv-sp-btn mt-[1cqw]" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

/** 왼쪽 가운데: 이 상대에 대해 아는 버릇 (항상 보임) */
function TellBook({ who, vars }: { who: CharKey; vars: Vars }) {
  const list = TELLS.filter((t) => t.who === who);
  if (!list.length) return null;
  return (
    <div className="lv-sp-book">
      <div className="mb-[0.3cqw] text-[0.95cqw] font-bold tracking-[0.12em] text-[#ffd27a]">
        ✎ {NAME[who]} 노트
      </div>
      {list.map((t) =>
        check(t.need, vars) ? (
          <div key={t.id} className="text-[1cqw] leading-[1.45] text-white/90">
            · <b>{t.name}</b>
            <div className="pl-[0.8cqw] text-[0.9cqw] text-white/60">{t.meaning}</div>
          </div>
        ) : (
          <div key={t.id} className="text-[0.95cqw] leading-[1.45] text-white/35">
            · ??? <span className="text-[0.85cqw]">({t.hint})</span>
          </div>
        )
      )}
    </div>
  );
}

/** 결과 연출 순서 (ms): 상대 패 → 보드 한 장씩 → 족보 이름 → 결과 → 버튼 */
const SD = { flip: 700, card: 650, names: 600, banner: 700, btn: 700 };

// ================= 스토리 포커 (정해진 패) =================
export function StoryPoker({
  spec,
  onDone,
  play,
  bg,
  vars,
  outfit,
}: {
  spec: PokerSpec;
  onDone: (score: number, eff?: Eff) => void;
  play: (id: SfxId) => void;
  /** 그 장면 배경 (VIP 룸 · 빈 펍 등) — 없으면 펍 */
  bg?: BgId;
  vars: Vars;
  outfit?: Outfit;
}) {
  const bgUrl = (bg && BG[bg]) || BG.pub;
  const [st, setSt] = useState(0);
  const [react, setReact] = useState<{ say?: string; think?: string } | null>(null);
  const [res, setRes] = useState<{ r: "win" | "lose" | "fold" | "split"; score: number } | null>(
    null
  );
  /** 결과 연출 단계: 0 시작 · 1 상대 패 · 2 보드 다 깔림 · 3 족보 이름 · 4 결과 · 5 버튼 */
  const [sd, setSd] = useState(0);
  const [runTo, setRunTo] = useState(0);
  const [help, setHelp] = useState(false);
  const eff = useRef<Record<string, number>>({});
  const street = spec.streets[st];
  const mine = spec.mine.map(toCard);
  const theirs = spec.theirs.map(toCard);
  const board = spec.board.map(toCard);

  // 결과 연출
  useEffect(() => {
    if (!res) return;
    const ts: number[] = [];
    const at = (ms: number, f: () => void) => ts.push(window.setTimeout(f, ms));
    if (res.r === "fold") {
      at(500, () => setSd(4));
      at(500 + SD.btn, () => setSd(5));
    } else {
      let t = SD.flip;
      at(t, () => {
        play("cardflip");
        setSd(1);
      });
      for (let n = street.board + 1; n <= 5; n++) {
        t += SD.card;
        const k = n === 1 || n === 2 ? 3 : n;
        at(t, () => {
          play("deal");
          setRunTo(k);
        });
      }
      at((t += SD.names), () => setSd(3));
      at((t += SD.banner), () => {
        setSd(4);
        if (res.r === "win") {
          play("potwin");
          window.setTimeout(() => play("win"), 450);
        }
        if (res.r === "lose") play("lose");
      });
      at(t + SD.btn, () => setSd(5));
    }
    return () => ts.forEach((x) => window.clearTimeout(x));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);

  const choose = (a: PokerAct) => {
    if (react || res) return;
    play(a.result === "fold" ? "fold" : "chip");
    if (a.eff)
      for (const [k, n] of Object.entries(a.eff)) eff.current[k] = (eff.current[k] ?? 0) + n;
    setReact({ say: a.say, think: a.think });
    window.setTimeout(
      () => {
        if (a.to !== undefined) {
          setReact(null);
          play("deal");
          setSt(a.to);
        } else {
          // 반응 대사는 결과 연출 동안 그대로 둠
          const r = a.result ?? "fold";
          setRunTo(street.board);
          setRes({ r, score: a.score ?? (r === "win" ? 2 : r === "lose" ? 0 : 1) });
        }
      },
      a.say || a.think ? 1500 : 350
    );
  };

  const RES_TXT = { win: "WIN", lose: "LOSE", fold: "FOLD", split: "SPLIT" } as const;
  const shown = res ? (res.r === "fold" ? street.board : Math.max(runTo, street.board)) : street.board;
  const vis = board.slice(0, shown);
  const theirsOpen = !!res && res.r !== "fold" && sd >= 1;
  const known = street.tellId ? tellKnown(street.tellId, vars) : false;
  const tellInfo = street.tellId ? tellById(street.tellId) : undefined;

  // 대사창: 상대 반응 > 결과 문장 > 거리별 상대 대사
  // 결과가 정해진 행동의 반응 대사는 결과가 뜬 뒤에 (쇼다운 전에 말해 버리면 김이 샘)
  const resSay = res && sd >= 4 ? react?.say : undefined;
  const line = res ? (sd >= 4 ? resSay || spec.ending?.[res.r] || "" : "") : (react?.say ?? street.opp ?? "");
  const speaker = (res ? !!resSay : !!(react?.say || street.opp)) ? NAME[spec.opp] : "";
  const note = react?.think
    ? { k: "속마음", t: react.think }
    : !res && street.tell
      ? { k: known ? "노트" : "관찰", t: street.tell }
      : null;
  const phase = res ? (res.r === "fold" ? "FOLD" : "SHOWDOWN") : (PHASE[street.board] ?? "");
  const myName = nameOf(mine, vis);
  const oppName = theirsOpen && shown === 5 && sd >= 3 ? nameOf(theirs, board) : "";
  const winner = res && sd >= 4 && res.r !== "fold" ? res.r : null;
  const hi =
    winner === "win" ? winCards(mine, board) : winner === "lose" ? winCards(theirs, board) : null;
  const face: Face | undefined = winner === "win" ? "sad" : winner === "lose" ? "smile" : undefined;

  return (
    <div
      className="lv-mini lv-sp absolute inset-0 z-40 overflow-hidden"
      style={{ backgroundImage: bgUrl ? `url("${bgUrl}")` : undefined }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/50" />
      {oppImg(spec.opp, face, outfit) && (
        <img src={oppImg(spec.opp, face, outfit)} alt="" className="lv-sp-opp lv-breathe" />
      )}
      <div className="lv-sp-table" />
      <img src="/poker/card/chip-red-stack.webp" alt="" className="lv-sp-chip left-[13%] top-[60%] w-[5.5cqw]" />
      <img src="/poker/card/chip-black-stack.webp" alt="" className="lv-sp-chip left-[19%] top-[64%] w-[4.6cqw]" />
      <img src="/poker/card/chip-blue-stack.webp" alt="" className="lv-sp-chip right-[13%] top-[62%] w-[5.5cqw]" />
      <img src="/poker/card/chip-gold-stack.webp" alt="" className="lv-sp-chip right-[20%] top-[66%] w-[4.4cqw]" />
      {/* 상대 카드 */}
      <div className="absolute left-1/2 top-[57.5%] flex -translate-x-1/2 gap-[0.4cqw]">
        {theirs.map((n, i) => (
          <Card key={i} n={n} back={!theirsOpen} w={theirsOpen ? 4.6 : 3.6} win={!!hi?.has(n)} dim={!!hi && !hi.has(n)} />
        ))}
      </div>
      {oppName && <div className="lv-sp-hand left-1/2 top-[52.5%] -translate-x-1/2">{oppName}</div>}
      {/* 보드 */}
      <div className="absolute left-1/2 top-[66%] flex -translate-x-1/2 items-center gap-[0.6cqw]">
        {board.map((n, i) => (
          <Card key={i} n={n} back={i >= shown} dim={i >= shown || (!!hi && !hi.has(n))} win={!!hi?.has(n)} w={6.2} />
        ))}
        {spec.pot > 0 && <span className="lv-sp-pot">POT {spec.pot.toLocaleString()}</span>}
      </div>
      {/* 내 손패 + 지금 족보 */}
      {myName && <div className="lv-sp-hand bottom-[13%] left-[61.5%] !text-[#ffe2a0]">내 패: {myName}</div>}
      <div className="absolute bottom-[-3%] left-1/2 flex -translate-x-1/2 items-end">
        {mine.map((n, i) => (
          <Card
            key={i}
            n={n}
            w={10}
            win={!!hi?.has(n)}
            dim={!!hi && !hi.has(n)}
            style={{
              transform: i ? "rotate(6deg) translateX(-1.6cqw)" : "rotate(-7deg) translateX(1.6cqw)",
              transformOrigin: "bottom center",
            }}
          />
        ))}
      </div>
      {/* 왼쪽 위: 판 제목 · 단계 · 족보표 */}
      <div className="absolute left-[2%] top-[3%] flex flex-col items-start gap-[0.5cqw]">
        <div className="lv-sp-badge text-[1.5cqw]">
          <span className="mr-[0.6cqw] text-[#ffd27a]">♠</span>
          {spec.title}
        </div>
        <div className="flex gap-[0.5cqw]">
          <div className="lv-sp-badge px-[1.4cqw] text-[0.95cqw] tracking-[0.4em] text-[#e9d9b0]">◆ {phase} ◆</div>
          <button className="lv-sp-badge px-[1cqw] text-[0.95cqw] text-[#e9d9b0] hover:text-white" onClick={() => setHelp(true)}>
            족보표
          </button>
        </div>
        <TellBook who={spec.opp} vars={vars} />
      </div>
      {/* 오른쪽 위: 읽기 노트 (지금 보이는 버릇 + 아는 버릇이면 해석) */}
      {note && (
        <div key={note.t} className="lv-sp-note absolute right-[2%] top-[3%] w-[27%]">
          <div className="mb-[0.4cqw] text-[1cqw] font-bold tracking-[0.15em] text-[#ffd27a]">
            {note.k === "속마음" ? "◇ 속마음" : note.k === "노트" ? "✎ 읽기 노트" : "◎ 관찰"}
          </div>
          <div className="text-[1.15cqw] leading-[1.5] text-white/90">{note.t}</div>
          {note.k === "노트" && tellInfo && (
            <div className="mt-[0.5cqw] border-t border-white/15 pt-[0.5cqw] text-[1.05cqw] leading-[1.5] text-[#ffe2a0]">
              → {tellInfo.name}. {tellInfo.meaning}
            </div>
          )}
        </div>
      )}
      {/* 결과 */}
      {res && sd >= 4 && res.r !== "fold" && (
        <div
          className={`lv-sp-result absolute left-1/2 top-[42%] -translate-x-1/2 text-[4.2cqw] font-black ${res.r === "win" ? "text-[#ffd27a]" : res.r === "lose" ? "text-[#ff8a8a]" : "text-white/85"}`}
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
      <div className="absolute bottom-[4%] right-[2%] flex flex-col items-end gap-[0.5cqw]">
        {!res && !react && <div className="lv-sp-turn">내 차례</div>}
        <div className="flex gap-[0.7cqw]">
          {res ? (
            <button className="lv-sp-btn disabled:opacity-40" disabled={sd < 5} onClick={() => onDone(res.score, eff.current)}>
              <span className="text-[#ffd27a]">▶</span> 계속
            </button>
          ) : (
            street.acts.map((a, i) => (
              <button key={a.label} className="lv-sp-btn disabled:opacity-40" disabled={!!react} onClick={() => choose(a)}>
                <span className={i % 2 ? "text-[#ff6b7f]" : "text-[#e9d9b0]"}>{ACT_SUIT[i % 4]}</span> {a.label}
              </button>
            ))
          )}
        </div>
      </div>
      {help && <RankHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

// ================= 진짜 헤즈업 (무작위 카드) =================
const ACT_NAME: Record<ActKind, string> = {
  fold: "폴드",
  check: "체크",
  call: "콜",
  bet: "베팅",
  raise: "레이즈",
  allin: "올인",
};
const ACT_SFX: Record<ActKind, SfxId> = {
  fold: "fold",
  check: "knock",
  call: "chip",
  bet: "chip",
  raise: "chip",
  allin: "allin",
};
type HuPhase = "intro" | "play" | "showdown" | "handEnd" | "done";

export function HeadsUp({
  spec,
  onDone,
  play,
  bg,
  vars,
  outfit,
}: {
  spec: MatchSpec;
  onDone: (score: number, eff?: Eff) => void;
  play: (id: SfxId) => void;
  bg?: BgId;
  vars: Vars;
  outfit?: Outfit;
}) {
  const who = spec.opp;
  const bgUrl = (bg && BG[bg]) || BG.pub;
  const known = PERSONA[who] ? tellKnown(PERSONA[who]!.tellId, vars) : false;
  const [phase, setPhase] = useState<HuPhase>("intro");
  const [stacks, setStacks] = useState<Record<Seat, number>>({ me: spec.stack, opp: spec.stack });
  const [handNo, setHandNo] = useState(0);
  const [button, setButton] = useState<Seat>("me");
  const [h, setH] = useState<Hand | null>(null);
  const [say, setSay] = useState<string>(spec.lines?.start ?? "");
  const [cue, setCue] = useState<{ look: "strong" | "bluff"; text: string } | null>(null);
  const [mine, setMine] = useState<string>("");
  /** 결과 연출: 보이는 보드 장수 · 단계 (1 상대 패 · 3 족보 · 4 결과 · 5 버튼) */
  const [vis, setVis] = useState(0);
  const [sd, setSd] = useState(0);
  const [face, setFace] = useState<Face | undefined>(undefined);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const timers = useRef<number[]>([]);
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
  useEffect(() => () => timers.current.forEach((x) => window.clearTimeout(x)), []);

  const total = spec.hands;
  const clone = (x: Hand): Hand => ({
    ...x,
    stack: { ...x.stack },
    bet: { ...x.bet },
    acted: { ...x.acted },
  });

  const startHand = (st: Record<Seat, number>, btn: Seat) => {
    const nh = newHand(st, btn);
    play("deal");
    setH(nh);
    setVis(0);
    setSd(0);
    setFace(undefined);
    setCue(null);
    setMine("");
    setSay("");
    setPhase("play");
    if (nh.toAct === "opp") aiTurn(nh);
  };

  // 진행: 거리 끝 → 다음 거리 / 판 끝 → 결과 연출 / 아니면 다음 사람
  const advance = (x: Hand, prevShown: number) => {
    if (x.over) return finish(x, prevShown);
    if (streetDone(x)) {
      const before = x.shown;
      nextStreet(x);
      if (x.over) return finish(x, before);
      later(450, () => {
        play("deal");
        setH(clone(x));
        setVis(x.shown);
        if (x.toAct === "opp") aiTurn(x);
        else setBusy(false);
      });
      return;
    }
    setH(clone(x));
    if (x.toAct === "opp") aiTurn(x);
    else setBusy(false);
  };

  const aiTurn = (x: Hand) => {
    setBusy(true);
    later(900, () => {
      const a = aiAct(x, who);
      const prev = x.shown;
      act(x, "opp", a.k, a.to);
      play(ACT_SFX[a.k]);
      setSay(pick(CHAT[who]?.[a.k]) ?? ACT_NAME[a.k]);
      setCue(cueFor(who, a.read));
      advance(x, prev);
    });
  };

  const meAct = (k: ActKind, to?: number) => {
    if (!h || busy || h.toAct !== "me" || h.over) return;
    const x = clone(h);
    const prev = x.shown;
    act(x, "me", k, to);
    play(ACT_SFX[k]);
    setMine(ACT_NAME[k] + (k === "bet" || k === "raise" ? ` ${to}` : ""));
    setCue(null);
    setBusy(true);
    advance(x, prev);
  };

  const finish = (x: Hand, prevShown: number) => {
    setBusy(true);
    setH(clone(x));
    setPhase("showdown");
    const w = x.over!.winner;
    let t = 500;
    if (x.over!.by === "showdown") {
      setVis(prevShown);
      later((t += SD.flip), () => {
        play("cardflip");
        setSd(1);
      });
      for (let n = Math.max(prevShown, 2) + 1; n <= 5; n++) {
        const k = n < 3 ? 3 : n;
        later((t += SD.card), () => {
          play("deal");
          setVis(k);
        });
      }
      later((t += SD.names), () => setSd(3));
    }
    later((t += SD.banner), () => {
      setSd(4);
      setFace(w === "opp" ? "smug" : w === "me" ? "pout" : undefined);
      setSay(pick(CHAT[who]?.[w === "opp" ? "winHand" : w === "me" ? "loseHand" : "call"]) ?? "");
      // 판마다는 칩 쓸어 오는 소리 · 대결 전체를 이겼을 때만 승리 징글
      if (w === "me") play("potwin");
      else if (w === "opp") play("lose");
      setStacks(settle(x));
    });
    later(t + SD.btn, () => {
      setSd(5);
      setPhase("handEnd");
      setBusy(false);
    });
  };

  const nextHand = () => {
    const n = handNo + 1;
    if (n >= total || stacks.me <= 0 || stacks.opp <= 0) {
      setPhase("done");
      const r = result();
      setFace(r === "win" ? "sad" : r === "lose" ? "smile" : undefined);
      setSay(spec.lines?.[r] ?? "");
      if (r === "win") play("win");
      return;
    }
    const b: Seat = button === "me" ? "opp" : "me";
    setHandNo(n);
    setButton(b);
    startHand(stacks, b);
  };

  const result = (): "win" | "even" | "lose" =>
    stacks.me > spec.stack + 2 ? "win" : stacks.me < spec.stack - 2 ? "lose" : "even";

  const retry = () => {
    timers.current.forEach((x) => window.clearTimeout(x));
    const st = { me: spec.stack, opp: spec.stack };
    setStacks(st);
    setHandNo(0);
    setButton("me");
    startHand(st, "me");
  };

  // ---- 화면 ----
  const board = h?.board ?? [];
  const shown = h ? (phase === "showdown" || phase === "handEnd" ? (h.over?.by === "showdown" ? vis : h.shown) : h.shown) : 0;
  const oppOpen = !!h && h.over?.by === "showdown" && sd >= 1;
  const w = h?.over && sd >= 4 ? h.over.winner : null;
  const hi = h && w && h.over?.by === "showdown" ? (w === "me" ? winCards(h.me, board) : w === "opp" ? winCards(h.opp, board) : null) : null;
  const myName = h ? nameOf(h.me, board.slice(0, shown)) : "";
  const oppName = h && oppOpen && sd >= 3 ? nameOf(h.opp, board) : "";
  const ops = h && phase === "play" && h.toAct === "me" && !busy ? options(h, "me") : [];
  const call = h ? toCall(h, "me") : 0;
  const pot = h ? h.pot + h.bet.me + h.bet.opp : 0;
  const r = phase === "done" ? result() : null;
  const RES = { win: "이겼다", even: "비겼다", lose: "졌다" } as const;
  const unit = spec.unit;

  const btnLabel = (o: { k: ActKind; to?: number }) =>
    o.k === "call"
      ? `콜 ${Math.min(call, h?.stack.me ?? 0)}`
      : o.k === "bet" || o.k === "raise"
        ? `${ACT_NAME[o.k]} ${o.to}`
        : o.k === "allin"
          ? `올인 ${h ? h.stack.me + h.bet.me : 0}`
          : ACT_NAME[o.k];

  return (
    <div className="lv-mini lv-sp absolute inset-0 z-40 overflow-hidden" style={{ backgroundImage: bgUrl ? `url("${bgUrl}")` : undefined }}>
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/50" />
      {oppImg(who, face, outfit) && <img src={oppImg(who, face, outfit)} alt="" className="lv-sp-opp lv-breathe" />}
      <div className="lv-sp-table" />
      {/* 칩 더미 (양쪽 스택 크기에 맞춰) */}
      <img src="/poker/card/chip-red-stack.webp" alt="" className="lv-sp-chip left-[14%] top-[61%]" style={{ width: `${3 + Math.min(4, (stacks.me / spec.stack) * 2.5)}cqw` }} />
      <img src="/poker/card/chip-blue-stack.webp" alt="" className="lv-sp-chip right-[14%] top-[61%]" style={{ width: `${3 + Math.min(4, (stacks.opp / spec.stack) * 2.5)}cqw` }} />
      {/* 상대 카드 */}
      {h && (
        <div className="absolute left-1/2 top-[57.5%] flex -translate-x-1/2 gap-[0.4cqw]">
          {h.opp.map((n, i) => (
            <Card key={`${handNo}-o${i}`} n={n} back={!oppOpen} w={oppOpen ? 4.6 : 3.6} win={!!hi?.has(n)} dim={!!hi && !hi.has(n)} />
          ))}
        </div>
      )}
      {oppName && <div className="lv-sp-hand left-1/2 top-[52.5%] -translate-x-1/2">{oppName}</div>}
      {/* 보드 + 팟 */}
      {h && (
        <div className="absolute left-1/2 top-[66%] flex -translate-x-1/2 items-center gap-[0.6cqw]">
          {board.map((n, i) => (
            <Card key={`${handNo}-b${i}`} n={n} back={i >= shown} dim={i >= shown || (!!hi && !hi.has(n))} win={!!hi?.has(n)} w={6.2} />
          ))}
          <span className="lv-sp-pot">
            팟 {pot} {unit}
          </span>
        </div>
      )}
      {/* 스택 */}
      <div className="lv-sp-stack left-[3%] bottom-[24%]">
        나 <b>{h && phase === "play" ? h.stack.me : stacks.me}</b> {unit}
        {h && h.bet.me > 0 && phase === "play" && <span className="text-white/60"> · 건 것 {h.bet.me}</span>}
      </div>
      <div className="lv-sp-stack right-[3%] top-[47%] text-right">
        {NAME[who]} <b>{h && phase === "play" ? h.stack.opp : stacks.opp}</b> {unit}
        {h && h.bet.opp > 0 && phase === "play" && <span className="text-white/60"> · 건 것 {h.bet.opp}</span>}
      </div>
      {/* 내 패 */}
      {myName && <div className="lv-sp-hand bottom-[13%] left-[61.5%] !text-[#ffe2a0]">내 패: {myName}</div>}
      {h && (
        <div className="absolute bottom-[-3%] left-1/2 flex -translate-x-1/2 items-end">
          {h.me.map((n, i) => (
            <Card
              key={`${handNo}-m${i}`}
              n={n}
              w={10}
              win={!!hi?.has(n)}
              dim={!!hi && !hi.has(n)}
              style={{ transform: i ? "rotate(6deg) translateX(-1.6cqw)" : "rotate(-7deg) translateX(1.6cqw)", transformOrigin: "bottom center" }}
            />
          ))}
        </div>
      )}
      {/* 왼쪽 위 */}
      <div className="absolute left-[2%] top-[3%] flex flex-col items-start gap-[0.5cqw]">
        <div className="lv-sp-badge text-[1.5cqw]">
          <span className="mr-[0.6cqw] text-[#ffd27a]">♠</span>
          {spec.title}
        </div>
        <div className="flex gap-[0.5cqw]">
          <div className="lv-sp-badge px-[1.2cqw] text-[0.95cqw] tracking-[0.2em] text-[#e9d9b0]">
            {phase === "intro" ? "◆ 준비 ◆" : `판 ${Math.min(handNo + 1, total)} / ${total} · ${h?.over ? "SHOWDOWN" : (PHASE[h?.shown ?? 0] ?? "")}`}
          </div>
          <button className="lv-sp-badge px-[1cqw] text-[0.95cqw] text-[#e9d9b0] hover:text-white" onClick={() => setHelp(true)}>
            족보표
          </button>
        </div>
        <TellBook who={who} vars={vars} />
      </div>
      {/* 오른쪽 위: 지금 보인 버릇 */}
      {cue && phase === "play" && (
        <div key={cue.text} className="lv-sp-note absolute right-[2%] top-[3%] w-[27%]">
          <div className="mb-[0.4cqw] text-[1cqw] font-bold tracking-[0.15em] text-[#ffd27a]">{known ? "✎ 읽기 노트" : "◎ 관찰"}</div>
          <div className="text-[1.15cqw] leading-[1.5] text-white/90">{cue.text}</div>
          {known && READ_TXT[who] && (
            <div className="mt-[0.5cqw] border-t border-white/15 pt-[0.5cqw] text-[1.05cqw] leading-[1.5] text-[#ffe2a0]">→ {READ_TXT[who]![cue.look]}</div>
          )}
          {!known && <div className="mt-[0.4cqw] text-[0.9cqw] text-white/45">무슨 뜻인지는 아직 모른다.</div>}
        </div>
      )}
      {/* 판 결과 */}
      {w && phase !== "done" && (
        <div className={`lv-sp-result absolute left-1/2 top-[42%] -translate-x-1/2 text-[3.6cqw] font-black ${w === "me" ? "text-[#ffd27a]" : w === "opp" ? "text-[#ff8a8a]" : "text-white/85"}`}>
          {w === "me" ? "팟을 가져왔다" : w === "opp" ? `${NAME[who]}의 팟` : "나눠 가졌다"}
          <div className="text-center text-[1.3cqw] font-bold text-white/75">{h?.over?.by === "fold" ? (w === "me" ? "상대 FOLD" : "FOLD") : ""}</div>
        </div>
      )}
      {/* 최종 결과 */}
      {r && (
        <div className={`lv-sp-result absolute left-1/2 top-[38%] -translate-x-1/2 text-center font-black ${r === "win" ? "text-[#ffd27a]" : r === "lose" ? "text-[#ff8a8a]" : "text-white/85"}`}>
          <div className="text-[4.2cqw]">{RES[r]}</div>
          <div className="text-[1.5cqw] text-white/80">
            {unit} {spec.stack} → {stacks.me}
          </div>
        </div>
      )}
      {/* 대사창 */}
      {(say || mine) && (
        <div className="lv-sp-box absolute bottom-[3%] left-[2%] w-[38%]">
          {say && <div className="lv-sp-name">{NAME[who]}</div>}
          {say && <div className="text-[1.35cqw] leading-[1.55] text-white">{say}</div>}
          {mine && phase === "play" && <div className="mt-[0.3cqw] text-[1.05cqw] text-[#ffe2a0]/80">나: {mine}</div>}
        </div>
      )}
      {/* 버튼 */}
      <div className="absolute bottom-[4%] right-[2%] flex flex-col items-end gap-[0.5cqw]">
        {phase === "play" && <div className="lv-sp-turn">{h?.toAct === "me" && !busy ? "내 차례" : `${NAME[who]} 생각 중…`}</div>}
        <div className="flex flex-wrap justify-end gap-[0.6cqw]">
          {phase === "intro" && (
            <button className="lv-sp-btn" onClick={() => startHand(stacks, "me")}>
              <span className="text-[#ffd27a]">▶</span> 시작 ({total}판 · {unit} {spec.stack}개)
            </button>
          )}
          {ops.map((o, i) => (
            <button key={o.k} className="lv-sp-btn" onClick={() => meAct(o.k, o.to)}>
              <span className={i % 2 ? "text-[#ff6b7f]" : "text-[#e9d9b0]"}>{ACT_SUIT[i % 4]}</span> {btnLabel(o)}
            </button>
          ))}
          {phase === "handEnd" && (
            <button className="lv-sp-btn" onClick={nextHand}>
              <span className="text-[#ffd27a]">▶</span> {handNo + 1 >= total || stacks.me <= 0 || stacks.opp <= 0 ? "결과 보기" : "다음 판"}
            </button>
          )}
          {phase === "done" && r && (
            <>
              {spec.retry && r === "lose" && (
                <button className="lv-sp-btn" onClick={retry}>
                  <span className="text-[#ff6b7f]">↻</span> 한 번 더
                </button>
              )}
              <button className="lv-sp-btn" onClick={() => onDone(r === "win" ? 2 : r === "even" ? 1 : 0, spec.eff?.[r])}>
                <span className="text-[#ffd27a]">▶</span> 계속
              </button>
            </>
          )}
        </div>
      </div>
      {help && <RankHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
