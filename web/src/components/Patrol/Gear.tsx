"use client";

/*
 * 픽셀 순찰대 — 장비 창: 왼쪽 반디 + 6칸 · 가운데 가방 · 오른쪽 고른 장비 (장착 · 강화 · 합성)
 */
import { useMemo, useState } from "react";
import { ATK_PCT, enhanceCost, fxText, spentOn, G_MAX, GEAR, GRADE_COLOR, GRADE_NAME, MAX_LV, MERGE_N, SLOTS, SLOT_NAME, isAtkSlot, mainStat, power, powerScore, type GearItem, type Slot } from "@/lib/patrol/gear";
import { RELICS } from "@/lib/survivor/relics";
import { WEAPONS } from "@/lib/survivor/data";
import { patrol, type PatrolProfile, type Refund } from "@/realtime/patrol";
import Token from "../Marble/Token";
import { sfx } from "../Survivor/audio";
import { Bp, Coin, GearIcon, Modal, btn, itemTitle } from "./ui";

export const equippedOf = (p: PatrolProfile) => SLOTS.flatMap((s) => p.items.filter((x) => x.uid === p.equip[s]));
const ORDER = (a: GearItem, b: GearItem) => b.g - a.g || SLOTS.indexOf(GEAR[a.id].slot) - SLOTS.indexOf(GEAR[b.id].slot) || b.lv - a.lv;
/** 합성 재료: 같은 칸 · 같은 등급, 끼지 않은 것 · 레벨 낮은 것부터 */
export function fodderOf(p: PatrolProfile, main: GearItem): GearItem[] {
  const s = GEAR[main.id].slot;
  return p.items
    .filter((x) => x.uid !== main.uid && GEAR[x.id].slot === s && x.g === main.g && p.equip[s] !== x.uid)
    .sort((a, b) => a.lv - b.lv)
    .slice(0, MERGE_N - 1);
}
/** 칸마다 더 센 장비가 가방에 있으면 그것 (주 능력치 → 등급 순) */
export function betterGear(p: PatrolProfile): GearItem[] {
  const score = (x: GearItem) => mainStat(x.id, x.g, x.lv).v * 10 + x.g;
  const out: GearItem[] = [];
  for (const s of SLOTS) {
    const cur = p.items.find((x) => x.uid === p.equip[s]);
    const best = p.items.filter((x) => GEAR[x.id].slot === s).sort((a, b) => score(b) - score(a))[0];
    if (best && (!cur || score(best) > score(cur))) out.push(best);
  }
  return out;
}
/** 합성할 수 있는 묶음 수 (버튼 뱃지) */
export function mergeCount(p: PatrolProfile) {
  let n = 0;
  for (const s of SLOTS)
    for (let g = 0; g < G_MAX; g++) {
      const c = p.items.filter((x) => GEAR[x.id].slot === s && x.g === g).length;
      n += Math.floor(c / MERGE_N);
    }
  return n;
}

export default function GearPanel({ prof, onProf, onClose, sprite = "patrol/hero/bandi" }: { prof: PatrolProfile; onProf(p: PatrolProfile): void; onClose(): void; sprite?: string }) {
  const [sel, setSel] = useState<string | null>(prof.equip.weapon ?? null);
  const [tab, setTab] = useState<Slot | "all">("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; c: string } | null>(null);
  const eq = equippedOf(prof);
  const gp = power(eq);
  const items = useMemo(() => prof.items.filter((x) => tab === "all" || GEAR[x.id].slot === tab).sort(ORDER), [prof.items, tab]);
  const it = prof.items.find((x) => x.uid === sel) ?? null;
  const merges = mergeCount(prof);
  const better = betterGear(prof);

  /** ok: 성공 문구 (함수면 결과를 받은 뒤에 만듦 — 환급 금액 등) */
  const act = async (fn: () => Promise<PatrolProfile>, ok: string | (() => string), s: Parameters<typeof sfx>[0]) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      onProf(await fn());
      sfx(s);
      setMsg({ t: typeof ok === "function" ? ok() : ok, c: "#4ff0c8" });
    } catch (e) {
      sfx("warn");
      setMsg({ t: (e as Error).message, c: "#ff8fb8" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="장비" sub="무기 · 목걸이 · 장갑 = 공격력 / 갑옷 · 벨트 · 신발 = 체력 · 희귀부터 특수 효과" onClose={onClose} w={984} h={540}>
      <div className="mt-[10px] flex min-h-0 flex-1 gap-[14px]">
        {/* 반디 + 6칸 */}
        <div className="flex w-[262px] shrink-0 flex-col">
          <div className="relative flex h-[300px] items-center justify-between px-[6px]" style={{ background: "radial-gradient(ellipse at 50% 70%, #3a2f8a 0%, #16123d 70%)", boxShadow: "inset 0 0 0 2px #2a2468" }}>
            <div className="flex flex-col gap-[14px]">
              {SLOTS.slice(0, 3).map((s) => (
                <Socket key={s} s={s} prof={prof} sel={sel} onSel={setSel} />
              ))}
            </div>
            <div className="absolute bottom-[26px] left-1/2 -translate-x-1/2">
              <Token sprite={sprite} anim="idle" h={150} />
            </div>
            <div className="flex flex-col gap-[14px]">
              {SLOTS.slice(3).map((s) => (
                <Socket key={s} s={s} prof={prof} sel={sel} onSel={setSel} />
              ))}
            </div>
          </div>
          <div className="mt-[10px] flex flex-col gap-[4px] text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-[#a9a2d6]">전투력</span>
              <b className="pts-title text-[22px] text-[#ffd23a]">{powerScore(gp).toLocaleString()}</b>
            </div>
            <div className="flex justify-between">
              <span>
                공격 <b className="text-[#ff9c7a]">{gp.atk}</b> <span className="text-[#a9a2d6]">(피해 +{gp.atk * ATK_PCT}%)</span>
              </span>
              <span>
                체력 <b className="text-[#4ff0c8]">+{gp.hp}</b>
              </span>
            </div>
            {gp.weapon && (
              <span className="text-[#e8e4ff]">
                시작 무기 <b>{WEAPONS[gp.weapon].name}</b> Lv{gp.wlv}
              </span>
            )}
            <div className="flex flex-wrap gap-[4px]">
              {gp.relics.length ? (
                gp.relics.map((r, i) => (
                  <span key={i} className="pts-tag text-[10px]" style={{ background: RELICS[r].color }} title={RELICS[r].desc}>
                    {RELICS[r].name}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-[#6b63a3]">특수 효과 없음 — 희귀 등급부터 열려요</span>
              )}
            </div>
          </div>
        </div>

        {/* 가방 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-[4px]">
            {(["all", ...SLOTS] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  sfx("click");
                  setTab(s);
                }}
                className={`h-[24px] cursor-pointer px-[8px] text-[11px] font-bold ${tab === s ? "bg-white/20 text-white" : "bg-white/5 text-[#a9a2d6] hover:bg-white/10"}`}
              >
                {s === "all" ? `전체 ${prof.items.length}` : SLOT_NAME[s]}
              </button>
            ))}
          </div>
          <div className="mt-[8px] grid min-h-0 flex-1 grid-cols-6 content-start gap-[10px] overflow-y-auto p-[6px]" style={{ background: "#100c2c", boxShadow: "inset 0 0 0 2px #2a2468" }}>
            {items.map((x) => (
              <GearIcon
                key={x.uid}
                id={x.id}
                g={x.g}
                lv={x.lv}
                size={56}
                on={sel === x.uid}
                onClick={() => {
                  sfx("pick");
                  setSel(x.uid);
                  setMsg(null);
                }}
                badge={prof.equip[GEAR[x.id].slot] === x.uid ? <span className="pts-tag absolute -top-[6px] -left-[6px] px-[3px] text-[9px] leading-[13px]">E</span> : undefined}
              />
            ))}
            {!items.length && <span className="col-span-6 p-[10px] text-[12px] text-[#6b63a3]">비어 있어요 — 상자에서 장비를 얻어요</span>}
          </div>
          <div className="mt-[8px] flex items-center gap-[8px]">
            <button
              type="button"
              disabled={busy || !better.length}
              onClick={() =>
                void act(
                  async () => {
                    let last = prof;
                    for (const x of better) last = await patrol.equip(x.uid);
                    return last;
                  },
                  "가장 센 장비로 바꿨어요!",
                  "pick"
                )
              }
              className="pts-btn h-[32px] shrink-0 px-[12px] text-[13px] whitespace-nowrap"
              style={btn("#4ff0c8")}
            >
              추천 장착{better.length ? ` (${better.length})` : ""}
            </button>
            <button type="button" disabled={busy || !merges} onClick={() => {
                let back: Refund = { coin: 0, bp: 0 };
                void act(
                  async () => {
                    const r = await patrol.mergeAll();
                    back = r.back;
                    return r.profile;
                  },
                  () => `한꺼번에 합성했어요!${refundText(back)}`,
                  "fuse"
                );
              }} className="pts-btn h-[32px] shrink-0 px-[14px] text-[13px] whitespace-nowrap" style={btn("#c58bff", "#fff")}>
              한꺼번에 합성{merges ? ` (${merges})` : ""}
            </button>
            <span className="text-[10px] leading-[13px] text-[#a9a2d6]">같은 칸 · 같은 등급 3개 → 한 등급 위 (레벨 유지 · 재료 강화비는 전액 환급)</span>
          </div>
        </div>

        {/* 고른 장비 */}
        <div className="flex w-[270px] shrink-0 flex-col px-[12px] py-[10px]" style={{ background: "#100c2c", boxShadow: "inset 0 0 0 2px #2a2468" }}>
          {it ? <Detail it={it} prof={prof} busy={busy} act={act} /> : <p className="text-[12px] text-[#6b63a3]">장비를 눌러 보세요</p>}
          {msg && <p className="mt-auto pt-[6px] text-[12px]" style={{ color: msg.c }}>{msg.t}</p>}
        </div>
      </div>
    </Modal>
  );
}

function Socket({ s, prof, sel, onSel }: { s: Slot; prof: PatrolProfile; sel: string | null; onSel(u: string | null): void }) {
  const it = prof.items.find((x) => x.uid === prof.equip[s]);
  return (
    <div className="flex flex-col items-center gap-[2px]">
      {it ? (
        <GearIcon
          id={it.id}
          g={it.g}
          lv={it.lv}
          size={54}
          on={sel === it.uid}
          onClick={() => {
            sfx("pick");
            onSel(it.uid);
          }}
        />
      ) : (
        <span className="flex h-[54px] w-[54px] items-center justify-center text-[20px] text-[#3a3080]" style={{ background: "#100c2c", boxShadow: "0 0 0 2px #2a2468, 0 0 0 4px #07051a" }}>
          ＋
        </span>
      )}
      <span className="text-[10px] text-[#a9a2d6]">{SLOT_NAME[s]}</span>
    </div>
  );
}

/** " · 강화비 환급 코인 N · 설계도 M" (없으면 빈칸) */
const refundText = (b: Refund) => (b.coin || b.bp ? ` · 강화비 환급 코인 ${b.coin.toLocaleString()} · 설계도 ${b.bp}` : "");

function Detail({ it, prof, busy, act }: { it: GearItem; prof: PatrolProfile; busy: boolean; act(fn: () => Promise<PatrolProfile>, ok: string | (() => string), s: Parameters<typeof sfx>[0]): Promise<void> }) {
  const [sure, setSure] = useState<string | null>(null);
  const def = GEAR[it.id];
  const s = def.slot;
  const on = prof.equip[s] === it.uid;
  const m = mainStat(it.id, it.g, it.lv);
  const max = MAX_LV[it.g];
  const next = it.lv < max ? mainStat(it.id, it.g, it.lv + 1).v : null;
  const cost = enhanceCost(it.lv);
  const can = it.lv < max && prof.coins >= cost.coin && prof.bp >= cost.bp;
  const fod = fodderOf(prof, it);
  const canMerge = it.g < G_MAX && fod.length >= MERGE_N - 1;
  const use = fod.slice(0, MERGE_N - 1);
  const back = use.reduce((a, x) => ({ coin: a.coin + spentOn(x.lv).coin, bp: a.bp + spentOn(x.lv).bp }), { coin: 0, bp: 0 });
  const mine = spentOn(it.lv);
  const c = GRADE_COLOR[it.g];
  return (
    <div className="flex flex-col gap-[7px] text-[12px]">
      <div className="flex items-center gap-[10px]">
        <GearIcon id={it.id} g={it.g} size={68} />
        <div className="min-w-0">
          <span className="pts-tag text-[10px]" style={{ background: c }}>
            {GRADE_NAME[it.g]}
          </span>{" "}
          <span className="text-[10px] text-[#a9a2d6]">{SLOT_NAME[s]}</span>
          <b className="mt-[2px] block text-[15px]">{def.name}</b>
          <span className="text-[11px] text-[#e8e4ff]">
            Lv {it.lv} / {max}
          </span>
        </div>
      </div>
      <p className="text-[11px] leading-[15px] text-[#a9a2d6]">{def.desc}</p>
      <div className="flex items-center justify-between" style={{ color: isAtkSlot(s) ? "#ff9c7a" : "#4ff0c8" }}>
        <b>
          {m.k === "atk" ? "공격" : "체력"} {m.v}
        </b>
        {next !== null && <span className="text-[11px] text-[#a9a2d6]">다음 Lv → {next}</span>}
      </div>
      <div className="flex flex-col gap-[3px]">
        {def.fx.map((f, k) => {
          const open = it.g >= 2 + k;
          return (
            <span key={k} className="text-[11px] leading-[14px]" style={{ color: open ? "#fff" : "#4a4380" }}>
              <b style={{ color: open ? GRADE_COLOR[2 + k] : undefined }}>{GRADE_NAME[2 + k]}</b> {fxText(f, it.id)}
            </span>
          );
        })}
      </div>
      <div className="mt-[4px] flex gap-[6px]">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(() => (on ? patrol.unequip(s) : patrol.equip(it.uid)), on ? "벗었어요" : `${itemTitle(it)} 장착!`, "pick")}
          className="pts-btn h-[30px] flex-1 text-[12px]"
          style={on ? btn("#221b58", "#a9a2d6") : btn("#4ff0c8")}
        >
          {on ? "장착 중 · 벗기" : "장착"}
        </button>
      </div>
      <div className="flex gap-[6px]">
        <button type="button" disabled={busy || !can} onClick={() => void act(async () => (await patrol.enhance(it.uid, 1)).profile, "강화 성공!", "levelup")} className="pts-btn flex h-[40px] flex-1 flex-col items-center justify-center text-[12px] leading-[14px]" style={btn("#ffd23a")}>
          <span>{it.lv >= max ? "최고 레벨" : "강화 +1"}</span>
          {it.lv < max && (
            <span className="flex gap-[6px] text-[10px]">
              <Coin v={cost.coin} size={10} ink="#07051a" /> <Bp v={cost.bp} size={10} ink="#07051a" />
            </span>
          )}
        </button>
        <button type="button" disabled={busy || !can} onClick={() => void act(async () => (await patrol.enhance(it.uid, 60)).profile, "되는 데까지 강화!", "levelup")} className="pts-btn h-[40px] w-[70px] text-[12px]" style={btn("#ffb03a")}>
          최대로
        </button>
      </div>
      {it.lv > 1 && (
        // 강화 초기화: 두 번 눌러야 (첫 번째는 환급 금액 보여 줌)
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (sure !== it.uid) return setSure(it.uid);
            setSure(null);
            void act(async () => (await patrol.reset(it.uid)).profile, `강화 초기화 · 환급 코인 ${mine.coin.toLocaleString()} · 설계도 ${mine.bp}`, "coin");
          }}
          className="pts-btn ghost h-[26px] text-[11px] whitespace-nowrap"
          style={sure === it.uid ? btn("#ff8fb8", "#07051a") : undefined}
        >
          {sure === it.uid ? `한 번 더 → Lv1 · 코인 ${mine.coin.toLocaleString()} · 설계도 ${mine.bp} 환급` : "강화 초기화 (전액 환급)"}
        </button>
      )}
      <div className="flex flex-col gap-[4px]">
        <button type="button" disabled={busy || !canMerge} onClick={() => void act(async () => (await patrol.merge(it.uid, use.map((x) => x.uid))).profile, `합성! ${GRADE_NAME[it.g + 1]} ${def.name}${refundText(back)}`, "fuse")} className="pts-btn h-[32px] text-[12px]" style={btn("#c58bff", "#fff")}>
          {it.g >= G_MAX ? "최고 등급" : `합성 → ${GRADE_NAME[it.g + 1]}`}
        </button>
        {it.g < G_MAX && (
          <div className="flex items-center gap-[6px] text-[10px] text-[#a9a2d6]">
            재료 ({SLOT_NAME[s]} · {GRADE_NAME[it.g]}) {fod.length}/{MERGE_N - 1}
            {fod.map((x) => (
              <GearIcon key={x.uid} id={x.id} g={x.g} size={26} />
            ))}
            {back.coin > 0 && <span className="text-[#ffd23a]">재료 강화비 환급 {back.coin.toLocaleString()} 코인 · 설계도 {back.bp}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
