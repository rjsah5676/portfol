"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { buyItem } from "@/lib/api/points";
import { ITEM_ART, RELIC_ART } from "@/lib/defense/assets";
import {
  GP_SHOP,
  CORE_EXCHANGE,
  GLITCH,
  GLITCH_UNLOCK_WAVE,
  collectReward,
  glitchFirstClear,
  lvCost,
  LV_DMG,
  LV_BUFF,
  planUpAll,
  relicDesc,
  relicUpCost,
  RELIC_MAX_LV,
  resDesc,
  resUpCost,
  RES_MAX_LV,
  PASS,
  PASS_PREMIUM_GP,
  RELIC,
  RELICS,
  RELIC_CORE_PRICE,
  RELIC_SLOTS,
  RES,
  RESEARCH,
  RES_SLOTS,
  THEME,
  THEMES,
  UNIT_MAX_LV,
  type PassReward,
  BOX,
  BENCH_BASE,
  BENCH_COST,
  BENCH_MAX,
  FRES_COST,
  FRES_MAX,
  TRANS_IDS,
  relicPassive,
  RELIC_PASSIVE,
} from "@/lib/defense/progress";
import { shopFor } from "@/lib/points";
import {
  FACTION_COLOR,
  FACTION_NAME,
  GRADE_COLOR,
  GRADE_NAME,
  UNIT,
  UNITS,
  type Faction,
} from "@/lib/defense/units";
import { meta, type DefenseProfile, type QuestRow } from "@/realtime/defense";
import { sfx } from "./audio";
import { Bar, Btn, FactionIcon, Icon, SoundButton, FsButton, TITLE, Tip, UnitIcon, fmtNum } from "./ui";

/*
 * 정비소 — 판 밖 성장 화면 (무대 1024×576 통째로).
 *  출전 준비(연구 · 유물 장착 · 오염 단계 · 블록 테마) · 유닛 강화 · 연구 · 유물 · 상점(상자 3종 · 칸 해금 · GP) · 미션 · 시즌 패스
 * 값은 모두 서버(defenseMeta)가 정하고 돌려준 프로필로 다시 그림 — 화면은 보여 주기 · 요청만.
 */

export type HubTab = "load" | "units" | "res" | "relic" | "shop" | "quest" | "pass";
const TABS: { k: HubTab; name: string; icon: string }[] = [
  { k: "load", name: "출전 준비", icon: "star" },
  { k: "units", name: "유닛 강화", icon: "up" },
  { k: "res", name: "연구", icon: "flask" },
  { k: "relic", name: "유물", icon: "relic" },
  { k: "shop", name: "상점", icon: "chest" },
  { k: "quest", name: "미션", icon: "note" },
  { k: "pass", name: "시즌 패스", icon: "ticket" },
];

const TIER_NAME = ["일반", "희귀", "전설"];
const TIER_COLOR = ["#a69cc9", "#5ff2ff", "#ffd23f"];

/** 재화 한 칸 (그림이 있으면 그림) */
type CurK = "piece" | "core" | "gp" | "card" | "cardbox" | "relicbox" | "shard" | "trans";
/** 그림이 아직 없는 재화는 비슷한 도트 아이콘으로 */
const CUR_ICON: Partial<Record<CurK, string>> = { cardbox: "chest", relicbox: "chest", shard: "relic", trans: "star" };
export function Cur({ k, n, size = 16, className = "" }: { k: CurK; n: ReactNode; size?: number; className?: string }) {
  // 그림은 클 때만 (작게 줄이면 뭉개져서 알아보기 어려움 → 작은 곳은 도트 아이콘)
  const art = size >= 20 ? ITEM_ART[k] : undefined;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {art ? <img src={art} alt="" width={size} height={size} className="shrink-0" /> : <Icon n={CUR_ICON[k] ?? k} size={size} />}
      <b>{n}</b>
    </span>
  );
}
const CUR_NAME = { piece: "픽셀 조각", core: "글리치 코어", gp: "GP", card: "카드", cardbox: "카드 상자", relicbox: "유물 상자", shard: "유물 조각", trans: "초월 소환" };
/** 재화 설명 (어디서 얻고 어디에 쓰는지) — 말풍선 · title */
export const CUR_INFO: Record<keyof typeof CUR_NAME, { get: string; use: string }> = {
  piece: {
    get: "회원 판 보상 (웨이브 · 보스 · 클리어, 오염 단계가 높을수록 많이) · 오늘 첫 판 ×2 · 미션 · 시즌 패스 · 처음 얻은 유닛(도감)",
    use: "유닛 강화 · 연구 열기 · 카드 상자 · 보관함 칸 해금",
  },
  core: {
    get: "클리어 (오염 단계가 높을수록 더) · 50웨이브 · 오염 단계 첫 클리어 · 주간 미션 · 시즌 패스 · 처음 얻은 신화/히든/초월 · GP 교환",
    use: "유물 상자 · 유물 바로 사기 · 유물 강화 · 세력 연구칸 · 초월 소환",
  },
  card: {
    get: "판에서 그 유닛을 얻으면 1장 (레전드 이상 2장, 한 판 최대 30장) · 카드 상자 · GP 카드 묶음 · 초월 소환에서 겹치면",
    use: "그 유닛 강화 (유닛마다 따로 모아요)",
  },
  cardbox: {
    get: `상점에서 픽셀 조각 ${BOX.card.pieces} · 시즌 패스 · 시작 선물`,
    use: `열면 무작위 유닛 카드 ${BOX.card.n}장 (낮은 등급이 잘 나와요)`,
  },
  relicbox: {
    get: `상점에서 글리치 코어 ${BOX.relic.cores} · GP 유물 상자 · 오염 단계 첫 클리어 · 시즌 패스`,
    use: "열면 유물 하나 — 새 유물이면 얻고, 가진 유물이면 그 유물 조각 +1",
  },
  shard: {
    get: "유물 상자에서 이미 가진 유물이 또 나오면 (그 유물 것)",
    use: "그 유물 레벨 올리기 (+ 글리치 코어)",
  },
  trans: {
    get: `상점에서 글리치 코어 ${BOX.trans.cores} 또는 GP ${BOX.trans.gp} (주 ${BOX.trans.gpPerWeek}번)`,
    use: "초월 셋 중 하나 — 처음이면 해금(판에서 신화 3기로 조합 가능), 겹치면 그 유닛 카드",
  },
  gp: {
    get: "사이트 공용 포인트 — 출석 · 업적 · 주간 도전 순위 보상",
    use: "글리치 코어 교환 · 시즌 패스 프리미엄 · 블록 테마 (다른 게임 상점과 같은 GP)",
  },
};
export const curTip = (k: keyof typeof CUR_NAME) => (
  <>
    <b className="text-white">{CUR_NAME[k]}</b>
    <br />
    <span className="text-[var(--green)]">얻는 곳</span> {CUR_INFO[k].get}
    <br />
    <span className="text-[var(--gold)]">쓰는 곳</span> {CUR_INFO[k].use}
  </>
);
export const curTitle = (k: keyof typeof CUR_NAME) => `${CUR_NAME[k]}\n얻는 곳: ${CUR_INFO[k].get}\n쓰는 곳: ${CUR_INFO[k].use}`;

export function RelicIcon({ id, size = 40, dim }: { id: string; size?: number; dim?: boolean }) {
  const r = RELIC[id];
  const art = RELIC_ART[id];
  const c = TIER_COLOR[r?.tier ?? 0];
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center bg-[#120d22]"
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 2px ${c}, 0 0 0 2px #0a0816`, opacity: dim ? 0.35 : 1 }}
    >
      {art ? <img src={art} alt="" width={size - 6} height={size - 6} /> : <Icon n="relic" size={Math.round(size * 0.6)} />}
    </span>
  );
}

function RewardLine({ r }: { r: PassReward & { xp?: number } }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
      {!!r.pieces && <Cur k="piece" n={r.pieces} size={13} />}
      {!!r.cores && <Cur k="core" n={r.cores} size={13} />}
      {!!r.cardBox && <Cur k="cardbox" n={r.cardBox} size={13} />}
      {!!r.relicBox && <Cur k="relicbox" n={r.relicBox} size={13} />}
      {!!r.gp && <Cur k="gp" n={fmtNum(r.gp)} size={13} />}
      {!!r.xp && <span className="text-[var(--cyan)]">+{r.xp} XP</span>}
      {r.item && <span className="text-[var(--gold)]">{THEME[r.item]?.name ?? r.item} 테마</span>}
    </span>
  );
}

const left = (t: number) => {
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000));
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${m}분`;
};

export default function Hub({
  profile: p,
  setProfile,
  onBack,
  tab: tab0 = "load",
}: {
  profile: DefenseProfile;
  setProfile(p: DefenseProfile): void;
  onBack(): void;
  tab?: HubTab;
}) {
  const [tab, setTab] = useState<HubTab>(tab0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  /** 서버에 요청하고 받은 프로필로 다시 그림 */
  const act = async (f: () => Promise<DefenseProfile>, ok?: string) => {
    if (busy) return null;
    setBusy(true);
    setErr("");
    try {
      const np = await f();
      setProfile(np);
      if (ok) sfx(ok);
      return np;
    } catch (e) {
      sfx("deny");
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const dots: Partial<Record<HubTab, number>> = {
    quest: [...p.quests.daily, ...p.quests.weekly].filter((q) => !q.claimed && q.value >= q.goal).length,
    pass: p.passTier - p.season.free.length + (p.season.premium ? p.passTier - p.season.prem.length : 0),
    shop: p.boxes.card + p.boxes.relic,
  };
  const ctx: TabProps = { p, act, busy };

  return (
    <div className="px-stars absolute inset-0 flex flex-col">
      <div className="dfn-scan pointer-events-none absolute inset-0 opacity-40" />
      {/* 머리 */}
      <div className="relative z-30 flex h-[58px] shrink-0 items-center gap-3 border-b-2 border-[#0a0816] bg-[#151029] px-4 shadow-[0_2px_0_0_#2a2350]">
        <Btn className="h-9 px-3 text-[13px]" onClick={onBack}>
          ◀ 메뉴
        </Btn>
        <h2 className={`${TITLE} px-shadow text-[24px]`}>정비소</h2>
        <div className="ml-4 flex items-center gap-4 text-[14px]">
          <Tip text={curTip("piece")}>
            <Cur k="piece" n={fmtNum(p.pieces)} />
          </Tip>
          <Tip text={curTip("core")} className="text-[#ffb3ee]">
            <Cur k="core" n={p.cores} />
          </Tip>
          <Tip text={curTip("gp")} className="text-[var(--green)]">
            <Cur k="gp" n={fmtNum(p.gp)} />
          </Tip>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SoundButton />
          <FsButton />
        </div>
      </div>
      <div className="relative z-10 flex min-h-0 flex-1">
        {/* 왼쪽 탭 */}
        <div className="flex w-[148px] shrink-0 flex-col gap-1.5 p-2.5">
          {TABS.map((t) => (
            <Btn
              key={t.k}
              tone={tab === t.k ? "main" : "ghost"}
              className="relative flex h-[38px] items-center gap-2 px-2.5 text-left text-[13px] font-bold"
              onClick={() => {
                setTab(t.k);
                setErr("");
              }}
            >
              <Icon n={t.icon} size={16} />
              {t.name}
              {!!dots[t.k] && dots[t.k]! > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] bg-[#ff4d6d] px-1 text-center text-[12px] leading-[16px] text-white shadow-[0_0_0_2px_#0a0816]">
                  {dots[t.k]}
                </span>
              )}
            </Btn>
          ))}
        </div>
        {/* 내용 */}
        <div className="px-win m-2.5 ml-0 flex min-w-0 flex-1 flex-col">
          {err && <p className="mx-3 mt-2 bg-[#3a0f1c] px-2 py-1 text-[12px] text-[#ff9ab0]">{err}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "load" && <LoadTab {...ctx} />}
            {tab === "units" && <UnitsTab {...ctx} />}
            {tab === "res" && <ResTab {...ctx} />}
            {tab === "relic" && <RelicTab {...ctx} />}
            {tab === "quest" && <QuestTab {...ctx} />}
            {tab === "pass" && <PassTab {...ctx} />}
            {tab === "shop" && <ShopTab {...ctx} />}
          </div>
        </div>
      </div>
    </div>
  );
}

interface TabProps {
  p: DefenseProfile;
  act(f: () => Promise<DefenseProfile>, ok?: string): Promise<DefenseProfile | null>;
  busy: boolean;
}

const H = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div className="mb-2 flex items-baseline gap-2">
    <h3 className={`${TITLE} px-shadow text-[16px]`}>{children}</h3>
    {sub && <span className="text-[12px] text-[var(--mute)]">{sub}</span>}
  </div>
);

/* ───────── 출전 준비 ───────── */

function LoadTab({ p, act, busy }: TabProps) {
  const L = p.load;
  const save = (load: DefenseProfile["load"]) => act(() => meta.setLoad(load));
  const isGen = (id: string) => RES[id]?.group === "general";
  const toggle = <K extends "res" | "relics">(k: K, id: string, max: number) => {
    const cur = L[k];
    // 연구는 공용 칸 · 세력 칸을 따로 셈
    const same = k === "res" ? cur.filter((x) => isGen(x) === isGen(id)) : cur;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : same.length < max ? [...cur, id] : null;
    if (!next) {
      sfx("deny");
      return;
    }
    void save({ ...L, [k]: next });
  };
  const g = GLITCH[L.glitch];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <H sub={`열린 단계 ${p.glitchOpen} · 0~9단계는 ${GLITCH_UNLOCK_WAVE}웨이브를 넘기면, 10단계부터는 클리어해야 다음 단계가 열려요`}>오염 단계</H>
        <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1">
          {GLITCH.map((x) => {
            const open = x.lv <= p.glitchOpen;
            const on = x.lv === L.glitch;
            const won = x.lv <= p.glitchWin;
            const fc = glitchFirstClear(x.lv);
            return (
              <Btn
                key={x.lv}
                tone={on ? "main" : x.lv > 10 && open ? "arcane" : "ghost"}
                disabled={!open || busy}
                title={open ? `${x.lv}단계 — ${x.rule}${won ? " · 클리어함" : ` · 첫 클리어: 코어 ${fc.cores} · 유물 상자 ${fc.relicBox}`}` : "잠김"}
                className="relative h-9 text-[13px] font-bold"
                onClick={() => void save({ ...L, glitch: x.lv })}
              >
                {open ? x.lv : <Icon n="lock" size={11} />}
                {won && <i className="absolute top-0.5 right-0.5 block h-1.5 w-1.5 bg-[var(--green)]" />}
              </Btn>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--mute)]">
          적 체력 <b className="text-[var(--text)]">×{g.hp}</b> · 속도 <b className="text-[var(--text)]">×{g.spd}</b>
          {g.bossSec ? (
            <>
              {" "}
              · 보스 시간 <b className="text-[#ff9ab0]">{g.bossSec}초</b>
            </>
          ) : null}{" "}
          {g.armor > 1 && (
            <>
              {" "}
              · 방어력 <b className="text-[var(--text)]">×{g.armor}</b>
            </>
          )}
          {g.boss > 1 && (
            <>
              {" "}
              · 보스 체력 <b className="text-[var(--text)]">×{g.boss}</b>
            </>
          )}{" "}
          · 보상 <b className="text-[var(--gold)]">×{g.reward}</b> · 시즌 랭킹 점수가 단계마다 크게 올라요
        </p>
        <p className="mt-0.5 text-[12px] text-[var(--dim)]">
          {L.glitch > p.glitchWin ? (
            <>
              이 단계 첫 클리어 보상: <Cur k="core" n={glitchFirstClear(L.glitch).cores} size={12} /> · <Cur k="relicbox" n={glitchFirstClear(L.glitch).relicBox} size={12} /> · 초록 점 = 클리어한 단계 · 11단계부터 심연 (방어력 · 보스 체력이 더 올라요)
            </>
          ) : (
            "초록 점 = 클리어한 단계 · 11단계부터 심연 (방어력 · 보스 체력이 더 올라요)"
          )}
        </p>
      </div>
      {(
        [
          ["공용 연구", true, RES_SLOTS, "공동 연구만 · 4칸"],
          ["세력 연구", false, p.fslots, p.fslots ? `기사단 · 기계공방 · 마도회 연구만 · ${p.fslots}칸` : "상점에서 세력 연구칸을 사면 기사단 · 기계공방 · 마도회 연구를 끼울 수 있어요"],
        ] as const
      ).map(([title, gen, max, sub]) => {
        const mine = p.res.filter((id) => isGen(id) === gen);
        const on = L.res.filter((id) => isGen(id) === gen).length;
        return (
          <div key={title}>
            <H sub={`장착 ${on}/${max} · ${sub}`}>{title}</H>
            {mine.length === 0 ? (
              <p className="text-[12px] text-[var(--dim)]">아직 연 {gen ? "공동" : "세력"} 연구가 없어요 — 연구 탭에서 픽셀 조각으로 열어요</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {mine.map((id) => {
                  const eq = L.res.includes(id);
                  return (
                    <Btn key={id} tone={eq ? "cyan" : "ghost"} disabled={busy || (!eq && max === 0)} className="px-2 py-1 text-left" onClick={() => toggle("res", id, max)}>
                      <b className="block text-[12px]">
                        {eq ? "■ " : "□ "}
                        {RES[id].name} <span className="text-[var(--gold)]">Lv.{p.resLv?.[id] ?? 1}</span>
                      </b>
                      <span className="block truncate text-[12px] opacity-75">{resDesc(id, p.resLv?.[id] ?? 1)}</span>
                    </Btn>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div>
        <H sub={`장착 ${L.relics.length}/${RELIC_SLOTS} · 가진 유물 보유 효과: 모든 피해 +${relicPassive(Object.fromEntries(p.relics.map((id) => [id, p.relicLv?.[id] ?? 1])))}% (장착 안 해도)`}>유물 장착</H>
        {p.relics.length === 0 ? (
          <p className="text-[12px] text-[var(--dim)]">아직 유물이 없어요 — 상자를 열거나 글리치 코어로 사요</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {p.relics.map((id) => {
              const on = L.relics.includes(id);
              const r = RELIC[id];
              return (
                <Btn key={id} tone={on ? "gold" : "ghost"} disabled={busy} className="flex items-center gap-2 px-2 py-1.5 text-left" onClick={() => toggle("relics", id, RELIC_SLOTS)}>
                  <RelicIcon id={id} size={34} />
                  <span className="min-w-0">
                    <b className="block text-[13px]">
                      {r.name} <span className="text-[var(--gold)]">Lv.{p.relicLv?.[id] ?? 1}</span>
                    </b>
                    <span className="block text-[12px] leading-tight opacity-80">{relicDesc(id, p.relicLv?.[id] ?? 1)}</span>
                  </span>
                </Btn>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <H sub="블록 윗면 · 돌길 색 (GP 상점 · 시즌 패스에서 얻어요)">블록 테마</H>
        <div className="flex flex-wrap gap-1.5">
          {THEMES.map((t) => {
            const own = p.themes.includes(t.id);
            return (
              <Btn
                key={t.id}
                tone={p.theme === t.id ? "main" : "ghost"}
                disabled={!own || busy}
                className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]"
                onClick={() => void act(() => meta.setTheme(t.id))}
              >
                <span className="flex">
                  {[0, 1, 2].map((i) => (
                    <i key={i} className="block h-3 w-3" style={{ background: t.top[i] || ["#1d4f7a", "#7a4612", "#4d2a82"][i] }} />
                  ))}
                </span>
                {own ? t.name : (
                  <>
                    <Icon n="lock" size={11} /> {t.name}
                  </>
                )}
              </Btn>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────── 유닛 강화 ───────── */

function UnitsTab({ p, act, busy }: TabProps) {
  const [fac, setFac] = useState<Faction>("knight");
  const list = UNITS.filter((u) => u.faction === fac).sort((a, b) => a.grade - b.grade);
  const [sel, setSel] = useState<string>(list[0]?.id ?? "");
  const u = UNIT[sel] && UNIT[sel].faction === fac ? UNIT[sel] : list[0];
  const lv = p.lv[u.id] ?? 0;
  const cost = lvCost(u.grade, lv);
  const back = lv > 0 ? lvCost(u.grade, lv - 1) : null;
  const cards = p.cards[u.id] ?? 0;
  const seen = new Set(p.seen ?? []);
  const collectable = UNITS.filter((x) => collectReward(x.grade));
  const all = planUpAll(UNITS, p.lv, p.cards, p.pieces);
  const one = planUpAll([u], p.lv, p.cards, p.pieces);
  return (
    <div className="flex h-full gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-1.5">
          {(["knight", "mech", "arcane", "hidden"] as Faction[]).map((f) => (
            <Btn key={f} tone={fac === f ? (f === "hidden" ? "cyan" : f) : "ghost"} className="h-8 px-3 text-[12px] font-bold" onClick={() => setFac(f)}>
              <FactionIcon f={f} size={12} className="mr-1" />
              {FACTION_NAME[f]}
            </Btn>
          ))}
          <Btn
            tone="main"
            disabled={busy || !all.n}
            silent
            className="ml-auto h-8 px-3 text-[12px] font-bold"
            title={all.n ? `모든 세력 유닛을 낮은 레벨부터 고르게 ${all.n}번 강화 — 조각 ${fmtNum(all.pieces)} 사용 (「−」로 하나씩 되돌릴 수 있어요)` : "지금 올릴 수 있는 유닛이 없어요"}
            onClick={() => void act(() => meta.unitUpAll(), "upgrade")}
          >
            일괄 강화{all.n ? ` ×${all.n}` : ""}
          </Btn>
        </div>
        <p className="mb-1.5 text-[12px] text-[var(--mute)]">
          도감 수집 <b className="text-[var(--gold)]">{collectable.filter((x) => seen.has(x.id)).length}</b>/{collectable.length} — 에픽 이상을 판에서 처음 얻으면 보상 (신화 · 히든은 코어도) ·{" "}
          <Tip text={curTip("card")} width={280}>
            <span className="cursor-pointer underline decoration-dotted">카드는 어디서?</span>
          </Tip>
        </p>
        <div className="grid grid-cols-6 gap-1.5">
          {list.map((x) => {
            const l = p.lv[x.id] ?? 0;
            const c = p.cards[x.id] ?? 0;
            const can = l < UNIT_MAX_LV && c >= lvCost(x.grade, l).cards;
            return (
              <button
                key={x.id}
                type="button"
                onPointerEnter={(e) => e.pointerType === "mouse" && sfx("ui-hover")}
                onClick={() => (sfx("ui-click"), setSel(x.id))}
                className={`px-inset relative flex flex-col items-center p-1 ${x.id === u.id ? "outline-2 outline-[var(--gold)]" : ""}`}
                style={{ "--b": GRADE_COLOR[x.grade] } as CSSProperties}
              >
                <UnitIcon id={x.id} size={46} dim={!c && !l && !seen.has(x.id)} />
                {!seen.has(x.id) && collectReward(x.grade) && (
                  <span className="absolute top-0.5 left-0.5 bg-[#ffd23f] px-0.5 text-[10px] leading-[12px] font-bold text-[#1a1000]" title="처음 얻으면 도감 수집 보상">
                    NEW
                  </span>
                )}
                <span className="text-[12px]" style={{ color: GRADE_COLOR[x.grade] }}>
                  Lv.{l}
                </span>
                {can && <i className="dfn-blink absolute top-0.5 right-0.5 block h-2 w-2 bg-[var(--green)]" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="px-inset flex w-[230px] shrink-0 flex-col items-center p-3 text-center" style={{ "--b": FACTION_COLOR[u.faction] } as CSSProperties}>
        <UnitIcon id={u.id} size={88} />
        <b className="mt-1 text-[15px]">{u.name}</b>
        <span className="text-[12px]" style={{ color: GRADE_COLOR[u.grade] }}>
          {GRADE_NAME[u.grade]} · {FACTION_NAME[u.faction]}
        </span>
        <p className={`${TITLE} mt-2 text-[22px] text-[var(--gold)]`}>Lv.{lv}</p>
        <p className="text-[12px] text-[var(--mute)]">
          판에서 피해 <b className="text-[var(--text)]">+{Math.round(lv * LV_DMG * 100)}%</b>
          {(u.aura || u.procs || u.execute) && (
            <>
              {" "}
              · 버프 · 둔화 · 확률 <b className="text-[var(--text)]">+{Math.round(lv * LV_BUFF * 100)}%</b>
            </>
          )}
        </p>
        {lv < UNIT_MAX_LV ? (
          <>
            <div className="mt-2 w-full">
              <div className="mb-0.5 flex justify-between text-[12px]">
                <Cur k="card" n={`${cards}/${cost.cards}`} size={12} />
                <Cur k="piece" n={cost.pieces} size={12} />
              </div>
              <Bar value={cards / cost.cards} color="#ffb347" h={6} />
            </div>
            <Btn
              tone="main"
              disabled={busy || cards < cost.cards || p.pieces < cost.pieces}
              className="mt-3 h-10 w-full text-[14px] font-bold"
              silent
              onClick={() => void act(() => meta.unitUp(u.id), "upgrade")}
            >
              + Lv.{lv + 1} 로 강화 (+{Math.round(LV_DMG * 100)}%)
            </Btn>
            {one.n > 1 && (
              <Btn
                disabled={busy}
                className="mt-1.5 h-8 w-full text-[12px]"
                silent
                onClick={() => void act(() => meta.unitUpAll(u.id), "upgrade")}
              >
                ++ Lv.{lv + one.n} 까지 한 번에 (조각 {fmtNum(one.pieces)})
              </Btn>
            )}
          </>
        ) : (
          <p className="mt-3 text-[13px] text-[var(--gold)]">최고 레벨!</p>
        )}
        {(() => {
          const n = p.gpBuys?.cards ?? 0;
          return (
            <Btn
              tone="cyan"
              disabled={busy || p.gp < GP_SHOP.cards.gp || n >= GP_SHOP.cards.perWeek}
              className="mt-1.5 h-8 w-full text-[12px]"
              silent
              title={`GP 로 이 유닛 카드 ${GP_SHOP.cards.n}장 (이번 주 ${n}/${GP_SHOP.cards.perWeek})`}
              onClick={() => void act(() => meta.gpCards(u.id), "upgrade")}
            >
              카드 {GP_SHOP.cards.n}장 · <Cur k="gp" n={GP_SHOP.cards.gp} size={12} /> ({n}/{GP_SHOP.cards.perWeek})
            </Btn>
          );
        })()}
        {back && (
          <Btn
            disabled={busy}
            className="mt-1.5 h-8 w-full text-[12px]"
            silent
            title="이 레벨에 쓴 카드 · 조각을 모두 돌려받아요 (여러 조합을 시험해 보세요)"
            onClick={() => void act(() => meta.unitDown(u.id), "sell")}
          >
            − Lv.{lv - 1} 로 내리기 (카드 {back.cards} · 조각 {back.pieces} 돌려받기)
          </Btn>
        )}
        <p className="mt-auto pt-2 text-[12px] leading-snug text-[var(--dim)]">
          조각 값은 등급이 높을수록 비싸요 (같은 +3% 라도 신화가 실제로 늘어나는 피해가 훨씬 커서). 주간 도전에는 강화가 적용되지 않아요.
        </p>
      </div>
    </div>
  );
}

/* ───────── 연구 ───────── */

const GROUP_NAME: Record<string, string> = { general: "공통", knight: "기사단", mech: "기계공방", arcane: "마도회" };
function ResTab({ p, act, busy }: TabProps) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <H sub={`공용 칸 ${RES_SLOTS}개 (공동 연구만) + 세력 칸 ${p.fslots}/${FRES_MAX} (세력 연구만) — 출전 준비에서 장착`}>연구</H>
        {p.fslots < FRES_MAX && (
          <Btn tone="arcane" disabled={busy || p.cores < FRES_COST[p.fslots]} silent className="ml-auto h-8 shrink-0 px-2 text-[12px]" onClick={() => void act(() => meta.fslotBuy(), "upgrade")}>
            세력 연구칸 +1 · <Cur k="core" n={FRES_COST[p.fslots]} size={12} />
          </Btn>
        )}
      </div>
      {(["general", "knight", "mech", "arcane"] as const).map((g) => (
        <div key={g} className="mb-3">
          <p className="mb-1 text-[12px] font-bold" style={{ color: g === "general" ? "var(--mute)" : FACTION_COLOR[g] }}>
            {g !== "general" && <FactionIcon f={g} size={11} className="mr-1" />}
            {GROUP_NAME[g]}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {RESEARCH.filter((r) => r.group === g).map((r) => {
              const own = p.res.includes(r.id);
              const lv = p.resLv?.[r.id] ?? 1;
              const up = resUpCost(r.id, lv);
              return (
                <div key={r.id} className="px-inset flex items-center gap-2 px-2.5 py-1.5" style={own ? ({ "--b": "#6dff8f" } as CSSProperties) : undefined}>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[13px]">
                      {r.name}
                      {own && <span className="ml-1.5 text-[var(--gold)]">Lv.{lv}</span>}
                      {own && p.load.res.includes(r.id) && <span className="ml-1.5 text-[12px] font-normal text-[var(--green)]">장착 중</span>}
                    </b>
                    <span className="block text-[12px] text-[var(--mute)]">{resDesc(r.id, own ? lv : 1)}</span>
                  </span>
                  {own ? (
                    <LvBtns
                      lv={lv}
                      max={RES_MAX_LV}
                      busy={busy}
                      can={p.pieces >= up}
                      cost={<Cur k="piece" n={up} size={12} />}
                      back={lv > 1 ? `조각 ${resUpCost(r.id, lv - 1)} 돌려받기` : ""}
                      next={lv < RES_MAX_LV ? resDesc(r.id, lv + 1) : ""}
                      onUp={() => void act(() => meta.resLevel(r.id, 1), "upgrade")}
                      onDown={() => void act(() => meta.resLevel(r.id, -1), "sell")}
                    />
                  ) : (
                    <Btn tone="cyan" disabled={busy || p.pieces < r.cost} silent className="h-8 shrink-0 px-2 text-[12px]" onClick={() => void act(() => meta.resBuy(r.id), "upgrade")}>
                      <Cur k="piece" n={r.cost} size={12} />
                    </Btn>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 연구 · 유물 레벨 버튼 — 「−」 내리기 (전부 돌려받기) · 「+ 값」 올리기 */
function LvBtns({ lv, max, busy, can, cost, back, next, onUp, onDown }: { lv: number; max: number; busy: boolean; can: boolean; cost: ReactNode; back: string; next: string; onUp(): void; onDown(): void }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {lv > 1 && (
        <Btn disabled={busy} silent className="h-8 w-7 px-0 text-[13px]" title={`Lv.${lv - 1} 로 내리기 (${back})`} onClick={onDown}>
          −
        </Btn>
      )}
      {lv < max ? (
        <Tip text={<><b className="text-[var(--gold)]">Lv.{lv + 1}</b> — {next}</>} align="right" width={240}>
          <Btn tone="cyan" disabled={busy || !can} silent className="h-8 px-2 text-[12px]" title={`Lv.${lv + 1} 로 강화`} onClick={onUp}>
            + {cost}
          </Btn>
        </Tip>
      ) : (
        <span className="px-1 text-[12px] text-[var(--gold)]">MAX</span>
      )}
    </span>
  );
}

/* ───────── 유물 ───────── */

function RelicTab({ p, act, busy }: TabProps) {
  return (
    <div>
      <H sub={`유물 상자 · 코어로 바로 사기 · 장착은 3개, 가진 유물은 모두 보유 효과 (레벨당 모든 피해 +${RELIC_PASSIVE.join(" / ")}% — 일반 / 희귀 / 전설) · 지금 +${relicPassive(Object.fromEntries(p.relics.map((id) => [id, p.relicLv?.[id] ?? 1])))}%`}>
        유물 {p.relics.length}/{RELICS.length}
      </H>
      <div className="grid grid-cols-2 gap-1.5">
        {RELICS.map((r) => {
          const own = p.relics.includes(r.id);
          const price = RELIC_CORE_PRICE[r.tier];
          const lv = p.relicLv?.[r.id] ?? 1;
          const up = relicUpCost(r.id, lv);
          return (
            <div key={r.id} className="px-inset flex items-center gap-2.5 px-2.5 py-2" style={{ "--b": own ? TIER_COLOR[r.tier] : undefined } as CSSProperties}>
              <RelicIcon id={r.id} size={42} dim={!own} />
              <span className="min-w-0 flex-1">
                <b className="text-[13px]">{r.name}</b>
                <span className="ml-1.5 text-[12px]" style={{ color: TIER_COLOR[r.tier] }}>
                  {TIER_NAME[r.tier]}
                </span>
                {own && <span className="ml-1.5 text-[12px] font-bold text-[var(--gold)]">Lv.{lv}</span>}
                {own && <span className="ml-1.5 text-[12px] text-[var(--mute)]">조각 {p.shards?.[r.id] ?? 0}</span>}
                {own && p.load.relics.includes(r.id) && <span className="ml-1.5 text-[12px] text-[var(--green)]">장착 중</span>}
                <span className="block text-[12px] leading-tight text-[var(--mute)]">{relicDesc(r.id, own ? lv : 1)}</span>
              </span>
              {own ? (
                <LvBtns
                  lv={lv}
                  max={RELIC_MAX_LV}
                  busy={busy}
                  can={p.cores >= up.cores && (p.shards?.[r.id] ?? 0) >= up.shards}
                  cost={
                    <>
                      <Cur k="shard" n={up.shards} size={12} /> <Cur k="core" n={up.cores} size={12} />
                    </>
                  }
                  back={lv > 1 ? `조각 ${relicUpCost(r.id, lv - 1).shards} · 코어 ${relicUpCost(r.id, lv - 1).cores} 돌려받기` : ""}
                  next={lv < RELIC_MAX_LV ? relicDesc(r.id, lv + 1) : ""}
                  onUp={() => void act(() => meta.relicLevel(r.id, 1), "legend")}
                  onDown={() => void act(() => meta.relicLevel(r.id, -1), "sell")}
                />
              ) : (
                <Btn tone="arcane" disabled={busy || p.cores < price} silent className="h-8 shrink-0 px-2 text-[12px]" onClick={() => void act(() => meta.relicBuy(r.id), "legend")}>
                  <Cur k="core" n={price} size={12} />
                </Btn>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── 미션 ───────── */

function QuestList({ list, act, busy }: { list: QuestRow[] } & Pick<TabProps, "act" | "busy">) {
  return (
    <div className="flex flex-col gap-1.5">
      {list.map((q) => {
        const done = q.value >= q.goal;
        return (
          <div key={q.id} className="px-inset flex items-center gap-3 px-3 py-2" style={done && !q.claimed ? ({ "--b": "#ffd23f" } as CSSProperties) : undefined}>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <b className="text-[13px]">{q.name}</b>
                <span className="text-[12px] text-[var(--mute)]">{questDesc(q)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Bar value={q.value / q.goal} color={done ? "#ffd23f" : "#5ff2ff"} h={6} className="flex-1" />
                <span className="w-[54px] text-right text-[12px]">
                  {q.value}/{q.goal}
                </span>
              </div>
            </div>
            <RewardLine r={{ pieces: q.pieces, cores: q.cores, xp: q.xp }} />
            <Btn tone={q.claimed ? "ghost" : "gold"} disabled={busy || q.claimed || !done} silent className="h-9 w-[64px] shrink-0 text-[12px] font-bold" onClick={() => void act(() => meta.questClaim(q.id), "reward")}>
              {q.claimed ? "받음" : "받기"}
            </Btn>
          </div>
        );
      })}
    </div>
  );
}
const questDesc = (q: QuestRow) =>
  ({
    runs: `판 ${q.goal}번 끝내기`,
    wave: `한 판에서 ${q.goal}웨이브`,
    bosses: `보스 ${q.goal}마리 잡기`,
    legend: `레전드 ${q.goal}기 얻기`,
    myth: `신화 · 히든 ${q.goal}기 얻기`,
    recipe: `조합식 ${q.goal}번`,
    knight: `기사단 유닛 ${q.goal}기 얻기`,
    mech: `기계공방 유닛 ${q.goal}기 얻기`,
    arcane: `마도회 유닛 ${q.goal}기 얻기`,
    rift: `균열 ${q.goal}번 닫기`,
    win: `60웨이브 클리어 ${q.goal}번`,
    multi: `함께 하기 ${q.goal}판`,
  })[q.metric];

function QuestTab({ p, act, busy }: TabProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <H sub={`${left(p.dayEnds)} 뒤 바뀜 · 회원 랭킹 판 · 주간 도전 · 함께 하기 모두 셈`}>오늘의 미션</H>
        <QuestList list={p.quests.daily} act={act} busy={busy} />
      </div>
      <div>
        <H sub={`${left(p.week.ends)} 뒤 바뀜`}>이번 주 미션</H>
        <QuestList list={p.quests.weekly} act={act} busy={busy} />
      </div>
    </div>
  );
}

/* ───────── 시즌 패스 ───────── */

function PassTab({ p, act, busy }: TabProps) {
  const t = p.passTier;
  const cur = PASS[t - 1]?.xp ?? 0;
  const next = PASS[t]?.xp ?? cur;
  const claimable = t - p.season.free.length + (p.season.premium ? t - p.season.prem.length : 0);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3">
        <H sub={`${left(p.seasonEnds)} 남음 · 판 · 미션으로 경험치`}>시즌 {p.season.id}</H>
        <div className="ml-auto flex items-center gap-2">
          <Btn tone="gold" disabled={busy || claimable <= 0} silent className="h-9 px-3 text-[13px] font-bold" onClick={() => void act(() => meta.passClaim(), "reward")}>
            모두 받기 {claimable > 0 ? `(${claimable})` : ""}
          </Btn>
          {!p.season.premium && (
            <Btn tone="main" disabled={busy || p.gp < PASS_PREMIUM_GP} silent className="h-9 px-3 text-[13px] font-bold" onClick={() => void act(() => meta.passBuy(), "legend")} title={p.gp < PASS_PREMIUM_GP ? "GP 가 모자라요" : ""}>
              프리미엄 열기 · <Cur k="gp" n={fmtNum(PASS_PREMIUM_GP)} size={13} />
            </Btn>
          )}
        </div>
      </div>
      <div className="mb-2 flex items-center gap-2 text-[12px]">
        <b className={`${TITLE} text-[18px] text-[var(--gold)]`}>{t}</b>
        <span className="text-[var(--mute)]">/ {PASS.length}단계</span>
        <Bar value={t >= PASS.length ? 1 : (p.season.xp - cur) / (next - cur)} color="#5ff2ff" h={8} className="flex-1" />
        <span className="w-[110px] text-right">
          {p.season.xp} / {t >= PASS.length ? "MAX" : next} XP
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto pb-1">
        <div className="flex h-full gap-1.5">
          <div className="flex w-[64px] shrink-0 flex-col gap-1.5 pt-[22px] text-[12px] text-[var(--mute)]">
            <span className="flex h-[96px] items-center">무료</span>
            <span className="flex h-[96px] items-center text-[var(--pink)]">프리미엄</span>
          </div>
          {PASS.map((x, i) => {
            const reached = i < t;
            const cell = (r: PassReward, got: boolean, prem: boolean) => (
              <div
                className={`px-inset flex h-[96px] flex-col items-center justify-center gap-1 p-1 text-center ${!reached || (prem && !p.season.premium) ? "opacity-45" : ""}`}
                style={got ? ({ "--b": "#6dff8f" } as CSSProperties) : reached && (!prem || p.season.premium) ? ({ "--b": "#ffd23f" } as CSSProperties) : undefined}
              >
                {r.item ? (
                  <>
                    <span className="flex">
                      {[0, 1, 2].map((k) => (
                        <i key={k} className="block h-3.5 w-3.5" style={{ background: THEME[r.item!]?.top[k] }} />
                      ))}
                    </span>
                    <span className="text-[12px] text-[var(--gold)]">{THEME[r.item]?.name}</span>
                    {!!r.cores && <Cur k="core" n={r.cores} size={12} className="text-[12px]" />}
                  </>
                ) : (
                  <span className="flex flex-col items-center gap-0.5 text-[12px]">
                    {!!r.pieces && <Cur k="piece" n={r.pieces} size={14} />}
                    {!!r.cores && <Cur k="core" n={r.cores} size={14} />}
                    {!!r.cardBox && <Cur k="cardbox" n={r.cardBox} size={14} />}
                    {!!r.relicBox && <Cur k="relicbox" n={r.relicBox} size={14} />}
                    {!!r.gp && <Cur k="gp" n={r.gp} size={14} />}
                  </span>
                )}
                {got && <span className="text-[12px] text-[var(--green)]">받음</span>}
              </div>
            );
            return (
              <div key={i} className="flex w-[74px] shrink-0 flex-col gap-1.5">
                <span className={`h-4 text-center text-[12px] ${reached ? "text-[var(--gold)]" : "text-[var(--dim)]"}`}>{i + 1}</span>
                {cell(x.free, p.season.free.includes(i), false)}
                {cell(x.premium, p.season.prem.includes(i), true)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────── 상점 (상품별 상자 · 해금 · GP) ───────── */

type Got = NonNullable<DefenseProfile["got"]>;
function GotBox({ got }: { got: Got }) {
  const col = got.relic ? TIER_COLOR[RELIC[got.relic].tier] : got.trans ? "#fff6d6" : "#ffb347";
  return (
    <div className="px-box dfn-pop mt-2 p-3 text-center" style={{ "--b": col } as CSSProperties}>
      {got.trans ? (
        <div className="flex items-center justify-center gap-3">
          <UnitIcon id={got.trans} size={56} />
          <div className="text-left">
            <p className="text-[12px] text-[#fff6d6]">초월</p>
            <b className="text-[17px]">{UNIT[got.trans].name}</b>
            <p className="text-[12px] text-[var(--mute)]">{got.dup ? `이미 해금 → 카드 +${got.dup}` : "해금! 판에서 신화 3기로 조합할 수 있어요"}</p>
          </div>
        </div>
      ) : got.relic ? (
        <div className="flex items-center justify-center gap-3">
          <RelicIcon id={got.relic} size={56} />
          <div className="text-left">
            <p className="text-[12px]" style={{ color: TIER_COLOR[RELIC[got.relic].tier] }}>
              {TIER_NAME[RELIC[got.relic].tier]} 유물
            </p>
            <b className="text-[17px]">{RELIC[got.relic].name}</b>
            <p className="text-[12px] text-[var(--mute)]">{got.shard ? `이미 가진 유물 → 유물 조각 +${got.shard} (유물 강화 재료)` : RELIC[got.relic].desc}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[13px]">유닛 카드 {BOX.card.n}장</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {Object.entries(got.cards ?? {}).map(([id, n]) => (
              <span key={id} className="relative">
                <UnitIcon id={id} size={40} />
                <b className="absolute right-0 bottom-0 bg-[#0a0816] px-1 text-[12px] text-[#ffb347]">×{n}</b>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 상품 한 줄: 그림 · 이름 · 설명 · 버튼들 */
function Product({ k, title, sub, children }: { k: CurK; title: ReactNode; sub: ReactNode; children: ReactNode }) {
  const art = ITEM_ART[k];
  return (
    <div className="px-inset flex items-center gap-3 px-3 py-2">
      {art ? <img src={art} alt="" width={44} height={44} className="shrink-0" /> : <Icon n={CUR_ICON[k] ?? k} size={36} />}
      <div className="min-w-0 flex-1">
        <b className="text-[14px]">{title}</b>
        <p className="text-[12px] leading-snug text-[var(--mute)]">{sub}</p>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-1">{children}</div>
    </div>
  );
}

function ShopTab({ p, act, busy }: TabProps) {
  const [msg, setMsg] = useState("");
  const [got, setGot] = useState<Got | null>(null);
  const themeItems = THEMES.map((t) => ({ t, item: shopFor("defense", "item", t.id) })).filter((x) => x.item);
  const run = async (f: () => Promise<DefenseProfile>, s = "chest-open") => {
    setGot(null);
    const np = await act(f, s);
    if (np?.got) setGot(np.got);
  };
  const gb = p.gpBuys ?? { relic: 0, cards: 0, trans: 0 };
  const btn = "h-8 px-2.5 text-[12px]";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <H sub="상품마다 따로 — 산 상자는 쌓아 두고 언제든 열어요">상자</H>
        <div className="flex flex-col gap-1.5">
          <Product k="cardbox" title={<>카드 상자 <span className="text-[12px] font-normal text-[var(--gold)]">보유 {p.boxes.card}</span></>} sub={`무작위 유닛 카드 ${BOX.card.n}장 (낮은 등급이 잘 나와요)`}>
            <Btn tone="gold" disabled={busy || p.boxes.card < 1} silent className={btn} onClick={() => void run(() => meta.boxOpen("card"))}>
              열기
            </Btn>
            <Btn tone="cyan" disabled={busy || p.pieces < BOX.card.pieces} silent className={btn} onClick={() => void act(() => meta.boxBuy("card"), "upgrade")}>
              사기 <Cur k="piece" n={BOX.card.pieces} size={12} />
            </Btn>
          </Product>
          <Product
            k="relicbox"
            title={<>유물 상자 <span className="text-[12px] font-normal text-[var(--gold)]">보유 {p.boxes.relic}</span></>}
            sub={`유물 하나 (일반 ${BOX.relic.tierOdds[0] * 100}% · 희귀 ${BOX.relic.tierOdds[1] * 100}% · 전설 ${BOX.relic.tierOdds[2] * 100}%) — 가진 유물이면 그 유물 조각 +1 (유물 강화 재료)`}
          >
            <Btn tone="gold" disabled={busy || p.boxes.relic < 1} silent className={btn} onClick={() => void run(() => meta.boxOpen("relic"))}>
              열기
            </Btn>
            <Btn tone="arcane" disabled={busy || p.cores < BOX.relic.cores} silent className={btn} onClick={() => void act(() => meta.boxBuy("relic"), "upgrade")}>
              사기 <Cur k="core" n={BOX.relic.cores} size={12} />
            </Btn>
            <Btn
              tone="cyan"
              disabled={busy || p.gp < BOX.relic.gp || gb.relic >= BOX.relic.gpPerWeek}
              silent
              className={btn}
              title={`좋은 확률 (희귀 ${BOX.relic.gpOdds[1] * 100}% · 전설 ${BOX.relic.gpOdds[2] * 100}%) · 바로 열림`}
              onClick={() => void run(() => meta.gpRelic())}
            >
              <Cur k="gp" n={fmtNum(BOX.relic.gp)} size={12} /> ({gb.relic}/{BOX.relic.gpPerWeek})
            </Btn>
          </Product>
          <Product
            k="trans"
            title={<>초월 소환 <span className="text-[12px] font-normal text-[#fff6d6]">해금 {p.trans.length}/{TRANS_IDS.length}</span></>}
            sub={
              <>
                {TRANS_IDS.map((id) => (
                  <span key={id} className={p.trans.includes(id) ? "text-[#fff6d6]" : "text-[var(--dim)]"}>
                    {UNIT[id].name}
                    {" · "}
                  </span>
                ))}
                셋 중 하나 — 처음이면 해금 (판에서 그 세력 신화 3기로 조합), 겹치면 카드 {BOX.trans.dupCards}장
              </>
            }
          >
            <Btn tone="arcane" disabled={busy || p.cores < BOX.trans.cores} silent className={btn} onClick={() => void run(() => meta.transSummon("cores"), "myth")}>
              <Cur k="core" n={BOX.trans.cores} size={12} />
            </Btn>
            <Btn tone="cyan" disabled={busy || p.gp < BOX.trans.gp || gb.trans >= BOX.trans.gpPerWeek} silent className={btn} onClick={() => void run(() => meta.transSummon("gp"), "myth")}>
              <Cur k="gp" n={fmtNum(BOX.trans.gp)} size={12} /> ({gb.trans}/{BOX.trans.gpPerWeek})
            </Btn>
          </Product>
        </div>
        {got && <GotBox got={got} />}
      </div>
      <div>
        <H sub="한 번 사면 계속">칸 해금</H>
        <div className="grid grid-cols-2 gap-1.5">
          <Product k="cardbox" title={`보관함 칸 ${p.bench}/${BENCH_MAX}`} sub={`처음 ${BENCH_BASE}칸 · 판 아래 보관함이 1칸 늘어요`}>
            {p.bench < BENCH_MAX ? (
              <Btn tone="cyan" disabled={busy || p.pieces < BENCH_COST[p.bench - BENCH_BASE]} silent className={btn} onClick={() => void act(() => meta.benchBuy(), "upgrade")}>
                +1 <Cur k="piece" n={fmtNum(BENCH_COST[p.bench - BENCH_BASE])} size={12} />
              </Btn>
            ) : (
              <span className="text-[12px] text-[var(--gold)]">MAX</span>
            )}
          </Product>
          <Product k="trans" title={`세력 연구칸 ${p.fslots}/${FRES_MAX}`} sub="기사단 · 기계공방 · 마도회 연구 전용 칸 (공용 4칸엔 공동 연구만)">
            {p.fslots < FRES_MAX ? (
              <Btn tone="arcane" disabled={busy || p.cores < FRES_COST[p.fslots]} silent className={btn} onClick={() => void act(() => meta.fslotBuy(), "upgrade")}>
                +1 <Cur k="core" n={FRES_COST[p.fslots]} size={12} />
              </Btn>
            ) : (
              <span className="text-[12px] text-[var(--gold)]">MAX</span>
            )}
          </Product>
        </div>
      </div>
      <div>
        <H sub="GP 는 사이트 공용 포인트 (출석 · 업적 · 주간 도전 순위) — 성장을 한 번에 건너뛰지 못하게 주마다 횟수 제한">GP</H>
        <div className="flex flex-col gap-1.5">
          <div className="px-inset flex items-center gap-3 px-3 py-2">
            <Cur k="gp" n={fmtNum(CORE_EXCHANGE.gp)} size={18} className="text-[14px] text-[var(--green)]" />
            <span className="text-[var(--dim)]">→</span>
            <Cur k="core" n={CORE_EXCHANGE.cores} size={18} className="text-[14px] text-[#ffb3ee]" />
            <span className="text-[12px] text-[var(--mute)]">글리치 코어 교환 · 이번 주 {p.coreBuys.n}/{CORE_EXCHANGE.maxPerWeek}</span>
            <Btn tone="arcane" disabled={busy || p.gp < CORE_EXCHANGE.gp || p.coreBuys.n >= CORE_EXCHANGE.maxPerWeek} silent className={`ml-auto ${btn}`} onClick={() => void act(() => meta.coresBuy(), "upgrade")}>
              교환
            </Btn>
          </div>
          <div className="px-inset flex items-center gap-3 px-3 py-2">
            <Cur k="gp" n={GP_SHOP.cards.gp} size={18} className="text-[14px] text-[var(--green)]" />
            <span className="text-[var(--dim)]">→</span>
            <Cur k="card" n={`고른 유닛 ${GP_SHOP.cards.n}장`} size={18} className="text-[13px]" />
            <span className="text-[12px] text-[var(--mute)]">유닛 강화 탭에서 골라 사요 · 이번 주 {gb.cards}/{GP_SHOP.cards.perWeek}</span>
          </div>
        </div>
      </div>
      <div>
        <H sub="블록 윗면 · 돌길 색이 바뀌어요 (판 결과에는 영향 없음)">블록 테마</H>
        <div className="grid grid-cols-2 gap-1.5">
          {themeItems.map(({ t, item }) => {
            const own = p.themes.includes(t.id);
            return (
              <div key={t.id} className="px-inset flex items-center gap-3 px-3 py-2">
                <span className="flex">
                  {[0, 1, 2, 3].map((k) => (
                    <i key={k} className="block h-5 w-5" style={{ background: t.top[k] }} />
                  ))}
                </span>
                <b className="flex-1 text-[13px]">{t.name}</b>
                {own ? (
                  <span className="text-[12px] text-[var(--green)]">보유</span>
                ) : (
                  <Btn
                    tone="cyan"
                    disabled={busy || p.gp < item!.price}
                    className="h-8 px-2.5 text-[12px]"
                    onClick={() =>
                      void act(async () => {
                        await buyItem(item!.id);
                        setMsg(`${t.name} 테마를 샀어요 — 출전 준비에서 바꿀 수 있어요`);
                        return meta.profile();
                      }, "upgrade")
                    }
                  >
                    <Cur k="gp" n={fmtNum(item!.price)} size={12} />
                  </Btn>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-1 text-[12px] text-[var(--dim)]">얼음 성채 · 네온 시티 · 황금 신전은 시즌 패스 프리미엄 보상으로도 나와요.</p>
        {msg && <p className="mt-1 text-[12px] text-[var(--green)]">{msg}</p>}
      </div>
    </div>
  );
}
