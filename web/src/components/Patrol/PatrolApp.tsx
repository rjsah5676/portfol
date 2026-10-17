"use client";

/*
 * 픽셀 순찰대 (알파) — 챕터 3개 × 스테이지 5개 · 반디 · 장비 6칸 · 상자 · 합성 · 강화 · 순찰
 * 판은 서바이버 엔진(Game · lib/survivor/sim)에 챕터 · 장비를 얹어서 돌림. 서버는 server/src/games/patrol.ts
 * 장면: 처음 → 로비 (챕터 · 스테이지 · 출동 · 장비 · 상자 · 순찰) → 판 → 결과
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { CH_COUNT, ST_COUNT, SUB, firstSt, stCh, stName, stSub, stage } from "@/lib/patrol/chapters";
import { BOOST_RUNS, PATROL_MAX_H, QUICK_FREE, QUICK_H, STAR_GEMS, WELCOME, firstReward, patrolPending, patrolRate } from "@/lib/patrol/economy";
import { ATK_PCT, GEAR, GRADE_COLOR, GRADE_NAME, power, powerScore, type GearItem } from "@/lib/patrol/gear";
import { ENEMIES, HEROES, type ChapterDef } from "@/lib/survivor/data";
import type { RunResult } from "@/lib/survivor/sim";
import { patrol, type PatrolFinish, type PatrolProfile } from "@/realtime/patrol";
import Token from "../Marble/Token";
import { playBgm, sfx } from "../Survivor/audio";
import Game, { type GameSetup } from "../Survivor/Game";
import Stage from "../Survivor/Stage";
import Boxes from "./Boxes";
import PatchNotes, { LATEST } from "./PatchNotes";
import GearPanel, { betterGear, equippedOf, mergeCount } from "./Gear";
import { Bp, Coin, Gem, GearIcon, Modal, SysButtons, btn } from "./ui";

type Scene = { k: "title" } | { k: "lobby" } | { k: "play"; setup: GameSetup; st: number; run: string | null } | { k: "result"; r: RunResult; st: number; fin: PatrolFinish | null; err: string };
type Pop = "gear" | "box" | "patrol" | null;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ST_KEY = "ptp-st";
/** 별 3개 조건 (보스 시간은 스테이지마다) */
const starLabel = (def: ChapterDef) => ["클리어", "체력 50% 이상으로 클리어", `보스 ${def.bossStar ?? 45}초 안에 처치`];

/** 로그인 안 했을 때: 시작 선물 장비로 챕터 1만 (기록 · 보상 없음) */
const GUEST: PatrolProfile = {
  coins: 0,
  gems: 0,
  bp: 0,
  items: WELCOME.gear.map((g, i) => ({ uid: String(i + 1), id: g.id, g: g.g, lv: 1 })),
  equip: { weapon: "1", armor: "2" },
  best: 0,
  bestSt: 0,
  stars: {},
  runs: 0,
  wins: 0,
  boostLeft: 0,
  quickLeft: 0,
  freeBox: false,
  patrolAt: 0,
  pity: { hero: 0, legend: 0 },
  now: 0,
};

export default function PatrolApp() {
  const { profile: account } = useAuth();
  const member = !!account;
  const [scene, setScene] = useState<Scene>({ k: "title" });
  const [prof, setProfRaw] = useState<PatrolProfile | null>(null);
  /** 서버 시각 - 내 시각 (순찰 시간 계산) */
  const [skew, setSkew] = useState(0);
  const setProf = useCallback((p: PatrolProfile) => {
    setSkew(p.now - Date.now());
    setProfRaw(p);
  }, []);
  const [st, setStRaw] = useState(1);
  const setSt = (n: number) => {
    setStRaw(n);
    try {
      localStorage.setItem(ST_KEY, String(n));
    } catch {}
  };
  const [note, setNote] = useState("");
  useEffect(() => {
    try {
      const n = Number(localStorage.getItem(ST_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 지난번 고른 스테이지 (브라우저에서만)
      if (n >= 1 && n <= ST_COUNT) setStRaw(n);
    } catch {}
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그아웃하면 프로필 비움
    if (!member) return setProfRaw(null);
    void patrol.profile().then(setProf, (e) => setNote((e as Error).message));
  }, [member, setProf]);
  useEffect(() => {
    // 결과 화면은 클리어 · 실패 징글이 끝난 뒤 로비 곡
    const t = scene.k === "play" ? 0 : window.setTimeout(() => playBgm("pt_lobby"), scene.k === "result" ? 3500 : 0);
    // 페이지를 떠나면 음악도 끔
    return () => {
      window.clearTimeout(t);
      playBgm(null);
    };
  }, [scene.k]);

  const p = prof ?? GUEST;
  /** 열린 가장 높은 스테이지 (손님은 1-1만) */
  const open = member ? Math.min(ST_COUNT, (p.bestSt ?? 0) + 1) : 1;
  // 고른 스테이지가 아직 잠겼으면(진행 정보가 오기 전 · 다른 계정) 그 챕터에서 열린 곳까지
  const cur = st <= open ? st : Math.max(Math.min(open, firstSt(stCh(st)) + SUB - 1), firstSt(stCh(st)));

  const runRef = useRef<string | null>(null);
  const start = async (n = cur) => {
    sfx("click");
    setNote("");
    const def = stage(n);
    if (!def) return;
    const gp = power(equippedOf(p));
    const setup: GameSetup = {
      hero: "bandi",
      sup: [],
      seed: Math.floor(Math.random() * 2 ** 31),
      bonus: { maxHp: gp.hp },
      opts: { chapter: def, gear: { atk: gp.atk * ATK_PCT, weapon: gp.weapon, wlv: gp.wlv, relics: gp.relics }, rerolls: 2, skips: 1, banish: 0 },
    };
    let run: string | null = null;
    if (member) {
      try {
        run = (await patrol.start(n)).run;
      } catch (e) {
        setNote((e as Error).message);
        return;
      }
    }
    runRef.current = run;
    setScene({ k: "play", setup, st: n, run });
  };
  const onEnd = useCallback(
    (r: RunResult) => {
      const run = runRef.current;
      const n = r.ch?.st ?? 1;
      setScene({ k: "result", r, st: n, fin: null, err: "" });
      if (!run) return;
      void patrol.finish(run, { sec: r.sec, kills: r.kills, lv: r.lv, win: r.win, gold: r.gold, stars: r.ch?.stars ?? [false, false, false] }).then(
        (fin) => {
          setScene((s) => (s.k === "result" ? { ...s, fin } : s));
          setProf(fin.profile);
          // 첫 클리어면 다음 스테이지로
          if (fin.first && n < ST_COUNT) setSt(n + 1);
        },
        (e) => setScene((s) => (s.k === "result" ? { ...s, err: (e as Error).message } : s))
      );
    },
    [setProf]
  );
  const onQuit = useCallback(() => setScene({ k: "lobby" }), []);
  return (
    <Stage>
      {scene.k === "title" && <Title onStart={() => setScene({ k: "lobby" })} />}
      {scene.k === "lobby" && <Lobby prof={p} member={member} loaded={!member || !!prof} st={cur} open={open} onSt={setSt} note={note} skew={skew} onProf={setProf} onStart={() => void start()} onBack={() => setScene({ k: "title" })} />}
      {scene.k === "play" && <Game key={scene.setup.seed} setup={scene.setup} onEnd={onEnd} onQuit={onQuit} />}
      {scene.k === "result" && <Result r={scene.r} st={scene.st} fin={scene.fin} err={scene.err} member={member} onAgain={() => void start(scene.st)} onNext={() => void start(Math.min(ST_COUNT, scene.st + 1))} onLobby={() => setScene({ k: "lobby" })} />}
    </Stage>
  );
}

/* ───────────── 처음 ───────────── */

function Title({ onStart }: { onStart(): void }) {
  const [notes, setNotes] = useState(false);
  return (
    <div className="absolute inset-0 bg-[#0d0a26]">
      <img src="/patrol/title.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-top" draggable={false} />
      <SysButtons className="absolute top-[14px] right-[18px] z-10" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(7,5,26,0) 45%, rgba(7,5,26,0.92) 88%)" }} />
      <div className="absolute inset-x-0 bottom-[34px] flex flex-col items-center">
        <span className="pts-sub text-[13px] tracking-[6px] text-[#4ff0c8]">밤의 픽셀 타운을 지켜라</span>
        <b className="pts-title pts-drop text-[64px] leading-none" style={{ color: "#ffd27a", textShadow: "4px 4px 0 #07051a, 0 0 24px #ff9c3a88" }}>
          픽셀 순찰대
        </b>
        <span className="pts-sub mt-[2px] text-[13px] tracking-[4px] text-[#e8e4ff]">PIXEL PATROL · ALPHA</span>
        <button type="button" onClick={onStart} className="pts-btn mt-[16px] h-[52px] w-[260px] text-[22px]" style={btn("#ffb03a", "#07051a")}>
          순찰 시작
        </button>
        <span className="pts-sub pts-blink mt-[10px] text-[12px] text-[#e8e4ff]">WASD 이동 · SPACE 대시 · E 필살기</span>
      </div>
      {/* pts-btn 은 position: relative 라 감싸서 자리 잡음 */}
      <div className="absolute bottom-[16px] left-[18px]">
        <button type="button" onClick={() => (sfx("click"), setNotes(true))} className="pts-btn ghost h-[30px] px-[10px] text-[12px]">
          패치노트 <span className="text-[#ffd23a]">{LATEST}</span>
        </button>
      </div>
      {notes && <PatchNotes onClose={() => setNotes(false)} />}
    </div>
  );
}

/* ───────────── 로비 ───────────── */

function Lobby({ prof, member, loaded, st, open, onSt, note, skew, onProf, onStart, onBack }: { prof: PatrolProfile; member: boolean; loaded: boolean; st: number; open: number; onSt(n: number): void; note: string; skew: number; onProf(p: PatrolProfile): void; onStart(): void; onBack(): void }) {
  const [pop, setPop] = useState<Pop>(null);
  const [notes, setNotes] = useState(false);
  const eq = equippedOf(prof);
  const gp = power(eq);
  const def = stage(st)!;
  const ch = stCh(st);
  const stars = prof.stars[`s${st}`] ?? [false, false, false];
  const cleared = (prof.bestSt ?? 0) >= st;
  const fr = firstReward(st);
  const labels = starLabel(def);
  /** 챕터 넘기기: 그 챕터에서 열린 가장 높은 스테이지 (잠긴 챕터면 첫 스테이지) */
  const goCh = (c: number) => {
    sfx("click");
    const f = firstSt(c);
    onSt(f > open ? f : Math.min(open, f + SUB - 1));
  };
  const h = HEROES.bandi;
  const pend = usePending(prof, skew);
  const merges = member ? mergeCount(prof) : 0;
  const better = member ? betterGear(prof).length : 0;
  const popUp = (x: Pop) => {
    sfx("click");
    setPop(x);
  };
  return (
    <div className="absolute inset-0 bg-[#0d0a26]">
      <img src="/survivor/title.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" draggable={false} />
      {/* 위 */}
      <div className="absolute top-[14px] right-[18px] left-[18px] flex items-center gap-[14px]">
        <button type="button" onClick={onBack} className="pts-btn ghost h-[30px] px-[10px] text-[12px]">
          ◀ 처음으로
        </button>
        <b className="pts-title text-[22px] text-[#ffd27a]">픽셀 순찰대</b>
        <button type="button" onClick={() => (sfx("click"), setNotes(true))} className="pts-btn ghost h-[24px] px-[8px] text-[11px]" title="패치노트">
          {LATEST}
        </button>
        {member ? (
          <span className="ml-auto flex items-center gap-[16px] text-[14px] font-bold">
            {prof.boostLeft > 0 && (
              <span className="pts-tag text-[11px]" style={{ background: "#ff9cc8" }} title={`하루 첫 ${BOOST_RUNS}판은 보상 두 배`}>
                보상 ×2 · {prof.boostLeft}판 남음
              </span>
            )}
            <Coin v={prof.coins} size={14} />
            <Gem v={prof.gems} size={14} />
            <Bp v={prof.bp} size={14} />
          </span>
        ) : (
          <span className="pts-sub ml-auto text-[12px] text-[#a9a2d6]">로그인하면 장비 · 상자 · 스테이지 진행이 저장돼요 (지금은 1-1 체험)</span>
        )}
        <SysButtons />
      </div>

      {/* 왼쪽: 반디 + 전투력 */}
      <div className="absolute top-[62px] bottom-[96px] left-[18px] flex w-[330px] flex-col">
        <div className="pts-win relative flex flex-1 flex-col items-center justify-end overflow-hidden pb-[12px]">
          <div className="absolute inset-x-0 bottom-[46px] h-[40px]" style={{ background: "radial-gradient(ellipse at 50% 50%, #ffd27a33, transparent 70%)" }} />
          <div className="absolute top-[10px] left-[12px]">
            <span className="text-[11px] text-[#a9a2d6]">{h.title}</span>
            <b className="pts-title block text-[26px] leading-none" style={{ color: h.color }}>
              {h.name}
            </b>
          </div>
          <div className="absolute top-[10px] right-[12px] text-right">
            <span className="text-[11px] text-[#a9a2d6]">전투력</span>
            <b className="pts-title block text-[26px] leading-none text-[#ffd23a]">{powerScore(gp).toLocaleString()}</b>
          </div>
          <Token sprite="patrol/hero/bandi" anim="walk" h={200} />
          <div className="mt-[8px] flex gap-[6px]">
            {eq.map((it) => (
              <GearIcon key={it.uid} id={it.id} g={it.g} lv={it.lv} size={40} />
            ))}
            {Array.from({ length: 6 - eq.length }, (_, i) => (
              <span key={i} className="h-[40px] w-[40px]" style={{ background: "#100c2c", boxShadow: "0 0 0 2px #2a2468, 0 0 0 4px #07051a" }} />
            ))}
          </div>
          <span className="mt-[8px] text-[12px]">
            공격 <b className="text-[#ff9c7a]">{gp.atk}</b> · 체력 <b className="text-[#4ff0c8]">{100 + gp.hp}</b>
            {gp.relics.length > 0 && <span className="text-[#c58bff]"> · 효과 {gp.relics.length}</span>}
          </span>
        </div>
      </div>

      {/* 오른쪽: 챕터 */}
      <div className="pts-win absolute top-[62px] right-[18px] bottom-[96px] left-[366px] flex flex-col overflow-hidden">
        <div className="relative h-[150px] shrink-0 overflow-hidden">
          <img src="/survivor/stage/town.webp" alt="" className="absolute inset-0 h-full w-full object-cover" style={{ imageRendering: "pixelated", filter: `hue-rotate(${(ch - 1) * 25}deg) brightness(${1 - (ch - 1) * 0.12})` }} draggable={false} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(22,18,61,0) 30%, #16123d)" }} />
          <div className="absolute top-[10px] left-[10px] z-10">
            <button type="button" disabled={ch <= 1} onClick={() => goCh(ch - 1)} className="pts-btn ghost h-[44px] w-[34px] text-[16px]">
              ◀
            </button>
          </div>
          <div className="absolute top-[10px] right-[10px] z-10">
            <button type="button" disabled={ch >= CH_COUNT} onClick={() => goCh(ch + 1)} className="pts-btn ghost h-[44px] w-[34px] text-[16px]">
              ▶
            </button>
          </div>
          <div className="absolute bottom-[8px] left-[16px]">
            <span className="pts-sub text-[12px] tracking-[3px] text-[#ffd27a]">CHAPTER {ch}</span>
            <b className="pts-title block text-[34px] leading-none">{def.name}</b>
          </div>
          <div className="absolute right-[16px] bottom-[10px] flex gap-[4px]">
            {stars.map((s, i) => (
              <span key={i} className="pts-title text-[30px] leading-none" style={{ color: s ? "#ffd23a" : "#2a2468", textShadow: "2px 2px 0 #07051a" }} title={labels[i]}>
                ★
              </span>
            ))}
          </div>
          {firstSt(ch) > open && (
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(7,5,26,0.7)" }}>
              <span className="text-[34px]">🔒</span>
              <span className="pts-sub text-[13px]">{stName(firstSt(ch) - 1)}을 깨면 열려요</span>
            </div>
          )}
        </div>
        {/* 스테이지 5칸: X-1 ~ X-4 짧은 판 · X-5 챕터 보스 */}
        <div className="flex shrink-0 gap-[8px] px-[16px] pt-[10px]">
          {Array.from({ length: SUB }, (_, i) => {
            const n = firstSt(ch) + i;
            const lock = n > open;
            const on = n === st;
            const ss = prof.stars[`s${n}`] ?? [false, false, false];
            const boss = i === SUB - 1;
            return (
              <button
                key={n}
                type="button"
                disabled={lock}
                onClick={() => (sfx("click"), onSt(n))}
                className="pts-btn relative flex h-[46px] flex-1 flex-col items-center justify-center leading-[16px]"
                style={on ? btn(boss ? "#ff4fa3" : "#ffd27a", "#07051a") : btn(boss ? "#3a1838" : "#221b58", "#e8e4ff")}
                title={boss ? "챕터 보스 (5분)" : "3분 + 미니 보스"}
              >
                <b className="text-[15px]">{lock ? "🔒" : `${stName(n)}${boss ? " 보스" : ""}`}</b>
                <span className="text-[10px] tracking-[1px]">
                  {ss.map((x, k) => (
                    <span key={k} style={{ color: x ? (on ? "#7a4a00" : "#ffd23a") : on ? "#00000033" : "#4a4290" }}>
                      ★
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-1 gap-[16px] px-[16px] py-[10px] text-[12px]">
          <div className="flex flex-1 flex-col gap-[6px]">
            <span>
              <b className="text-[#ffd27a]">{stName(st)}</b> <span className="text-[#a9a2d6]">{def.len / 60}분 버티고</span> <b className="text-[#ff8fb8]">{ENEMIES[def.final].name}</b> <span className="text-[#a9a2d6]">처치</span>
            </span>
            <span className="text-[#a9a2d6]">
              적 체력 ×{def.hp} · 피해 ×{def.dmg}
            </span>
            {def.tip && <span className="text-[#ffd27a]">{def.tip}</span>}
            <div className="flex flex-col gap-[2px]">
              {labels.map((t, i) => (
                <span key={i} style={{ color: stars[i] ? "#ffd23a" : "#6b63a3" }}>
                  ★ {t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex w-[220px] flex-col gap-[6px]">
            <span className="text-[#a9a2d6]">{cleared ? "다시 깨면" : "첫 클리어 보상"}</span>
            {cleared ? (
              <span>코인 · 설계도 · 가끔 장비</span>
            ) : (
              <div className="flex items-center gap-[10px]">
                <Gem v={fr.gems} />
                {fr.gear !== null && <span style={{ color: GRADE_COLOR[fr.gear] }}>{GRADE_NAME[fr.gear]} 장비</span>}
              </div>
            )}
            <span className="text-[11px] text-[#6b63a3]">별 하나 새로 딸 때마다 보석 {STAR_GEMS}</span>
            {note && <span className="text-[12px] text-[#ff8fb8]">{note}</span>}
          </div>
        </div>
        <div className="flex items-center gap-[10px] px-[16px] pb-[12px]">
          {ch === 3 && (prof.bestSt ?? 0) < firstSt(3) + 1 && <span className="text-[11px] leading-[14px] text-[#ff9c7a]">시계탑 아래는 세요 — 막히면 장비를 키우고 다시!</span>}
          <button type="button" disabled={st > open || !loaded} onClick={onStart} className="pts-btn ml-auto h-[52px] w-[220px] text-[22px]" style={btn("#ff4fa3", "#fff")}>
            출동! ▶
          </button>
        </div>
      </div>

      {/* 아래 메뉴 */}
      <div className="absolute right-[18px] bottom-[16px] left-[18px] flex gap-[12px]">
        <NavBtn label="장비" sub={`전투력 ${powerScore(gp)}`} c="#4ff0c8" dot={better > 0 ? `장착 ${better}` : merges > 0 ? `합성 ${merges}` : ""} disabled={!member || !loaded} onClick={() => popUp("gear")} />
        <NavBtn label="상자" sub={prof.freeBox ? "오늘 무료 상자!" : `보석 ${prof.gems.toLocaleString()}`} c="#ffd23a" dot={prof.freeBox || prof.gems >= 300 ? "!" : ""} disabled={!member || !loaded} onClick={() => popUp("box")} />
        <NavBtn label="순찰" sub={member ? `${pend.coin.toLocaleString()} 코인 · 설계도 ${pend.bp} 쌓임` : "로그인하면 쌓여요"} c="#9fb6ff" dot={pend.h >= 1 || prof.quickLeft > 0 ? "!" : ""} disabled={!member || !loaded} onClick={() => popUp("patrol")} />
      </div>
      {pop === "gear" && <GearPanel prof={prof} onProf={onProf} onClose={() => setPop(null)} />}
      {pop === "box" && <Boxes prof={prof} onProf={onProf} onClose={() => setPop(null)} />}
      {pop === "patrol" && <PatrolPop prof={prof} skew={skew} onProf={onProf} onClose={() => setPop(null)} />}
      {notes && <PatchNotes onClose={() => setNotes(false)} />}
    </div>
  );
}

function NavBtn({ label, sub, c, dot, disabled, onClick }: { label: string; sub: string; c: string; dot: string; disabled: boolean; onClick(): void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="pts-btn relative flex h-[64px] flex-1 flex-col items-center justify-center leading-[18px]" style={btn(c)}>
      <b className="text-[19px]">{label}</b>
      <span className="text-[11px] opacity-80">{sub}</span>
      {dot && !disabled && (
        <span className="pts-tag pts-blink absolute -top-[8px] -right-[6px] text-[10px]" style={{ background: "#ff4fa3", color: "#fff" }}>
          {dot}
        </span>
      )}
    </button>
  );
}

/** 쌓인 순찰 보상 (1초마다 다시 계산) */
function usePending(prof: PatrolProfile, skew: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!prof.patrolAt) return { h: 0, coin: 0, bp: 0 };
  return patrolPending(prof.bestSt ?? 0, prof.patrolAt, now + skew);
}

/* ───────────── 순찰 ───────────── */

function PatrolPop({ prof, skew, onProf, onClose }: { prof: PatrolProfile; skew: number; onProf(p: PatrolProfile): void; onClose(): void }) {
  const pend = usePending(prof, skew);
  const rate = patrolRate(prof.bestSt ?? 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; c: string } | null>(null);
  const claim = async (quick: boolean) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await patrol.claim(quick);
      onProf(r.profile);
      sfx("coin");
      setMsg({ t: `코인 +${r.coin.toLocaleString()} · 설계도 +${r.bp}`, c: "#ffd23a" });
    } catch (e) {
      sfx("warn");
      setMsg({ t: (e as Error).message, c: "#ff8fb8" });
    } finally {
      setBusy(false);
    }
  };
  const full = pend.h >= PATROL_MAX_H;
  return (
    <Modal title="순찰" sub="게임을 꺼 두어도 반디가 골목을 돌며 코인 · 설계도를 모아요" onClose={onClose} w={620}>
      <div className="relative mt-[12px] h-[150px] overflow-hidden" style={{ background: "linear-gradient(180deg,#0d0a26,#221b58)", boxShadow: "inset 0 0 0 2px #2a2468" }}>
        <img src="/survivor/title.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" draggable={false} />
        <div className="ptp-walk absolute bottom-[10px]">
          <Token sprite="patrol/hero/bandi" anim="walk" h={90} />
        </div>
        <div className="absolute top-[10px] right-[12px] text-right">
          <span className="text-[11px] text-[#a9a2d6]">순찰한 시간</span>
          <b className="pts-title block text-[24px]">
            {Math.floor(pend.h)}시간 {Math.floor((pend.h % 1) * 60)}분
          </b>
          <span className="text-[11px]" style={{ color: full ? "#ff8fb8" : "#6b63a3" }}>
            {full ? "가득! 받아야 다시 쌓여요" : `최대 ${PATROL_MAX_H}시간`}
          </span>
        </div>
      </div>
      <div className="mt-[12px] flex items-center gap-[16px] text-[16px] font-bold">
        <Coin v={pend.coin} size={16} />
        <Bp v={pend.bp} size={16} />
        <span className="text-[11px] font-normal text-[#a9a2d6]">
          시간당 코인 {rate.coin} · 설계도 {rate.bp} (스테이지를 깰수록 늘어요)
        </span>
      </div>
      <div className="mt-[12px] flex gap-[10px]">
        <button type="button" disabled={busy || pend.h < 1 / 60} onClick={() => void claim(false)} className="pts-btn h-[46px] flex-1 text-[16px]" style={btn("#ffd23a")}>
          받기
        </button>
        <button type="button" disabled={busy || prof.quickLeft <= 0} onClick={() => void claim(true)} className="pts-btn flex h-[46px] flex-1 flex-col items-center justify-center text-[14px] leading-[16px]" style={btn("#9fb6ff")}>
          <span>빠른 순찰 · {QUICK_H}시간치 바로</span>
          <span className="text-[11px]">
            오늘 {prof.quickLeft}/{QUICK_FREE}번 무료
          </span>
        </button>
      </div>
      {msg && <p className="mt-[8px] text-[13px]" style={{ color: msg.c }}>{msg.t}</p>}
    </Modal>
  );
}

/* ───────────── 결과 ───────────── */

function Result({ r, st, fin, err, member, onAgain, onNext, onLobby }: { r: RunResult; st: number; fin: PatrolFinish | null; err: string; member: boolean; onAgain(): void; onNext(): void; onLobby(): void }) {
  const def = stage(st)!;
  const ch = stCh(st);
  const stars = r.ch?.stars ?? [false, false, false];
  const labels = starLabel(def);
  const win = r.win;
  const next = win && st < ST_COUNT;
  return (
    <div className="absolute inset-0 flex flex-col items-center" style={{ background: win ? "linear-gradient(180deg,#3a2a8a,#0d0a26)" : "linear-gradient(180deg,#2a0f2e,#0d0a26)" }}>
      <SysButtons className="absolute top-[14px] right-[18px]" />
      <span className="pts-sub mt-[26px] text-[13px] tracking-[3px] text-[#a9a2d6]">
        스테이지 {stName(st)} · {def.name}
      </span>
      <b className="pts-title pts-drop text-[52px] leading-none" style={{ color: win ? "#ffd23a" : "#ff8fb8" }}>
        {win ? "순찰 완료!" : "쓰러졌어요…"}
      </b>
      <div className="mt-[10px] flex gap-[14px]">
        {stars.map((s, i) => (
          <div key={i} className="flex w-[150px] flex-col items-center">
            <span className={`pts-title text-[46px] leading-none ${s ? "pts-pop" : ""}`} style={{ color: s ? "#ffd23a" : "#2a2468", textShadow: "3px 3px 0 #07051a", animationDelay: `${0.3 + i * 0.25}s` }}>
              ★
            </span>
            <span className="text-center text-[11px]" style={{ color: s ? "#fff" : "#6b63a3" }}>
              {labels[i]}
            </span>
          </div>
        ))}
      </div>
      <div className="pts-win mt-[14px] flex w-[640px] flex-col gap-[8px] px-[18px] py-[12px] text-[13px]">
        <div className="flex justify-between text-[#e8e4ff]">
          <span>{win ? `${fmt(r.sec)} · 보스 ${r.ch?.finalAge ?? 0}초 만에 처치` : `${fmt(r.sec)} 버팀`}</span>
          <span>
            Lv {r.lv} · 처치 {r.kills.toLocaleString()} · 받은 피해 {r.taken.toLocaleString()}
          </span>
        </div>
        {member ? (
          fin ? (
            <>
              <div className="flex items-center gap-[18px] text-[17px] font-bold">
                <Coin v={`+${fin.coins.toLocaleString()}`} size={16} />
                <Bp v={`+${fin.bp}`} size={16} />
                {fin.gems > 0 && <Gem v={`+${fin.gems}`} size={16} />}
                {fin.boosted && (
                  <span className="pts-tag text-[11px]" style={{ background: "#ff9cc8" }}>
                    오늘 보상 ×2
                  </span>
                )}
              </div>
              {fin.first && (
                <span className="text-[#ffd23a]">
                  첫 클리어! {st >= ST_COUNT ? "맛보기 챕터를 전부 깼어요!" : stSub(st) === SUB ? `챕터 ${ch + 1}이 열렸어요` : `${stName(st + 1)}이 열렸어요`}
                </span>
              )}
              {fin.newStars > 0 && <span className="text-[#ffd23a]">새 별 {fin.newStars}개 · 보석 +{fin.newStars * STAR_GEMS}</span>}
              {fin.rank && (fin.first || fin.newStars > 0) && <span className="text-[#4ff0c8]">랭킹 {fin.rank}위!</span>}
              {fin.gear.length > 0 && (
                <div className="flex items-center gap-[10px]">
                  <span className="text-[#a9a2d6]">장비 획득</span>
                  {fin.gear.map((it: GearItem) => (
                    <span key={it.uid} className="flex items-center gap-[6px]">
                      <GearIcon id={it.id} g={it.g} size={44} />
                      <b style={{ color: GRADE_COLOR[it.g] }}>
                        {GRADE_NAME[it.g]} {GEAR[it.id].name}
                      </b>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : err ? (
            <span className="text-[#ff8fb8]">{err}</span>
          ) : (
            <span className="text-[#a9a2d6]">보상 받는 중…</span>
          )
        ) : (
          <span className="text-[#a9a2d6]">로그인하면 코인 · 설계도 · 보석 · 장비를 받고 다음 스테이지가 열려요</span>
        )}
        {!win && <span className="text-[12px] text-[#ff9c7a]">막히면 상자를 열고 장비를 합성 · 강화해서 다시 도전해 봐요</span>}
      </div>
      <div className="mt-[16px] flex gap-[12px]">
        <button type="button" onClick={onLobby} className="pts-btn ghost h-[46px] px-[22px] text-[16px]">
          로비로
        </button>
        <button type="button" onClick={onAgain} className="pts-btn h-[46px] px-[22px] text-[16px]" style={btn(next ? "#221b58" : "#ff4fa3", "#fff")}>
          다시 도전
        </button>
        {next && member && fin && (
          <button type="button" onClick={onNext} className="pts-btn h-[46px] px-[22px] text-[16px]" style={btn("#ff4fa3", "#fff")}>
            {stName(st + 1)} ▶
          </button>
        )}
      </div>
    </div>
  );
}
