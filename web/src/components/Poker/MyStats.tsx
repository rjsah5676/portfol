"use client";

import { useState } from "react";
import { fmtEok, fmtShort, type GameKind } from "@/lib/poker/rules";
import type { PlayStats } from "@/lib/poker/types";

/*
 * 마이페이지 통계 탭: 한 게임의 베팅 성향을 차트 몇 개로.
 *   ① 스타일 도넛 (수비 · 따라가기 · 공격 세 묶음) + 스타일 이름
 *   ② 행동별 비율 막대
 *   ③ 성향 지표 막대 (보통 범위 띠와 같이)
 *   ④ 판마다 누적 증감 선 (가리키면 몇 판째 얼마)
 * 색: 세 묶음만 범주색(어두운 바탕에서 검증한 세 칸), 나머지는 한 가지 색.
 */

const C = { attack: "#d95926", follow: "#3987e5", guard: "#199e70" } as const;
const INK = "#e9c879"; // 단색 막대
const MIN_HANDS = 15; // 이보다 적으면 "기록 쌓는 중"

const ACTS: Record<GameKind, { key: string; name: string; group: keyof typeof C }[]> = {
  holdem: [
    { key: "fold", name: "폴드", group: "guard" },
    { key: "check", name: "체크", group: "follow" },
    { key: "call", name: "콜", group: "follow" },
    { key: "bet", name: "벳", group: "attack" },
    { key: "raise", name: "레이즈", group: "attack" },
    { key: "allin", name: "올인", group: "attack" },
  ],
  seven: [
    { key: "die", name: "다이", group: "guard" },
    { key: "bbing", name: "삥", group: "follow" },
    { key: "call", name: "콜", group: "follow" },
    { key: "ddadang", name: "따당", group: "attack" },
    { key: "quarter", name: "쿼터", group: "attack" },
    { key: "half", name: "하프", group: "attack" },
    { key: "allin", name: "올인", group: "attack" },
  ],
};
const GROUP_NAME = { guard: "수비", follow: "따라가기", attack: "공격" } as const;

const pct = (a: number, b: number) => (b > 0 ? a / b : 0);
const pctText = (v: number) => `${Math.round(v * 100)}%`;

/** 스타일 이름 · 한 줄 설명 */
function styleOf(game: GameKind, s: PlayStats): { name: string; desc: string } {
  if (s.hands < MIN_HANDS)
    return { name: "기록 쌓는 중", desc: `${MIN_HANDS}판쯤 치면 스타일이 보여요` };
  const a = s.acts;
  if (game === "holdem") {
    const vpip = pct(s.vpip, s.hands);
    const aggr = (a.bet ?? 0) + (a.raise ?? 0) + (a.allin ?? 0);
    const af = aggr / Math.max(1, a.call ?? 0);
    const tight = vpip < 0.3;
    const hard = af >= 1.4;
    if (tight && hard)
      return { name: "냉철한 사냥꾼", desc: "고른 패로만 들어가서 세게 몰아붙여요" };
    if (!tight && hard) return { name: "폭주 기관차", desc: "아무 패나 들고 일단 올리고 봐요" };
    if (tight) return { name: "신중한 바위", desc: "좋은 패만 들어가고, 들어가면 따라가요" };
    return { name: "끝까지 본다", desc: "넓게 들어가서 콜로 끝까지 따라가요" };
  }
  const die = pct(s.folds, s.hands);
  const bets = (a.ddadang ?? 0) + (a.quarter ?? 0) + (a.half ?? 0) + (a.allin ?? 0);
  const all = bets + (a.bbing ?? 0) + (a.call ?? 0);
  const half = pct(a.half ?? 0, all);
  if (half >= 0.35) return { name: "하프 장인", desc: "기회만 오면 하프부터 질러요" };
  if (die >= 0.55) return { name: "신중한 관망파", desc: "아니다 싶으면 바로 다이" };
  if (pct(bets, all) < 0.25)
    return { name: "삥콜 수비수", desc: "삥 · 콜로 버티며 다음 장을 봐요" };
  return { name: "균형형 승부사", desc: "때로는 지르고 때로는 버텨요" };
}

export default function MyStats({
  stats,
  two,
}: {
  stats: { holdem: PlayStats; seven: PlayStats };
  /** 넓은 화면: 카드를 두 줄로 */
  two?: boolean;
}) {
  const [game, setGame] = useState<GameKind>(() =>
    stats.seven.hands > stats.holdem.hands ? "seven" : "holdem"
  );
  const s = stats[game];
  const acts = ACTS[game];
  const total = acts.reduce((n, x) => n + (s.acts[x.key] ?? 0), 0);
  const groups = (["guard", "follow", "attack"] as const).map((g) => ({
    g,
    n: acts.filter((x) => x.group === g).reduce((n, x) => n + (s.acts[x.key] ?? 0), 0),
  }));
  const style = styleOf(game, s);

  return (
    <div className="grid gap-[0.6em]">
      <div className="pk-seg">
        {(["holdem", "seven"] as const).map((g) => (
          <button key={g} type="button" aria-pressed={game === g} onClick={() => setGame(g)}>
            {g === "holdem" ? "홀덤" : "7포커"}
            <span className="ml-[0.3em] text-[0.82em] opacity-70">{stats[g].hands}판</span>
          </button>
        ))}
      </div>
      <p className="-mt-[0.2em] text-center text-[0.72em] text-white/45">
        최근 30일 · 최대 500판 기준
      </p>

      {s.hands === 0 ? (
        <p className="py-[2em] text-center text-[0.85em] text-white/45">
          아직 {game === "holdem" ? "홀덤" : "7포커"}을 안 쳤어요
        </p>
      ) : (
        <div className={`grid gap-[0.6em] ${two ? "grid-cols-2 items-start" : ""}`}>
          {/* ① 스타일 */}
          <Card title="내 스타일">
            <div className="flex items-center gap-[0.9em]">
              <Donut
                parts={groups.map((x) => ({ v: x.n, color: C[x.g], name: GROUP_NAME[x.g] }))}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[1.25em] leading-tight font-extrabold text-[#ffd84a]">
                  {style.name}
                </div>
                <div className="mt-[0.15em] text-[0.78em] text-white/60">{style.desc}</div>
                <ul className="mt-[0.5em] grid gap-[0.2em] text-[0.8em]">
                  {groups.map((x) => (
                    <li key={x.g} className="flex items-center gap-[0.4em]">
                      <span
                        className="h-[0.7em] w-[0.7em] rounded-[2px]"
                        style={{ background: C[x.g] }}
                      />
                      <span className="text-white/75">{GROUP_NAME[x.g]}</span>
                      <span className="pk-num ml-auto text-white">{pctText(pct(x.n, total))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          {/* ② 행동 비율 */}
          <Card title="행동 비율" note={`행동 ${total.toLocaleString()}번`}>
            <ul className="grid gap-[0.35em]">
              {acts.map((x) => {
                const n = s.acts[x.key] ?? 0;
                const v = pct(n, total);
                return (
                  <li
                    key={x.key}
                    className="grid grid-cols-[3.9em_1fr_3.4em] items-center gap-[0.5em] text-[0.8em]"
                  >
                    <span className="flex items-center gap-[0.3em] font-bold text-white/85">
                      <span
                        className="h-[0.55em] w-[0.55em] rounded-full"
                        style={{ background: C[x.group] }}
                      />
                      {x.name}
                    </span>
                    <Bar v={v} />
                    <span className="pk-num text-right text-white" title={`${n}번`}>
                      {pctText(v)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* ③ 성향 지표 */}
          <Card title="성향 지표" note="띠 = 보통 범위">
            <ul className="grid gap-[0.55em]">
              {meters(game, s).map((m) => (
                <li key={m.name} className="grid gap-[0.2em] text-[0.8em]">
                  <div className="flex items-baseline gap-[0.4em]">
                    <span className="font-bold text-white/85">{m.name}</span>
                    <span className="truncate text-[0.88em] text-white/40">{m.hint}</span>
                    <span className="pk-num ml-auto shrink-0 text-white">{m.text}</span>
                  </div>
                  <Bar v={m.v} band={m.band} />
                </li>
              ))}
            </ul>
          </Card>

          {/* ④ 누적 증감 */}
          <Card title="누적 증감" note={`${s.hands}판`}>
            <Trend points={s.trend} hands={s.hands} />
            <div className="mt-[0.4em] grid grid-cols-2 gap-[0.4em] text-[0.78em]">
              <div className="rounded-[6px] bg-white/[0.05] px-[0.6em] py-[0.35em]">
                <div className="text-white/50">한 판 최고</div>
                <div className="pk-num text-[1.1em] text-[#5ff0b5]">+{fmtEok(s.best)}</div>
              </div>
              <div className="rounded-[6px] bg-white/[0.05] px-[0.6em] py-[0.35em]">
                <div className="text-white/50">한 판 최저</div>
                <div className="pk-num text-[1.1em] text-[#ff8a97]">{fmtEok(s.worst)}</div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function meters(game: GameKind, s: PlayStats) {
  const a = s.acts;
  type M = { name: string; hint: string; v: number; band: [number, number]; text?: string };
  const sd: M = {
    name: "끝까지 간 판",
    hint: "패를 깐 비율",
    v: pct(s.showdowns, s.hands),
    band: [0.2, 0.35],
  };
  const sdw: M = {
    name: "쇼다운 승률",
    hint: "깠을 때 이긴 비율",
    v: pct(s.sdWins, s.showdowns),
    band: [0.45, 0.6],
  };
  const win: M = {
    name: "승률",
    hint: "이긴 판 / 친 판",
    v: pct(s.wins, s.hands),
    band: [0.15, 0.3],
  };
  let list: M[];
  if (game === "holdem") {
    const aggr = (a.bet ?? 0) + (a.raise ?? 0) + (a.allin ?? 0);
    const af = aggr / Math.max(1, a.call ?? 0);
    list = [
      { name: "VPIP", hint: "프리플랍에 돈을 넣은 판", v: pct(s.vpip, s.hands), band: [0.18, 0.3] },
      { name: "PFR", hint: "프리플랍에 레이즈한 판", v: pct(s.pfr, s.hands), band: [0.12, 0.22] },
      {
        name: "3벳",
        hint: "레이즈에 다시 올린 비율",
        v: pct(s.threeBet, s.threeBetChance),
        band: [0.05, 0.12],
      },
      // 공격성(AF): (벳+레이즈)/콜. 0~4 를 0~100% 로
      {
        name: "공격성",
        hint: "(벳+레이즈) ÷ 콜",
        v: Math.min(1, af / 4),
        band: [0.25, 0.5],
        text: af.toFixed(1),
      },
      sd,
      sdw,
    ];
  } else {
    const bets = (a.ddadang ?? 0) + (a.quarter ?? 0) + (a.half ?? 0) + (a.allin ?? 0);
    const all = bets + (a.bbing ?? 0) + (a.call ?? 0);
    list = [
      { name: "하프 비율", hint: "베팅 중 하프", v: pct(a.half ?? 0, all), band: [0.15, 0.3] },
      {
        name: "지르는 비율",
        hint: "따당 · 쿼터 · 하프 · 올인",
        v: pct(bets, all),
        band: [0.3, 0.5],
      },
      { name: "다이 비율", hint: "다이로 끝낸 판", v: pct(s.folds, s.hands), band: [0.4, 0.6] },
      sd,
      sdw,
    ];
  }
  return [...list, win].map((m) => ({ ...m, text: m.text ?? pctText(m.v) }));
}

function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-white/[0.07] bg-white/[0.04] p-[0.75em]">
      <div className="mb-[0.5em] flex items-baseline">
        <span className="pk-frame-title">{title}</span>
        {note && <span className="ml-auto text-[0.7em] text-white/40">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** 0~1 막대. band = 보통 범위 띠 */
function Bar({ v, band }: { v: number; band?: [number, number] }) {
  return (
    <span className="relative block h-[0.7em] overflow-hidden rounded-full bg-white/[0.08]">
      {band && (
        <span
          className="absolute inset-y-0 bg-white/[0.14]"
          style={{ left: `${band[0] * 100}%`, width: `${(band[1] - band[0]) * 100}%` }}
        />
      )}
      <span
        className="absolute inset-y-[2px] left-[2px] rounded-full"
        style={{ width: `max(0px, calc(${Math.min(1, v) * 100}% - 4px))`, background: INK }}
      />
    </span>
  );
}

/** 세 묶음 도넛 (조각 사이 2px 틈) */
function Donut({ parts }: { parts: { v: number; color: string; name: string }[] }) {
  const size = 96;
  const r = 38;
  const w = 13;
  const sum = parts.reduce((n, p) => n + p.v, 0);
  const circ = 2 * Math.PI * r;
  const gap = sum > 0 && parts.filter((p) => p.v > 0).length > 1 ? 2 : 0;
  let off = 0;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="shrink-0"
      role="img"
      aria-label={parts.map((p) => `${p.name} ${pctText(pct(p.v, sum))}`).join(", ")}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={w}
      />
      {sum > 0 &&
        parts.map((p) => {
          const len = (p.v / sum) * circ;
          const seg = (
            <circle
              key={p.name}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth={w}
              strokeDasharray={`${Math.max(0, len - gap)} ${circ}`}
              strokeDashoffset={-off}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${p.name} ${pctText(pct(p.v, sum))}`}</title>
            </circle>
          );
          off += len;
          return seg;
        })}
    </svg>
  );
}

/** 누적 증감 선: 0 기준선 + 가리키면 그 지점 값 */
function Trend({ points, hands }: { points: number[]; hands: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 120;
  const pad = { l: 6, r: 6, t: 10, b: 10 };
  const data = [0, ...points];
  const lo = Math.min(0, ...data);
  const hi = Math.max(0, ...data);
  const span = hi - lo || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, data.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const last = data[data.length - 1];
  const color = last >= 0 ? "#5ff0b5" : "#ff8a97";
  const path = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${path}L${x(data.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const hi2 = hover ?? data.length - 1;
  // 점 하나가 몇 판째인지 (점이 판보다 적으면 묶은 것)
  const handAt = (i: number) => Math.round((i / Math.max(1, data.length - 1)) * hands);
  const pick = (clientX: number, el: SVGSVGElement) => {
    const b = el.getBoundingClientRect();
    const fx = ((clientX - b.left) / b.width) * W;
    const i = Math.round(((fx - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  return (
    <div className="relative">
      <div className="mb-[0.25em] flex items-baseline gap-[0.4em] text-[0.78em]">
        <span className="text-white/50">{hover === null ? "지금까지" : `${handAt(hi2)}판째`}</span>
        <span
          className="pk-num text-[1.15em]"
          style={{ color: data[hi2] >= 0 ? "#5ff0b5" : "#ff8a97" }}
        >
          {data[hi2] > 0 ? "+" : ""}
          {fmtEok(data[hi2])}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full touch-pan-y"
        role="img"
        aria-label={`누적 증감 ${fmtShort(last)}`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={y(0)}
          y2={y(0)}
          stroke="rgba(255,255,255,0.25)"
          strokeDasharray="3 3"
        />
        <path d={area} fill={color} opacity={0.12} />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover !== null && (
          <>
            <line
              x1={x(hi2)}
              x2={x(hi2)}
              y1={pad.t - 6}
              y2={H - pad.b + 6}
              stroke="rgba(255,255,255,0.35)"
            />
            <circle
              cx={x(hi2)}
              cy={y(data[hi2])}
              r={4.5}
              fill={color}
              stroke="#15161c"
              strokeWidth={2}
            />
          </>
        )}
      </svg>
    </div>
  );
}
