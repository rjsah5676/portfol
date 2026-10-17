"use client";

/*
 * 픽셀 순찰대 — 상자 창 (고급: 보석 · 천장 / 일반: 코인 · 하루 한 번 무료) + 여는 연출
 * 여는 연출: 상자가 흔들림 → 번쩍 → 뚜껑이 열리며 빛기둥(가장 높은 등급 색) → 카드가 한 장씩 뒤집힘
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BOX, PITY_HERO, PITY_LEGEND } from "@/lib/patrol/economy";
import { GEAR, GRADE_COLOR, GRADE_NAME, SLOT_NAME, mainStat, type GearItem } from "@/lib/patrol/gear";
import { patrol, type PatrolProfile } from "@/realtime/patrol";
import { sfx } from "../Survivor/audio";
import { Coin, Gem, GearIcon, Modal, btn } from "./ui";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Kind = "premium" | "premium10" | "normal";

export default function Boxes({ prof, onProf, onClose }: { prof: PatrolProfile; onProf(p: PatrolProfile): void; onClose(): void }) {
  const [open, setOpen] = useState<{ kind: Kind; got: GearItem[] | null } | null>(null);
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
      const [res] = await Promise.all([patrol.box(kind), wait(1100)]);
      if (!live.current) return;
      onProf(res.profile);
      setOpen({ kind, got: res.got });
    } catch (e) {
      setOpen(null);
      setErr((e as Error).message);
      sfx("warn");
    }
  };
  if (open) return <Opening kind={open.kind} got={open.got} onDone={() => setOpen(null)} />;
  const prem = BOX.premium;
  return (
    <Modal title="장비 상자" sub="얻은 장비는 장비 창 가방으로 · 같은 칸 · 같은 등급 3개면 합성" onClose={onClose} w={820}>
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
function Opening({ kind, got, onDone }: { kind: Kind; got: GearItem[] | null; onDone(): void }) {
  const prem = kind !== "normal";
  const best = got ? Math.max(...got.map((x) => x.g)) : -1;
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
      for (let i = 0; i < got.length; i++) {
        if (off || !live.current || allRef.current) return;
        setShown((s) => Math.max(s, i + 1));
        sfx(got[i].g >= 3 ? "rare" : "reveal");
        await wait(got.length > 1 ? 160 : 0);
      }
      allAt.current = performance.now();
    })();
    return () => {
      off = true;
    };
  }, [got, best]);
  /** 1번째: 전부 보여주기 (결과 화면) · 2번째: 닫기 — 결과가 보인 뒤 잠깐은 안 닫힘 */
  const skip = useCallback(() => {
    if (!got) return;
    if (shown < got.length) {
      allRef.current = true;
      allAt.current = performance.now();
      setLid(true);
      setShown(got.length);
      sfx(best >= 3 ? "rare" : "reveal");
      return;
    }
    if (performance.now() - allAt.current < 350) return;
    onDone();
  }, [got, shown, best, onDone]);
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
  const many = (got?.length ?? 1) > 1;
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
        src={`/patrol/ui/box_${prem ? "premium" : "normal"}${lid ? "_open" : ""}.png`}
        alt=""
        draggable={false}
        className={`absolute ${lid ? "" : "ptp-shake"}`}
        style={{ imageRendering: "pixelated", width: small ? 140 : 230, height: small ? 140 : 230, bottom: small ? 16 : 120, transition: "all 0.25s steps(4)" }}
      />
      {/* 카드 */}
      {got && shown > 0 && (
        <div className={`relative z-10 grid gap-[12px] ${many ? "mb-[120px] grid-cols-5" : "mb-[110px]"}`}>
          {got.slice(0, shown).map((it) => (
            <Card key={it.uid} it={it} big={!many} />
          ))}
        </div>
      )}
      {got && shown >= got.length && (
        <span className="pts-sub pts-blink absolute top-[14px] text-[13px] text-[#e8e4ff]">눌러서 닫기 (스페이스)</span>
      )}
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
