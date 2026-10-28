"use client";

/*
 * 육성 — 픽셀파이트 인연 화면들: 미연시 장면 · 인연 현황 · 인연 축복 고르기 · 인연 대결 · 덱 고르기(만들기) · 가이드 힌트.
 * 규칙은 lib/baseball/career.ts (+ 대사 bonds.ts).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BOND_IDS, BOONS, DUOS, ROLE_NAME, heartName, type BondId } from "@/lib/baseball/bonds";
import {
  BEATS, BEAT_NAME, BOND_MAX, BOON_MUL, DECK_SIZE, STAT_NAME, TAG_NAME, TYPES, VISIT_AFF, VISIT_SEASON,
  autoBattle, boonLv, inheritable, legacyBonus, nextBeat, roleOf, skill, tagCount,
  type BatType, type Career, type HofEntry, type SkillId, type StatKey, type TurnOut,
} from "@/lib/baseball/career";
import { BONDS } from "@/lib/baseball/career";
import { artUrl, charById, faceUrl, type CharId } from "@/lib/baseball/data";
import { makeRng } from "@/lib/baseball/rng";
import { ACCENT, Btn, Modal, font } from "./ui";
import { sfx } from "./sfx";

export { artUrl };
const ROLE_COLOR = { friend: "#7ad7ff", sister: "#7dff9a", crush: "#ff7ae0" } as const;
const BEAT_ICON = { talk: "💬", boon: "✨", mini: "⚾", final: "🔥" } as const;

/* ─────────────── 미연시 장면 ─────────────── */

/** 장면 배경 (그림 받기 전 — 장소 분위기 그라데이션) */
const PLACE_BG: Record<string, string> = {
  river:
    "linear-gradient(180deg, #0c1838 0%, #1b2f63 45%, #2a3f7a 55%, #0d1a3a 56%, #13244d 100%), radial-gradient(ellipse at 30% 55%, rgba(255,210,120,0.25) 0%, transparent 40%)",
  park: "linear-gradient(180deg, #2b3d6b 0%, #c97b6a 38%, #f0b27a 50%, #2f5a3a 51%, #1d3b26 100%)",
  downtown: "linear-gradient(180deg, #190d33 0%, #3a1661 40%, #7a2a8a 52%, #1a0f2e 53%, #120a22 100%)",
  library: "linear-gradient(180deg, #2a1a10 0%, #5a3a20 45%, #7a5530 52%, #3a2414 53%, #24160c 100%)",
  tv: "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.35) 0%, transparent 45%), linear-gradient(180deg, #101423 0%, #1c2236 60%, #0b0e1c 100%)",
};
const SEEN = "pxb:seen:v1";
const seenSet = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN) ?? "[]"));
  } catch {
    return new Set();
  }
};
const markSeen = (k: string) => {
  try {
    const s = seenSet();
    s.add(k);
    localStorage.setItem(SEEN, JSON.stringify([...s].slice(-400)));
  } catch {}
};

/**
 * 전신 그림(안 잘리게 contain) + 대화창. 줄은 눌러서 넘기고, 끝나면 고르기 또는 결과.
 * panel = 왼쪽 위 관계 패널 · place = 배경 분위기 · seenKey = 판을 넘어 본 장면이면 「바로 고르기」
 */
export function VnScene({
  char,
  skin,
  lines,
  title,
  choices,
  onChoose,
  result,
  onDone,
  panel,
  place,
  seenKey,
}: {
  char: CharId;
  skin?: string;
  lines: string[];
  title?: string;
  choices?: string[];
  onChoose?: (i: number) => void;
  result?: TurnOut;
  onDone?: () => void;
  panel?: ReactNode;
  place?: string;
  seenKey?: string;
}) {
  const ch = charById(char);
  const [i, setI] = useState(0);
  const [log, setLog] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장값 확인
    if (seenKey) setSeen(seenSet().has(seenKey));
  }, [seenKey]);
  const end = i >= lines.length - 1;
  useEffect(() => {
    if (end && seenKey) markSeen(seenKey);
  }, [end, seenKey]);
  const line = lines[Math.min(i, lines.length - 1)] ?? "";
  // "이름: 대사" 꼴이면 이름표로
  const m = /^(.{1,6}): (.*)$/.exec(line);
  const speaker = m ? m[1] : null;
  const text = m ? m[2] : line;
  const next = () => {
    if (log) return setLog(false);
    if (!end) {
      sfx.ui();
      setI((v) => v + 1);
    } else if (!choices && onDone) onDone();
  };
  const bg = (place && PLACE_BG[place]) ?? `radial-gradient(ellipse at 70% 40%, ${ch.color}33 0%, #0b0e1c 65%), #0b0e1c`;
  return (
    <div
      className="absolute inset-0 z-40 cursor-pointer overflow-hidden select-none"
      style={{ background: bg }}
      data-space={end && choices ? undefined : "pointer"}
      onPointerDown={(e) => {
        e.stopPropagation();
        next();
      }}
    >
      {/* 캐릭터 색 빛 */}
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at 74% 45%, ${ch.color}40 0%, transparent 55%)` }} />
      {/* 전신 (머리 · 손 안 잘리게) */}
      <img
        src={artUrl(skin ?? char)}
        alt={ch.name}
        className="pointer-events-none absolute right-[40px] bottom-[18px] h-[500px] w-auto object-contain drop-shadow-[0_0_30px_rgba(0,0,0,0.7)]"
      />
      <div className="absolute top-4 right-5 z-10 flex gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
        {!end && lines.length > 1 && (
          <button
            type="button"
            className="cursor-pointer rounded-lg border px-3 py-1 text-[12.5px]"
            style={{ borderColor: seen ? "#ffd23f" : "rgba(255,255,255,0.2)", background: seen ? "#ffd23f26" : "rgba(0,0,0,0.6)", color: seen ? "#ffd23f" : "rgba(255,255,255,0.8)" }}
            onClick={() => {
              sfx.ui();
              setI(lines.length - 1);
            }}
          >
            {seen ? "본 장면 — 바로 넘기기 ⏭" : "건너뛰기 ⏭"}
          </button>
        )}
        {i > 0 && (
          <button type="button" className="cursor-pointer rounded-lg border border-white/20 bg-black/60 px-3 py-1 text-[12.5px] text-white/80" onClick={() => setLog((v) => !v)}>
            로그
          </button>
        )}
      </div>
      {panel ? (
        <div className="absolute top-4 left-5" onPointerDown={(e) => e.stopPropagation()}>
          {panel}
        </div>
      ) : (
        title && (
          <div className="absolute top-4 left-5 rounded-xl border border-white/15 bg-black/60 px-4 py-1.5">
            <span className={`${font.title} text-[20px]`} style={{ color: ch.color }}>
              {title}
            </span>
          </div>
        )
      )}
      {log && (
        <div className="absolute top-[64px] left-1/2 z-20 max-h-[300px] w-[560px] -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/15 bg-black/85 p-4 text-left text-[14px] leading-relaxed text-white/85">
          {lines.slice(0, i + 1).map((l, k) => (
            <div key={k} className="mb-1">
              {l}
            </div>
          ))}
          <div className="mt-2 text-right text-[11px] text-white/40">눌러서 닫기</div>
        </div>
      )}
      <div className="absolute bottom-5 left-5 w-[640px] rounded-2xl border-2 bg-[#0d1124]/95 px-5 py-4 shadow-2xl" style={{ borderColor: `${ch.color}aa` }}>
        {speaker && (
          <div className={`${font.title} absolute -top-[18px] left-4 rounded-lg px-3 py-0.5 text-[17px] text-black`} style={{ background: ch.color }}>
            {speaker}
          </div>
        )}
        <div className="min-h-[52px] text-[17px] leading-relaxed text-white/95">{text}</div>
        {end && choices && (
          <div className="mt-3 flex flex-col gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
            {choices.map((t, k) => (
              <Btn key={k} className="flex items-center gap-2 px-3 py-2 text-left text-[15px]" color={ch.color} onClick={() => onChoose?.(k)}>
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[13px]" style={{ background: `${ch.color}55` }}>
                  {k + 1}
                </span>
                <span>{t}</span>
              </Btn>
            ))}
          </div>
        )}
        {end && !choices && result && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {result.lines.map((l, k) => (
              <span key={k} className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-bold" style={{ color: l.startsWith("호감") ? "#ff9ad5" : "#ffd23f" }}>
                {l}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1 text-right text-[11px] text-white/40">{end ? (choices ? "고르기" : "눌러서 계속 ▶") : `눌러서 넘기기 ▶ ${i + 1}/${lines.length}`}</div>
      </div>
    </div>
  );
}

/** 미연시 장면 왼쪽 위 관계 패널 */
export function BondPanel({ c, id, label }: { c: Career; id: BondId; label?: string }) {
  const ch = charById(id);
  const role = roleOf(id);
  const aff = c.aff[id] ?? 0;
  const v = c.bonds[id] ?? 0;
  return (
    <div className="flex w-[300px] gap-2.5 rounded-2xl border-2 bg-[#0d1124]/92 p-2.5 shadow-xl" style={{ borderColor: `${ch.color}88` }}>
      <img src={faceUrl(id)} alt={ch.name} className="h-[64px] w-[58px] shrink-0 rounded-lg object-cover object-top" style={{ outline: `2px solid ${ch.color}` }} />
      <div className="min-w-0 flex-1 text-left">
        <div className={`${font.title} truncate text-[17px] leading-tight`} style={{ color: ch.color }}>
          {ch.name} · {label ?? `${Math.min(v, BOND_MAX)}/${BOND_MAX}`}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="rounded px-1.5 text-[10.5px] font-bold" style={{ background: `${ROLE_COLOR[role]}26`, color: ROLE_COLOR[role] }}>
            {ROLE_NAME[role]}
          </span>
          <span className="truncate text-[11.5px] text-white/70">{heartName(role, aff)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-[12px] text-[#ff7ae0]">♥</span>
          <div className="relative h-[7px] flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${aff}%`, background: "linear-gradient(90deg,#ff7ae0,#ffb0e8)" }} />
          </div>
          <span className="font-mono text-[11px] text-white/70">{aff}</span>
          <span className="text-[11px] text-[#7ad7ff]">{"◆".repeat(Math.min(5, c.know[id] ?? 0)) || "◇"}</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── 인연 카드 (현황) ─────────────── */

export function BondCard({ c, id, action }: { c: Career; id: BondId; action?: ReactNode }) {
  const ch = charById(id);
  const role = roleOf(id);
  const aff = c.aff[id] ?? 0;
  const v = c.bonds[id] ?? 0;
  const nb = nextBeat(c, id);
  const lock = v < BOND_MAX && c.season < VISIT_SEASON[v] ? `${VISIT_SEASON[v]}년차부터` : null;
  const boons = c.skills.filter((s) => {
    const b = skill(s).boon;
    return b === id || (Array.isArray(b) && b.includes(id));
  });
  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-black/30 p-2.5 text-left">
      <img src={faceUrl(id)} alt={ch.name} className="h-[92px] w-[84px] shrink-0 rounded-lg object-cover object-top" style={{ outline: `2px solid ${ch.color}` }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`${font.title} text-[19px]`} style={{ color: ch.color }}>
            {ch.name}
          </span>
          <span className="rounded px-1.5 py-[1px] text-[10.5px] font-bold" style={{ background: `${ROLE_COLOR[role]}22`, color: ROLE_COLOR[role] }}>
            {ROLE_NAME[role]}
          </span>
          <span className="text-[11.5px] text-white/55">{heartName(role, aff)}</span>
          <span className="ml-auto text-[11px] text-white/50">{STAT_NAME[BONDS[id].stat as StatKey]} 키워 줌</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="w-[30px] text-[11px] text-[#ff9ad5]">호감</span>
          <div className="relative h-[8px] flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${aff}%`, background: "linear-gradient(90deg,#ff7ae0,#ffb0e8)" }} />
            {v < BOND_MAX && VISIT_AFF[v] > 0 && <div className="absolute inset-y-0 w-[2px] bg-white/80" style={{ left: `${VISIT_AFF[v]}%` }} title="다음 이야기에 필요한 호감" />}
          </div>
          <span className="w-[26px] text-right font-mono text-[12px]">{aff}</span>
          <span className="text-[11px] text-white/55">이해 {"◆".repeat(Math.min(5, c.know[id] ?? 0)) || "-"}</span>
        </div>
        {/* 줄기 8칸 */}
        <div className="mt-1 flex items-center gap-1">
          {BEATS.map((b, k) => (
            <span
              key={k}
              title={BEAT_NAME[b]}
              className="flex h-[20px] w-[24px] items-center justify-center rounded text-[11px]"
              style={{ background: k < v ? `${ch.color}55` : k === v ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)", outline: k === v ? `1px solid ${ch.color}` : undefined, opacity: k <= v ? 1 : 0.5 }}
            >
              {BEAT_ICON[b]}
            </span>
          ))}
          <span className="ml-1 truncate text-[11.5px] text-white/70">
            {v >= BOND_MAX ? "인연 완료 — 가끔 같이 놀기" : lock ? `다음: ${BEAT_NAME[BEATS[v]]} · ${lock}` : nb.kind === "hang" ? `다음: ${BEAT_NAME[BEATS[v]]} · ${nb.why}` : `다음: ${BEAT_NAME[nb.kind]}`}
          </span>
        </div>
        {boons.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {boons.map((b) => (
              <span key={b} title={skill(b).desc} className="rounded border px-1.5 text-[10.5px]" style={{ borderColor: `${ch.color}88`, color: ch.color }}>
                ✨{skill(b).name} Lv{boonLv(c, b)}
              </span>
            ))}
          </div>
        )}
        {action && <div className="mt-1.5">{action}</div>}
      </div>
    </div>
  );
}

export function BondsModal({ c, onClose }: { c: Career; onClose: () => void }) {
  return (
    <Modal w={720} onClose={onClose}>
      <div className="mb-1 flex items-center justify-between">
        <div className={`${font.title} text-[26px]`}>💞 인연</div>
        <Btn space className="px-3 py-1 text-[13px]" color="#8b93b8" onClick={onClose}>
          닫기
        </Btn>
      </div>
      <div className="mb-2 text-left text-[12px] text-white/55">
        만남마다 한 칸씩: 💬 이야기(고르기) · ✨ 인연 축복 · ⚾ 가벼운 대결 · 🔥 필살 전수 대결. 그 사람다운 답을 고르면 「이해」가 쌓여서 특별한 답 · 축복 Lv2 시작이 열려요.
      </div>
      <div className="flex flex-col gap-2">
        {c.deck.map((id) => (
          <BondCard key={id} c={c} id={id} />
        ))}
      </div>
      <DuoList c={c} />
    </Modal>
  );
}

/** 덱 조합으로 열 수 있는 듀오 */
function DuoList({ c }: { c: Career }) {
  const hasFrom = (who: BondId) => (BOONS[who] as SkillId[]).some((x) => c.skills.includes(x));
  const duos = DUOS.filter((d) => c.deck.includes(d.a) && c.deck.includes(d.b));
  if (!duos.length) return <div className="mt-2 text-left text-[12px] text-white/45">💫 이 덱 조합엔 듀오 축복이 없어요</div>;
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-left">
      {duos.map((d) => {
        const owned = c.skills.includes(d.id as SkillId);
        const ok = hasFrom(d.a) && hasFrom(d.b);
        return (
          <div key={d.id} className="rounded-lg border px-2 py-1 text-[12px]" style={{ borderColor: owned ? "#ffd23f" : ok ? "#7dff9a88" : "rgba(255,255,255,0.15)" }} title={skill(d.id as SkillId).desc}>
            <b style={{ color: owned ? "#ffd23f" : "#fff" }}>
              {owned ? "★" : ok ? "✨" : "🔒"} {skill(d.id as SkillId).name}
            </b>{" "}
            <span className="text-white/55">
              {charById(d.a).name} {hasFrom(d.a) ? "✓" : "✗"} · {charById(d.b).name} {hasFrom(d.b) ? "✓" : "✗"}
              {owned ? ` · Lv${boonLv(c, d.id as SkillId)}` : ok ? " · 이제 축복에 섞여 나와요" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────── 인연 축복 고르기 ─────────────── */

export function BoonPickModal({ c, onPick }: { c: Career; onPick: (i: number) => void }) {
  const p = c.pick!;
  const who = charById(p.boon!);
  const tc = tagCount(c);
  return (
    <Modal w={780}>
      <div className="flex items-center justify-center gap-3">
        <img src={faceUrl(who.id)} alt={who.name} className="h-[54px] w-[50px] rounded-lg object-cover object-top" style={{ outline: `2px solid ${who.color}` }} />
        <div className={`${font.title} text-[28px]`} style={{ color: who.color }}>
          {p.from}
        </div>
      </div>
      <div className="text-[12.5px] text-white/60">하나를 골라요 · 이미 가진 축복은 레벨 업 (Lv3 = 효과 ×2) · 💫 듀오는 두 사람 축복이 다 있어야 나와요</div>
      <div className="mt-3 flex gap-3">
      <div className="grid flex-1 grid-cols-3 gap-3">
        {p.options.map((id, i) => {
          const s = skill(id);
          const duo = Array.isArray(s.boon);
          const owned = c.skills.includes(id);
          const lv = owned ? boonLv(c, id) : 0;
          const col = duo ? "#ffd23f" : who.color;
          const have = s.tag ? tc[s.tag] ?? 0 : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                sfx.ui();
                onPick(i);
              }}
              className="flex min-h-[180px] cursor-pointer flex-col items-center justify-between rounded-2xl border-[3px] bg-[#0b0e1c] p-3 transition-transform hover:-translate-y-1"
              style={{ borderColor: col, boxShadow: `0 0 20px ${col}55` }}
            >
              <span className="flex gap-1">
                {duo &&
                  (s.boon as CharId[]).map((x) => <img key={x} src={faceUrl(x)} alt="" className="h-[26px] w-[24px] rounded object-cover object-top" style={{ outline: `1.5px solid ${charById(x).color}` }} />)}
                <span className="rounded px-2 py-0.5 text-[11px] font-bold" style={{ background: `${col}22`, color: col }}>
                  {duo ? "💫 듀오" : "✨ 축복"} {s.tag ? `· ${TAG_NAME[s.tag]}` : ""}
                </span>
              </span>
              <span className={`${font.title} text-[23px] leading-tight`} style={{ color: col }}>
                {s.name}
              </span>
              <span className="text-[13px] text-white/80">{s.desc}</span>
              <span className="text-[11.5px] font-bold" style={{ color: owned ? "#7dff9a" : "rgba(255,255,255,0.5)" }}>
                {owned ? `Lv${lv} → Lv${lv + 1} (×${BOON_MUL[lv - 1]} → ×${BOON_MUL[lv]})` : `새 축복${s.tag ? ` · ${TAG_NAME[s.tag]} ${have}→${have + 1}/3${have + 1 >= 3 ? " 세트!" : ""}` : ""}`}
              </span>
            </button>
          );
        })}
      </div>
      <MyBoons c={c} focus={p.boon!} />
      </div>
      <div className="mt-2 text-[12px] text-[#ff9ad5]">고르면 {who.name} 호감 +2</div>
      <Hint k="boon" title="인연 축복">
        그 사람만의 능력 카드예요. 같은 축복을 또 고르면 레벨 업(최대 Lv3 = 효과 ×2). 두 사람 축복을 하나씩 가지면 둘을 묶는 💫 듀오 축복이 나오기 시작해요. 축복도 태그가 있어서 같은 태그 3장이면 세트 효과!
      </Hint>
    </Modal>
  );
}

/** 내 축복 목록 + 이 사람과 열 수 있는 듀오 진척 */
function MyBoons({ c, focus }: { c: Career; focus: BondId }) {
  const mine = c.skills.filter((s) => skill(s).boon);
  const hasFrom = (who: BondId) => (BOONS[who] as SkillId[]).some((x) => c.skills.includes(x));
  const duos = DUOS.filter((d) => d.a === focus || d.b === focus);
  return (
    <div className="flex w-[190px] shrink-0 flex-col gap-1 rounded-xl border border-white/10 bg-black/30 p-2 text-left">
      <div className="text-[12px] font-bold text-white/70">내 축복 {mine.length}</div>
      <div className="flex max-h-[120px] flex-col gap-0.5 overflow-y-auto">
        {mine.length ? (
          mine.map((s) => {
            const b = skill(s).boon;
            const who = Array.isArray(b) ? b[0] : (b as CharId);
            return (
              <div key={s} className="flex items-center gap-1 text-[11.5px]" title={skill(s).desc}>
                <img src={faceUrl(who)} alt="" className="h-[16px] w-[15px] rounded object-cover object-top" />
                <span className="flex-1 truncate">{skill(s).name}</span>
                <span className="font-mono text-[#7dff9a]">Lv{boonLv(c, s)}</span>
              </div>
            );
          })
        ) : (
          <span className="text-[11px] text-white/40">아직 없음</span>
        )}
      </div>
      <div className="mt-1 text-[12px] font-bold text-white/70">💫 듀오</div>
      {duos.map((d) => {
        const other = d.a === focus ? d.b : d.a;
        const owned = c.skills.includes(d.id as SkillId);
        const inDeck = c.deck.includes(other);
        return (
          <div key={d.id} className="text-[11px] leading-snug" title={skill(d.id as SkillId).desc}>
            <span style={{ color: owned ? "#ffd23f" : "#fff" }}>{owned ? "★" : "🔒"} {skill(d.id as SkillId).name}</span>
            <div className="text-white/50">
              {charById(focus).name} {hasFrom(focus) ? "✓" : "✗"} · {charById(other).name} {!inDeck ? "(덱에 없음)" : hasFrom(other) ? "✓" : "✗"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────── 인연 대결 ─────────────── */

export function BattleModal({ c, onDirect, onAuto }: { c: Career; onDirect: () => void; onAuto: () => void }) {
  const bt = c.battle!;
  const ch = charById(bt.char);
  // 자동 예상 승률 (봇 실력)
  const winP = useMemo(() => {
    let w = 0;
    const r = makeRng(c.seed + c.turn);
    for (let k = 0; k < 300; k++) if (autoBattle(c, r) >= bt.need) w++;
    return w / 300;
  }, [c, bt.need]);
  return (
    <div className="absolute inset-0 z-30" style={{ background: `radial-gradient(ellipse at 70% 40%, ${ch.color}40 0%, #0b0e1c 65%), #0b0e1c` }}>
      <img src={artUrl(ch.id)} alt={ch.name} className="pointer-events-none absolute right-[50px] bottom-[10px] h-[520px] w-auto object-contain" />
      <div className="absolute top-[70px] left-[50px] w-[520px]">
        <div className="text-[14px] text-white/60">{bt.kind === "final" ? "필살 전수 대결" : "가벼운 대결"}{bt.tries ? ` · ${bt.tries + 1}번째 도전` : ""}</div>
        <div className={`${font.title} text-[46px] leading-tight`} style={{ color: ch.color }}>
          {ch.name}와 대결!
        </div>
        <div className="mt-2 rounded-xl border border-white/15 bg-black/50 px-4 py-3 text-[15px] leading-relaxed">
          {ch.name}가 공 <b>{bt.pitches}개</b>를 던져요. <b className="text-[#7dff9a]">안타 1점</b> · <b className="text-[#ffd23f]">홈런 2점</b> — <b>{bt.need}점</b>이면 승리.
          <div className="mt-1 flex items-center gap-1.5 text-[13px] text-white/70">
            {Array.from({ length: bt.pitches }, (_, k) => (
              <span key={k} className="flex h-[24px] w-[24px] items-center justify-center rounded-full text-[11px]" style={{ background: "rgba(255,255,255,0.12)", outline: bt.magic.includes(k) ? `2px solid ${ch.color}` : undefined }}>
                {k + 1}
              </span>
            ))}
            <span className="ml-1">테두리 = 마구 「{ch.ball.name}」 — {ch.ball.hint}</span>
          </div>
          <div className="mt-1 text-[12.5px] text-white/55">
            {bt.kind === "final" ? `이기면 필살타법 「${ch.swing.name}」 전수!` : "이기면 축복 하나 + 능력치"} · 지면 다음에 만날 때 다시 · 안 친 볼은 다시 던져 줘요
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Btn className={`${font.title} flex-1 py-3 text-[22px]`} color={ch.color} active onClick={onDirect}>
            ⚾ 직접 치기
          </Btn>
          <Btn className="flex-1 py-3 text-[15px]" color="#8b93b8" onClick={onAuto}>
            자동으로
            <span className="block text-[11.5px] font-normal opacity-75">예상 승률 {Math.round(winP * 100)}%</span>
          </Btn>
        </div>
        <div className="mt-2 text-[11.5px] text-white/45">직접 치면 타이밍 실력이 그대로 — 자동은 능력치로만 계산해요.</div>
        <Hint k="battle" title="인연 대결">
          오른쪽 위에 다음 공이 직구 · 변화구 · 마구 중 뭔지 미리 떠요. 마구는 그 사람만의 특별한 공 — 힌트 문구를 잘 봐요. 져도 다음에 만나면 다시 도전할 수 있어요.
        </Hint>
      </div>
    </div>
  );
}

/* ─────────────── 만들기: 인연 덱 · 선배의 유산 ─────────────── */

/** 타입에 맞는 추천 덱 */
export function recommendDeck(type: BatType): BondId[] {
  const apt = TYPES[type].apt;
  return [...BOND_IDS].sort((a, b) => apt[BONDS[b].stat as StatKey] - apt[BONDS[a].stat as StatKey] || a.localeCompare(b)).slice(0, DECK_SIZE);
}

export function DeckStep({
  type,
  deck,
  setDeck,
  levels,
  hof,
  legacy,
  setLegacy,
}: {
  type: BatType;
  deck: BondId[];
  setDeck: (d: BondId[]) => void;
  levels: Partial<Record<CharId, number>>;
  hof: HofEntry[];
  legacy: { id: string; skill?: SkillId } | null;
  setLegacy: (l: { id: string; skill?: SkillId } | null) => void;
}) {
  const apt = TYPES[type].apt;
  const toggle = (id: BondId) => {
    if (deck.includes(id)) setDeck(deck.filter((x) => x !== id));
    else if (deck.length < DECK_SIZE) setDeck([...deck, id]);
  };
  const lg = legacy ? hof.find((h) => h.id === legacy.id) : undefined;
  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-white/75">
            인연 덱 — 같이 갈 {DECK_SIZE}명 ({deck.length}/{DECK_SIZE})
          </span>
          <Btn className="px-2.5 py-0.5 text-[12px]" color="#7dff9a" onClick={() => setDeck(recommendDeck(type))}>
            추천으로 채우기
          </Btn>
        </div>
        <div className="mt-0.5 text-[11.5px] text-white/50">덱에 넣은 사람만 지도에 나타나고 · 자기 훈련에 「함께 훈련」 하러 와요 (효율 ×1.3~1.6). 듀오 축복은 덱 조합으로 열려요.</div>
        <div className="mt-1.5 grid grid-cols-4 gap-2">
          {BOND_IDS.map((bid) => {
            const ch = charById(bid);
            const on = deck.includes(bid);
            const role = roleOf(bid);
            const st = BONDS[bid].stat as StatKey;
            const good = apt[st] > 1.05;
            const lv = levels[ch.id] ?? 0;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  sfx.ui();
                  toggle(bid);
                }}
                className="relative flex cursor-pointer flex-col items-center rounded-xl border-2 p-1.5 transition-transform hover:-translate-y-0.5"
                style={{ borderColor: on ? ch.color : "rgba(255,255,255,0.15)", background: on ? `${ch.color}26` : "rgba(0,0,0,0.3)", boxShadow: on ? `0 0 14px ${ch.color}77` : undefined, opacity: !on && deck.length >= DECK_SIZE ? 0.5 : 1 }}
              >
                <img src={faceUrl(ch.id)} alt={ch.name} className="h-[64px] w-[60px] rounded-lg object-cover object-top" />
                <span className={`${font.title} text-[16px]`} style={{ color: ch.color }}>
                  {ch.name}
                </span>
                <span className="text-[10.5px] text-white/65">
                  <span style={{ color: ROLE_COLOR[role] }}>{ROLE_NAME[role]}</span> · {STAT_NAME[st]}
                  {good && <span className="text-[#7dff9a]"> ▲</span>}
                </span>
                {lv > 0 && <span className="absolute top-1 left-1 rounded bg-[#ff7ae0] px-1 text-[9.5px] font-bold text-black">인연 Lv{lv}</span>}
                {on && <span className="absolute top-1 right-1 rounded-full bg-white px-1.5 text-[11px] font-bold text-black">{deck.indexOf(bid) + 1}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex w-[300px] shrink-0 flex-col">
        <div className="mb-2 rounded-xl border border-white/10 bg-black/30 p-2">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: DECK_SIZE }, (_, k) => {
              const id = deck[k];
              return id ? (
                <img key={k} src={faceUrl(id)} alt="" className="h-[40px] w-[37px] rounded-md object-cover object-top" style={{ outline: `2px solid ${charById(id).color}` }} />
              ) : (
                <span key={k} className="flex h-[40px] w-[37px] items-center justify-center rounded-md border border-dashed border-white/25 text-white/30">
                  +
                </span>
              );
            })}
            <span className="ml-1 text-[11.5px] text-white/60">
              함께 훈련:{" "}
              <b className="text-white">{deck.length ? [...new Set(deck.map((d) => STAT_NAME[BONDS[d].stat as StatKey]))].join(" · ") : "-"}</b>
            </span>
          </div>
          <div className="mt-1 text-[11.5px] text-white/60">
            💫 열리는 듀오:{" "}
            {(() => {
              const ds = DUOS.filter((d) => deck.includes(d.a) && deck.includes(d.b));
              return ds.length ? (
                <b className="text-[#ffd23f]">{ds.map((d) => `${skill(d.id as SkillId).name}(${charById(d.a).name}+${charById(d.b).name})`).join(" · ")}</b>
              ) : (
                <span className="text-white/40">없음 — 짝이 맞는 두 사람을 같이 넣으면 열려요</span>
              );
            })()}
          </div>
        </div>
        <span className="text-[13px] font-bold text-white/75">선배의 유산 (선택)</span>
        <div className="mt-0.5 text-[11.5px] text-white/50">은퇴한 선수 한 명에게서 특수능력 1개 + 시작 능력치 조금</div>
        <div className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          <Btn className="py-1.5 text-[12.5px]" color="#8b93b8" active={!legacy} onClick={() => setLegacy(null)}>
            안 받기
          </Btn>
          {hof.slice(0, 8).map((h) => {
            const on = legacy?.id === h.id;
            const sk = (h.skills ?? []).filter(inheritable);
            return (
              <div key={h.id} className="rounded-lg border px-2 py-1" style={{ borderColor: on ? ACCENT : "rgba(255,255,255,0.12)", background: on ? `${ACCENT}1f` : "rgba(0,0,0,0.25)" }}>
                <button type="button" className="flex w-full cursor-pointer items-center gap-2 text-left" onClick={() => setLegacy({ id: h.id, skill: sk[0] })}>
                  <span className={`${font.title} text-[15px]`}>{h.grade}</span>
                  <span className="text-[13px] font-bold">{h.name}</span>
                  <span className="text-[11px] text-white/50">{TYPES[h.type].name} · {h.ovr}</span>
                </button>
                {on && (
                  <div className="mt-1">
                    <div className="text-[10.5px] text-white/55">
                      시작 능력치 +{(["hit", "power", "run"] as StatKey[]).map((k) => legacyBonus(h.stats[k])).join("/")}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {sk.length ? (
                        sk.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="cursor-pointer rounded border px-1.5 text-[10.5px]"
                            style={{ borderColor: legacy?.skill === s ? "#ffd23f" : "rgba(255,255,255,0.2)", color: legacy?.skill === s ? "#ffd23f" : "#fff" }}
                            onClick={() => setLegacy({ id: h.id, skill: s })}
                            title={skill(s).desc}
                          >
                            {skill(s).name}
                          </button>
                        ))
                      ) : (
                        <span className="text-[10.5px] text-white/40">물려줄 특수능력 없음</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!hof.length && <div className="text-[11.5px] text-white/40">아직 은퇴한 선수가 없어요 — 첫 선수가 은퇴하면 열려요</div>}
          {lg && lg.skills === undefined && <div className="text-[10.5px] text-white/40">예전 기록이라 특수능력 정보가 없어요</div>}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── 가이드 힌트 (처음 한 번씩) ─────────────── */

const HINT_KEY = "pxb:hint:";
export function seenHint(k: string) {
  try {
    return localStorage.getItem(HINT_KEY + k) === "1";
  } catch {
    return true;
  }
}
export function markHint(k: string) {
  try {
    localStorage.setItem(HINT_KEY + k, "1");
  } catch {}
}
/** 처음 보는 화면이면 아래쪽에 한 번 뜨는 설명 */
export function Hint({ k, title, children }: { k: string; title: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장값 확인
    setShow(!seenHint(k));
  }, [k]);
  if (!show) return null;
  return (
    <div className="absolute bottom-[78px] left-1/2 z-20 w-[560px] -translate-x-1/2 rounded-2xl border-2 border-[#ffd23f]/70 bg-[#141a35]/97 px-4 py-3 shadow-2xl" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-3">
        <span className="text-[26px] leading-none">💡</span>
        <div className="flex-1 text-left">
          <div className={`${font.title} text-[17px] text-[#ffd23f]`}>{title}</div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-white/85">{children}</div>
        </div>
        <Btn
          className="shrink-0 px-3 py-1.5 text-[13px]"
          color="#ffd23f"
          onClick={() => {
            markHint(k);
            setShow(false);
          }}
        >
          알겠어요
        </Btn>
      </div>
    </div>
  );
}


/* ─────────────── 도움말 ─────────────── */

const GUIDE: [string, string][] = [
  ["하루 흐름", "캠프 · 비시즌은 하루마다, 시즌은 2경기마다 관리 턴이 와요. 지도에서 장소를 눌러 행동하고, 다 했으면 「경기 진행 ▶ / 다음 날 ▶」."],
  ["⚡ 행동력", "행동마다 행동력을 써요 (훈련 4 · 필살 훈련 5 · 만남 5 · 쉬기 3). 경기마다 +3, 캠프 · 비시즌 하루마다 +6. 남은 건 다음으로 넘어가요."],
  ["훈련 · 부상", "훈련 버튼에 대성공 · 실패 · 부상 확률이 나와요. 체력 40 아래부터 부상이 확 늘어요. 얼굴이 붙은 훈련은 「함께 훈련」 — 효율 ×1.3 이상."],
  ["인연", "덱 3명이 지도에 ❗ 로 나와요. 만남마다 이야기 → 축복 → 대결 → … → 필살 전수 대결. 대답이 그 사람답다면 「이해」가 쌓여 특별한 답 · 축복 Lv2 시작이 열려요."],
  ["특수능력 · 세트 · 양날", "시즌 끝 · S 평가 · 퀴즈쇼에서 3장 중 1장. 같은 태그 3장이면 세트 효과. 주황 테두리 = 좋은 점과 나쁜 점이 같이 있는 양날 카드."],
  ["경기", "직접 · 하이라이트(찬스 타석만) · 자동. 잘 칠수록 경기 평가(S ~ D)가 높아져 성장 배율이 커져요. 경기 중에도 「남은 타석」 방식을 바꿀 수 있어요 (다음 타석부터)."],
  ["코치진", "타격 · 근력 · 주루 코치는 그 훈련과 그 능력치 한계를, 치어리더는 휴식 회복을 올려 줘요. 지금은 모두 C(기본)."],
  ["은퇴 · 다음 선수", "7년차부터 은퇴를 고를 수 있어요. 은퇴하면 명예의 전당 · 인연 레벨이 쌓이고, 다음 선수에게 「선배의 유산」(특수능력 1개 + 능력치 조금)을 물려줄 수 있어요."],
];
export function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal w={720} onClose={onClose}>
      <div className="mb-2 flex items-center justify-between">
        <div className={`${font.title} text-[26px]`}>❔ 도움말</div>
        <Btn space className="px-3 py-1 text-[13px]" color="#8b93b8" onClick={onClose}>
          닫기
        </Btn>
      </div>
      <div className="grid grid-cols-2 gap-2 text-left">
        {GUIDE.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
            <div className={`${font.title} text-[16px] text-[#ffd23f]`}>{t}</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-white/80">{d}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
