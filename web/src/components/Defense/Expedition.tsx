"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { B, TPS } from "@/lib/defense/balance";
import { BOSSES } from "@/lib/defense/enemies";
import { BOSS_ART, EXP_RELIC_ART } from "@/lib/defense/assets";
import { capOf, expLeak, expNext, hasEmpty, type Board, type Cmd } from "@/lib/defense/sim";
import {
  CURSES,
  EVENTS,
  EXP,
  EXP_ASC,
  EXP_NODE_TEXT,
  EXP_RELIC,
  FIGHT_MOD,
  GIM,
  SHOP,
  SQUADS,
  TOWN_NAME,
  ascOn,
  type ExpNode,
} from "@/lib/defense/town";
import { FACTION_COLOR, GRADE_COLOR, UNIT, type Faction } from "@/lib/defense/units";
import { Btn, FactionChip, FactionIcon, GradeChip, Icon, TITLE, UnitIcon } from "./ui";
import { sfx } from "./audio";
import { bossDesc } from "./Codex";

/*
 * 글리치 원정 화면
 *  ExpBar    — 위쪽 줄: 원정 체력 · 층 · 지금 칸 (정리 시간이면 남은 초)
 *  CleanBanner — 정리 시간 동안 필드 위 안내 (남은 적 → 깎일 체력)
 *  ExpModal  — 캠프 (시간이 멈춤): 분대 · 지도 · 드래프트 · 유물 · 상점 · 휴식 · 사건
 */

/** 도트 하트 */
export function Heart({ size = 14, color = "#ff4d6d" }: { size?: number; color?: string }) {
  const rows = [".11.11.", "1221111", "1211111", "1111111", ".11111.", "..111..", "...1..."];
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" className="inline-block shrink-0 align-[-2px]" aria-hidden>
      {rows.flatMap((r, y) => [...r].map((ch, x) => (ch === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={ch === "2" ? "#ffd0da" : color} />)))}
    </svg>
  );
}

/** 원정 유물 아이콘 (그림이 오기 전 — 도트 아이콘 + 색 테두리) */
const RELIC_LOOK: Record<string, [string, string]> = {
  alch: ["flask", "#c79bff"],
  twin: ["star", "#9be7ff"],
  growth: ["up", "#6dff8f"],
  piggy: ["coin", "#ffb3d1"],
  iron: ["gear", "#bfc6d9"],
  blood: ["heart", "#ff4d6d"],
  bag: ["chest", "#ffb347"],
  vamp: ["heart", "#c2306f"],
  goldhand: ["coin", "#ffd23f"],
  first: ["rift", "#5ff2ff"],
  hunter: ["skull", "#ff6b7f"],
  kit: ["clover", "#6dff8f"],
  echo: ["card", "#9be7ff"],
  phoenix: ["star", "#ff9f43"],
  glass: ["gem", "#5ff2ff"],
};
export function ExpRelicIcon({ id, size = 28, dim }: { id: string; size?: number; dim?: boolean }) {
  const f = id.startsWith("sq_") ? id.slice(3) : id.startsWith("oath_") ? id.slice(5) : null;
  const [ic, col] = f ? ["", FACTION_COLOR[f as Faction]] : (RELIC_LOOK[id] ?? ["relic", "#9be7ff"]);
  const art = EXP_RELIC_ART[id];
  if (art)
    return (
      <span className="inline-flex shrink-0 items-center justify-center bg-[#0a0816]" style={{ width: size, height: size, boxShadow: `inset 0 0 0 2px ${dim ? "#3d3468" : col}` }}>
        <img src={art} alt="" className="object-contain" style={{ width: size - 4, height: size - 4, opacity: dim ? 0.35 : 1, filter: dim ? "grayscale(1) brightness(0.5)" : undefined }} />
      </span>
    );
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center bg-[#0a0816]"
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 2px ${dim ? "#3d3468" : col}`, opacity: dim ? 0.5 : 1 }}
    >
      {f ? <FactionIcon f={f as Faction} size={Math.round(size * 0.55)} /> : ic === "heart" ? <Heart size={Math.round(size * 0.55)} color={col} /> : <Icon n={ic} size={Math.round(size * 0.55)} />}
    </span>
  );
}

const hpColor = (hp: number, max: number) => (hp <= max * 0.3 ? "#ff4d6d" : hp <= max * 0.6 ? "#ffb347" : "#6dff8f");

function HpBar({ hp, max, w = 120 }: { hp: number; max: number; w?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Heart />
      <span className="relative inline-block h-[10px] bg-[#07060f] p-[2px]" style={{ width: w }}>
        <span className="block h-full" style={{ width: `${Math.max(0, (hp / max) * 100)}%`, background: hpColor(hp, max) }} />
      </span>
      <b className="text-[13px] tabular-nums" style={{ color: hpColor(hp, max) }}>
        {hp}
        <span className="text-[11px] text-[var(--dim)]">/{max}</span>
      </b>
    </span>
  );
}

const relicTip = (b: Board) => {
  const x = b.exp!;
  const r = x.relics.map((id) => `· ${EXP_RELIC[id]?.name}: ${EXP_RELIC[id]?.desc}`);
  const c = x.curses.map((id) => `· [저주] ${CURSES[id]?.name}: ${CURSES[id]?.desc}`);
  return [`원정 유물 ${x.relics.length}`, ...r, ...c].join("\n");
};

/** 위쪽 줄 웨이브 칸 (원정): 층 · 전투 몇 번째 웨이브 · 정리 시간 */
export function expWave(b: Board): { text: string; sub: string; p: number; red: boolean } {
  const x = b.exp!;
  const act = x.act > 1 ? "2막 " : "";
  if (x.stage === "clean") return { text: `정리 ${Math.ceil(x.cleanT / TPS)}`, sub: "초", p: x.cleanT / (EXP.cleanSec * TPS), red: true };
  if (x.stage === "waves") {
    const n = x.segEnd - x.segStart + 1;
    const i = Math.max(1, Math.min(n, b.wave - x.segStart + 1));
    return { text: `${act}${x.f + 1}F`, sub: `${x.mod ? FIGHT_MOD[x.mod].name + " " : ""}${i}/${n}`, p: Math.min(1, (i - 1 + Math.min(1, b.wt / (B.waveSec * TPS))) / n), red: false };
  }
  if (x.stage === "boss") return { text: `${act}BOSS`, sub: "", p: 1, red: true };
  return { text: x.f < 0 ? `${act}출발` : `${act}${x.f + 1}F`, sub: `/${EXP.floors}F`, p: (x.f + 1) / (EXP.floors + 1), red: false };
}

/** 위쪽 줄: 원정 체력 (나머지는 「빌드」 창) */
export function ExpBar({ b }: { b: Board }) {
  const x = b.exp!;
  return (
    <div className="px-inset flex h-full shrink-0 items-center px-2" title={`원정 체력 — 전투가 끝날 때 남은 적만큼 깎여요. 0이면 실패\n${relicTip(b)}`}>
      <Heart />
      <b className="ml-1 text-[14px] tabular-nums" style={{ color: hpColor(x.hp, x.max) }}>
        {x.hp}
        <span className="text-[11px] text-[var(--dim)]">/{x.max}</span>
      </b>
    </div>
  );
}

/** 정리 시간 (웨이브 끝 → 남은 적을 치울 시간) */
export function CleanBanner({ b }: { b: Board }) {
  const x = b.exp!;
  if (x.stage !== "clean" || x.camp) return null;
  const { leak, gimLeft } = expLeak(b);
  const s = Math.ceil(x.cleanT / TPS);
  return (
    <div className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2">
      <div className="px-box flex items-center gap-3 px-3 py-1.5" style={{ "--b": leak ? "#ff4d6d" : "#6dff8f" } as CSSProperties}>
        <b className={`${TITLE} text-[18px] ${s <= 5 ? "dfn-blink text-[var(--red)]" : "text-white"}`}>정리 시간 {s}</b>
        <span className="text-[13px] text-[var(--text)]">
          {leak ? (
            <>
              이대로 끝나면 <Heart size={12} /> <b className="text-[var(--red)]">-{leak}</b>
              {gimLeft > 0 && <span className="text-[#ffd23f]"> (기믹 엘리트 도망 -{EXP.gimEscape})</span>}
            </>
          ) : (
            <b className="text-[#6dff8f]">깨끗해요 — 곧 다음으로</b>
          )}
        </span>
      </div>
    </div>
  );
}

const card = "px-box dfn-pop flex flex-1 flex-col items-center gap-1.5 p-3 text-center transition-transform hover:-translate-y-1 disabled:hover:translate-y-0";

/** 캠프 창 (시간이 멈춤). 「판 보기」로 접고 소환 · 합성 · 판매도 가능 */
export function ExpModal({ b, run }: { b: Board; run: (c: Cmd) => boolean }) {
  const [hide, setHide] = useState(false);
  const x = b.exp!;
  const c = x.camp!;
  if (hide)
    return (
      <div className="absolute top-2 left-1/2 z-20 -translate-x-1/2">
        <Btn tone="gold" className="dfn-pulse h-9 px-4 text-[13px] font-bold" onClick={() => setHide(false)}>
          {c.k === "map" ? "원정 지도 열기" : "원정 선택 창 열기"}
        </Btn>
      </div>
    );
  const go = (a: number) => run({ t: "exp", a });
  let title = "";
  let sub: ReactNode = null;
  let body: ReactNode = null;
  let foot: ReactNode = null;
  switch (c.k) {
    case "squad":
      title = `${TOWN_NAME} — 분대 고르기`;
      sub = `${b.mods.town}단계 · 적 세기 오염 ${b.mods.glitch.lv}단계`;
      body = <SquadView b={b} opts={c.opts} go={go} />;
      break;
    case "map":
      title = "원정 지도";
      sub = "이어진 칸 중 하나를 골라요 · 꼭대기 보스를 잡으면 성공";
      body = <MapView b={b} go={go} />;
      break;
    case "draft":
      title = "유닛 드래프트";
      sub = hasEmpty(b) ? "골라서 바로 칸에 놓아요" : "빈 칸이 없어요 — 판 보기로 팔거나 합성하고 골라요";
      body = (
        <div className="flex w-full max-w-[720px] gap-3">
          {c.offer.map((id, i) => {
            const d = UNIT[id];
            return (
              <button key={i} type="button" className={card} style={{ "--b": GRADE_COLOR[d.grade] } as CSSProperties} onClick={() => go(i)}>
                <UnitIcon id={id} size={56} />
                <b className="px-shadow text-[16px] text-white">{d.name}</b>
                <span className="flex gap-1">
                  <GradeChip g={d.grade} />
                  <FactionChip f={d.faction} />
                </span>
                <span className="text-[12px] leading-snug text-[var(--text)]">{d.desc}</span>
              </button>
            );
          })}
        </div>
      );
      foot = (
        <Btn className="h-8 px-4 text-[12px]" onClick={() => go(-1)}>
          건너뛰기 (+{EXP.skipGold}G)
        </Btn>
      );
      break;
    case "relic":
      title = "원정 유물";
      sub = "하나를 골라요 · 이번 원정에서만 규칙을 바꿔요";
      body = (
        <div className="flex w-full max-w-[720px] gap-3">
          {c.offer.map((id, i) => {
            const r = EXP_RELIC[id];
            return (
              <button key={i} type="button" className={card} style={{ "--b": "#9be7ff" } as CSSProperties} onClick={() => (go(i), sfx("reward"))}>
                <ExpRelicIcon id={id} size={44} />
                <b className="px-shadow text-[16px] text-white">{r.name}</b>
                <span className="text-[13px] leading-snug text-[var(--text)]">{r.desc}</span>
              </button>
            );
          })}
        </div>
      );
      foot = (
        <Btn className="h-8 px-4 text-[12px]" onClick={() => go(-1)}>
          건너뛰기
        </Btn>
      );
      break;
    case "shop":
      title = "글리치 상점";
      sub = (
        <>
          가진 골드 <b className="text-[var(--gold)]">{b.gold}G</b>
        </>
      );
      body = (
        <div className="flex w-full max-w-[760px] gap-2.5">
          {c.items.map((it, i) => {
            const S = SHOP[it.kind];
            return (
              <button
                key={i}
                type="button"
                disabled={it.sold}
                className={`${card} ${it.sold ? "opacity-40" : ""}`}
                style={{ "--b": it.kind === "uncurse" ? "#c79bff" : "#ffd23f" } as CSSProperties}
                onClick={() => go(i) && sfx("town-coin")}
              >
                <Icon n={SHOP_ICON[it.kind]} size={28} />
                <b className="px-shadow text-[14px] text-white">{S.name}</b>
                <span className="text-[12px] leading-snug text-[var(--text)]">{S.desc}</span>
                <b className={`mt-auto text-[14px] ${b.gold >= it.cost ? "text-[var(--gold)]" : "text-[var(--red)]"}`}>{it.sold ? "판매 완료" : `${it.cost}G`}</b>
              </button>
            );
          })}
        </div>
      );
      foot = (
        <Btn tone="gold" className="h-8 px-4 text-[12px]" onClick={() => go(-1)}>
          나가기
        </Btn>
      );
      break;
    case "rest": {
      const heal = Math.min(x.max - x.hp, Math.ceil(x.max * EXP.restHeal * (ascOn(b.mods.town, 9) ? 0.5 : 1)));
      title = "모닥불 — 휴식";
      sub = "하나를 골라요";
      body = (
        <div className="flex w-full max-w-[560px] gap-3">
          <button type="button" className={card} style={{ "--b": "#6dff8f" } as CSSProperties} onClick={() => (go(0), sfx("town-fest"))}>
            <Heart size={36} color="#6dff8f" />
            <b className="px-shadow text-[17px] text-white">쉬기</b>
            <span className="text-[13px] text-[var(--text)]">
              원정 체력 <b className="text-[#6dff8f]">+{heal}</b> ({x.hp} → {x.hp + heal})
            </span>
          </button>
          <button type="button" className={card} style={{ "--b": "#c79bff" } as CSSProperties} onClick={() => (go(1), sfx("reward"))}>
            <Icon n="up" size={36} />
            <b className="px-shadow text-[17px] text-white">단련</b>
            <span className="text-[13px] text-[var(--text)]">가장 낮은 등급 유닛 칸이 한 등급 올라요 (레전드까지)</span>
          </button>
        </div>
      );
      break;
    }
    case "act":
      title = "1막 클리어!";
      sub = `${BOSSES[x.boss].name} 처치 — 여기서 돌아갈까, 더 깊이 갈까?`;
      body = (
        <div className="flex w-full max-w-[640px] gap-3">
          <button type="button" className={card} style={{ "--b": "#6dff8f" } as CSSProperties} onClick={() => (go(0), sfx("reward"))}>
            <Icon n="chest" size={36} />
            <b className="px-shadow text-[18px] text-white">귀환</b>
            <span className="text-[13px] leading-snug text-[var(--text)]">원정 성공으로 끝내고 보상을 받아요</span>
          </button>
          <button type="button" className={card} style={{ "--b": "#ff5fa2" } as CSSProperties} onClick={() => (go(1), sfx("boss"))}>
            <Icon n="skull" size={36} />
            <b className="px-shadow text-[18px] text-white">2막 도전</b>
            <span className="text-[13px] leading-snug text-[var(--text)]">
              새 지도 · 더 센 적 · 다른 보스. 원정 체력 <b className="text-[#6dff8f]">+{EXP.act2Heal}</b>, 드래프트 한 등급 위
              <br />
              <b className="text-[var(--gold)]">2막 보스까지 잡으면 보상 ×{EXP.act2Reward}</b> · 쓰러져도 1막 클리어는 그대로
            </span>
          </button>
        </div>
      );
      break;
    case "event": {
      const ev = EVENTS[c.id];
      title = ev.name;
      sub = "? 사건";
      body = (
        <div className="flex w-full max-w-[600px] flex-col items-center gap-3">
          <p className="px-inset w-full px-4 py-3 text-center text-[15px] leading-relaxed text-white">{ev.text}</p>
          <div className="flex w-full gap-3">
            {[ev.a, ev.b].map((t, i) => (
              <button key={i} type="button" className={card} style={{ "--b": i ? "#7a6aa8" : "#9be7ff" } as CSSProperties} onClick={() => go(i)}>
                <b className="px-shadow text-[15px] leading-snug text-white">{t}</b>
              </button>
            ))}
          </div>
        </div>
      );
      break;
    }
  }
  return (
    // 필드 + 오른쪽 패널까지 덮음 (무대 12,56 기준 1000×510)
    <div className="absolute top-0 left-0 z-20 flex flex-col items-center gap-2.5 bg-[#07060f]/95 px-5 py-3 shadow-[0_0_0_2px_#2a2350]" style={{ width: 1000, height: 510 }}>
      <div className="flex w-full items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`${TITLE} px-shadow dfn-pop text-[22px] leading-tight text-white`}>{title}</p>
          <p className="px-shadow text-[12px] text-[var(--mute)]">{sub}</p>
        </div>
        {c.k !== "squad" && <ExpHud b={b} />}
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">{body}</div>
      <div className="flex gap-2">
        {foot}
        {c.k !== "squad" && (
          <Btn className="h-8 px-4 text-[12px]" onClick={() => setHide(true)}>
            판 보기 (소환 · 합성 · 판매) · 시간 멈춤 · 필드 적 {b.enemies.length}/{capOf(b)}
          </Btn>
        )}
      </div>
    </div>
  );
}

const SHOP_ICON: Record<string, string> = { heal: "clover", free: "ticket", epic: "card", legend: "star", relic: "relic", up: "up", uncurse: "flask" };

/** 원정 상태 (체력 · 골드 · 유물 · 저주) */
function ExpHud({ b }: { b: Board }) {
  const x = b.exp!;
  return (
    <div className="px-inset flex shrink-0 flex-col items-end gap-1 px-2.5 py-1.5" title={relicTip(b)}>
      <div className="flex items-center gap-3">
        <HpBar hp={x.hp} max={x.max} />
        <b className="text-[13px] text-[var(--gold)]">
          <Icon n="coin" size={12} /> {b.gold}
        </b>
      </div>
      <div className="flex max-w-[420px] flex-wrap justify-end gap-1">
        {x.relics.map((id) => (
          <span key={id} className="bg-[#123a4a] px-1 text-[11px] font-bold text-[#9be7ff]" title={EXP_RELIC[id]?.desc}>
            {EXP_RELIC[id]?.name}
          </span>
        ))}
        {x.curses.map((id, i) => (
          <span key={`${id}${i}`} className="bg-[#3a1a4a] px-1 text-[11px] font-bold text-[#c79bff]" title={CURSES[id]?.desc}>
            저주 {CURSES[id]?.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 보스 얼굴 */
function BossFace({ boss, size }: { boss: number; size: number }) {
  const d = BOSSES[boss];
  const art = BOSS_ART[d.fighter];
  return art ? (
    <img src={art.src} alt="" className="object-contain" style={{ width: size, height: size }} />
  ) : (
    <img src={`/fight/art/${d.fighter}-face.webp`} alt="" className="object-cover" style={{ width: size, height: size, boxShadow: `0 0 0 2px ${d.color}` }} />
  );
}

/** 분대 고르기 + 이번 원정 보스 · 단계 비틀기 미리보기 */
function SquadView({ b, opts, go }: { b: Board; opts: string[]; go: (a: number) => boolean }) {
  const x = b.exp!;
  const boss = BOSSES[x.boss];
  const twists = EXP_ASC.filter((a) => ascOn(b.mods.town, a.lv));
  return (
    <div className="flex w-full max-w-[860px] flex-col gap-3">
      <div className="flex gap-3">
        {SQUADS.map((q) => {
          const i = opts.indexOf(q.id);
          const r = EXP_RELIC[q.relic];
          const f = q.id as Faction;
          const open = i >= 0;
          return (
            <button
              key={q.id}
              type="button"
              disabled={!open}
              className={`${card} ${open ? "" : "opacity-45"}`}
              style={{ "--b": open ? FACTION_COLOR[f] : "#3d3468" } as CSSProperties}
              onClick={() => (go(i), sfx("reward"))}
            >
              <FactionIcon f={f} size={44} />
              <b className="px-shadow text-[17px] text-white">{q.name}</b>
              <span className="text-[12px] text-[var(--text)]">
                시작 유닛: 레어 2 · 노멀 3 <FactionChip f={f} />
              </span>
              <span className="px-inset w-full px-2 py-1 text-[12px] leading-snug">
                <b className="text-[#9be7ff]">{r.name}</b>
                <br />
                <span className="text-[var(--text)]">{r.desc}</span>
              </span>
              {!open && (
                <b className="text-[12px] text-[var(--dim)]">
                  <Icon n="lock" size={12} /> {q.id === "mech" ? "기사단으로" : "기계공방으로"} 원정에서 이기면 열려요
                </b>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3">
        <div className="px-box flex flex-1 items-center gap-3 px-3 py-2" style={{ "--b": boss.color } as CSSProperties}>
          <BossFace boss={x.boss} size={64} />
          <div className="min-w-0 leading-snug">
            <p className="text-[11px] font-bold tracking-[0.2em] text-[var(--red)]">이번 원정 보스</p>
            <b className="text-[16px]" style={{ color: boss.color }}>
              {boss.name}
            </b>
            <p className="text-[12px] text-[var(--mute)]">{bossDesc(boss)}</p>
          </div>
        </div>
        <div className="px-inset w-[300px] shrink-0 px-3 py-2 text-[12px] leading-snug">
          <b className="text-[#ffb347]">{b.mods.town}단계 비틀기</b>
          {twists.length ? (
            twists.map((a) => (
              <p key={a.lv} className="text-[var(--text)]">
                · {a.desc}
              </p>
            ))
          ) : (
            <p className="text-[var(--dim)]">없음 — 단계를 올리면 하나씩 늘어요</p>
          )}
          <p className="mt-1 text-[var(--mute)]">
            원정 체력 <b className="text-white">{x.max}</b> · 시작 골드 <b className="text-[var(--gold)]">{b.gold}</b>
          </p>
        </div>
      </div>
    </div>
  );
}

const NODE_W = 42;
/** 지도 (왼쪽 출발 → 오른쪽 꼭대기 보스) */
function MapView({ b, go }: { b: Board; go: (a: number) => boolean }) {
  const x = b.exp!;
  const next = expNext(b);
  const [pick, setPick] = useState(-1);
  const [hov, setHov] = useState<[number, number] | null>(null);
  const cols = x.map.length + 1; // 출발 + 층들
  const W = 1000,
    H = 400;
  const px = (c: number) => 40 + (c * (W - 80)) / (cols - 1);
  const py = (lane: number) => 60 + (lane * (H - 100)) / 3;
  const startY = py(1.5);
  const nodeXY = (f: number, i: number): [number, number] => [px(f + 1), py(x.map[f][i].lane)];
  const onPath = (f: number, i: number) => x.trail[f] === i;
  const lines: ReactNode[] = [];
  // 출발 → 1층
  x.map[0].forEach((_, j) => {
    const [bx, by] = nodeXY(0, j);
    const walked = onPath(0, j);
    const live = x.f < 0;
    lines.push(<line key={`s${j}`} x1={px(0)} y1={startY} x2={bx} y2={by} stroke={walked ? "#ffd23f" : live ? "#ffffff" : "#3d3468"} strokeWidth={walked ? 5 : 3} strokeDasharray={walked ? undefined : "8 8"} className={live ? "dfn-dash" : undefined} />);
  });
  x.map.forEach((fl, f) =>
    fl.forEach((n, i) =>
      n.next.forEach((j) => {
        const [ax, ay] = nodeXY(f, i);
        const [bx, by] = nodeXY(f + 1, j);
        const walked = onPath(f, i) && onPath(f + 1, j);
        const live = f === x.f && i === x.i;
        lines.push(
          <line
            key={`${f}-${i}-${j}`}
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke={walked ? "#ffd23f" : live ? "#ffffff" : "#3d3468"}
            strokeWidth={walked ? 5 : live ? 3 : 2}
            strokeDasharray={walked ? undefined : "8 8"}
            className={live ? "dfn-dash" : undefined}
          />
        );
      })
    )
  );
  const info = (() => {
    const at = pick >= 0 ? ([x.f + 1, pick] as [number, number]) : hov;
    if (!at) return null;
    const [f, i] = at;
    const n = x.map[f]?.[i];
    if (!n) return null;
    return { f, i, n };
  })();
  const fightWaves = (k: ExpNode) => (k === "elite" ? EXP.eliteWaves : EXP.fightWaves);
  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="relative min-h-0 flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {lines}
        </svg>
        {/* 층 번호 */}
        {x.map.map((_, f) => (
          <span key={f} className="absolute top-0 -translate-x-1/2 text-[11px] font-bold text-[var(--dim)]" style={{ left: `${(px(f + 1) / W) * 100}%` }}>
            {f === x.map.length - 1 ? "BOSS" : `${f + 1}층`}
          </span>
        ))}
        {/* 출발 */}
        <div className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${(px(0) / W) * 100}%`, top: `${(startY / H) * 100}%` }}>
          <div className={`px-inset flex h-[38px] w-[38px] items-center justify-center ${x.f < 0 ? "dfn-pulse" : ""}`}>
            <Icon n="rift" size={22} />
          </div>
          <b className="text-[11px] text-[var(--mute)]">출발</b>
        </div>
        {x.map.map((fl, f) =>
          fl.map((n, i) => {
            const t = EXP_NODE_TEXT[n.kind];
            const [cx, cy] = nodeXY(f, i);
            const here = f === x.f && i === x.i;
            const can = f === x.f + 1 && next.includes(i);
            const done = onPath(f, i) && !here;
            const past = f <= x.f && !onPath(f, i);
            const boss = n.kind === "boss";
            const sz = boss ? 72 : NODE_W;
            const sel = can && pick === i;
            const tag = n.mod ? FIGHT_MOD[n.mod].name : n.gim ? GIM[n.gim].name : null;
            return (
              <button
                key={`${f}-${i}`}
                type="button"
                disabled={!can}
                data-can={can ? "1" : undefined}
                onPointerEnter={() => setHov([f, i])}
                onPointerLeave={() => setHov(null)}
                onClick={() => {
                  if (!can) return;
                  if (pick === i) {
                    setPick(-1);
                    go(i);
                  } else {
                    setPick(i);
                    sfx("ui-click", 0.9, 1.05);
                  }
                }}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center ${can ? "cursor-pointer" : "cursor-default"}`}
                style={{ left: `${(cx / W) * 100}%`, top: `${(cy / H) * 100}%`, opacity: past ? 0.3 : can || here || done || boss ? 1 : 0.6 }}
                title={`${t.name}${tag ? ` · ${tag}` : ""}\n${t.desc}`}
              >
                <span
                  className={`flex items-center justify-center ${can && !sel ? "dfn-pulse" : ""}`}
                  style={{
                    width: sz,
                    height: sz,
                    background: done ? "#3a3010" : boss ? "#2a0e22" : "#141026",
                    boxShadow: `0 0 0 ${here || sel ? 4 : 2}px ${here ? "#ffffff" : sel ? "#ffd23f" : t.color}, 0 0 0 ${here || sel ? 6 : 4}px #07060f`,
                  }}
                >
                  {boss ? <BossFace boss={x.boss} size={64} /> : <Icon n={t.icon} size={24} />}
                </span>
                <b className="px-shadow mt-1 text-[11px] leading-none whitespace-nowrap" style={{ color: t.color }}>
                  {t.name}
                </b>
                {tag && <span className="px-shadow text-[10px] leading-none whitespace-nowrap text-[#ffb347]">{tag}</span>}
                {here && <b className="absolute -top-4 text-[10px] text-white">지금</b>}
              </button>
            );
          })
        )}
      </div>
      {/* 고른 칸 / 올린 칸 정보 */}
      <div className="px-inset flex h-[64px] shrink-0 items-center gap-3 px-3">
        {info ? (
          (() => {
            const { f, i, n } = info;
            const t = EXP_NODE_TEXT[n.kind];
            const boss = n.kind === "boss";
            const can = f === x.f + 1 && next.includes(i);
            return (
              <>
                <div className="min-w-0 flex-1 leading-snug">
                  <b className="text-[15px]" style={{ color: t.color }}>
                    {boss ? BOSSES[x.boss].name : t.name}
                  </b>
                  <span className="ml-2 text-[12px] text-[var(--mute)]">{f + 1 > EXP.floors ? "꼭대기" : `${f + 1}층`}</span>
                  <p className="truncate text-[12px] text-[var(--text)]">
                    {boss
                      ? bossDesc(BOSSES[x.boss])
                      : n.kind === "fight" || n.kind === "elite"
                        ? `${fightWaves(n.kind)}웨이브 → 정리 ${EXP.cleanSec}초 → 남은 적 하나당 체력 -${EXP.leak}${n.kind === "elite" ? ` (엘리트 -${EXP.leakElite})` : ""} · ${t.desc}`
                        : t.desc}
                  </p>
                  {n.mod && (
                    <p className="text-[12px] text-[#ffb347]">
                      {FIGHT_MOD[n.mod].name} — {FIGHT_MOD[n.mod].desc}
                    </p>
                  )}
                  {n.gim && (
                    <p className="text-[12px]" style={{ color: GIM[n.gim].color }}>
                      {GIM[n.gim].name} — {GIM[n.gim].desc}
                    </p>
                  )}
                </div>
                {can && pick === i && (
                  <Btn tone="main" arrow className="h-10 shrink-0 px-5 text-[15px] font-bold" onClick={() => (setPick(-1), go(i))}>
                    출발
                  </Btn>
                )}
              </>
            );
          })()
        ) : (
          <p className="text-[12px] text-[var(--mute)]">
            반짝이는 칸을 눌러 정보를 보고, 한 번 더 누르면 출발해요. 전투가 끝나면 정리 시간 {EXP.cleanSec}초 — 그때 남은 적만큼 <Heart size={11} /> 원정 체력이 깎여요.
          </p>
        )}
      </div>
    </div>
  );
}
