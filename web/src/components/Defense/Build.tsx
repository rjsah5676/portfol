"use client";

import type { CSSProperties, ReactNode } from "react";
import { TUNE } from "@/lib/defense/balance";
import { BOSSES } from "@/lib/defense/enemies";
import { PATCHES } from "@/lib/defense/meta";
import { CHEAT, CHEAT_TIER_COLOR, CHEAT_TIER_NAME } from "@/lib/defense/cheats";
import { RELIC, RES, relicDesc, resDesc } from "@/lib/defense/progress";
import { CELLS, usable, type Board } from "@/lib/defense/sim";
import { CURSES, EXP_ASC, EXP_RELIC, SQUADS, TOWN_NAME, ascOn } from "@/lib/defense/town";
import { FACTION_COLOR, FACTION_NAME, GRADE_COLOR, GRADE_NAME, UNIT, type Faction } from "@/lib/defense/units";
import { FactionIcon, Icon, Modal } from "./ui";
import { RelicIcon } from "./Hub";
import { ExpRelicIcon, Heart } from "./Expedition";

/*
 * 빌드 창 — 위쪽 줄에 늘 둘 필요 없는 정보 (내 유닛 구성 · 시작 치트 · 치트 코드 · 장착 유물 · 연구 · 원정 유물 · 저주 · 단계 비틀기)
 * 위쪽 줄 「빌드」 버튼 · 단축키 B
 */

/** 위쪽 줄 버튼에 보일 수 (시작 치트 · 치트 코드 · 장착 유물 · 원정 유물) */
export const buildCount = (b: Board) => (b.patch ? 1 : 0) + b.cheats.length + b.mods.relics.length + (b.exp?.relics.length ?? 0);

function Row({ icon, name, desc, color, tag }: { icon: ReactNode; name: ReactNode; desc: ReactNode; color?: string; tag?: ReactNode }) {
  return (
    <div className="px-inset flex items-start gap-2 p-2 text-[12px] leading-snug">
      {icon}
      <div className="min-w-0">
        <b className="text-[13px]" style={{ color: color ?? "#fff" }}>
          {name}
        </b>
        {tag && <span className="ml-1.5 text-[11px] text-[var(--dim)]">{tag}</span>}
        <p className="text-[var(--mute)]">{desc}</p>
      </div>
    </div>
  );
}

function Section({ title, children, empty }: { title: string; children: ReactNode[]; empty: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-bold text-[var(--dim)]">{title}</p>
      {children.length ? <div className="grid grid-cols-2 gap-2">{children}</div> : <p className="text-[12px] text-[var(--dim)]">{empty}</p>}
    </div>
  );
}

const box = (c: string, child: ReactNode) => (
  <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#0a0816]" style={{ boxShadow: `inset 0 0 0 2px ${c}` } as CSSProperties}>
    {child}
  </span>
);

/** 내 유닛 구성 — 세력 비율(필드 · 보관함 따로, 순혈은 필드만 셈) · 등급별 수 */
function Roster({ b }: { b: Board }) {
  const FS: Faction[] = ["knight", "mech", "arcane", "hidden"];
  const field: Record<string, number> = {},
    bench: Record<string, number> = {},
    grade: number[] = [0, 0, 0, 0, 0, 0, 0];
  let nf = 0,
    nb = 0;
  b.cells.forEach((c, i) => {
    if (!c.def || !usable(b, i)) return;
    const d = UNIT[c.def];
    const k = c.units.length;
    if (i < CELLS) {
      field[d.faction] = (field[d.faction] ?? 0) + k;
      nf += k;
    } else {
      bench[d.faction] = (bench[d.faction] ?? 0) + k;
      nb += k;
    }
    grade[d.grade] += k;
  });
  const pct = (n: number) => (nf ? Math.round((n / nf) * 100) : 0);
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-bold text-[var(--dim)]">
        내 유닛 구성 <span className="font-normal">· 필드 {nf}기{nb ? ` · 보관함 ${nb}기` : ""} (비율은 필드 기준 — 순혈도 필드만 셈)</span>
      </p>
      {/* 필드 비율 막대 */}
      <div className="px-inset flex h-4 w-full overflow-hidden">
        {FS.map((f) => (field[f] ? <span key={f} style={{ width: `${(field[f] / nf) * 100}%`, background: FACTION_COLOR[f] }} title={`${FACTION_NAME[f]} ${pct(field[f])}%`} /> : null))}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-2">
        {FS.map((f) => (
          <div key={f} className="px-inset flex items-center gap-1.5 px-2 py-1.5 text-[12px]" style={{ opacity: field[f] || bench[f] ? 1 : 0.45 }}>
            <FactionIcon f={f} size={12} />
            <span className="min-w-0">
              <b style={{ color: FACTION_COLOR[f] }}>{FACTION_NAME[f]}</b>{" "}
              <b className="text-white">{pct(field[f] ?? 0)}%</b>
              <span className="block text-[var(--mute)]">
                필드 {field[f] ?? 0}
                {bench[f] ? ` · 보관함 ${bench[f]}` : ""}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-[var(--mute)]">
        {grade.map((n, g) =>
          n ? (
            <span key={g}>
              <b style={{ color: GRADE_COLOR[g] }}>{GRADE_NAME[g]}</b> {n}
            </span>
          ) : null
        )}
      </p>
    </div>
  );
}

export function BuildModal({ b, onClose }: { b: Board; onClose(): void }) {
  const patch = PATCHES.find((p) => p.id === b.patch);
  const x = b.exp;
  const g = b.mods.glitch;
  return (
    <Modal title="빌드" onClose={onClose} wide accent="#ffd23f">
      <div className="flex max-h-[400px] flex-col gap-4 overflow-y-auto pr-1">
        {/* 이번 판 */}
        <div className="px-inset flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[13px]">
          {b.stage === "town" ? (
            <b className="text-[#ffd36b]">
              {TOWN_NAME} {b.mods.town}단계 <span className="font-normal text-[var(--mute)]">· 적 세기 = 오염 {g.lv}단계</span>
            </b>
          ) : (
            <b className="text-[var(--pink)]">
              오염 {g.lv}단계 <span className="font-normal text-[var(--mute)]">· 적 체력 ×{g.hp} · 속도 ×{g.spd}</span>
            </b>
          )}
          {b.mods.grit > 0 && <b className="text-[var(--gold)]">끈기 {b.mods.grit}판 · 모든 피해 +{Math.round((b.mods.gritDmg - 1) * 100)}%</b>}
          {x && (
            <span className="flex items-center gap-1.5">
              <Heart /> 원정 체력 <b className="text-white">{x.hp}</b>/{x.max}
              {x.act > 1 && <b className="ml-1 text-[#ff9ec7]">2막</b>}
              {x.squad && <span className="text-[var(--mute)]">· {SQUADS.find((q) => q.id === x.squad)?.name}</span>}
              <span className="text-[var(--mute)]">· 보스 {BOSSES[x.boss].name}</span>
            </span>
          )}
        </div>

        <Roster b={b} />

        <Section title="시작 치트 · 치트 코드" empty="아직 없어요">
          {[
            ...(patch
              ? [
                  <Row
                    key="patch"
                    icon={box("#ffd23f", <Icon n="gear" size={16} />)}
                    name={patch.name}
                    tag="시작 치트"
                    color="#ffd23f"
                    desc={
                      <>
                        {patch.desc}
                        {patch.id === "pure" && (
                          <b className="block text-[var(--text)]">
                            {b.mono && b.pure > 0 ? (
                              <>
                                지금 <FactionIcon f={b.mono} size={11} /> {FACTION_NAME[b.mono]} 피해 +{Math.round((TUNE.pureDmg - 1) * b.pure * 100)}%
                              </>
                            ) : (
                              `지금 꺼짐 — 가장 많은 세력 ${Math.round(b.pureR * 100)}% (${Math.round(TUNE.pureFrom * 100)}% 부터)`
                            )}
                          </b>
                        )}
                      </>
                    }
                  />,
                ]
              : []),
            ...b.cheats.map((id) => {
              const c = CHEAT[id];
              return <Row key={id} icon={box(CHEAT_TIER_COLOR[c.tier], <Icon n="card" size={16} />)} name={c.name} tag={CHEAT_TIER_NAME[c.tier]} color={CHEAT_TIER_COLOR[c.tier]} desc={c.desc} />;
            }),
          ]}
        </Section>

        {x && (
          <Section title={`원정 유물 · 저주 (이번 원정에서만)`} empty="아직 없어요 — 엘리트 · 보물 · 상점에서 얻어요">
            {[
              ...x.relics.map((id) => <Row key={id} icon={<ExpRelicIcon id={id} size={32} />} name={EXP_RELIC[id]?.name} color="#9be7ff" desc={EXP_RELIC[id]?.desc} />),
              ...x.curses.map((id, i) => <Row key={`${id}${i}`} icon={box("#c79bff", <Icon n="skull" size={16} />)} name={`저주 · ${CURSES[id]?.name}`} color="#c79bff" desc={`${CURSES[id]?.desc} (상점에서 풀 수 있어요)`} />),
              ...EXP_ASC.filter((a) => ascOn(b.mods.town, a.lv)).map((a) => <Row key={`asc${a.lv}`} icon={box("#ffb347", <b className="text-[11px] text-[#ffb347]">{a.lv}</b>)} name={a.name} tag="단계 비틀기" color="#ffb347" desc={a.desc} />),
            ]}
          </Section>
        )}

        <Section title="장착 유물 · 연구 (정비소)" empty="장착한 유물 · 연구가 없어요">
          {[
            ...b.mods.relics.map((id) => (
              <Row key={id} icon={<RelicIcon id={id} size={32} />} name={`${RELIC[id]?.name} Lv.${b.mods.relicLv?.[id] ?? 1}`} desc={relicDesc(id, b.mods.relicLv?.[id] ?? 1)} />
            )),
            ...b.mods.res.map((id) => (
              <Row key={id} icon={box("#5ff2ff", <Icon n="flask" size={16} />)} name={`${RES[id]?.name} Lv.${b.mods.resLv?.[id] ?? 1}`} tag="연구" color="#5ff2ff" desc={resDesc(id, b.mods.resLv?.[id] ?? 1)} />
            )),
          ]}
        </Section>
      </div>
    </Modal>
  );
}
