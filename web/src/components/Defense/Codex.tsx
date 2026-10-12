"use client";

import { useState } from "react";
import { BOSSES, KINDS, SIZE_NAME } from "@/lib/defense/enemies";
import {
  FACTIONS,
  FACTION_COLOR,
  FACTION_NAME,
  GRADE_NAME,
  RECIPES,
  SIZE_MULT,
  UNITS,
  UNIT,
} from "@/lib/defense/units";
import { FactionChip, GradeChip, TITLE, UnitIcon, unitStats } from "./ui";

/** 히든 유닛: 한 번 만들면 이 브라우저에서 도감 · 조합식에 보임 */
const KEY = "dfn-found";
export function foundHidden(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).includes(id);
  } catch {
    return false;
  }
}
export function markFound(id: string) {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
    if (!l.includes(id)) localStorage.setItem(KEY, JSON.stringify([...l, id]));
  } catch {}
}

type Tab = "knight" | "mech" | "arcane" | "hidden" | "enemy";

/** 도감 — 세력별 유닛 · 조합식 · 적 · 보스 */
export default function Codex({ have }: { have?: Record<string, number> }) {
  const [tab, setTab] = useState<Tab>("knight");
  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {[...FACTIONS, "hidden" as const].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setTab(f)}
            className={`rounded-lg border px-3 py-1.5 text-[14px] font-bold ${tab === f ? "border-white/40 bg-white/10" : "border-white/10 text-white/60"}`}
            style={{ color: tab === f ? FACTION_COLOR[f] : undefined }}
          >
            {FACTION_NAME[f]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTab("enemy")}
          className={`rounded-lg border px-3 py-1.5 text-[14px] font-bold ${tab === "enemy" ? "border-white/40 bg-white/10 text-[#ff5a6e]" : "border-white/10 text-white/60"}`}
        >
          글리치 · 보스
        </button>
      </div>
      {tab === "enemy" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-[13px] text-white/50">글리치 몬스터</p>
            {KINDS.map((k) => (
              <div
                key={k.id}
                className="mb-1 flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 text-[13px]"
              >
                <span className="h-4 w-4 rounded-sm" style={{ background: k.color }} />
                <b className="w-[100px]">{k.name}</b>
                <span className="text-white/60">
                  {SIZE_NAME[k.size]} · 속도 ×{k.spd} · 체력 ×{k.hp}
                  {k.armor >= 1.5 ? " · 단단함" : ""}
                  {k.mres ? ` · 마법 저항 ${k.mres * 100}%` : ""}
                </span>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-[13px] text-white/50">오염된 파이터 (10웨이브마다)</p>
            {BOSSES.map((x) => (
              <div
                key={x.wave}
                className="mb-1 flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5"
              >
                <img
                  src={`/fight/art/${x.fighter}-face.webp`}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                />
                <div className="text-[13px] leading-tight">
                  <b style={{ color: x.color }}>
                    W{x.wave} {x.name}
                  </b>{" "}
                  <span className="text-white/50">{x.title}</span>
                  <p className="text-white/60">{bossDesc(x)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {UNITS.filter((u) => u.faction === tab).map((u) => {
            const hidden = u.faction === "hidden" && !foundHidden(u.id);
            const r = RECIPES.find((x) => x.id === u.id);
            return (
              <div
                key={u.id}
                className="flex gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2"
              >
                {hidden ? (
                  <span
                    className={`${TITLE} flex h-11 w-11 items-center justify-center rounded-md bg-white/10 text-white/40`}
                  >
                    ?
                  </span>
                ) : (
                  <UnitIcon id={u.id} size={44} />
                )}
                <div className="min-w-0 text-[13px] leading-snug">
                  <div className="flex items-center gap-1">
                    <b className="text-[14px]">{hidden ? "???" : u.name}</b>
                    <GradeChip g={u.grade} />
                    {u.faction !== "hidden" && <FactionChip f={u.faction} />}
                    {have?.[u.id] ? <span className="text-white/50">보유 {have[u.id]}</span> : null}
                  </div>
                  {!hidden && <p className="text-white/55">{unitStats(u)}</p>}
                  <p className="text-white/80">
                    {hidden ? "숨겨진 유닛 — 조합식을 찾아보세요" : u.desc}
                  </p>
                  {r && !hidden && (
                    <p className="text-[12px] text-[#ffd84a]/80">
                      조합: {r.needs.map((n) => UNIT[n].name).join(" + ")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {tab !== "hidden" && (
            <p className="col-span-2 text-[12px] text-white/45">
              {FACTION_NAME[tab]} 상성: 소형 {SIZE_MULT[tab][0] * 100}% · 중형{" "}
              {SIZE_MULT[tab][1] * 100}% · 대형 {SIZE_MULT[tab][2] * 100}%
              {tab === "arcane"
                ? " (마법 — 방어력 무시, 마법 저항에 막힘)"
                : " (물리 — 방어력에 깎임, 방어 깎기로 뚫음)"}{" "}
              · 같은 유닛 3기 → 같은 세력 다음 등급 무작위 ({GRADE_NAME[0]}→{GRADE_NAME[1]}→
              {GRADE_NAME[2]}→{GRADE_NAME[3]})
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function bossDesc(x: (typeof BOSSES)[number]) {
  const s = x.skills.map((k) =>
    k.kind === "heal"
      ? `${k.every}초마다 체력 ${k.pct * 100}% 회복`
      : k.kind === "whip"
        ? `${k.every}초마다 유닛 칸 ${k.n}개 ${k.sec}초 기절`
        : k.kind === "dash"
          ? `${k.every}초마다 질주`
          : k.kind === "shield"
            ? `${k.every}초마다 보호막`
            : k.kind === "summon"
              ? `${k.every}초마다 졸개 ${k.n}마리`
              : `${k.every}초마다 ${k.sec}초 회피`
  );
  if (x.pres) s.push(`물리 저항 ${x.pres * 100}%`);
  if (x.mres) s.push(`마법 저항 ${x.mres * 100}%`);
  return s.join(" · ");
}
