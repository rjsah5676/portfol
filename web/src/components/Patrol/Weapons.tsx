"use client";

/*
 * 픽셀 순찰대 — 무기 덱 창: 위 덱 6칸 (판 안 레벨업 카드에 나오는 무기) · 아래 가진 무기 · 오른쪽 고른 무기 (별 · 조각 · 효과)
 * 바꾸기: 덱 밖 무기를 고르고 → 덱 칸을 누르면 그 자리에 들어감
 */
import { useState, type CSSProperties } from "react";
import { BASE_DECK, DECK_N, FIRST_WEAPON, NEW_WEAPONS, P_WEAPONS, STAR3, STAR5, STAR_DMG, STAR_MAX, W_ROLE, starOf, starProgress } from "@/lib/patrol/weapons";
import { stName } from "@/lib/patrol/chapters";
import { PASSIVES, WEAPONS, type WeaponId } from "@/lib/survivor/data";
import { patrol, type PatrolProfile } from "@/realtime/patrol";
import { sfx } from "../Survivor/audio";
import { ItemIcon, evoOf } from "../Survivor/Game";
import { Modal, btn } from "./ui";

/** 기본 무기 · 새 무기 테두리 색 */
export const wColor = (w: WeaponId) => (NEW_WEAPONS.includes(w) ? "#ffd23a" : "#9fb6ff");
/** 어디서 얻나 (안 가진 무기) */
const whereOf = (w: WeaponId) => {
  const st = Object.entries(FIRST_WEAPON).find(([, x]) => x === w)?.[0];
  return st ? `${stName(Number(st))} 첫 클리어 · 무기 상자` : "무기 상자 · 첫 순찰 꾸러미";
};

export function Stars({ n, size = 12 }: { n: number; size?: number }) {
  return (
    <span className="tracking-[-1px]" style={{ fontSize: size, lineHeight: 1 }}>
      {Array.from({ length: STAR_MAX }, (_, i) => (
        <span key={i} style={{ color: i < n ? "#ffd23a" : "#3a3478", textShadow: "1px 1px 0 #07051a" }}>
          ★
        </span>
      ))}
    </span>
  );
}

export function WeaponTile({ w, prof, size = 56, on, dim, onClick, badge }: { w: WeaponId; prof: PatrolProfile; size?: number; on?: boolean; dim?: boolean; onClick?(): void; badge?: string }) {
  const own = prof.wown[w] !== undefined;
  const c = wColor(w);
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex shrink-0 cursor-pointer flex-col items-center justify-center"
      style={{ width: size, height: size + (size >= 56 ? 26 : 14), background: on ? "#3a2f8a" : "#16123d", boxShadow: `0 0 0 2px ${on ? "#ffffff" : own ? c : "#2a2468"}, 0 0 0 4px #07051a`, opacity: dim ? 0.45 : 1 }}
      title={WEAPONS[w].name}
    >
      <span style={{ filter: own ? "none" : "grayscale(1) brightness(0.5)" }}>
        <ItemIcon k="weapon" id={w} size={Math.round(size * 0.62)} />
      </span>
      {own ? <Stars n={starOf(prof.wown[w] ?? 0)} size={Math.max(8, Math.round(size / 6))} /> : <span className="text-[10px] text-[#6b63a3]">🔒</span>}
      {size >= 56 && <span className="mt-[3px] max-w-full truncate px-[2px] text-[10px] leading-none text-[#e8e4ff]">{WEAPONS[w].name}</span>}
      {badge && (
        <span className="pts-tag absolute -top-[7px] -right-[6px] text-[9px]" style={{ background: "#ff4fa3", color: "#fff" }}>
          {badge}
        </span>
      )}
    </button>
  );
}

export default function WeaponsPanel({ prof, onProf, onClose }: { prof: PatrolProfile; onProf(p: PatrolProfile): void; onClose(): void }) {
  const [sel, setSel] = useState<WeaponId>(prof.wdeck[0] ?? "shuriken");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; c: string } | null>(null);
  const deck = prof.wdeck;
  const own = prof.wown[sel] !== undefined;
  const inDeck = deck.includes(sel);
  const shards = prof.wown[sel] ?? 0;
  const star = own ? starOf(shards) : 0;
  const prog = own ? starProgress(shards) : null;
  const def = WEAPONS[sel];

  const put = async (slot: number) => {
    sfx("click");
    // 덱 밖 가진 무기를 고른 채 덱 칸을 누르면 바꿈, 아니면 그 칸 무기를 고름
    if (!own || inDeck || busy) {
      setSel(deck[slot]);
      return;
    }
    const next = [...deck];
    next[slot] = sel;
    setBusy(true);
    setMsg(null);
    try {
      onProf(await patrol.deck(next));
      sfx("buy");
      setMsg({ t: `${WEAPONS[deck[slot]].name} → ${def.name}`, c: "#4ff0c8" });
    } catch (e) {
      sfx("warn");
      setMsg({ t: (e as Error).message, c: "#ff8fb8" });
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onProf(await patrol.deck(BASE_DECK));
      sfx("buy");
      setMsg({ t: "기본 덱으로 돌렸어요", c: "#4ff0c8" });
    } catch (e) {
      setMsg({ t: (e as Error).message, c: "#ff8fb8" });
    } finally {
      setBusy(false);
    }
  };
  const swapping = own && !inDeck;

  return (
    <Modal title="무기 덱" sub="덱 6칸에 넣은 무기만 판 안 레벨업 카드에 나와요 · 판에서 무기 Lv5 + 짝 능력치 → 진화" onClose={onClose} w={900} h={520}>
      <div className="mt-[12px] flex min-h-0 flex-1 gap-[16px]">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 덱 */}
          <div className="flex items-center justify-between">
            <b className="text-[14px] text-[#ffd27a]">덱 {DECK_N}칸</b>
            <button type="button" onClick={() => void reset()} className="pts-btn ghost h-[26px] px-[10px] text-[11px]">
              기본 덱으로
            </button>
          </div>
          <div className="mt-[10px] flex gap-[12px] px-[8px] py-[8px]" style={{ boxShadow: swapping ? "inset 0 0 0 2px #ffd27a" : "inset 0 0 0 2px #2a2468", background: swapping ? "#2a2468" : "transparent" }}>
            {deck.map((w, i) => (
              <WeaponTile key={i} w={w} prof={prof} size={64} on={w === sel} onClick={() => void put(i)} />
            ))}
          </div>
          <span className="mt-[8px] h-[16px] text-[12px]" style={{ color: msg?.c ?? "#ffd27a" }}>
            {msg ? msg.t : swapping ? `▲ 바꿀 칸을 눌러요 — ${def.name}이(가) 그 자리에 들어가요` : ""}
          </span>
          {/* 가진 무기 */}
          <b className="mt-[12px] text-[14px] text-[#ffd27a]">무기 {P_WEAPONS.filter((w) => prof.wown[w] !== undefined).length} / {P_WEAPONS.length}</b>
          <div className="mt-[10px] grid grid-cols-5 gap-[14px] px-[4px]">
            {P_WEAPONS.map((w) => (
              <WeaponTile key={w} w={w} prof={prof} size={64} on={w === sel} dim={deck.includes(w)} badge={NEW_WEAPONS.includes(w) && prof.wown[w] !== undefined && !deck.includes(w) ? "NEW" : undefined} onClick={() => (sfx("click"), setSel(w))} />
            ))}
          </div>
          <span className="mt-[10px] text-[11px] text-[#6b63a3]">흐린 칸 = 덱에 들어 있음 · 파란 테두리 기본 무기 · 금색 테두리 새 무기</span>
        </div>
        {/* 고른 무기 */}
        <div className="pts-card flex w-[300px] shrink-0 flex-col px-[14px] py-[12px]" style={{ "--r": wColor(sel) } as CSSProperties}>
          <div className="flex items-center gap-[10px]">
            <ItemIcon k="weapon" id={sel} size={56} />
            <div className="flex flex-col">
              <b className="pts-title text-[20px]">{def.name}</b>
              <span className="text-[11px] text-[#a9a2d6]">{W_ROLE[sel]}</span>
            </div>
          </div>
          <span className="mt-[8px] text-[12px] text-[#e8e4ff]">{def.desc[0]}</span>
          {own ? (
            <>
              <div className="mt-[10px] flex items-center gap-[8px]">
                <Stars n={star} size={20} />
                {prog ? (
                  <span className="text-[11px] text-[#a9a2d6]">
                    다음 별까지 조각 {prog[0]}/{prog[1]}
                  </span>
                ) : (
                  <span className="text-[11px] text-[#ffd23a]">최고 별!</span>
                )}
              </div>
              {prog && (
                <div className="pts-bar mt-[4px] h-[8px]" style={{ "--c": "#ffd23a" } as CSSProperties}>
                  <i style={{ width: `${(prog[0] / prog[1]) * 100}%` }} />
                </div>
              )}
            </>
          ) : (
            <span className="mt-[10px] text-[12px] text-[#ff9c7a]">아직 없어요 — {whereOf(sel)}</span>
          )}
          <div className="mt-[12px] flex flex-col gap-[5px] text-[12px]">
            <span style={{ color: star >= 2 ? "#4ff0c8" : "#6b63a3" }}>★ 피해 +{Math.round(STAR_DMG * 100)}% (별마다) — 지금 +{Math.round(STAR_DMG * 100 * Math.max(0, star - 1))}%</span>
            <span style={{ color: star >= 3 ? "#4ff0c8" : "#6b63a3" }}>★3 {STAR3[sel]}</span>
            <span style={{ color: star >= 5 ? "#4ff0c8" : "#6b63a3" }}>★5 {STAR5}</span>
          </div>
          {(() => {
            const e = evoOf(sel, true);
            if (!e) return null;
            const need = WEAPONS[e].evo![1];
            return (
              <div className="mt-[12px] px-[8px] py-[6px] text-[12px]" style={{ background: "#ffd23a14", boxShadow: "inset 0 0 0 1px #ffd23a55" }}>
                <b className="text-[#ffd23a]">✦ 진화</b>
                <div className="mt-[4px] flex items-center gap-[4px]">
                  <ItemIcon k="weapon" id={sel} size={22} />
                  <span>Lv{def.lv.length}</span>+<ItemIcon k="passive" id={need} size={22} />
                  <span>{PASSIVES[need].name}</span>→<ItemIcon k="weapon" id={e} size={26} />
                </div>
                <b className="mt-[2px] block text-[#ffd27a]">{WEAPONS[e].name}</b>
                <span className="text-[11px] leading-[15px] text-[#a9a2d6]">{WEAPONS[e].desc[0]}</span>
              </div>
            );
          })()}
          <div className="mt-auto">
            {own && !inDeck && (
              <span className="pts-sub block text-center text-[12px] text-[#ffd27a]">위 덱 칸을 눌러 넣어요</span>
            )}
            {inDeck && <span className="block text-center text-[12px] text-[#4ff0c8]">덱에 들어 있어요</span>}
            {!own && (
              <button type="button" disabled className="pts-btn h-[36px] w-full text-[13px]" style={btn("#2a2468", "#a9a2d6")}>
                🔒 잠김
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
