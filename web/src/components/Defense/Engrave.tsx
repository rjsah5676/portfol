"use client";

import { useState, type CSSProperties } from "react";
import { meta, type DefenseProfile } from "@/realtime/defense";
import { ENGRAVES, ENGR_FROM, ENGR_IDS, ENGR_ODDS, ENGR_PITY, ENGR_REFUND, ENGR_TIER_COLOR, ENGR_TIER_NAME, ENGR_MAXED, engrVal, type Engr } from "@/lib/defense/engrave";
import { GRADE_COLOR, UNIT } from "@/lib/defense/units";
import { Btn, GradeChip, Icon, Modal, TITLE, UnitIcon } from "./ui";
import { sfx } from "./audio";

/*
 * 정비소 「각인」 탭 — 유닛마다 특성 하나 (각인석으로 굴림)
 * 중복: 같은 특성 = 공명(등급 +1) · 다른 특성 = 둘 중 고르기 (버린 쪽 등급만큼 각인석) · 글리치에 같은 특성 = 각인석 돌려받음
 */

interface Props {
  p: DefenseProfile;
  act(f: () => Promise<DefenseProfile>, ok?: string): Promise<DefenseProfile | null>;
  busy: boolean;
}

/** 각인 한 장 (등급 색 테두리 · 글리치는 번쩍) */
export function EngrCard({ g, label, big }: { g: Engr; label?: string; big?: boolean }) {
  const c = ENGR_TIER_COLOR[g.t];
  return (
    <div
      className={`px-box dfn-pop flex flex-col items-center gap-1 p-3 text-center ${g.t === 3 ? "dfn-glitch" : ""} ${big ? "min-h-[150px] w-[220px]" : "w-full"}`}
      style={{ "--b": c, boxShadow: g.t >= 2 ? `0 0 18px 2px ${c}66` : undefined } as CSSProperties}
    >
      {label && <span className="text-[11px] font-bold text-[var(--mute)]">{label}</span>}
      <b className="text-[12px]" style={{ color: c }}>
        {ENGR_TIER_NAME[g.t]}
      </b>
      <b className={`px-shadow text-white ${big ? "text-[20px]" : "text-[15px]"}`}>{ENGRAVES[g.e].name}</b>
      <span className="text-[12px] leading-snug text-[var(--text)]">{ENGRAVES[g.e].desc(engrVal(g))}</span>
    </div>
  );
}

/** 유닛 아이콘 옆 작은 각인 표시 */
export function EngrBadge({ g }: { g: Engr | undefined }) {
  if (!g) return null;
  return (
    <span className="px-1 text-[10px] font-bold leading-[14px] text-[#0a0816]" style={{ background: ENGR_TIER_COLOR[g.t] }} title={`${ENGR_TIER_NAME[g.t]} ${ENGRAVES[g.e].name}`}>
      {ENGRAVES[g.e].name}
    </span>
  );
}

export function EngraveTab({ p, act, busy }: Props) {
  const units = (p.seen ?? []).filter((id) => UNIT[id]).sort((a, b) => UNIT[b].grade - UNIT[a].grade || UNIT[a].name.localeCompare(UNIT[b].name));
  const [sel, setSel] = useState<string>(units[0] ?? "");
  const [res, setRes] = useState<DefenseProfile["engrRoll"] | null>(null);
  const [list, setList] = useState(false);
  const open = p.glitchWin >= ENGR_FROM;
  const stones = p.estone ?? 0;
  const pend = p.epend ?? null;
  const cur = sel ? p.engr?.[sel] : undefined;

  const roll = async () => {
    const np = await act(() => meta.engrRoll(sel));
    const r = np?.engrRoll;
    if (!r) return;
    setRes(r);
    sfx(r.got.t >= 3 ? "boss" : r.got.t >= 2 || r.kind === "resonate" ? "reward" : "ui-click");
  };
  const pick = async (take: boolean) => {
    await act(() => meta.engrPick(take), take ? "reward" : "ui-click");
    setRes(null);
  };

  if (!open)
    return (
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed">
        <p className={`${TITLE} px-shadow text-[18px]`}>
          <Icon n="lock" size={14} /> 각인
        </p>
        <p className="text-[var(--text)]">
          오염 <b className="text-white">{ENGR_FROM}단계</b>를 클리어하면 열려요. 유닛마다 특성 하나를 새겨 — 폭발 · 치명 리듬 · 거인 사냥 · 처형… 같은 유닛이 나올 때마다 붙어요.
        </p>
        <p className="text-[var(--mute)]">각인석은 오염 31단계 이상 클리어(첫 클리어는 +2 더)와 글리치 원정 보스(하나당 1)에서 얻어요.</p>
      </div>
    );

  return (
    <div className="flex h-full gap-3">
      {/* 유닛 고르기 */}
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-baseline gap-3">
          <h3 className={`${TITLE} px-shadow text-[16px]`}>각인</h3>
          <span className="text-[12px] text-[var(--mute)]">얻어 본 유닛 {units.length} · 각인 {Object.keys(p.engr ?? {}).length}</span>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {units.map((id) => {
            const g = p.engr?.[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => (setSel(id), sfx("ui-click", 0.6, 1.2))}
                className={`px-inset flex flex-col items-center gap-0.5 p-1 ${sel === id ? "outline outline-2 outline-[#ffd23f]" : ""}`}
                title={UNIT[id].name}
              >
                <UnitIcon id={id} size={36} />
                <span className="h-[14px]">{g ? <EngrBadge g={g} /> : <span className="text-[10px] text-[var(--dim)]">—</span>}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* 고른 유닛 */}
      <div className="flex w-[280px] shrink-0 flex-col gap-2">
        <div className="px-inset flex items-center justify-between px-2.5 py-1.5 text-[13px]">
          <span>
            <Icon n="gem" size={13} /> 각인석 <b className="text-[#ff9ef0]">{stones}</b>
          </span>
          <span className="text-[11px] text-[var(--mute)]" title={`${ENGR_PITY}번 안에 전설 이상이 꼭 나와요`}>
            전설 확정까지 {ENGR_PITY - (p.epity ?? 0)}번
          </span>
        </div>
        {sel && (
          <div className="px-box flex flex-col gap-2 p-2.5" style={{ "--b": GRADE_COLOR[UNIT[sel].grade] } as CSSProperties}>
            <div className="flex items-center gap-2">
              <UnitIcon id={sel} size={44} />
              <div className="min-w-0">
                <b className="block truncate text-[15px]">{UNIT[sel].name}</b>
                <GradeChip g={UNIT[sel].grade} />
              </div>
            </div>
            {cur ? <EngrCard g={cur} label="지금 각인" /> : <p className="px-inset px-2 py-3 text-center text-[12px] text-[var(--dim)]">아직 각인이 없어요</p>}
            <Btn tone="gold" arrow className="h-10 text-[14px] font-bold" disabled={busy || stones < 1 || !!pend} onClick={roll}>
              각인하기 (각인석 1)
            </Btn>
            <p className="text-[11px] leading-snug text-[var(--mute)]">
              같은 특성이 나오면 <b className="text-[#ff9ef0]">공명</b> — 등급 +1. 다른 특성이면 둘 중 골라요 (버린 쪽이 희귀 이상이면 각인석을 돌려받아요).
            </p>
          </div>
        )}
        <button type="button" className="text-left text-[12px] text-[var(--mute)] underline" onClick={() => setList((v) => !v)}>
          {list ? "각인 목록 닫기" : `각인 목록 · 확률 (${ENGR_IDS.length}종)`}
        </button>
        {list && (
          <div className="px-inset flex max-h-[220px] flex-col gap-1 overflow-y-auto p-2 text-[11px] leading-snug">
            <p className="text-[var(--mute)]">
              등급 확률 {ENGR_TIER_NAME.map((n, i) => `${n} ${ENGR_ODDS[i]}%`).join(" · ")}
            </p>
            {ENGR_IDS.map((e) => (
              <p key={e}>
                <b className="text-white">{ENGRAVES[e].name}</b> <span className="text-[var(--text)]">{ENGRAVES[e].desc(ENGRAVES[e].val[0])}</span>{" "}
                <span className="text-[var(--dim)]">(글리치 {ENGRAVES[e].val[3]})</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {/* 결과 · 고르기 */}
      {(res || pend) && (
        <Modal title={pend ? "각인 고르기" : res?.kind === "resonate" ? "공명!" : "각인"} onClose={pend ? undefined : () => setRes(null)} accent={ENGR_TIER_COLOR[(pend?.g ?? res!.got).t]}>
          {pend ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-[13px] text-[var(--text)]">
                <b className="text-white">{UNIT[pend.u]?.name}</b> — 다른 특성이 나왔어요. 하나를 골라요.
              </p>
              <div className="flex gap-3">
                {p.engr?.[pend.u] && <EngrCard g={p.engr[pend.u]} label="지금" big />}
                <EngrCard g={pend.g} label="새로" big />
              </div>
              <div className="flex gap-2">
                <Btn className="h-10 px-4 text-[13px]" disabled={busy} onClick={() => pick(false)}>
                  지금 각인 유지{ENGR_REFUND[pend.g.t] ? ` (각인석 +${ENGR_REFUND[pend.g.t]})` : ""}
                </Btn>
                <Btn tone="gold" arrow className="h-10 px-4 text-[13px] font-bold" disabled={busy} onClick={() => pick(true)}>
                  새 각인으로 바꾸기{p.engr?.[pend.u] && ENGR_REFUND[p.engr[pend.u].t] ? ` (각인석 +${ENGR_REFUND[p.engr[pend.u].t]})` : ""}
                </Btn>
              </div>
            </div>
          ) : (
            res && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-[13px] text-[var(--text)]">
                  <b className="text-white">{UNIT[res.unit]?.name}</b>{" "}
                  {res.kind === "new"
                    ? "에 새 각인!"
                    : res.kind === "resonate"
                      ? `— 같은 특성이 겹쳐 등급이 올랐어요 (${ENGR_TIER_NAME[res.prev?.t ?? 0]} → ${ENGR_TIER_NAME[p.engr?.[res.unit]?.t ?? 0]})`
                      : `— 이미 글리치 등급이라 각인석 ${ENGR_MAXED}개를 돌려받았어요`}
                </p>
                <EngrCard g={res.kind === "resonate" ? (p.engr?.[res.unit] ?? res.got) : res.got} big />
                <Btn tone="main" className="h-9 px-5 text-[13px]" onClick={() => setRes(null)}>
                  확인
                </Btn>
              </div>
            )
          )}
        </Modal>
      )}
    </div>
  );
}
