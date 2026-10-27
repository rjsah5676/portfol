"use client";

/*
 * 구단 관리 — 왼쪽 타선 · 투수진 · 스태프 칸, 오른쪽 카드 목록 (종류 · 등급 거르기).
 * 칸을 누르고 카드를 누르면 바뀜 (카드 먼저 → 칸 도 됨). PC 는 카드를 칸으로 끌어도 됨.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useNick } from "@/lib/AuthContext";
import { clubDefById } from "@/lib/baseball/data";
import {
  AREA_KIND,
  BUFF_NAME,
  GRADES,
  KIND_NAME,
  POS_NAME,
  buffOf,
  cardById,
  clearSlot,
  gradeOf,
  nextStarter,
  ovrOf,
  placeCard,
  staffBuffs,
  swapSlots,
  teamRating,
  whereIs,
  type Area,
  type Card,
  type CardKind,
  type Club,
  type Grade,
} from "@/lib/baseball/club";
import { ACCENT, Btn, font } from "./ui";
import { CardView, Emblem, GradeChip, cardSub } from "./clubUi";
import { sfx } from "./sfx";

type At = { area: Area; i: number };
const same = (a: At | null, b: At) => !!a && a.area === b.area && a.i === b.i;

/** 칸 이름 (카드 위 표시) */
function slotTag(at: At | null): string | undefined {
  if (!at) return undefined;
  if (at.area === "lineup") return `${at.i + 1}번`;
  if (at.area === "bench") return "후보";
  if (at.area === "rotation") return `선발${at.i + 1}`;
  if (at.area === "bullpen") return "불펜";
  if (at.area === "closer") return "마무리";
  if (at.area === "coach") return "코치";
  return "응원";
}

/** 위 띠: 엠블럼 · 구단 이름 · 구단주 · 팀 평점 · 코인 */
export function ClubHeader({ club, coin, title, onBack, right }: { club: Club; coin: number; title?: string; onBack: () => void; right?: ReactNode }) {
  const nick = useNick();
  const def = clubDefById(club.teamId);
  const r = teamRating(club);
  return (
    <div className="flex h-[58px] shrink-0 items-center gap-3 border-b border-white/10 px-4" style={{ background: `linear-gradient(90deg, ${def.dark} 0%, rgba(11,14,28,0.85) 55%)` }}>
      <Emblem def={def} size={42} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`${font.title} text-[21px] leading-none text-white`}>{def.name}</span>
          {title && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{title}</span>}
        </div>
        <div className="mt-1 text-[11px] text-white/55">
          구단주 <b className="text-white/85">{nick ?? "게스트"}</b>
          {!nick && <span className="ml-1 text-white/40">(이 브라우저에 저장)</span>}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {right}
        <Stat label="팀 평점">
          <span className="flex items-center gap-1">
            <GradeChip g={gradeOf(r)} />
            <span className={`${font.title} text-[20px]`} style={{ color: ACCENT }}>
              {r}
            </span>
          </span>
        </Stat>
        <Stat label="코인">
          <span className="font-mono text-[15px] font-bold text-[#ffd23f]">{coin.toLocaleString()}</span>
        </Stat>
        <Btn className="ml-1 px-4 py-1.5 text-sm" color="#8b93b8" onClick={onBack}>
          ← 뒤로
        </Btn>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-[42px] min-w-[74px] flex-col items-center justify-center rounded-lg border border-white/10 bg-black/30 px-2.5">
      <span className="text-[10px] leading-none text-white/50">{label}</span>
      <span className="mt-0.5 leading-none">{children}</span>
    </div>
  );
}

type Tab = "bat" | "pit" | "staff";
type KindF = CardKind | "all";

export default function ClubScreen({ club, coin, onChange, onBack }: { club: Club; coin: number; onChange: (c: Club) => void; onBack: () => void }) {
  const def = clubDefById(club.teamId);
  const [tab, setTab] = useState<Tab>("bat");
  const [sel, setSel] = useState<At | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [kindF, setKindF] = useState<KindF>("bat");
  const [gradeF, setGradeF] = useState<Grade | "all">("all");
  const [sort, setSort] = useState<"ovr" | "name">("ovr");
  const [flash, setFlash] = useState<string | null>(null);

  const say = (t: string) => {
    setFlash(t);
    window.setTimeout(() => setFlash((f) => (f === t ? null : f)), 1800);
  };
  const apply = (next: Club, msg?: string) => {
    if (next === club) {
      sfx.ui();
      say("그 자리엔 넣을 수 없어요");
      return;
    }
    sfx.ui();
    onChange(next);
    if (msg) say(msg);
  };

  const tapSlot = (at: At) => {
    if (pick) {
      const c = cardById(club, pick);
      setPick(null);
      if (c && c.kind === AREA_KIND[at.area]) apply(placeCard(club, at, c.id), `${c.name} → ${slotTag(at)}`);
      else say(`${KIND_NAME[AREA_KIND[at.area]]} 칸이에요`);
      return;
    }
    if (same(sel, at)) {
      setSel(null);
      return;
    }
    if (sel && AREA_KIND[sel.area] === AREA_KIND[at.area]) {
      apply(swapSlots(club, sel, at), "자리를 바꿨어요");
      setSel(null);
      return;
    }
    sfx.ui();
    setSel(at);
    setKindF(AREA_KIND[at.area]);
  };
  const tapCard = (c: Card) => {
    if (sel) {
      if (c.kind !== AREA_KIND[sel.area]) {
        say(`${KIND_NAME[AREA_KIND[sel.area]]} 카드를 골라 주세요`);
        return;
      }
      const at = sel;
      setSel(null);
      apply(placeCard(club, at, c.id), `${c.name} → ${slotTag(at)}`);
      return;
    }
    sfx.ui();
    setPick((p) => (p === c.id ? null : c.id));
    setTab(c.kind === "bat" ? "bat" : c.kind === "pit" ? "pit" : "staff");
  };
  const dropOn = (at: At, cardId: string, fromSlot?: string) => {
    setSel(null);
    setPick(null);
    if (fromSlot) {
      const [a, i] = fromSlot.split(":");
      apply(swapSlots(club, { area: a as Area, i: Number(i) }, at), "자리를 바꿨어요");
    } else apply(placeCard(club, at, cardId), "배치했어요");
  };

  const list = useMemo(() => {
    const l = club.cards.filter((c) => (kindF === "all" || c.kind === kindF) && (gradeF === "all" || gradeOf(ovrOf(c)) === gradeF));
    return l.sort((a, b) => (sort === "ovr" ? ovrOf(b) - ovrOf(a) : a.name.localeCompare(b.name, "ko")));
  }, [club.cards, kindF, gradeF, sort]);
  const counts = useMemo(() => {
    const n: Record<KindF, number> = { all: club.cards.length, bat: 0, pit: 0, coach: 0, cheer: 0 };
    for (const c of club.cards) n[c.kind]++;
    return n;
  }, [club.cards]);

  const selCard = sel ? cardById(club, club.slots[sel.area][sel.i]) : undefined;
  const pickCard = pick ? cardById(club, pick) : undefined;
  const buffs = staffBuffs(club);
  const sp = nextStarter(club);

  const slot = (at: At, label: ReactNode, extra?: ReactNode, compact?: boolean) => (
    <SlotRow
      key={`${at.area}${at.i}`}
      at={at}
      club={club}
      label={label}
      extra={extra}
      compact={compact}
      selected={same(sel, at)}
      target={!!(pickCard && pickCard.kind === AREA_KIND[at.area]) || !!(sel && !same(sel, at) && AREA_KIND[sel.area] === AREA_KIND[at.area])}
      teamColor={def.color}
      onTap={() => tapSlot(at)}
      onDrop={dropOn}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <ClubHeader
        club={club}
        coin={coin}
        title="구단 관리"
        onBack={onBack}
        right={
          <div className="mr-1 text-right text-[11px] leading-tight text-white/55">
            대전 {club.record.w}승 {club.record.l}패{club.record.d ? ` ${club.record.d}무` : ""}
            <span className="block">
              대전 점수 <b className="text-white/85">{club.record.rating}</b>
            </span>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 gap-3 px-3 pt-2.5 pb-3">
        {/* ── 왼쪽: 칸 ── */}
        <div className="flex w-[404px] shrink-0 flex-col rounded-xl border border-white/10 bg-black/25 p-2">
          <div className="mb-1.5 grid grid-cols-3 gap-1.5">
            {(
              [
                ["bat", "타선 · 후보"],
                ["pit", "투수진"],
                ["staff", "코치 · 응원"],
              ] as [Tab, string][]
            ).map(([t, n]) => (
              <Btn
                key={t}
                active={tab === t}
                className="py-1 text-[13px]"
                color={t === "bat" ? ACCENT : t === "pit" ? "#7ad7ff" : "#ff8ad1"}
                onClick={() => {
                  setTab(t);
                  setSel(null);
                  setKindF(t === "staff" ? "coach" : t);
                }}
              >
                {n}
              </Btn>
            ))}
          </div>

          {tab === "bat" && (
            <div className="flex min-h-0 flex-1 flex-col gap-[3px]">
              {club.slots.lineup.map((_, i) =>
                slot(
                  { area: "lineup", i },
                  <span className="flex items-center gap-1">
                    <span className={`${font.title} w-[18px] text-center text-[15px]`} style={{ color: ACCENT }}>
                      {i + 1}
                    </span>
                    <span className="w-[30px] rounded bg-white/10 text-center font-mono text-[10.5px] font-bold text-white/85" title={POS_NAME[club.lpos[i]]}>
                      {club.lpos[i]}
                    </span>
                  </span>
                )
              )}
              <div className="mt-1 text-[11px] font-bold text-white/50">후보</div>
              <div className="grid grid-cols-2 gap-[3px]">
                {club.slots.bench.map((_, i) => slot({ area: "bench", i }, <span className="w-[22px] text-center text-[10.5px] font-bold text-white/45">후{i + 1}</span>, undefined, true))}
              </div>
            </div>
          )}

          {tab === "pit" && (
            <div className="flex min-h-0 flex-1 flex-col gap-[3px]">
              <div className="flex items-center justify-between text-[11px] font-bold text-white/50">
                <span>선발 로테이션</span>
                {sp && <span className="font-normal text-white/60">다음 경기 선발 · <b className="text-[#7ad7ff]">{sp.name}</b></span>}
              </div>
              {club.slots.rotation.map((id, i) =>
                slot(
                  { area: "rotation", i },
                  <span className="w-[44px] text-[11px] font-bold text-[#7ad7ff]">선발{i + 1}</span>,
                  sp && id === sp.id ? <span className="rounded bg-[#7ad7ff] px-1 text-[9.5px] font-bold text-[#111]">다음</span> : undefined
                )
              )}
              <div className="mt-1 text-[11px] font-bold text-white/50">불펜</div>
              {club.slots.bullpen.map((_, i) => slot({ area: "bullpen", i }, <span className="w-[44px] text-[11px] font-bold text-white/60">불펜{i + 1}</span>))}
              <div className="mt-1 text-[11px] font-bold text-white/50">마무리</div>
              {slot({ area: "closer", i: 0 }, <span className="w-[44px] text-[11px] font-bold text-[#ff7a7a]">마무리</span>)}
            </div>
          )}

          {tab === "staff" && (
            <div className="flex min-h-0 flex-1 flex-col gap-[3px]">
              <div className="text-[11px] font-bold text-white/50">코치</div>
              {club.slots.coach.map((_, i) => slot({ area: "coach", i }, <span className="w-[30px] text-[11px] font-bold text-white/60">{i < 3 ? "타자" : "투수"}</span>))}
              <div className="mt-1 text-[11px] font-bold text-white/50">치어리더</div>
              {club.slots.cheer.map((_, i) => slot({ area: "cheer", i }, <span className="w-[30px] text-[11px] font-bold text-[#ff8ad1]">응원</span>))}
              <div className="mt-auto rounded-lg border border-[#7dff9a]/30 bg-[#7dff9a]/[0.06] p-2 text-[11.5px] leading-relaxed text-white/80">
                <b className="text-[#7dff9a]">코치 보너스 합계</b> (경기 출전 선수 전원 · 치어리더 효과는 준비 중)
                <div className="mt-0.5 flex flex-wrap gap-x-3">
                  {(Object.keys(buffs) as (keyof typeof buffs)[]).map((k) => (
                    <span key={k}>
                      {BUFF_NAME[k]} <b className="font-mono text-[#7dff9a]">+{buffs[k]}</b>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 오른쪽: 카드 목록 ── */}
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-white/10 bg-black/25 p-2">
          <div className="flex items-center gap-1">
            {(["all", "bat", "pit", "coach", "cheer"] as KindF[]).map((k) => (
              <Btn key={k} active={kindF === k} className="px-2.5 py-1 text-[12px]" color="#7ad7ff" onClick={() => setKindF(k)}>
                {k === "all" ? "전체" : KIND_NAME[k]} <span className="font-mono text-[10px] opacity-70">{counts[k]}</span>
              </Btn>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <Btn className="px-2 py-1 text-[11px]" color="#8b93b8" onClick={() => setSort((s) => (s === "ovr" ? "name" : "ovr"))}>
                {sort === "ovr" ? "종합순" : "이름순"}
              </Btn>
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <span className="mr-0.5 text-[11px] text-white/50">등급</span>
            {(["all", ...GRADES] as (Grade | "all")[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  sfx.ui();
                  setGradeF(g);
                }}
                className={`cursor-pointer rounded-md px-1 py-0.5 ${gradeF === g ? "bg-white/20 ring-1 ring-white/70" : "opacity-70 hover:opacity-100"}`}
              >
                {g === "all" ? <span className="px-1 text-[11px] font-bold text-white">전체</span> : <GradeChip g={g} />}
              </button>
            ))}
          </div>

          {/* 안내 띠 */}
          <div className="mt-1.5 flex h-[30px] shrink-0 items-center gap-2 rounded-lg bg-white/[0.05] px-2 text-[11.5px] text-white/75">
            {flash ? (
              <span className="font-bold text-[#7dff9a]">{flash}</span>
            ) : sel ? (
              <>
                <span>
                  <b className="text-[#ffd23f]">{slotTag(sel)}</b> {selCard ? `${selCard.name} 자리` : "빈 칸"} — 바꿀 {KIND_NAME[AREA_KIND[sel.area]]} 카드나 같은 종류 칸을 누르세요
                </span>
                {selCard && sel.area !== "lineup" && (
                  <Btn
                    className="ml-auto px-2 py-0.5 text-[11px]"
                    color="#ff7a7a"
                    onClick={() => {
                      apply(clearSlot(club, sel), "칸을 비웠어요");
                      setSel(null);
                    }}
                  >
                    빼기
                  </Btn>
                )}
                <Btn className={`${selCard && sel.area !== "lineup" ? "" : "ml-auto"} px-2 py-0.5 text-[11px]`} color="#8b93b8" onClick={() => setSel(null)}>
                  취소
                </Btn>
              </>
            ) : pickCard ? (
              <>
                <span>
                  <b className="text-[#ffd23f]">{pickCard.name}</b> ({cardSub(pickCard)}) — 넣을 칸을 왼쪽에서 누르세요
                </span>
                <Btn className="ml-auto px-2 py-0.5 text-[11px]" color="#8b93b8" onClick={() => setPick(null)}>
                  취소
                </Btn>
              </>
            ) : (
              <span>칸을 누르고 카드를 누르면 교체 · 칸끼리 누르면 순서 바꾸기 · PC 는 카드를 칸으로 끌어도 돼요</span>
            )}
          </div>

          <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto pr-1" style={{ touchAction: "pan-y" }}>
            {list.length ? (
              <div className="grid grid-cols-4 gap-2">
                {list.map((c) => {
                  const w = whereIs(club, c.id);
                  return (
                    <CardView
                      key={c.id}
                      card={c}
                      tag={slotTag(w) ?? "대기"}
                      teamColor={def.color}
                      selected={pick === c.id || (!!selCard && selCard.id === c.id)}
                      dim={!!sel && c.kind !== AREA_KIND[sel.area]}
                      draggable
                      onClick={() => tapCard(c)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-[13px] text-white/50">
                이 조건의 카드가 없어요
                <span className="text-[11.5px] text-white/35">B 등급 이상 카드는 육성 모드 은퇴 선수(명예의 전당)로 얻어요 · 카드팩은 개발 예정</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 왼쪽 한 줄 (칸) */
function SlotRow({
  at,
  club,
  label,
  extra,
  compact,
  selected,
  target,
  teamColor,
  onTap,
  onDrop,
}: {
  at: At;
  club: Club;
  label: ReactNode;
  extra?: ReactNode;
  compact?: boolean;
  selected: boolean;
  target: boolean;
  teamColor: string;
  onTap: () => void;
  onDrop: (at: At, cardId: string, fromSlot?: string) => void;
}) {
  const [over, setOver] = useState(false);
  const c = cardById(club, club.slots[at.area][at.i]);
  const ovr = c ? ovrOf(c) : 0;
  const staff = !!c && (c.kind === "coach" || c.kind === "cheer");
  const g = c && (c.kind === "coach" || c.kind === "cheer") ? c.grade : gradeOf(ovr);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!!c}
      onDragStart={(e) => {
        if (!c) return;
        e.dataTransfer.setData("text/pxb-card", c.id);
        e.dataTransfer.setData("text/pxb-slot", `${at.area}:${at.i}`);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/pxb-card");
        const from = e.dataTransfer.getData("text/pxb-slot") || undefined;
        if (id) onDrop(at, id, from);
      }}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onTap();
      }}
      className={`flex ${compact ? "h-[32px]" : "h-[33px]"} min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border px-1.5 transition-colors select-none`}
      style={{
        borderColor: selected ? "#ffd23f" : over ? "#7dff9a" : target ? "rgba(125,255,154,0.45)" : "rgba(255,255,255,0.08)",
        background: selected ? "rgba(255,210,63,0.16)" : over ? "rgba(125,255,154,0.14)" : target ? "rgba(125,255,154,0.05)" : "rgba(255,255,255,0.03)",
        boxShadow: selected ? "0 0 12px rgba(255,210,63,0.35)" : undefined,
      }}
    >
      {label}
      {c ? (
        <>
          <span className="h-[18px] w-[3px] shrink-0 rounded-full" style={{ background: teamColor }} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-white">
            {c.name}
            {c.kind === "bat" && c.hof && <span className="ml-1 text-[9px] text-[#ffcf3a]">★전당</span>}
          </span>
          {!compact && <span className="shrink-0 text-[10px] text-white/50">{rowInfo(c)}</span>}
          {extra}
          <GradeChip g={g} />
          <span className="w-[28px] shrink-0 text-right font-mono text-[12px] font-bold text-white/90">{staff ? "" : ovr}</span>
        </>
      ) : (
        <span className="flex-1 text-[11.5px] text-white/35">빈 칸 — 눌러서 넣기</span>
      )}
    </div>
  );
}

function rowInfo(c: Card): string {
  if (c.kind === "bat") return `${c.pos} ${c.bats === "R" ? "우" : "좌"}타 · 맞${c.hit} 파${c.power}`;
  if (c.kind === "pit") return `${c.throws === "R" ? "우" : "좌"}투 ${c.velo}km · 제${c.control} 변${c.brk}`;
  if (c.kind === "cheer") return `${c.title} · 효과 준비 중`;
  return `${c.title} · ${c.buff.map((b) => `${BUFF_NAME[b]}+${buffOf(c)}`).join(" ")}`;
}
