"use client";

/*
 * 육성 — 픽셀파이트 인연 화면들: 미연시 장면 · 인연 현황 · 인연 축복 고르기 · 인연 대결 · 덱 고르기(만들기) · 가이드 힌트.
 * 규칙은 lib/baseball/career.ts (+ 대사 bonds.ts).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BOND_IDS, ROLE_NAME, heartName, type BondId } from "@/lib/baseball/bonds";
import {
  BEATS, BEAT_NAME, BOND_MAX, BOON_MUL, DECK_SIZE, STAT_NAME, TAG_NAME, TYPES, VISIT_AFF, VISIT_SEASON,
  autoBattle, boonLv, inheritable, legacyBonus, nextBeat, roleOf, skill, tagCount,
  type BatType, type Career, type HofEntry, type SkillId, type StatKey, type TurnOut,
} from "@/lib/baseball/career";
import { BONDS } from "@/lib/baseball/career";
import { charById, faceUrl, type CharId } from "@/lib/baseball/data";
import { makeRng } from "@/lib/baseball/rng";
import { ACCENT, Btn, Modal, font } from "./ui";
import { sfx } from "./sfx";

export const artUrl = (id: string) => `/fight/art/${id}.webp`;
const ROLE_COLOR = { friend: "#7ad7ff", sister: "#7dff9a", crush: "#ff7ae0" } as const;
const BEAT_ICON = { talk: "💬", boon: "✨", mini: "⚾", final: "🔥" } as const;

/* ─────────────── 미연시 장면 ─────────────── */

/**
 * 전신 그림(안 잘리게 contain) + 대화창. 줄은 눌러서 넘기고, 끝나면 고르기 또는 결과.
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
}: {
  char: CharId;
  skin?: string;
  lines: string[];
  title?: string;
  choices?: string[];
  onChoose?: (i: number) => void;
  result?: TurnOut;
  onDone?: () => void;
}) {
  const ch = charById(char);
  const [i, setI] = useState(0);
  const end = i >= lines.length - 1;
  const line = lines[Math.min(i, lines.length - 1)] ?? "";
  // "이름: 대사" 꼴이면 이름표로
  const m = /^(.{1,6}): (.*)$/.exec(line);
  const speaker = m ? m[1] : null;
  const text = m ? m[2] : line;
  const next = () => {
    if (!end) {
      sfx.ui();
      setI((v) => v + 1);
    } else if (!choices && onDone) onDone();
  };
  return (
    <div
      className="absolute inset-0 z-40 cursor-pointer select-none"
      style={{ background: `radial-gradient(ellipse at 70% 40%, ${ch.color}33 0%, #0b0e1c 65%), #0b0e1c` }}
      onPointerDown={(e) => {
        e.stopPropagation();
        next();
      }}
    >
      {/* 전신 (머리 · 손 안 잘리게) */}
      <img
        src={artUrl(skin ?? char)}
        alt={ch.name}
        className="pointer-events-none absolute right-[40px] bottom-[18px] h-[500px] w-auto object-contain drop-shadow-[0_0_30px_rgba(0,0,0,0.7)]"
      />
      {!end && lines.length > 1 && (
        <button
          type="button"
          className="absolute top-4 right-5 z-10 cursor-pointer rounded-lg border border-white/20 bg-black/60 px-3 py-1 text-[12.5px] text-white/80"
          onPointerDown={(e) => {
            e.stopPropagation();
            sfx.ui();
            setI(lines.length - 1);
          }}
        >
          건너뛰기 ⏭
        </button>
      )}
      {title && (
        <div className="absolute top-4 left-5 rounded-xl border border-white/15 bg-black/60 px-4 py-1.5">
          <span className={`${font.title} text-[20px]`} style={{ color: ch.color }}>
            {title}
          </span>
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
              <Btn key={k} className="px-4 py-2 text-left text-[15px]" color={ch.color} onClick={() => onChoose?.(k)}>
                {t}
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
        <Btn className="px-3 py-1 text-[13px]" color="#8b93b8" onClick={onClose}>
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
    </Modal>
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
      <div className="mt-3 grid grid-cols-3 gap-3">
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
    </Modal>
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
        <div className="mt-0.5 text-[11.5px] text-white/50">덱에 넣은 사람만 지도에 나타나고 · 자기 훈련에 「함께 훈련」 하러 와요 (효율 ×1.2~). 듀오 축복은 덱 조합으로 열려요.</div>
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
                      시작 능력치 +{(["hit", "power", "run", "def"] as StatKey[]).map((k) => legacyBonus(h.stats[k])).join("/")}
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

