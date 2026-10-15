"use client";

import { useState, type CSSProperties } from "react";
import { CHAR, GRADE_COLOR, ITEM, ITEMS, MAX_LV, STORE, charOn, itemUpCost, power, type CharDef, type ItemDef, type ItemSlot } from "@/lib/marble/data";
import { charUpNeed } from "@/lib/marble/gacha";
import type { ProfileWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { sfx } from "./audio";
import { CharCardArt, ItemIcon } from "./Gacha";
import { Btn, Cur, GradeTag, Icon, Stars, Win, fmt } from "./pixel";
import Token from "./Token";

/*
 * 가방 — 캐릭터 · 주사위 · 동행. 고르면 오른쪽에 설명(지금 단계 · 다음 단계) · 강화 · 장착.
 * 상점 — GP 로 별사탕 · 부품 · 패키지.
 */

type Tab = "char" | ItemSlot;
const GRADE_ORDER = { UR: 0, SSR: 1, SR: 2, R: 3 } as const;

export default function Bag({ prof, onProf, onBack }: { prof: ProfileWire; onProf(p: ProfileWire): void; onBack(): void }) {
  const [tab, setTab] = useState<Tab>("char");
  const [sel, setSel] = useState<string | null>(prof.load.char);
  const [err, setErr] = useState("");
  const run = async (f: () => Promise<ProfileWire>, snd = "click") => {
    setErr("");
    try {
      onProf(await f());
      sfx(snd);
    } catch (e) {
      sfx("deny");
      setErr((e as Error).message);
    }
  };
  const chars = [...charOn()].sort((a, b) => Number(!prof.chars[a.id]) - Number(!prof.chars[b.id]) || GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]);
  const items = ITEMS.filter((i) => i.slot === tab).sort((a, b) => Number(!prof.items[a.id]) - Number(!prof.items[b.id]) || GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]);
  const c = tab === "char" && sel ? CHAR[sel] : null;
  const it = tab !== "char" && sel ? ITEM[sel] : null;
  return (
    <div className="mb-dots absolute inset-0">
      <div className="absolute top-[10px] left-[12px] flex items-center gap-2">
        <Btn className="h-[34px] px-3 text-[13px]" onClick={onBack}>
          <Icon n="back" size={12} /> 돌아가기
        </Btn>
        <div className="mb-wood px-3 py-1.5">
          <b className="mb-title mb-out text-[17px] text-white">가방</b>
        </div>
        {(["char", "dice", "buddy"] as Tab[]).map((k) => (
          <Btn
            key={k}
            tone={tab === k ? "gold" : "paper"}
            className="h-[34px] px-3 text-[13px] font-bold"
            onClick={() => {
              setTab(k);
              setSel(k === "char" ? prof.load.char : prof.load[k]);
            }}
          >
            {k === "char" ? "캐릭터" : k === "dice" ? "주사위" : "동행"}
          </Btn>
        ))}
      </div>
      <div className="mb-box absolute top-[12px] right-[12px] flex items-center gap-3 px-3 py-1.5 text-[13px]">
        <Cur k="star" n={prof.stars} />
        <Cur k="parts" n={prof.parts} />
      </div>

      {/* 목록 */}
      <div className="mb-box mb-scroll absolute top-[60px] left-[12px] h-[500px] w-[600px] overflow-y-auto p-3" style={{ "--bg": "#fffaf0" } as CSSProperties}>
        <div className="grid grid-cols-5 gap-3">
          {tab === "char"
            ? chars.map((d) => <CharTile key={d.id} d={d} own={prof.chars[d.id]} sel={sel === d.id} on={prof.load.char === d.id} onClick={() => setSel(d.id)} />)
            : items.map((d) => <ItemTile key={d.id} d={d} own={prof.items[d.id]} sel={sel === d.id} on={prof.load[d.slot] === d.id} onClick={() => setSel(d.id)} />)}
        </div>
      </div>

      {/* 자세히 */}
      <div className="absolute top-[60px] right-[12px] w-[384px]">
        {c && <CharDetail d={c} own={prof.chars[c.id]} on={prof.load.char === c.id} onEquip={() => void run(() => marble.equip({ char: c.id }))} onUp={() => void run(() => marble.charUp(c.id), "upgrade")} />}
        {it && (
          <ItemDetail
            d={it}
            own={prof.items[it.id]}
            parts={prof.parts}
            on={prof.load[it.slot] === it.id}
            onEquip={(v) => void run(() => marble.equip({ [it.slot]: v ? it.id : null }))}
            onUp={() => void run(() => marble.itemUp(it.id), "upgrade")}
          />
        )}
        {!c && !it && (
          <Win title="고르기">
            <p className="p-4 text-[13px]">왼쪽에서 하나를 골라 주세요</p>
          </Win>
        )}
        {err && <p className="mt-2 text-center text-[12px] text-[#d43a3a]">{err}</p>}
      </div>
    </div>
  );
}

function CharTile({ d, own, sel, on, onClick }: { d: CharDef; own?: { lv: number; dup: number }; sel: boolean; on: boolean; onClick(): void }) {
  const need = own ? charUpNeed(own.lv) : 0;
  return (
    <button type="button" onClick={onClick} className={`mb-box relative flex flex-col overflow-hidden ${sel ? "mb-glow" : ""}`} style={{ "--g": GRADE_COLOR[d.grade], height: 150 } as CSSProperties}>
      <CharCardArt id={d.id} h={104} dim={!own} />
      <div className="flex flex-1 flex-col items-center justify-center leading-[14px]">
        <b className="w-full truncate px-1 text-[12px]">{d.title.includes(d.name) ? d.title : d.name}</b>
        {own ? <Stars lv={own.lv} size={9} /> : <span className="text-[10px] text-[var(--mute)]">없음</span>}
      </div>
      <GradeTag g={d.grade} className="absolute top-[4px] left-[4px]" />
      {on && <span className="mb-chip absolute top-[4px] right-[4px] text-[10px]" style={{ "--c": "#4fd1b5" } as CSSProperties}>장착</span>}
      {own && own.lv < MAX_LV && own.dup >= need && <span className="mb-blink absolute top-[24px] right-[4px]"><Icon n="up" size={14} /></span>}
    </button>
  );
}

function ItemTile({ d, own, sel, on, onClick }: { d: ItemDef; own?: { lv: number }; sel: boolean; on: boolean; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className={`mb-box relative flex h-[120px] flex-col items-center justify-center gap-1 ${sel ? "mb-glow" : ""}`} style={{ "--g": GRADE_COLOR[d.grade], opacity: own ? 1 : 0.5 } as CSSProperties}>
      <ItemIcon id={d.id} size={54} />
      <b className="w-full truncate px-1 text-[11px]">{d.name}</b>
      {own ? <Stars lv={own.lv} size={8} /> : <span className="text-[10px] text-[var(--mute)]">없음</span>}
      <GradeTag g={d.grade} className="absolute top-[4px] left-[4px]" />
      {on && <span className="mb-chip absolute top-[4px] right-[4px] text-[10px]" style={{ "--c": "#4fd1b5" } as CSSProperties}>장착</span>}
    </button>
  );
}

function CharDetail({ d, own, on, onEquip, onUp }: { d: CharDef; own?: { lv: number; dup: number }; on: boolean; onEquip(): void; onUp(): void }) {
  const lv = own?.lv ?? 0;
  const p = power(d.grade, lv);
  const next = Math.min(MAX_LV, lv + 1);
  const pn = power(d.grade, next);
  const need = charUpNeed(lv);
  return (
    <Win title={d.title}>
      <div className="flex flex-col gap-2 p-3 text-[12px]">
        <div className="flex gap-3">
          <div className="mb-grass flex h-[120px] w-[110px] shrink-0 items-end justify-center pb-2" style={{ boxShadow: "0 0 0 2px #232a4d" }}>
            <Token sprite={d.sprite} h={96} anim={own ? "win" : "idle"} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <GradeTag g={d.grade} />
              <b className="text-[15px]">{d.name}</b>
            </div>
            <Stars lv={lv} size={12} />
            <span className="text-[11px] text-[var(--ink2)]">{d.line}</span>
            <span className="text-[11px] text-[var(--mute)]">파워 {p}{lv < MAX_LV && ` → ${pn}`}</span>
          </div>
        </div>
        <div className="mb-inset px-2 py-1.5 leading-[16px]">
          <b>패시브 · {d.passive.name}</b>
          <div>{d.passive.desc(p)}</div>
          {lv < MAX_LV && <div className="text-[11px] text-[#2f8a3a]">다음 강화: {d.passive.desc(pn)}</div>}
        </div>
        <div className="mb-inset px-2 py-1.5 leading-[16px]">
          <b>
            스킬 · {d.active.name} <span className="text-[11px] font-normal text-[var(--mute)]">({d.active.cd(p)}턴마다)</span>
          </b>
          <div>{d.active.desc(p)}</div>
          {lv < MAX_LV && (d.active.desc(pn) !== d.active.desc(p) || d.active.cd(pn) !== d.active.cd(p)) && (
            <div className="text-[11px] text-[#2f8a3a]">
              다음 강화: {d.active.desc(pn)} ({d.active.cd(pn)}턴)
            </div>
          )}
        </div>
        {own ? (
          <div className="flex gap-2">
            <Btn tone={on ? "paper" : "mint"} className="h-[38px] flex-1 text-[14px] font-bold" disabled={on} onClick={onEquip}>
              {on ? "장착 중" : "장착"}
            </Btn>
            <Btn tone="gold" className="h-[38px] flex-1 text-[13px] font-bold" disabled={lv >= MAX_LV || own.dup < need} onClick={onUp} silent>
              {lv >= MAX_LV ? "최고 강화" : `강화 (카드 ${own.dup}/${need})`}
            </Btn>
          </div>
        ) : (
          <p className="text-center text-[12px] text-[var(--mute)]">뽑기에서 얻을 수 있어요</p>
        )}
      </div>
    </Win>
  );
}

function ItemDetail({ d, own, parts, on, onEquip, onUp }: { d: ItemDef; own?: { lv: number }; parts: number; on: boolean; onEquip(v: boolean): void; onUp(): void }) {
  const lv = own?.lv ?? 0;
  const p = power(d.grade, lv);
  const pn = power(d.grade, Math.min(MAX_LV, lv + 1));
  const cost = itemUpCost(d.grade, lv);
  return (
    <Win title={d.name}>
      <div className="flex flex-col gap-2 p-3 text-[12px]">
        <div className="flex items-center gap-3">
          <ItemIcon id={d.id} size={80} />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <GradeTag g={d.grade} />
              <span>{d.slot === "dice" ? "주사위" : "동행"}</span>
            </div>
            <Stars lv={lv} size={12} />
          </div>
        </div>
        <div className="mb-inset px-2 py-1.5 leading-[16px]">
          <div>{d.desc(p)}</div>
          {lv < MAX_LV && <div className="text-[11px] text-[#2f8a3a]">다음 강화: {d.desc(pn)}</div>}
        </div>
        {own ? (
          <div className="flex gap-2">
            <Btn tone={on ? "paper" : "mint"} className="h-[38px] flex-1 text-[14px] font-bold" onClick={() => onEquip(!on)}>
              {on ? "해제" : "장착"}
            </Btn>
            <Btn tone="gold" className="h-[38px] flex-1 text-[13px] font-bold" disabled={lv >= MAX_LV || parts < cost} onClick={onUp} silent>
              {lv >= MAX_LV ? "최고 강화" : <>강화 <Cur k="parts" n={cost} size={12} /></>}
            </Btn>
          </div>
        ) : (
          <p className="text-center text-[12px] text-[var(--mute)]">뽑기에서 얻을 수 있어요</p>
        )}
      </div>
    </Win>
  );
}

export function Shop({ prof, onProf, onBack }: { prof: ProfileWire; onProf(p: ProfileWire): void; onBack(): void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  return (
    <div className="mb-dots absolute inset-0">
      <div className="absolute top-[10px] left-[12px] flex items-center gap-2">
        <Btn className="h-[34px] px-3 text-[13px]" onClick={onBack}>
          <Icon n="back" size={12} /> 돌아가기
        </Btn>
        <div className="mb-wood px-3 py-1.5">
          <b className="mb-title mb-out text-[17px] text-white">상점</b>
        </div>
      </div>
      <div className="mb-box absolute top-[12px] right-[12px] flex items-center gap-3 px-3 py-1.5 text-[13px]">
        <Cur k="gp" n={prof.gp} />
        <Cur k="star" n={prof.stars} />
        <Cur k="parts" n={prof.parts} />
      </div>
      <div className="absolute top-[70px] left-1/2 grid w-[900px] -translate-x-1/2 grid-cols-4 gap-4">
        {STORE.map((s) => {
          const bought = s.once ? prof.packs[s.id] ?? 0 : prof.shop[s.id] ?? 0;
          const lim = s.once ? 1 : s.perWeek ?? 99;
          const sold = bought >= lim;
          return (
            <div key={s.id} className="mb-box flex h-[300px] flex-col items-center gap-2 p-3 text-center" style={{ "--bg": s.id.startsWith("p_") ? "#fff1d6" : "#fffaf0" } as CSSProperties}>
              <div className="flex h-[90px] items-center justify-center gap-1">
                {s.give.stars && <Icon n="candy" size={s.id.startsWith("p_") ? 40 : 54} />}
                {s.give.parts && <Icon n="gear" size={s.id.startsWith("p_") ? 34 : 54} />}
                {(s.give.charTickets || s.give.itemTickets) && <Icon n="ticket" size={44} />}
              </div>
              <b className="mb-title text-[17px]">{s.name}</b>
              <span className="text-[12px] text-[var(--ink2)]">{s.desc}</span>
              <span className="text-[11px] text-[var(--mute)]">{s.once ? "한 번만" : `이번 주 ${bought}/${lim}`}</span>
              <Btn
                tone={sold ? "paper" : "gold"}
                className="mt-auto h-[42px] w-full text-[15px] font-bold"
                disabled={sold || !!busy || prof.gp < s.gp}
                onClick={async () => {
                  setBusy(s.id);
                  setErr("");
                  try {
                    onProf(await marble.buy(s.id));
                    sfx("coin");
                  } catch (e) {
                    setErr((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {sold ? "다 샀어요" : <Cur k="gp" n={fmt(s.gp)} size={14} />}
              </Btn>
            </div>
          );
        })}
      </div>
      {err && <p className="absolute top-[390px] w-full text-center text-[13px] text-[#d43a3a]">{err}</p>}
      <p className="absolute bottom-[18px] w-full text-center text-[12px] text-[var(--mute)]">GP 는 출석 · 일일 미션 · 업적으로 모으는 사이트 공용 포인트예요 (위 머리말의 일일 미션 · 업적)</p>
    </div>
  );
}
