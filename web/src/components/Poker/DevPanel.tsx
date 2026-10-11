"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHAR_IDS, CHARS, GAMES, SKINS, TIERS, fmtShort, type CharId, type GameKind, type TierId } from "@/lib/poker/rules";
import type { DevOpts, SeatWire } from "@/lib/poker/types";
import { playBgm, playExact, soundNames } from "@/lib/poker/sfx";
import { devCreate, devSet, sit } from "@/realtime/poker";
import Sheet from "./Sheet";

/*
 * 관리자 전용 개발자 창
 *   테스트 방: 지갑 · 기록 · 로비와 무관한 방을 봇 캐릭터 · 진행 속도 · 쇼다운 속도 · 봇 행동을 골라 엶
 *   음성: 캐릭터(스킨 포함)별 모든 대사 파일을 하나씩 / 차례로 들어 봄
 *   효과음 · 음악: 효과음 · 징글 · 배경음악 전부
 */

type Tab = "room" | "voice" | "sound";

export const SPEEDS: [number, string][] = [
  [0.25, "x4 빠르게"],
  [0.5, "x2 빠르게"],
  [1, "실제"],
  [1.5, "느리게"],
];
export const SD_SPEEDS: [number, string][] = [
  [0.6, "x0.6"],
  [0.8, "x0.8"],
  [1, "실제"],
  [1.2, "x1.2"],
  [1.5, "x1.5"],
];
export const MODES: [DevOpts["mode"], string][] = [
  ["normal", "평소"],
  ["call", "늘 콜 (쇼다운 자주)"],
  ["allin", "늘 올인"],
];
const LIMITS: [number, string][] = [
  [8_000, "8초"],
  [15_000, "15초"],
  [30_000, "30초"],
  [600_000, "10분"],
];

const LOOKS: { id: string; name: string }[] = [
  ...CHAR_IDS.map((c) => ({ id: c, name: CHARS[c].name })),
  ...SKINS.map((s) => ({ id: s.id, name: s.name })),
];

export default function DevPanel({
  mobile,
  maxH,
  onClose,
  onEnter,
}: {
  mobile: boolean;
  maxH: number;
  onClose: () => void;
  onEnter: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("room");
  return (
    <Sheet mobile={mobile} maxH={maxH} wide={640} fill title="개발자 테스트" onClose={onClose}>
      <div className="flex h-full min-h-0 flex-col gap-[0.6em]">
        <div className="pk-seg" role="tablist">
          {(
            [
              ["room", "테스트 방"],
              ["voice", "음성"],
              ["sound", "효과음 · 음악"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-[0.2em]" data-sheet-scroll>
          {tab === "room" ? <RoomTab onEnter={onEnter} /> : tab === "voice" ? <VoiceTab /> : <SoundTab />}
        </div>
      </div>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[0.3em]">
      <div className="text-[0.78em] text-white/55">{label}</div>
      <div className="flex flex-wrap gap-[0.3em]">{children}</div>
    </div>
  );
}

function Pick<T>({ on, v, set, children }: { on: T; v: T; set: (v: T) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => set(v)}
      className={`pk-btn ${on === v ? "pk-btn-gold" : "pk-btn-ghost"} px-[0.7em] py-[0.3em] text-[0.82em]`}
    >
      {children}
    </button>
  );
}

function RoomTab({ onEnter }: { onEnter: (id: string) => void }) {
  const [game, setGame] = useState<GameKind>("seven");
  const [tier, setTier] = useState<TierId>(1);
  const [bots, setBots] = useState<CharId[]>(["jinwoo", "yeonseo", "taeyang", "amy"]);
  const [speed, setSpeed] = useState(1);
  const [sd, setSd] = useState(1);
  const [mode, setMode] = useState<DevOpts["mode"]>("call");
  const [limit, setLimit] = useState(15_000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const max = GAMES[game].seats - 1;
  const t = TIERS.find((x) => x.id === tier)!;
  const toggle = (c: CharId) =>
    setBots((b) => (b.includes(c) ? b.filter((x) => x !== c) : b.length >= max ? b : [...b, c]));
  const open = async () => {
    setBusy(true);
    setErr("");
    try {
      const id = await devCreate({ game, tier, bots: bots.slice(0, max), speed, sd, mode, limit });
      await sit(id);
      onEnter(id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-[0.8em] pb-[0.6em]">
      <p className="text-[0.78em] leading-snug text-white/50">
        지갑 · 전적 · 랭킹 · 로비와 상관없는 나만 보는 방이에요. 칩은 모자라면 판마다 다시 채워져요. 방 안 왼쪽 위
        「테스트」 도구로 속도 · 봇 행동을 바로 바꿀 수 있어요.
      </p>
      <Row label="게임">
        <Pick on={game} v="seven" set={setGame}>
          7포커
        </Pick>
        <Pick on={game} v="holdem" set={setGame}>
          홀덤
        </Pick>
      </Row>
      <Row label={`단계 (판돈 ${fmtShort(t.ante ?? 0)})`}>
        {TIERS.map((x) => (
          <Pick key={x.id} on={tier} v={x.id} set={setTier}>
            {x.name}
          </Pick>
        ))}
      </Row>
      <Row label={`봇 캐릭터 (최대 ${max}명 · ${bots.length}명 고름)`}>
        {CHAR_IDS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            className={`pk-btn ${bots.includes(c) ? "pk-btn-gold" : "pk-btn-ghost"} px-[0.7em] py-[0.3em] text-[0.82em]`}
          >
            {CHARS[c].name}
          </button>
        ))}
      </Row>
      <Row label="진행 속도 (봇 생각 · 카드 돌리기 · 판 사이)">
        {SPEEDS.map(([v, l]) => (
          <Pick key={v} on={speed} v={v} set={setSpeed}>
            {l}
          </Pick>
        ))}
      </Row>
      <Row label="쇼다운 연출 속도 (패 까기 간격 · 결과 뒤 다음 판까지)">
        {SD_SPEEDS.map(([v, l]) => (
          <Pick key={v} on={sd} v={v} set={setSd}>
            {l}
          </Pick>
        ))}
      </Row>
      <Row label="봇 행동">
        {MODES.map(([v, l]) => (
          <Pick key={v} on={mode} v={v} set={setMode}>
            {l}
          </Pick>
        ))}
      </Row>
      <Row label="내 제한 시간">
        {LIMITS.map(([v, l]) => (
          <Pick key={v} on={limit} v={v} set={setLimit}>
            {l}
          </Pick>
        ))}
      </Row>
      {err && <p className="text-[0.82em] text-[#ff8a8a]">{err}</p>}
      <button type="button" disabled={busy || !bots.length} onClick={() => void open()} className="pk-btn pk-btn-gold py-[0.6em] text-[1em]">
        {busy ? "여는 중…" : "테스트 방 열고 앉기"}
      </button>
    </div>
  );
}

/** 이름 목록을 하나씩 차례로 틂 (멈춤 가능) */
function usePlayer() {
  const [now, setNow] = useState<string | null>(null);
  const stopRef = useRef(0);
  const one = async (n: string) => {
    setNow(n);
    const d = await playExact(n);
    window.setTimeout(() => setNow((x) => (x === n ? null : x)), d * 1000);
  };
  const all = async (list: string[]) => {
    const my = ++stopRef.current;
    for (const n of list) {
      if (stopRef.current !== my) return;
      setNow(n);
      const d = await playExact(n);
      await new Promise((r) => setTimeout(r, d * 1000 + 350));
    }
    if (stopRef.current === my) setNow(null);
  };
  const stop = () => {
    stopRef.current++;
    setNow(null);
  };
  return { now, one, all, stop };
}

function useNames() {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    void soundNames().then(setNames);
  }, []);
  return names;
}

function VoiceTab() {
  const names = useNames();
  const [look, setLook] = useState<string>(LOOKS[0].id);
  const p = usePlayer();
  const list = useMemo(() => names.filter((n) => n.startsWith(`voice/${look}/`)), [names, look]);
  const prefix = `voice/${look}/${look}-`;
  return (
    <div className="flex flex-col gap-[0.7em] pb-[0.6em]">
      <Row label="캐릭터">
        {LOOKS.map((l) => (
          <Pick key={l.id} on={look} v={l.id} set={(v) => (p.stop(), setLook(v))}>
            {l.name}
          </Pick>
        ))}
      </Row>
      <div className="flex items-center gap-[0.4em]">
        <span className="text-[0.8em] text-white/55">{list.length}개</span>
        <button type="button" className="pk-btn pk-btn-gold px-[0.8em] py-[0.25em] text-[0.8em]" onClick={() => void p.all(list)}>
          전부 차례로
        </button>
        <button type="button" className="pk-btn pk-btn-ghost px-[0.8em] py-[0.25em] text-[0.8em]" onClick={p.stop}>
          멈춤
        </button>
      </div>
      <div className="grid grid-cols-2 gap-[0.3em] sm:grid-cols-3">
        {list.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => void p.one(n)}
            className={`pk-btn ${p.now === n ? "pk-btn-gold" : "pk-btn-ghost"} truncate px-[0.5em] py-[0.35em] text-left text-[0.8em]`}
            title={n}
          >
            ▶ {n.startsWith(prefix) ? n.slice(prefix.length) : n.split("/").pop()}
          </button>
        ))}
      </div>
    </div>
  );
}

function SoundTab() {
  const names = useNames();
  const p = usePlayer();
  const [bgm, setBgm] = useState<string | null>(null);
  useEffect(() => () => playBgm(null), []);
  const groups: [string, string[]][] = [
    ["효과음", names.filter((n) => n.startsWith("sfx-"))],
    ["징글", names.filter((n) => n.startsWith("jingle-"))],
  ];
  const bgms = names.filter((n) => n.startsWith("bgm-"));
  return (
    <div className="flex flex-col gap-[0.9em] pb-[0.6em]">
      {groups.map(([label, list]) => (
        <div key={label} className="flex flex-col gap-[0.35em]">
          <div className="flex items-center gap-[0.4em]">
            <span className="text-[0.82em] text-white/70">
              {label} · {list.length}개
            </span>
            <button type="button" className="pk-btn pk-btn-ghost px-[0.7em] py-[0.2em] text-[0.76em]" onClick={() => void p.all(list)}>
              전부 차례로
            </button>
            <button type="button" className="pk-btn pk-btn-ghost px-[0.7em] py-[0.2em] text-[0.76em]" onClick={p.stop}>
              멈춤
            </button>
          </div>
          <div className="grid grid-cols-2 gap-[0.3em] sm:grid-cols-3">
            {list.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => void p.one(n)}
                className={`pk-btn ${p.now === n ? "pk-btn-gold" : "pk-btn-ghost"} truncate px-[0.5em] py-[0.35em] text-left text-[0.8em]`}
              >
                ▶ {n}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-[0.35em]">
        <span className="text-[0.82em] text-white/70">배경음악 · {bgms.length}개 (다시 누르면 끔)</span>
        <div className="grid grid-cols-2 gap-[0.3em] sm:grid-cols-3">
          {bgms.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                const next = bgm === n ? null : n;
                setBgm(next);
                playBgm(next);
              }}
              className={`pk-btn ${bgm === n ? "pk-btn-gold" : "pk-btn-ghost"} truncate px-[0.5em] py-[0.35em] text-left text-[0.8em]`}
            >
              {bgm === n ? "■" : "▶"} {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 테스트 방 안 왼쪽 위 도구: 속도 · 쇼다운 배수 · 봇 행동 바로 바꾸기, 칩 채우기, 봇 넣고 빼기, 다음 판, 올인 컷인 미리보기 */
export function DevBar({
  id,
  dev,
  seats,
  onCutin,
}: {
  id: string;
  dev: DevOpts;
  seats: (SeatWire | null)[];
  onCutin: (look: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [add, setAdd] = useState<CharId>("mio");
  const [cut, setCut] = useState<string>(LOOKS[0].id);
  const set = (o: Parameters<typeof devSet>[1]) => {
    setErr("");
    devSet(id, o).catch((e: Error) => setErr(e.message));
  };
  const bots = seats.filter((s): s is SeatWire => !!s && !s.uid);
  const sel = "rounded-[6px] border border-white/15 bg-black/60 px-[0.3em] py-[0.15em] text-[0.95em] text-white";
  return (
    <div className="absolute top-[40px] left-[6px] z-[58] text-[12px]" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pk-btn pk-btn-gold px-[0.7em] py-[0.2em] text-[0.95em]"
      >
        테스트 {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="mt-[4px] flex w-[230px] flex-col gap-[6px] rounded-[10px] border border-[rgba(214,175,92,0.5)] bg-black/85 p-[8px] text-white/85 backdrop-blur-[3px]">
          <label className="flex items-center justify-between gap-[6px]">
            진행 속도
            <select className={sel} value={dev.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
              {SPEEDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-[6px]">
            쇼다운 연출
            <select className={sel} value={dev.sd} onChange={(e) => set({ sd: Number(e.target.value) })}>
              {SD_SPEEDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-[6px]">
            봇 행동
            <select className={sel} value={dev.mode} onChange={(e) => set({ mode: e.target.value as DevOpts["mode"] })}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-[4px]">
            <button type="button" className="pk-btn pk-btn-ghost flex-1 py-[0.2em]" onClick={() => set({ refill: true })}>
              칩 채우기
            </button>
            <button type="button" className="pk-btn pk-btn-ghost flex-1 py-[0.2em]" onClick={() => set({ next: true })}>
              다음 판 바로
            </button>
          </div>
          <div className="flex items-center gap-[4px]">
            <select className={`${sel} flex-1`} value={add} onChange={(e) => setAdd(e.target.value as CharId)}>
              {CHAR_IDS.map((c) => (
                <option key={c} value={c}>
                  {CHARS[c].name}
                </option>
              ))}
            </select>
            <button type="button" className="pk-btn pk-btn-ghost px-[0.6em] py-[0.2em]" onClick={() => set({ addBot: add })}>
              봇 넣기
            </button>
          </div>
          {bots.length > 0 && (
            <div className="flex flex-wrap gap-[4px]">
              {bots.map((b) => (
                <button
                  key={b.seat}
                  type="button"
                  className="pk-btn pk-btn-ghost px-[0.5em] py-[0.1em] text-[0.92em]"
                  title="이 봇 빼기 (판 중이면 판 끝나고)"
                  onClick={() => set({ removeSeat: b.seat })}
                >
                  ✕ {CHARS[b.char]?.name ?? b.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-[4px]">
            <select className={`${sel} flex-1`} value={cut} onChange={(e) => setCut(e.target.value)}>
              {LOOKS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="pk-btn pk-btn-ghost px-[0.6em] py-[0.2em]"
              onClick={() => onCutin(cut, LOOKS.find((l) => l.id === cut)?.name ?? cut)}
            >
              올인 컷인
            </button>
          </div>
          {err && <p className="text-[#ff8a8a]">{err}</p>}
        </div>
      )}
    </div>
  );
}
