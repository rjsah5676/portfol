"use client";

/*
 * 픽셀 순찰대 — 상자 창 (장비: 고급 보석 · 천장 / 일반 코인 · 하루 한 번 무료 · 무기: 보석 · 티켓 · 천장) + 여는 연출
 * 여는 연출: 상자가 흔들림 → 번쩍 → 뚜껑이 열리며 빛기둥(가장 높은 등급 색) → 카드가 한 장씩 뒤집힘
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BOX, PITY_HERO, PITY_LEGEND } from "@/lib/patrol/economy";
import { GEAR, GRADE_COLOR, GRADE_NAME, SLOT_NAME, mainStat, type GearItem } from "@/lib/patrol/gear";
import { NEW_WEAPONS, P_WEAPONS, STAR3, WBOX, WBOX_ODDS, WBOX_PITY } from "@/lib/patrol/weapons";
import { WEAPONS } from "@/lib/survivor/data";
import { patrol, type PatrolProfile, type WeaponGot } from "@/realtime/patrol";
import { sfx } from "../Survivor/audio";
import { ItemIcon } from "../Survivor/Game";
import { Coin, Gem, GearIcon, Modal, btn } from "./ui";
import { Stars, wColor } from "./Weapons";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Kind = "premium" | "premium10" | "normal" | "weapon" | "weapon10" | "wticket";
const isW = (k: Kind) => k === "weapon" || k === "weapon10" || k === "wticket";

export default function Boxes({ prof, onProf, onClose, start = "gear" }: { prof: PatrolProfile; onProf(p: PatrolProfile): void; onClose(): void; start?: "gear" | "weapon" }) {
  const [open, setOpen] = useState<{ kind: Kind; got: GearItem[] | null; wgot?: WeaponGot[] } | null>(null);
  const [tab, setTab] = useState<"gear" | "weapon">(start);
  const [err, setErr] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const buy = async (kind: Kind) => {
    setErr("");
    sfx("click");
    setOpen({ kind, got: null });
    try {
      if (isW(kind)) {
        const [res] = await Promise.all([patrol.wbox(kind === "weapon10" ? 10 : 1, kind === "wticket"), wait(1100)]);
        if (!live.current) return;
        onProf(res.profile);
        setOpen({ kind, got: [], wgot: res.got });
        return;
      }
      const [res] = await Promise.all([patrol.box(kind as "premium" | "premium10" | "normal"), wait(1100)]);
      if (!live.current) return;
      onProf(res.profile);
      setOpen({ kind, got: res.got });
    } catch (e) {
      setOpen(null);
      setErr((e as Error).message);
      sfx("warn");
    }
  };
  if (open) return <Opening kind={open.kind} got={open.got} wgot={open.wgot} onDone={() => setOpen(null)} />;
  const prem = BOX.premium;
  const tabs = (
    <div className="mt-[10px] flex gap-[8px]">
      {(
        [
          ["gear", "장비 상자"],
          ["weapon", "무기 상자"],
        ] as const
      ).map(([k, n]) => (
        <button key={k} type="button" onClick={() => (sfx("click"), setTab(k))} className="pts-btn h-[32px] px-[16px] text-[14px]" style={tab === k ? btn("#ffd27a") : btn("#221b58", "#e8e4ff")}>
          {n}
          {k === "weapon" && prof.wt > 0 && <span className="ml-[6px] text-[11px]">티켓 {prof.wt}</span>}
        </button>
      ))}
    </div>
  );
  if (tab === "weapon")
    return (
      <Modal title="무기 상자" sub="무기 하나 — 처음이면 ★1, 이미 있으면 조각 (별 올리기) · 덱은 「무기」 창에서" onClose={onClose} w={820}>
        {tabs}
        <div className="mt-[12px] flex gap-[16px]">
          <div className="pts-card flex w-[300px] shrink-0 flex-col items-center px-[14px] py-[12px]" style={{ "--r": "#ffd23a" } as CSSProperties}>
            <b className="pts-title text-[22px] text-[#ffd23a]">무기 상자</b>
            <img src="/patrol/ui/box_weapon.png" alt="" draggable={false} className="pts-bob my-[6px] h-[150px] w-[150px]" style={{ imageRendering: "pixelated" }} />
            <span className="text-[11px] text-[#a9a2d6]">{prof.wpity >= 0 && NEW_WEAPONS.some((w) => prof.wown[w] === undefined) ? `안 가진 새 무기 확정까지 ${Math.max(1, WBOX_PITY - prof.wpity)}번` : "새 무기를 다 모았어요 — 별 올리기"}</span>
            <div className="mt-[10px] flex w-full gap-[8px]">
              <button type="button" disabled={prof.gems < WBOX.cost} onClick={() => void buy("weapon")} className="pts-btn flex h-[46px] flex-1 flex-col items-center justify-center text-[14px] leading-[16px]" style={btn("#7fe8ff")}>
                <span>1번 열기</span>
                <Gem v={WBOX.cost} size={11} ink="#07051a" />
              </button>
              <button type="button" disabled={prof.gems < WBOX.cost10} onClick={() => void buy("weapon10")} className="pts-btn flex h-[46px] flex-1 flex-col items-center justify-center text-[14px] leading-[16px]" style={btn("#ffd23a")}>
                <span>10번 열기</span>
                <Gem v={WBOX.cost10} size={11} ink="#07051a" />
              </button>
            </div>
            <button type="button" disabled={prof.wt < 1} onClick={() => void buy("wticket")} className="pts-btn mt-[8px] h-[36px] w-full text-[13px]" style={btn("#4ff0c8")}>
              티켓으로 열기 ({prof.wt}장)
            </button>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <b className="text-[13px] text-[#ffd27a]">나오는 무기</b>
            <div className="mt-[8px] grid grid-cols-5 gap-[10px]">
              {P_WEAPONS.map((w) => {
                const own = prof.wown[w] !== undefined;
                return (
                  <div key={w} className="flex flex-col items-center gap-[2px] px-[2px] py-[6px]" style={{ background: "#16123d", boxShadow: `0 0 0 2px ${own ? wColor(w) : "#2a2468"}` }} title={`${WEAPONS[w].name} · ★3 ${STAR3[w]}`}>
                    <span style={{ filter: own ? "none" : "grayscale(1) brightness(0.55)" }}>
                      <ItemIcon k="weapon" id={w} size={34} />
                    </span>
                    <span className="max-w-full truncate text-[10px]">{WEAPONS[w].name}</span>
                    <span className="text-[10px]" style={{ color: NEW_WEAPONS.includes(w) ? "#ffd23a" : "#9fb6ff" }}>
                      {WBOX_ODDS[w]}%
                    </span>
                  </div>
                );
              })}
            </div>
            <span className="mt-[10px] text-[11px] leading-[16px] text-[#a9a2d6]">
              금색 = 새 무기 (각 {WBOX_ODDS.umbrella}%) · 파랑 = 기본 무기 (각 {WBOX_ODDS.shuriken}%) · 별이 다 찬 무기가 또 나오면 코인 300
            </span>
          </div>
        </div>
        <div className="mt-[10px] flex items-center gap-[14px] text-[13px]">
          <Gem v={prof.gems} />
          <span className="text-[11px] text-[#6b63a3]">티켓: 상점 꾸러미</span>
          {err && <span className="ml-auto text-[12px] text-[#ff8fb8]">{err}</span>}
        </div>
      </Modal>
    );
  return (
    <Modal title="장비 상자" sub="얻은 장비는 장비 창 가방으로 · 같은 칸 · 같은 등급 3개면 합성" onClose={onClose} w={820}>
      {tabs}
      <div className="mt-[12px] grid grid-cols-2 gap-[16px]">
        <div className="pts-card flex flex-col items-center px-[14px] py-[12px]" style={{ "--r": "#ffd23a" } as CSSProperties}>
          <b className="pts-title text-[22px] text-[#ffd23a]">고급 상자</b>
          <img src="/patrol/ui/box_premium.png" alt="" draggable={false} className="pts-bob my-[6px] h-[150px] w-[150px]" style={{ imageRendering: "pixelated" }} />
          <div className="flex gap-[6px] text-[11px]">
            {prem.odds.map((o, g) =>
              o ? (
                <span key={g} style={{ color: GRADE_COLOR[g] }}>
                  {GRADE_NAME[g]} {o}%
                </span>
              ) : null
            )}
          </div>
          <span className="mt-[4px] text-[11px] text-[#a9a2d6]">
            영웅 확정까지 {Math.max(1, PITY_HERO - prof.pity.hero)}번 · 전설 확정까지 {Math.max(1, PITY_LEGEND - prof.pity.legend)}번
          </span>
          <div className="mt-[10px] flex w-full gap-[8px]">
            <button type="button" disabled={prof.gems < prem.cost} onClick={() => void buy("premium")} className="pts-btn flex h-[46px] flex-1 flex-col items-center justify-center text-[14px] leading-[16px]" style={btn("#7fe8ff")}>
              <span>1번 열기</span>
              <Gem v={prem.cost} size={11} ink="#07051a" />
            </button>
            <button type="button" disabled={prof.gems < BOX.premium10.cost} onClick={() => void buy("premium10")} className="pts-btn flex h-[46px] flex-1 flex-col items-center justify-center text-[14px] leading-[16px]" style={btn("#ffd23a")}>
              <span>10번 열기</span>
              <Gem v={BOX.premium10.cost} size={11} ink="#07051a" />
            </button>
          </div>
          <span className="mt-[4px] text-[10px] text-[#6b63a3]">10번 열기: 10% 할인 · 희귀 이상 하나 확정</span>
        </div>
        <div className="pts-card flex flex-col items-center px-[14px] py-[12px]" style={{ "--r": "#c58b6a" } as CSSProperties}>
          <b className="pts-title text-[22px] text-[#e8c8a8]">일반 상자</b>
          <img src="/patrol/ui/box_normal.png" alt="" draggable={false} className="my-[6px] h-[150px] w-[150px]" style={{ imageRendering: "pixelated" }} />
          <div className="flex gap-[6px] text-[11px]">
            {BOX.normal.odds.map((o, g) =>
              o ? (
                <span key={g} style={{ color: GRADE_COLOR[g] }}>
                  {GRADE_NAME[g]} {o}%
                </span>
              ) : null
            )}
          </div>
          <span className="mt-[4px] text-[11px] text-[#a9a2d6]">하루 한 번 무료 · 그다음엔 코인</span>
          <button type="button" disabled={!prof.freeBox && prof.coins < BOX.normal.cost} onClick={() => void buy("normal")} className="pts-btn mt-[10px] flex h-[46px] w-full flex-col items-center justify-center text-[14px] leading-[16px]" style={prof.freeBox ? btn("#4ff0c8") : btn("#e8c8a8")}>
            <span>{prof.freeBox ? "무료로 열기!" : "열기"}</span>
            {prof.freeBox ? <span className="text-[11px]">오늘 한 번</span> : <Coin v={BOX.normal.cost} size={11} ink="#07051a" />}
          </button>
        </div>
      </div>
      <div className="mt-[10px] flex items-center gap-[14px] text-[13px]">
        <Gem v={prof.gems} /> <Coin v={prof.coins} />
        <span className="text-[11px] text-[#6b63a3]">보석: 챕터 첫 클리어 · 별 / 코인: 판 · 순찰</span>
        {err && <span className="ml-auto text-[12px] text-[#ff8fb8]">{err}</span>}
      </div>
    </Modal>
  );
}

/** 여는 연출 */
function Opening({ kind, got, wgot, onDone }: { kind: Kind; got: GearItem[] | null; wgot?: WeaponGot[]; onDone(): void }) {
  const prem = kind !== "normal";
  const weapon = isW(kind);
  /** 무기: 새 무기 = 전설 색 · 별 오름 = 영웅 색 · 나머지 = 고급 색 */
  const wg = (x: WeaponGot) => (x.isNew ? 4 : x.up ? 3 : 1);
  const n = weapon ? (wgot?.length ?? 0) : (got?.length ?? 0);
  const gradeAt = (i: number) => (weapon ? wg(wgot![i]) : got![i].g);
  const best = got ? (weapon ? Math.max(1, ...(wgot ?? []).map(wg)) : Math.max(...got.map((x) => x.g))) : -1;
  const [shown, setShown] = useState(0);
  const [lid, setLid] = useState(false);
  const live = useRef(true);
  /** 건너뛰기로 다 보여줬는지 · 다 보인 시각 (바로 닫히지 않게) */
  const allRef = useRef(false);
  const allAt = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!got) {
      sfx("summon");
      return;
    }
    let off = false;
    void (async () => {
      setLid(true);
      sfx(best >= 4 ? "legend" : best >= 3 ? "rare" : "chest");
      await wait(best >= 3 ? 900 : 550);
      for (let i = 0; i < n; i++) {
        if (off || !live.current || allRef.current) return;
        setShown((s) => Math.max(s, i + 1));
        sfx(gradeAt(i) >= 3 ? "rare" : "reveal");
        await wait(n > 1 ? 160 : 0);
      }
      allAt.current = performance.now();
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [got, best]);
  /** 1번째: 전부 보여주기 (결과 화면) · 2번째: 닫기 — 결과가 보인 뒤 잠깐은 안 닫힘 */
  const skip = useCallback(() => {
    if (!got) return;
    if (shown < n) {
      allRef.current = true;
      allAt.current = performance.now();
      setLid(true);
      setShown(n);
      sfx(best >= 3 ? "rare" : "reveal");
      return;
    }
    if (performance.now() - allAt.current < 350) return;
    onDone();
  }, [got, shown, best, onDone, n]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [skip]);
  const c = best >= 0 ? GRADE_COLOR[best] : "#ffd23a";
  const many = (got ? n : 1) > 1;
  /** 카드가 나오면 상자는 작게 아래로 */
  const small = shown > 0;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center overflow-hidden" style={{ background: "radial-gradient(ellipse at 50% 60%, #2a2468, #07051a 75%)" }} onClick={skip}>
      <div className="pts-stars absolute inset-0 opacity-50" />
      {/* 빛살 (가장 높은 등급 색) — 상자 뒤에서 돌아감 */}
      {lid && (
        <div className="ptp-rays absolute left-1/2 h-[900px] w-[900px]" style={{ bottom: small ? 16 + 70 - 450 : 120 + 115 - 450, background: `repeating-conic-gradient(from 0deg, ${c}66 0deg 7deg, transparent 7deg 18deg)`, transition: "bottom 0.25s steps(4)" }} />
      )}
      {lid && <div className="absolute left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full" style={{ bottom: small ? 16 + 70 - 210 : 120 + 115 - 210, background: `radial-gradient(circle, ${c}aa 0%, ${c}33 35%, transparent 70%)`, transition: "bottom 0.25s steps(4)" }} />}
      {lid && <div className="pts-flash absolute inset-0" style={{ background: c }} />}
      {/* 상자 */}
      <img
        src={`/patrol/ui/box_${weapon ? "weapon" : prem ? "premium" : "normal"}${lid ? "_open" : ""}.png`}
        alt=""
        draggable={false}
        className={`absolute ${lid ? "" : "ptp-shake"}`}
        style={{ imageRendering: "pixelated", width: small ? 140 : 230, height: small ? 140 : 230, bottom: small ? 16 : 120, transition: "all 0.25s steps(4)" }}
      />
      {/* 카드 */}
      {got && shown > 0 && (
        <div className={`relative z-10 grid gap-[12px] ${many ? "mb-[120px] grid-cols-5" : "mb-[110px]"}`}>
          {weapon ? wgot!.slice(0, shown).map((w, i) => <WCard key={i} w={w} big={!many} />) : got.slice(0, shown).map((it) => <Card key={it.uid} it={it} big={!many} />)}
        </div>
      )}
      {got && shown >= n && (
        <span className="pts-sub pts-blink absolute top-[14px] text-[13px] text-[#e8e4ff]">눌러서 닫기 (스페이스)</span>
      )}
    </div>
  );
}

/** 무기 카드: 새 무기 · 별 오름 · 조각 */
function WCard({ w, big }: { w: WeaponGot; big: boolean }) {
  const c = w.isNew ? GRADE_COLOR[4] : w.up ? GRADE_COLOR[3] : wColor(w.id);
  const tag = w.isNew ? "NEW!" : w.coin ? `코인 +${w.coin}` : w.up ? `★${w.star}!` : "조각 +1";
  return (
    <div className={`pts-flip relative flex flex-col items-center ${big ? "w-[200px] px-[12px] py-[12px]" : "w-[132px] px-[6px] py-[8px]"}`} style={{ background: "linear-gradient(180deg,#221b58,#16123d)", boxShadow: `0 0 0 2px ${c}, 0 0 0 4px #07051a, 0 0 ${w.isNew || w.up ? 24 : 8}px ${c}` }}>
      <span className="pts-tag text-[10px]" style={{ background: c }}>
        {tag}
      </span>
      <div className="mt-[8px]">
        <ItemIcon k="weapon" id={w.id} size={big ? 96 : 60} />
      </div>
      <b className={`mt-[6px] text-center ${big ? "text-[16px]" : "text-[12px]"}`}>{WEAPONS[w.id].name}</b>
      <Stars n={w.star} size={big ? 16 : 11} />
    </div>
  );
}

function Card({ it, big }: { it: GearItem; big: boolean }) {
  const c = GRADE_COLOR[it.g];
  const m = mainStat(it.id, it.g, it.lv);
  return (
    <div className={`pts-flip relative flex flex-col items-center ${big ? "w-[200px] px-[12px] py-[12px]" : "w-[132px] px-[6px] py-[8px]"}`} style={{ background: "linear-gradient(180deg,#221b58,#16123d)", boxShadow: `0 0 0 2px ${c}, 0 0 0 4px #07051a, 0 0 ${it.g >= 3 ? 24 : 8}px ${c}` }}>
      <span className="pts-tag text-[10px]" style={{ background: c }}>
        {GRADE_NAME[it.g]}
      </span>
      <div className="mt-[6px]">
        <GearIcon id={it.id} g={it.g} size={big ? 110 : 70} />
      </div>
      <b className={`mt-[6px] text-center ${big ? "text-[16px]" : "text-[12px]"}`}>{GEAR[it.id].name}</b>
      <span className="text-[10px] text-[#a9a2d6]">
        {SLOT_NAME[GEAR[it.id].slot]} · {m.k === "atk" ? "공격" : "체력"} {m.v}
      </span>
    </div>
  );
}
