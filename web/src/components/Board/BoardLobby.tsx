"use client";

/**
 * 체스·장기·오목 통합 로비: 세 게임 방을 한 목록에서 보고, 빠른 대국(빈자리 바로 앉기 / 없으면 방 만들기)·방 만들기·이어하기.
 */
import Nick from "@/components/Nick";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveRoomPrompt } from "@/components/Chess/ChessLobby";
import { lockScroll } from "@/lib/scrollLock";
import { BOARD_NS, RULES, type BoardN, type Rule } from "@/lib/omok/engine";
import { SETUPS, type Setup } from "@/lib/janggi/engine";
import {
  ActiveRoomError,
  MAX_SPECTATORS,
  WAITING_STALE_MS,
  colorOf,
  isPauseExpired,
  serverNow,
  type Color,
} from "@/firestore/boardRooms";
import { API, GAMES, GAME_KEYS, timeLabel, variantLabel, type AnyRoom, type GameKey } from "./games";

const KR = "font-['Nanum_Gothic',sans-serif]";
const TIME_OPTIONS = [0, 1, 3, 5, 10, 15, 30];
const INC_OPTIONS = [0, 2, 3, 5, 10];
const PREF_KEY = "board:create";

const ghostBtn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/75 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const input =
  "w-full rounded-xl border border-white/10 bg-[#15171c] px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none";

type Room = AnyRoom & { g: GameKey };

/** 로비에 노출할 방인지 */
function isVisible(r: AnyRoom, now: number) {
  const updated = r.updatedAt?.toMillis() ?? now;
  if (r.status === "closed") return false;
  if (r.status === "waiting") return now - updated < WAITING_STALE_MS;
  if (r.status === "playing") return now - updated < 2 * 60 * 60_000;
  return now - updated < 10 * 60_000;
}
const seatOpen = (r: AnyRoom) => r.status === "waiting" && (!r.whiteUid || !r.blackUid);

// ───────────── 방 만들기 설정 (게임별로 마지막 고른 값 기억) ─────────────

interface Prefs {
  color: Color | "r";
  timeMin: number;
  incSec: number;
  setupW: Setup;
  setupB: Setup;
  rule: Rule;
  boardN: BoardN;
}
const DEFAULT_PREFS: Prefs = { color: "r", timeMin: 10, incSec: 0, setupW: "heeh", setupB: "heeh", rule: "renju", boardN: 15 };
function loadPrefs(): Record<GameKey, Prefs> {
  const base = { chess: { ...DEFAULT_PREFS }, janggi: { ...DEFAULT_PREFS }, omok: { ...DEFAULT_PREFS } };
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null") as Partial<Record<GameKey, Partial<Prefs>>> | null;
    if (v) for (const g of GAME_KEYS) base[g] = { ...base[g], ...(v[g] ?? {}) };
  } catch {}
  return base;
}
function savePrefs(p: Record<GameKey, Prefs>) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {}
}
const variantOf = (g: GameKey, p: Prefs) =>
  g === "janggi" ? `${p.setupW}/${p.setupB}` : g === "omok" ? API.omok.makeVariant(p.rule, p.boardN) : "";

// ───────────── 작은 조각들 ─────────────

function Chips<T extends string | number>({
  value,
  options,
  onChange,
  accent,
}: {
  value: T;
  options: { v: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  accent: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={String(o.v)}
            type="button"
            title={o.hint}
            onClick={() => onChange(o.v)}
            className={`cursor-pointer rounded-full border px-3 py-1.5 ${KR} text-xs transition-colors ${
              on ? "font-bold text-[#14121c]" : "border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/10"
            }`}
            style={on ? { background: accent, borderColor: accent } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className={`mb-1.5 ${KR} text-xs text-white/45`}>{label}</div>
      {children}
      {hint && <p className={`mt-1.5 ${KR} text-[11px] text-white/35`}>{hint}</p>}
    </div>
  );
}

export function GameBadge({ g, size = "md" }: { g: GameKey; size?: "sm" | "md" }) {
  const m = GAMES[g];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold ${size === "sm" ? "h-7 w-7 text-sm" : "h-10 w-10 text-lg"}`}
      style={{ background: `${m.accent}22`, color: m.accent, boxShadow: `inset 0 0 0 1px ${m.accent}55` }}
      title={m.name}
    >
      {m.glyph}
    </span>
  );
}

function StatusPill({ r }: { r: AnyRoom }) {
  const [cls, label] =
    r.status === "waiting"
      ? seatOpen(r)
        ? ["bg-emerald-500/15 text-emerald-300", "자리 있음"]
        : ["bg-emerald-500/10 text-emerald-300/70", "시작 대기"]
      : r.status === "playing"
        ? r.pausedAt
          ? ["bg-amber-400/15 text-amber-200", "일시정지"]
          : ["bg-[#6C63FF]/20 text-[#B9B4FF]", "대국 중"]
        : ["bg-white/10 text-white/40", "끝남"];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 ${KR} text-[10.5px] font-bold ${cls}`}>{label}</span>;
}

// ───────────── 방 만들기 창 ─────────────

function CreateSheet({
  initial,
  nick,
  uid,
  onClose,
  onCreated,
  onActive,
}: {
  initial: GameKey;
  nick: string;
  uid: string;
  onClose: () => void;
  onCreated: (g: GameKey, id: string) => void;
  onActive: (g: GameKey, room: AnyRoom) => void;
}) {
  const [g, setG] = useState<GameKey>(initial);
  const [prefs, setPrefs] = useState<Record<GameKey, Prefs>>(() => loadPrefs());
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const p = prefs[g];
  const m = GAMES[g];
  const set = (patch: Partial<Prefs>) => setPrefs((all) => ({ ...all, [g]: { ...all[g], ...patch } }));
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => lockScroll(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    savePrefs(prefs);
    try {
      const id = await API[g].createRoom({
        name: title.trim() || `${nick}의 ${m.name}`,
        uid,
        nick,
        color: p.color,
        timeMin: p.timeMin,
        incSec: p.timeMin ? p.incSec : 0,
        password: password.trim(),
        variant: variantOf(g, p),
      });
      onCreated(g, id);
    } catch (e) {
      setBusy(false);
      if (e instanceof ActiveRoomError) return onActive(g, e.room as AnyRoom);
      console.error(e);
      setErr("방을 만들지 못했어요. 잠시 후 다시 시도해주세요.");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label="방 만들기"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg touch-pan-y overflow-y-auto rounded-t-2xl border border-white/10 bg-[#1C1E24] p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className={`${KR} text-base font-bold text-white`}>방 만들기</div>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-full px-2 text-lg text-white/50 hover:text-white" aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 게임 고르기 */}
        <div className="mb-5 grid grid-cols-3 gap-2">
          {GAME_KEYS.map((k) => {
            const on = k === g;
            const gm = GAMES[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setG(k)}
                className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-2 py-3 transition-colors ${on ? "" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}
                style={on ? { borderColor: gm.accent, background: `${gm.accent}1f` } : undefined}
              >
                <span className="text-2xl leading-none" style={{ color: gm.accent }}>
                  {gm.glyph}
                </span>
                <span className={`${KR} text-sm font-bold ${on ? "text-white" : "text-white/70"}`}>{gm.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-4">
          <input
            ref={titleRef}
            value={title}
            maxLength={20}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && create()}
            placeholder={`방 제목 (비우면 "${nick}의 ${m.name}")`}
            className={input}
          />
          <Field label={`내 ${g === "omok" ? "돌" : g === "janggi" ? "진영" : "색"} (${m.seats[0]}이 먼저 둬요)`}>
            <Chips
              accent={m.accent}
              value={p.color}
              onChange={(color) => set({ color })}
              options={[
                { v: "w", label: `${m.seatMark[0]} ${m.seats[0]}` },
                { v: "b", label: `${m.seatMark[1]} ${m.seats[1]}` },
                { v: "r", label: "랜덤" },
              ]}
            />
          </Field>
          {g === "janggi" && (
            <>
              <Field label="초 상차림">
                <Chips accent={m.accent} value={p.setupW} onChange={(setupW) => set({ setupW })} options={SETUPS} />
              </Field>
              <Field label="한 상차림">
                <Chips accent={m.accent} value={p.setupB} onChange={(setupB) => set({ setupB })} options={SETUPS} />
              </Field>
            </>
          )}
          {g === "omok" && (
            <>
              <Field label="규칙" hint={RULES.find((o) => o.v === p.rule)?.desc}>
                <Chips accent={m.accent} value={p.rule} onChange={(rule) => set({ rule })} options={RULES} />
              </Field>
              <Field label="판">
                <Chips accent={m.accent} value={p.boardN} onChange={(boardN) => set({ boardN })} options={BOARD_NS} />
              </Field>
            </>
          )}
          <Field label="제한 시간 (1인당)">
            <Chips
              accent={m.accent}
              value={p.timeMin}
              onChange={(timeMin) => set({ timeMin })}
              options={TIME_OPTIONS.map((v) => ({ v, label: v === 0 ? "무제한" : `${v}분` }))}
            />
          </Field>
          {p.timeMin > 0 && (
            <Field label="한 수 둘 때마다 추가">
              <Chips
                accent={m.accent}
                value={p.incSec}
                onChange={(incSec) => set({ incSec })}
                options={INC_OPTIONS.map((v) => ({ v, label: v === 0 ? "없음" : `+${v}초` }))}
              />
            </Field>
          )}
          {showPw ? (
            <input
              value={password}
              maxLength={20}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 (초대 링크로 들어오면 비번 없이 입장)"
              aria-label="비밀번호"
              className={input}
            />
          ) : (
            <button type="button" onClick={() => setShowPw(true)} className={`w-fit cursor-pointer ${KR} text-xs text-white/45 underline-offset-2 hover:text-white/80 hover:underline`}>
              🔒 비밀번호 걸기
            </button>
          )}
          {err && <p className={`${KR} text-xs text-red-300`}>{err}</p>}
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className={`mt-1 cursor-pointer rounded-xl py-3 ${KR} text-sm font-bold text-[#14121c] transition-opacity hover:opacity-90 disabled:opacity-50`}
            style={{ background: m.accent }}
          >
            {busy ? "만드는 중…" : `${m.name} 방 만들기`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────── 로비 ─────────────

export default function BoardLobby({
  uid,
  nick,
  filter,
  onFilter,
  onChangeNick,
  onEnter,
}: {
  uid: string;
  nick: string;
  /** null = 전체 */
  filter: GameKey | null;
  onFilter: (g: GameKey | null) => void;
  onChangeNick: () => void;
  onEnter: (g: GameKey, roomId: string, as?: "play" | "watch") => void;
}) {
  const [rooms, setRooms] = useState<Record<GameKey, AnyRoom[]>>({ chess: [], janggi: [], omok: [] });
  const [loaded, setLoaded] = useState<Record<GameKey, boolean>>({ chess: false, janggi: false, omok: false });
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => serverNow());
  const [creating, setCreating] = useState<GameKey | null>(null);
  const [quickPick, setQuickPick] = useState(false);
  const [busy, setBusy] = useState(false);

  const prompts = {
    chess: useActiveRoomPrompt((id) => onEnter("chess", id)),
    janggi: useActiveRoomPrompt((id) => onEnter("janggi", id)),
    omok: useActiveRoomPrompt((id) => onEnter("omok", id)),
  };

  useEffect(() => {
    const offs = GAME_KEYS.map((g) =>
      API[g].subscribeRooms(
        (list) => {
          setRooms((r) => ({ ...r, [g]: list as AnyRoom[] }));
          setLoaded((l) => ({ ...l, [g]: true }));
        },
        (e) => {
          console.error(e);
          setError("방 목록을 불러오지 못했어요.");
          setLoaded((l) => ({ ...l, [g]: true }));
        }
      )
    );
    return () => offs.forEach((off) => off());
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 15_000);
    return () => clearInterval(t);
  }, []);
  // 빠른 대국 게임 고르기: 바깥을 누르거나 Esc 면 닫힘
  const quickRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!quickPick) return;
    const onDown = (e: PointerEvent) => {
      if (!quickRef.current?.contains(e.target as Node)) setQuickPick(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setQuickPick(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [quickPick]);

  const { mine, open, counts } = useMemo(() => {
    const mine: Room[] = [];
    const open: Room[] = [];
    const counts = {} as Record<GameKey, { wait: number; play: number }>;
    for (const g of GAME_KEYS) {
      counts[g] = { wait: 0, play: 0 };
      for (const r of rooms[g]) {
        if (isPauseExpired(r, now)) continue;
        if (colorOf(r, uid) && (r.status === "playing" || r.status === "waiting")) {
          mine.push({ ...r, g });
          continue;
        }
        if (!isVisible(r, now)) continue;
        open.push({ ...r, g });
        if (seatOpen(r)) counts[g].wait++;
        else if (r.status === "playing") counts[g].play++;
      }
    }
    // 자리 있는 방 → 대국 중 → 끝난 방, 같은 상태면 최근 순
    const rank = (r: AnyRoom) => (seatOpen(r) ? 0 : r.status === "waiting" ? 1 : r.status === "playing" ? 2 : 3);
    open.sort((a, b) => rank(a) - rank(b) || (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0));
    return { mine, open, counts };
  }, [rooms, uid, now]);

  const shown = filter ? open.filter((r) => r.g === filter) : open;
  const allLoaded = GAME_KEYS.every((g) => loaded[g]);

  async function join(g: GameKey, id: string) {
    const active = await API[g].findMyActiveRoom(uid).catch(() => null);
    if (active && active.id !== id) return prompts[g](active);
    onEnter(g, id, "play");
  }

  /** 빠른 대국: 그 게임의 비번 없는 빈자리에 바로 앉고, 없으면 마지막 설정으로 방을 만들어 기다림 */
  async function quick(g: GameKey) {
    setQuickPick(false);
    if (busy) return;
    setBusy(true);
    try {
      const active = await API[g].findMyActiveRoom(uid).catch(() => null);
      if (active) return void onEnter(g, active.id);
      const cand = open
        .filter((r) => r.g === g && seatOpen(r) && !r.locked)
        .sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0))[0];
      if (cand) return void onEnter(g, cand.id, "play");
      const p = loadPrefs()[g];
      const id = await API[g].createRoom({
        name: `${nick}의 ${GAMES[g].name}`,
        uid,
        nick,
        color: p.color,
        timeMin: p.timeMin,
        incSec: p.timeMin ? p.incSec : 0,
        password: "",
        variant: variantOf(g, p),
      });
      onEnter(g, id);
    } catch (e) {
      if (e instanceof ActiveRoomError) return void prompts[g](e.room);
      console.error(e);
      setError("빠른 대국을 시작하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  const filterChip = (g: GameKey | null, label: React.ReactNode, n: number) => {
    const on = filter === g;
    const accent = g ? GAMES[g].accent : "#6C63FF";
    return (
      <button
        key={g ?? "all"}
        type="button"
        onClick={() => onFilter(g)}
        className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 ${KR} text-sm transition-colors ${
          on ? "font-bold text-white" : "border-white/10 text-white/55 hover:text-white"
        }`}
        style={on ? { borderColor: accent, background: `${accent}26` } : undefined}
      >
        {label}
        <span className={`rounded-full px-1.5 font-mono text-[10px] ${on ? "bg-white/20" : "bg-white/[0.06]"}`}>{n}</span>
      </button>
    );
  };

  return (
    <div className="pt-4 pb-24">
      {/* 위: 닉네임 · 빠른 대국 · 방 만들기 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onChangeNick} className={ghostBtn} title="닉네임 바꾸기">
          👤 {nick} <span className="text-white/35">· 변경</span>
        </button>
        <div className="flex gap-2">
          <div className="relative" ref={quickRef}>
            <button
              type="button"
              disabled={busy}
              onClick={() => (filter ? quick(filter) : setQuickPick((v) => !v))}
              className={`cursor-pointer rounded-full border border-[#6C63FF]/60 bg-[#6C63FF]/15 px-4 py-2 ${KR} text-sm font-bold text-white transition-colors hover:bg-[#6C63FF]/30 disabled:opacity-50`}
              title="빈자리에 바로 앉고, 없으면 방을 만들어 상대를 기다려요"
            >
              ⚡ 빠른 대국{filter ? ` · ${GAMES[filter].name}` : ""}
            </button>
            {quickPick && (
              <div className="absolute right-0 z-20 mt-2 flex w-44 flex-col gap-1 rounded-xl border border-white/10 bg-[#1C1E24] p-1.5 shadow-xl">
                {GAME_KEYS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => quick(g)}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left ${KR} text-sm text-white/80 hover:bg-white/10`}
                  >
                    <GameBadge g={g} size="sm" />
                    {GAMES[g].name}
                    {counts[g].wait > 0 && <span className="ml-auto font-mono text-[10px] text-emerald-300">빈자리 {counts[g].wait}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCreating(filter ?? "chess")}
            className={`cursor-pointer rounded-full bg-[#6C63FF] px-4 py-2 ${KR} text-sm font-bold text-white transition-colors hover:bg-[#5b52f0]`}
          >
            + 방 만들기
          </button>
        </div>
      </div>

      {/* 진행 중인 내 대국 (세 게임 모두) */}
      {mine.length > 0 && (
        <div className="mb-4 rounded-2xl border border-[#6C63FF]/40 bg-[#6C63FF]/10 p-2">
          <div className={`px-2 pt-1 pb-1.5 ${KR} text-xs font-bold text-[#B9B4FF]`}>진행 중인 내 대국</div>
          {mine.map((r) => (
            <button
              key={`${r.g}:${r.id}`}
              type="button"
              onClick={() => onEnter(r.g, r.id)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5"
            >
              <GameBadge g={r.g} size="sm" />
              <span className={`min-w-0 flex-1 truncate ${KR} text-sm text-white/85`}>
                {r.locked && "🔒 "}
                {r.name}
              </span>
              {r.status === "waiting" ? (
                <span className={`shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 ${KR} text-[10.5px] font-bold text-emerald-300`}>
                  {seatOpen(r) ? "상대 기다리는 중" : "시작 대기"}
                </span>
              ) : (
                <StatusPill r={r} />
              )}
              <span className={`shrink-0 ${KR} text-xs font-bold text-[#B9B4FF]`}>이어하기 →</span>
            </button>
          ))}
        </div>
      )}

      {/* 게임 거르기 */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {filterChip(null, "전체", open.length)}
        {GAME_KEYS.map((g) =>
          filterChip(
            g,
            <>
              <span style={{ color: filter === g ? undefined : GAMES[g].accent }}>{GAMES[g].glyph}</span>
              {GAMES[g].name}
            </>,
            open.filter((r) => r.g === g).length
          )
        )}
      </div>

      {error && <p className={`mb-2 ${KR} text-xs text-red-300`}>{error}</p>}

      {/* 방 목록 */}
      <div className="flex flex-col gap-1.5">
        {!allLoaded && shown.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-[#1C1E24] py-10 text-center font-mono text-sm text-white/30">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#1C1E24] px-4 py-10 text-center">
            <p className={`${KR} text-sm text-white/45`}>
              {filter ? `열린 ${GAMES[filter].name} 방이 없어요.` : "열린 방이 없어요."}
              <br />
              빠른 대국을 누르면 방을 만들고 상대를 기다려요.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => (filter ? quick(filter) : setQuickPick(true))}
              className={`cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 ${KR} text-sm font-bold text-white hover:bg-[#5b52f0] disabled:opacity-50`}
            >
              ⚡ 빠른 대국
            </button>
          </div>
        ) : (
          shown.map((r) => {
            const m = GAMES[r.g];
            const spec = Object.keys(r.spectators).length;
            const vl = variantLabel(r.g, r.variant);
            const canJoin = seatOpen(r);
            return (
              <div
                key={`${r.g}:${r.id}`}
                className={`group flex items-center gap-3 rounded-2xl border bg-[#1C1E24] px-3 py-3 transition-colors sm:px-4 ${
                  canJoin ? "border-emerald-400/20 hover:border-emerald-400/45" : "border-white/[0.07] hover:border-white/20"
                }`}
              >
                <GameBadge g={r.g} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusPill r={r} />
                    <span className={`truncate ${KR} text-sm font-bold text-white/90`}>
                      {r.locked && "🔒 "}
                      {r.name}
                    </span>
                  </div>
                  <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 ${KR} text-xs text-white/45`}>
                    <span>
                      <span style={{ color: m.seatColor[0] }}>{m.seatMark[0]}</span>{" "}
                      {r.whiteName ? <Nick name={r.whiteName} /> : <span className="text-white/25">빈자리</span>}
                      <span className="px-1.5 text-white/25">vs</span>
                      <span style={{ color: m.seatColor[1] }}>{m.seatMark[1]}</span>{" "}
                      {r.blackName ? <Nick name={r.blackName} /> : <span className="text-white/25">빈자리</span>}
                    </span>
                    <span className="text-white/25">·</span>
                    <span className="font-mono text-[11px]">{timeLabel(r)}</span>
                    {vl && (
                      <>
                        <span className="text-white/25">·</span>
                        <span>{vl}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                  {canJoin && (
                    <button
                      type="button"
                      onClick={() => join(r.g, r.id)}
                      className={`cursor-pointer rounded-full bg-emerald-500/90 px-3.5 py-1.5 ${KR} text-xs font-bold text-[#0c1a12] transition-colors hover:bg-emerald-400`}
                    >
                      참여
                    </button>
                  )}
                  {r.status !== "ended" && (
                    <button
                      type="button"
                      disabled={spec >= MAX_SPECTATORS}
                      onClick={() => onEnter(r.g, r.id, "watch")}
                      className={ghostBtn}
                      title={`관전 ${spec}/${MAX_SPECTATORS}`}
                    >
                      관전 {spec}/{MAX_SPECTATORS}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {creating && (
        <CreateSheet
          initial={creating}
          nick={nick}
          uid={uid}
          onClose={() => setCreating(null)}
          onCreated={(g, id) => {
            setCreating(null);
            onEnter(g, id);
          }}
          onActive={(g, room) => {
            setCreating(null);
            prompts[g](room);
          }}
        />
      )}
    </div>
  );
}
