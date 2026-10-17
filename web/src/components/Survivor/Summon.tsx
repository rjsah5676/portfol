"use client";

/*
 * 별빛 소환 — 서바이버 안에서 바로 하는 캐릭터 뽑기 (다이스 타운과 같은 뽑기 · 같은 별사탕 · 같은 보유 목록).
 * 서버는 marble.pull 그대로. 화면만 서바이버 도트 UI: 소환진에 별이 떨어지고 → 빛기둥 색으로 최고 등급 예고 → 카드 공개.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { charUpNeed, type CharPull } from "@/lib/marble/gacha";
import { CHAR_OVERFLOW_STARS, GACHA, MAX_LV } from "@/lib/marble/data";
import { HEROES, HERO_IDS, type Grade, type HeroId } from "@/lib/survivor/data";
import { marble } from "@/realtime/marble";
import type { SurvivorProfile } from "@/realtime/survivor";
import Token from "../Marble/Token";
import { sfx } from "./audio";

export const GRADE_COL: Record<Grade, string> = { R: "#9fb6ff", SR: "#c58bff", SSR: "#ffb03a", UR: "#ff4fa3" };
const RANK: Record<Grade, number> = { R: 0, SR: 1, SSR: 2, UR: 3 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Phase = { k: "idle" } | { k: "cast"; n: number; best: Grade | null } | { k: "show"; got: CharPull[]; n: 1 | 10; ticket: boolean; all: boolean };

export default function Summon({ prof, onProf, onClose, focus }: { prof: SurvivorProfile; onProf(p: SurvivorProfile): void; onClose(): void; focus?: HeroId }) {
  const [ph, setPh] = useState<Phase>({ k: "idle" });
  const [err, setErr] = useState("");
  const busy = ph.k === "cast";
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);

  const pull = async (n: 1 | 10, ticket = false) => {
    if (busy) return;
    setErr("");
    sfx("summon");
    setPh({ k: "cast", n, best: null });
    try {
      const [res] = await Promise.all([marble.pull("char", n, ticket), wait(900)]);
      if (!live.current) return;
      const got = res.got.filter((x): x is CharPull => x.k === "char");
      const best = got.reduce<Grade>((b, x) => (RANK[x.grade] > RANK[b] ? x.grade : b), "R");
      onProf({ ...prof, chars: res.profile.chars, stars: res.profile.stars, tickets: res.profile.tickets.char, pity: res.profile.pity });
      // 빛기둥 색으로 최고 등급 예고
      setPh({ k: "cast", n, best });
      sfx(best === "UR" ? "legend" : best === "SSR" ? "rare" : "chest");
      await wait(best === "UR" ? 1300 : best === "SSR" ? 1000 : 650);
      if (!live.current) return;
      setPh({ k: "show", got, n, ticket, all: false });
    } catch (e) {
      setErr((e as Error).message);
      setPh({ k: "idle" });
    }
  };

  // 카드 하나씩 소리
  const shown = ph.k === "show" ? ph.got.length : 0;
  useEffect(() => {
    if (ph.k !== "show" || ph.all) return;
    const ts = ph.got.map((x, i) => setTimeout(() => sfx(RANK[x.grade] >= 2 ? "rare" : "reveal"), 120 + i * 140));
    return () => ts.forEach(clearTimeout);
  }, [ph, shown]);

  const ownedN = HERO_IDS.filter((h) => prof.chars[h]).length;
  const pity = prof.pity ?? { char: 0, item: 0, ur: 0 };
  const toSSR = Math.max(1, GACHA.char.pity - pity.char);
  const toUR = Math.max(1, GACHA.char.urPity - (pity.ur ?? 0));
  const tickets = prof.tickets ?? 0;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(7,5,26,0.82)" }} onClick={close}>
      <div className="pts-win pts-pop relative flex h-[500px] w-[900px] flex-col overflow-hidden px-[18px] py-[14px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-[10px]">
          <span className="pts-tag text-[13px]" style={{ background: "#ff9cc8" }}>
            별빛 소환
          </span>
          <span className="text-[12px] text-[#a9a2d6]">다이스 타운과 같은 뽑기 · 별사탕 · 캐릭터를 같이 써요</span>
          <span className="pts-sub ml-auto text-[15px] text-[#ff9cc8]">★ {prof.stars.toLocaleString()}</span>
          {tickets > 0 && <span className="pts-sub text-[13px] text-[#ffd23a]">🎫 {tickets}</span>}
          <button type="button" onClick={close} disabled={busy} className="pts-btn ghost h-[28px] w-[28px] text-[14px]">
            ✕
          </button>
        </div>

        {ph.k === "show" ? (
          <Reveal ph={ph} prof={prof} tickets={tickets} onSkip={() => setPh({ ...ph, all: true })} onOk={() => setPh({ k: "idle" })} onAgain={() => void pull(ph.n, ph.ticket)} />
        ) : (
          <div className="mt-[12px] flex min-h-0 flex-1 gap-[18px]">
            <Altar ph={ph} />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-[8px]">
                <span className="pts-tag text-[11px]">도감 {ownedN}/{HERO_IDS.length}</span>
                <span className="text-[11.5px] text-[#a9a2d6]">뽑은 캐릭터는 다이스 타운 · 서바이버 둘 다에서 써요</span>
              </div>
              <div className="mt-[8px] grid grid-cols-8 gap-[6px]">
                {HERO_IDS.map((id) => {
                  const h = HEROES[id];
                  const c = prof.chars[id];
                  return (
                    <div
                      key={id}
                      title={c ? `${h.title} +${c.lv}` : "? ? ?"}
                      className="relative flex h-[58px] items-end justify-center overflow-hidden"
                      style={{ background: c ? "#221b58" : "#100c2c", boxShadow: `0 0 0 2px ${focus === id ? "#fff" : GRADE_COL[h.grade]}, 0 0 0 4px #07051a` }}
                    >
                      <span className="absolute top-[1px] left-[3px] text-[9px] font-bold" style={{ color: GRADE_COL[h.grade] }}>
                        {h.grade}
                      </span>
                      <div style={{ filter: c ? undefined : "brightness(0.12) saturate(0)" }}>
                        <Token sprite={h.sprite} anim="idle" h={44} />
                      </div>
                      {c && c.lv > 0 && <span className="absolute top-[1px] right-[3px] text-[9px] text-[#ffd23a]">+{c.lv}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-[12px] grid grid-cols-4 gap-[6px] text-center text-[11px]">
                {(["R", "SR", "SSR", "UR"] as Grade[]).map((g) => (
                  <div key={g} className="pts-box px-[4px] py-[4px]">
                    <b style={{ color: GRADE_COL[g] }}>{g}</b> <span className="text-[#e8e4ff]">{(GACHA.char.rate[g] * 100).toFixed(g === "UR" ? 1 : g === "SSR" ? 1 : 0)}%</span>
                  </div>
                ))}
              </div>
              <div className="mt-[10px] flex flex-col gap-[5px] text-[11px] text-[#a9a2d6]">
                <Pity label="SSR 이상 확정까지" left={toSSR} max={GACHA.char.pity} c="#ffb03a" />
                <Pity label="UR 확정까지" left={toUR} max={GACHA.char.urPity} c="#ff4fa3" />
                <span>10회 소환은 SR 이상 1장 확정 · 끝까지 강화한 캐릭터가 또 나오면 별사탕으로 돌려받아요 (UR ★{CHAR_OVERFLOW_STARS.UR})</span>
              </div>
              {err && <p className="mt-[6px] text-[12px] text-[#ff8fb8]">{err}</p>}
              <div className="mt-auto flex items-end justify-end gap-[12px]">
                {tickets > 0 && (
                  <button type="button" disabled={busy} onClick={() => void pull(10, true)} className="pts-btn h-[46px] px-[14px] text-[14px]" style={{ "--c": "#ffd23a" } as CSSProperties}>
                    티켓 10회
                  </button>
                )}
                <button type="button" disabled={busy || prof.stars < GACHA.char.one} onClick={() => void pull(1)} className="pts-btn h-[46px] px-[16px] text-[15px]" style={{ "--c": "#c58bff", "--t": "#fff" } as CSSProperties}>
                  1회 <span className="text-[12px]">★{GACHA.char.one}</span>
                </button>
                <button type="button" disabled={busy || prof.stars < GACHA.char.ten} onClick={() => void pull(10)} className="pts-btn h-[52px] px-[20px] text-[18px]" style={{ "--c": "#ff4fa3", "--t": "#fff" } as CSSProperties}>
                  10회 소환 <span className="text-[13px]">★{GACHA.char.ten.toLocaleString()}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Reveal({ ph, prof, tickets, onSkip, onOk, onAgain }: { ph: Extract<Phase, { k: "show" }>; prof: SurvivorProfile; tickets: number; onSkip(): void; onOk(): void; onAgain(): void }) {
  const one = ph.got.length === 1;
  const again = ph.ticket ? tickets > 0 : prof.stars >= (ph.n === 10 ? GACHA.char.ten : GACHA.char.one);
  return (
    <div className="relative mt-[10px] flex min-h-0 flex-1 flex-col" onClick={onSkip}>
      <div className="pts-stars absolute inset-0 opacity-30" />
      <div className={`relative flex flex-1 items-center justify-center ${one ? "" : "content-center"}`}>
        <div className={one ? "" : "grid grid-cols-5 gap-x-[14px] gap-y-[16px]"}>
          {ph.got.map((x, i) => (
            <Card key={i} x={x} big={one} delay={ph.all ? 0 : i * 140} prof={prof} />
          ))}
        </div>
      </div>
      <div className="relative flex items-center justify-end gap-[12px]" onClick={(e) => e.stopPropagation()}>
        <span className="mr-auto text-[11.5px] text-[#a9a2d6]">새 캐릭터는 바로 편성할 수 있어요 · 같은 카드가 모이면 고르기 화면에서 강화</span>
        <button type="button" onClick={onOk} className="pts-btn ghost h-[40px] px-[16px] text-[14px]">
          확인
        </button>
        <button
          type="button"
          disabled={!again}
          onClick={onAgain}
          className="pts-btn h-[40px] px-[20px] text-[15px]"
          style={{ "--c": "#ff4fa3", "--t": "#fff" } as CSSProperties}
        >
          한 번 더 {ph.ticket ? "(티켓)" : `★${(ph.n === 10 ? GACHA.char.ten : GACHA.char.one).toLocaleString()}`}
        </button>
      </div>
    </div>
  );
}

function Pity({ label, left, max, c }: { label: string; left: number; max: number; c: string }) {
  return (
    <div className="flex items-center gap-[8px]">
      <span className="w-[104px]">{label}</span>
      <div className="pts-bar h-[7px] flex-1" style={{ "--c": c } as CSSProperties}>
        <i style={{ width: `${((max - left) / max) * 100}%` }} />
      </div>
      <b className="w-[44px] text-right" style={{ color: c }}>
        {left}회
      </b>
    </div>
  );
}

/** 소환진 — 대기 중엔 천천히 빛나고, 소환하면 별이 떨어져 빛기둥 (색 = 최고 등급) */
function Altar({ ph }: { ph: Phase }) {
  const cast = ph.k === "cast";
  const best = cast ? ph.best : null;
  const col = best ? GRADE_COL[best] : "#f4f0ff";
  return (
    <div className="relative h-full w-[300px] shrink-0 overflow-hidden" style={{ background: "linear-gradient(180deg,#07051a,#1a1350 70%,#2a1a60)", boxShadow: "0 0 0 2px #3a3080" }}>
      <div className="pts-stars absolute inset-0 opacity-50" />
      {/* 제단 (87×80 도트 ×3) — 별이 떨어지는 자리 = 제단 위 소환진 (위에서 38%) */}
      <div className="absolute bottom-[18px] left-1/2 h-[240px] w-[261px] -translate-x-1/2">
        <div className="pts-rune absolute top-[30%] left-1/2 h-[60px] w-[150px] -translate-x-1/2" style={{ borderRadius: "50%", background: `radial-gradient(ellipse, ${cast ? col : "#c58bff"}88, transparent 70%)` }} />
        <img src="/survivor/ui/altar.png" alt="" className="absolute inset-0 h-full w-full" style={{ imageRendering: "pixelated" }} draggable={false} />
        {best && <div className="pts-beam absolute bottom-[60%] left-1/2 w-[90px]" style={{ height: 600, background: `linear-gradient(180deg, transparent, ${col} 40%, #fff 96%)` }} />}
      </div>
      {cast && !best && (
        <span className="pts-fall absolute left-1/2 text-[34px]" style={{ marginLeft: -17 }}>
          ★
        </span>
      )}
      {best && (
        <>
          <div className="pts-flash absolute inset-0" style={{ background: best === "UR" ? "#ffd1ea" : "#fff" }} />
          {RANK[best] >= 2 && (
            <b className="pts-title pts-pop absolute top-[40px] w-full text-center text-[30px]" style={{ color: col }}>
              {best}!
            </b>
          )}
        </>
      )}
      {!cast && <span className="pts-sub pts-blink absolute top-[14px] w-full text-center text-[11px] text-[#e8e4ff]">별사탕을 바치면 친구가 와요</span>}
    </div>
  );
}

function Card({ x, big, delay, prof }: { x: CharPull; big: boolean; delay: number; prof: SurvivorProfile }) {
  const h = HEROES[x.id as HeroId];
  const col = GRADE_COL[x.grade];
  const c = prof.chars[x.id];
  const canUp = !!c && c.lv < MAX_LV && c.dup >= charUpNeed(c.lv);
  const rare = RANK[x.grade] >= 2;
  return (
    <div
      className={`pts-card pts-flip relative flex flex-col items-center justify-end ${rare ? "legend" : ""}`}
      style={{ "--r": col, width: big ? 210 : 132, height: big ? 280 : 168, animationDelay: `${delay}ms`, background: rare ? "linear-gradient(180deg,#3a2470,#16123d)" : undefined } as CSSProperties}
    >
      <span className="absolute top-[4px] left-[6px] text-[12px] font-bold" style={{ color: col }}>
        {x.grade}
      </span>
      {x.fresh && (
        <span className="pts-tag absolute top-[4px] right-[4px] text-[10px]" style={{ background: "#ff4fa3", color: "#fff" }}>
          NEW
        </span>
      )}
      <div className="flex items-end" style={{ height: big ? 180 : 96 }}>
        {h ? <Token sprite={h.sprite} anim={x.fresh || rare ? "win" : "idle"} h={big ? 170 : 90} /> : null}
      </div>
      <span className="text-[10.5px] text-[#a9a2d6]">{h?.title}</span>
      <b className={big ? "text-[18px]" : "text-[13px]"} style={{ color: rare ? col : "#fff" }}>
        {h?.name ?? x.id}
      </b>
      <span className="mb-[6px] h-[16px] text-[10.5px]">
        {x.stars ? <span className="text-[#ff9cc8]">★ +{x.stars}</span> : x.fresh ? <span className="text-[#4ff0c8]">새 친구!</span> : canUp ? <span className="pts-blink text-[#ffd23a]">강화 가능!</span> : <span className="text-[#e8e4ff]">카드 +1</span>}
      </span>
    </div>
  );
}
