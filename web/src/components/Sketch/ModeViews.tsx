"use client";

/*
 * DOODLE PARTY — 그림 맞히기 말고 다른 모드의 가운데 화면 (도화지 자리)
 *   가짜 화가(f-*) · 그림 속 거짓말(l-*) · 그림 릴레이(r-*)
 * 대기실 · 최종 결과는 SketchRoom 이 같이 그림.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { plainName } from "@/components/Nick";
import { avatarOf } from "@/lib/sketch/assets";
import { FAKE_LAPS, LIKE_EMOJI, MODE_MS, MODES } from "@/lib/sketch/modes";
import { randomStarter } from "@/lib/sketch/prompts";
import { playSfx } from "@/lib/sketch/sfx";
import {
  likeDrawing,
  pickOption,
  submitSheet,
  submitText,
  subscribeAlbum,
  subscribeSecret,
  subscribeSheet,
  tick,
  voteFake,
  type FakeSecret,
  type FakeState,
  type LieSecret,
  type LieState,
  type RelayEntry,
  type RelaySecret,
  type RelayState,
  type SketchRoom as Room,
  type Stroke,
} from "@/realtime/sketch";
import { Avatar, Icon, Mascot, Who } from "./Art";
import SketchCanvas, {
  localSource,
  serverSource,
  staticSource,
  type CanvasApi,
  type LocalSource,
} from "./SketchCanvas";
import Toolbar, { useTools } from "./Toolbar";
import { tap } from "./stage";

export type AnySecret = FakeSecret | LieSecret | RelaySecret | null;

/** 지금 단계가 다른 모드의 진행 중 단계인지 */
export const isModePhase = (phase: string) => /^[flr]-/.test(phase);

/** 단계 전체 시간 (시간 원 비율) */
export function phaseTotal(room: Room): number {
  const p = room.state.phase;
  const draw = room.meta.drawTime * 1000;
  return (
    (
      {
        "f-draw": MODE_MS.fakeStroke,
        "f-vote": MODE_MS.fakeVote,
        "f-guess": MODE_MS.fakeGuess,
        "f-result": MODE_MS.fakeResult,
        "l-draw": Math.max(60_000, draw),
        "l-write": MODE_MS.lieWrite,
        "l-pick": MODE_MS.liePick,
        "l-show": MODE_MS.lieShow,
        "r-write": MODE_MS.relayWrite,
        "r-draw": draw,
        "r-desc": MODE_MS.relayDesc,
        "r-album": MODE_MS.relayPage,
      } as Record<string, number>
    )[p] ?? 1
  );
}

/** 나만 아는 것 구독 (다른 모드일 때만) */
export function useSecret(roomId: string, on: boolean): AnySecret {
  const [v, setV] = useState<AnySecret>(null);
  useEffect(() => {
    if (!on) {
      setV(null); // eslint-disable-line react-hooks/set-state-in-effect -- 모드가 아니면 비움
      return;
    }
    return subscribeSecret<AnySecret>(roomId, setV);
  }, [roomId, on]);
  return v;
}

/** 따로 그린 그림 한 장 (볼 수 있게 되면 단계가 바뀌므로 step 으로 다시 구독) */
function useSheet(roomId: string, key: string | null | undefined, step: number) {
  const [v, setV] = useState<{ key: string; strokes: Stroke[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    return subscribeSheet(roomId, key, (s) => setV(s ? { key, strokes: s } : null));
  }, [roomId, key, step]);
  return v && v.key === key ? v.strokes : null;
}

/** 이름 (비회원 표시 없이) */
const nameOf = (room: Room, uid: string) =>
  plainName(room.players[uid]?.nick ?? room.scores[uid]?.nick ?? "?");

// ───────────── 작은 조각들 ─────────────

/** 다 그린 그림 보여 주기 */
function SheetView({
  id,
  strokes,
  children,
}: {
  id: string;
  strokes: Stroke[] | null;
  children?: ReactNode;
}) {
  const source = useMemo(() => (strokes ? staticSource(id, strokes) : null), [id, strokes]);
  return (
    <SketchCanvas source={source} canDraw={false} tool="pen" color="#000" width={7}>
      {!strokes && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="sk-hand text-[18px] text-[var(--ink3)]">그림 불러오는 중…</p>
        </div>
      )}
      {children}
    </SketchCanvas>
  );
}

/** 따봉 — 누르면 엄지가 위로 떠오름. 내 그림 · 이미 누른 건 못 누름 */
export function LikeButton({
  room,
  uid,
  likeKey,
  author,
  big = false,
}: {
  room: Room;
  uid: string;
  likeKey: string;
  author: string;
  big?: boolean;
}) {
  const list = room.state.likes?.[likeKey] ?? [];
  const mine = author === uid;
  const done = list.includes(uid);
  const n = list.length;
  // 새로 눌린 만큼 엄지가 떠오름 (남이 누른 것도)
  const [floats, setFloats] = useState<number[]>([]);
  const prev = useRef(n);
  useEffect(() => {
    const add = n - prev.current;
    prev.current = n;
    if (add <= 0) return;
    const ks = Array.from({ length: Math.min(add, 5) }, (_, i) => Date.now() + i);
    setFloats((f) => [...f, ...ks]);
    const t = setTimeout(() => setFloats((f) => f.filter((x) => !ks.includes(x))), 1400);
    return () => clearTimeout(t);
  }, [n]);
  return (
    <button
      type="button"
      disabled={mine || done}
      onClick={() => {
        playSfx("sfx-like");
        likeDrawing(room.id, likeKey);
      }}
      title={mine ? "내 그림이에요" : done ? "따봉 보냄!" : "이 그림 좋아요"}
      className={`sk-btn relative shrink-0 ${done ? "sk-btn-sun" : ""} ${big ? "text-[20px]" : "px-3 text-[16px]"}`}
    >
      <span className={done ? "sk-pop inline-block" : "inline-block"}>{LIKE_EMOJI}</span>
      <span className="sk-hand">{n}</span>
      {floats.map((k, i) => (
        <span
          key={k}
          className="sk-like-float pointer-events-none absolute -top-2 left-1/2 text-[22px]"
          style={{ ["--dx" as string]: `${(i % 3) * 14 - 14}px` }}
        >
          {LIKE_EMOJI}
        </span>
      ))}
    </button>
  );
}

/** 글 내기 칸 (Enter). 시간이 거의 끝나면 적어 둔 걸 알아서 냄 */
function TextBox({
  placeholder,
  max,
  remaining,
  onSubmit,
  extra,
  big,
}: {
  placeholder: string;
  max: number;
  remaining: number;
  onSubmit: (text: string) => Promise<void>;
  extra?: (set: (t: string) => void) => ReactNode;
  big?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 처음 보일 때 입력칸으로 (페이지가 밀리지 않게)
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  const send = async (t = text) => {
    const v = t.trim();
    if (!v || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit(v);
      playSfx("sfx-submit");
    } catch (e) {
      playSfx("sfx-error");
      setErr((e as Error).message || "못 보냈어요. 다시 해 주세요");
      setBusy(false);
    }
  };
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const auto = useRef(false);
  useEffect(() => {
    if (remaining > 0 && remaining < 900 && !auto.current) {
      auto.current = true;
      void sendRef.current();
    }
  }, [remaining]);
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
          }}
          maxLength={max}
          placeholder={placeholder}
          enterKeyHint="send"
          autoComplete="off"
          className={`sk-input min-w-0 flex-1 ${big ? "py-2.5 text-[17px]" : "py-2 text-[15.5px]"}`}
        />
        {extra?.(setText)}
        <button
          type="button"
          disabled={!text.trim() || busy}
          onClick={() => void send()}
          className="sk-btn sk-btn-coral shrink-0 text-[17px]"
        >
          <Icon name="send" size={16} /> 내기
        </button>
      </div>
      {err && <p className="text-[12.5px] font-bold text-[var(--coral)]">{err}</p>}
    </div>
  );
}

/** 낸 사람 · 아직 안 낸 사람 */
function Waiting({
  room,
  need,
  done,
  text,
}: {
  room: Room;
  need: string[];
  done: string[];
  text: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Mascot pose="idle" size={64} />
      <p className="sk-hand text-[20px] leading-tight">{text}</p>
      <div className="flex flex-wrap justify-center gap-1">
        {need.map((u) => (
          <span
            key={u}
            className={`relative ${done.includes(u) ? "" : "opacity-35 grayscale"}`}
            title={nameOf(room, u)}
          >
            <Avatar idx={avatarOf(u)} size={30} />
            {done.includes(u) && (
              <span className="absolute -right-1 -bottom-1 rounded-full bg-[var(--mint)] px-0.5 text-[9px] font-extrabold text-white">
                ✓
              </span>
            )}
          </span>
        ))}
      </div>
      <p className="text-[12px] font-bold text-[var(--ink3)]">
        {done.filter((u) => need.includes(u)).length}/{need.length}명 냈어요
      </p>
    </div>
  );
}

/** 혼자 그리는 도화지 + 도구 + 「다 그렸어요」. 시간이 거의 끝나면 그린 데까지 알아서 냄 */
function DrawPad({
  roomId,
  step,
  v,
  remaining,
  head,
}: {
  roomId: string;
  step: number;
  v: boolean;
  remaining: number;
  head: ReactNode;
}) {
  const t = useTools();
  const apiRef = useRef<CanvasApi | null>(null);
  const [src] = useState<LocalSource>(() => localSource(`pad-${roomId}-${step}`));
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await submitSheet(roomId, step, src.all());
      playSfx("sfx-submit");
    } catch {
      playSfx("sfx-error");
      setBusy(false);
    }
  };
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const auto = useRef(false);
  useEffect(() => {
    if (remaining > 0 && remaining < 1200 && !auto.current) {
      auto.current = true;
      void sendRef.current();
    }
  }, [remaining]);
  const done = (
    <button
      type="button"
      disabled={busy}
      onClick={tap(() => void send())}
      className={`sk-btn sk-btn-coral shrink-0 ${v ? "text-[16px]" : "text-[19px]"}`}
    >
      ✔ 다 그렸어요
    </button>
  );
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">{head}</div>
        {!v && done}
      </div>
      <div className={v ? "w-full" : "mx-auto w-[612px]"}>
        <SketchCanvas
          source={src}
          canDraw={!busy}
          tool={t.tool}
          color={t.color}
          width={t.width}
          apiRef={apiRef}
        />
      </div>
      <Toolbar compact={v} t={t} apiRef={apiRef} />
      {v && done}
    </div>
  );
}

/** 도화지 위 안내 칸 */
function Note({
  children,
  tone = "sun",
}: {
  children: ReactNode;
  tone?: "sun" | "coral" | "grape" | "mint";
}) {
  const bg = { sun: "#FFF4CC", coral: "#FFE1DF", grape: "#EEE3FB", mint: "#D9F5F1" }[tone];
  return (
    <div
      className="sk-card-soft flex items-center gap-2 px-3 py-2 text-[14px] font-bold"
      style={{ background: bg }}
    >
      {children}
    </div>
  );
}

// ───────────── 상태 줄 (머리) ─────────────

export function modeStatus(room: Room, uid: string, secret: AnySecret, big: boolean): ReactNode {
  const st = room.state;
  const m = st.m;
  const fs = big ? 24 : 18;
  if (!m) return null;
  if (m.kind === "fake") {
    const s = secret as FakeSecret | null;
    const topic = (
      <span className="shrink-0 rounded-full border-2 border-[var(--ink)] bg-[var(--sky)] px-2 py-0.5 text-[12px] font-extrabold text-white">
        주제 · {m.topic}
      </span>
    );
    if (st.phase === "f-result")
      return (
        <span className="flex items-center gap-2">
          {topic}
          <span className="sk-hand" style={{ fontSize: fs }}>
            제시어 「{m.word}」
          </span>
        </span>
      );
    return (
      <span className="flex min-w-0 items-center gap-2">
        {topic}
        {s?.faker ? (
          <span className="sk-hand truncate text-[var(--coral)]" style={{ fontSize: fs }}>
            🕵️ 내가 가짜 화가! 들키지 마요
          </span>
        ) : s?.word ? (
          <span className="sk-hand truncate" style={{ fontSize: fs }}>
            제시어 「{s.word}」
          </span>
        ) : (
          <span className="sk-hand truncate text-[var(--ink2)]" style={{ fontSize: fs }}>
            관전 중
          </span>
        )}
      </span>
    );
  }
  if (m.kind === "lie") {
    const s = secret as LieSecret | null;
    if (st.phase === "l-draw")
      return s?.prompt ? (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-full border-2 border-[var(--ink)] bg-[var(--sun)] px-2 py-0.5 text-[12px] font-extrabold">
            그릴 것
          </span>
          <span className="sk-hand truncate" style={{ fontSize: fs }}>
            {s.prompt}
          </span>
        </span>
      ) : (
        <span className="sk-hand" style={{ fontSize: fs }}>
          다들 그리는 중…
        </span>
      );
    const label =
      st.phase === "l-write"
        ? "가짜 제목 짓기"
        : st.phase === "l-pick"
          ? "진짜 제목은?"
          : "정답 공개!";
    return (
      <span className="flex items-center gap-2">
        <span className="sk-hand" style={{ fontSize: fs }}>
          {label}
        </span>
        <span className="text-[12px] font-bold text-[var(--ink3)]">
          {m.idx + 1}/{m.order.length}번째 그림
        </span>
      </span>
    );
  }
  const s = secret as RelaySecret | null;
  if (st.phase === "r-album")
    return (
      <span className="sk-hand" style={{ fontSize: fs }}>
        📖 앨범 {(m.album?.chain ?? 0) + 1}/{m.order.length}
      </span>
    );
  const what =
    st.phase === "r-write"
      ? "첫 문장 쓰기"
      : st.phase === "r-draw"
        ? "문장을 그림으로"
        : "그림을 문장으로";
  return (
    <span className="flex items-center gap-2">
      <span className="sk-hand" style={{ fontSize: fs }}>
        {what}
      </span>
      <span className="text-[12px] font-bold text-[var(--ink3)]">
        {m.step + 1}/{m.steps}단계{s?.done ? " · 냈어요 ✓" : ""}
      </span>
    </span>
  );
}

// ───────────── 가운데 ─────────────

export default function ModeCenter({
  room,
  uid,
  v,
  remaining,
  isLeader,
  secret,
}: {
  room: Room;
  uid: string;
  v: boolean;
  remaining: number;
  isLeader: boolean;
  secret: AnySecret;
}) {
  const m = room.state.m;
  if (!m) return null;
  if (m.kind === "fake")
    return <FakeCenter room={room} uid={uid} v={v} m={m} secret={secret as FakeSecret | null} />;
  if (m.kind === "lie")
    return (
      <LieCenter
        room={room}
        uid={uid}
        v={v}
        m={m}
        secret={secret as LieSecret | null}
        remaining={remaining}
      />
    );
  return (
    <RelayCenter
      room={room}
      uid={uid}
      v={v}
      m={m}
      secret={secret as RelaySecret | null}
      remaining={remaining}
      isLeader={isLeader}
    />
  );
}

// ── 가짜 화가 ──

function FakeCenter({
  room,
  uid,
  v,
  m,
  secret,
}: {
  room: Room;
  uid: string;
  v: boolean;
  m: FakeState;
  secret: FakeSecret | null;
}) {
  const st = room.state;
  const t = useTools();
  const apiRef = useRef<CanvasApi | null>(null);
  const source = useMemo(() => serverSource(room.id, st.turnId), [room.id, st.turnId]);
  const myColor = m.colors[uid];
  const myTurn = st.phase === "f-draw" && st.drawer === uid;
  const total = m.order.length * FAKE_LAPS;
  const voting = st.phase === "f-vote";
  const iVoted = m.voted.includes(uid);
  const inGame = m.order.includes(uid);
  const isFaker = !!secret?.faker;

  // 순서 · 색 줄
  const orderRow = (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {m.order.map((u) => {
        const now = st.phase === "f-draw" && m.order[m.at % m.order.length] === u;
        return (
          <span
            key={u}
            className={`flex items-center gap-1 rounded-full border-2 py-0.5 pr-2 pl-0.5 text-[12px] font-bold ${now ? "border-[var(--ink)] bg-[var(--sun)]" : "border-transparent bg-white/70"} ${room.players[u] ? "" : "opacity-40"}`}
          >
            <Avatar idx={avatarOf(u)} size={22} />
            <span
              className="h-3 w-3 rounded-full border border-[var(--ink)]"
              style={{ background: m.colors[u] }}
            />
            <span className="max-w-[5.5em] truncate">{nameOf(room, u)}</span>
          </span>
        );
      })}
    </div>
  );

  let below: ReactNode = null;
  if (st.phase === "f-draw")
    below = myTurn ? (
      <Toolbar
        compact={v}
        t={t}
        apiRef={apiRef}
        colors={[myColor]}
        noFill
        noEraser
        noUndo
        extra={
          <span className="flex min-w-0 flex-1 items-center gap-2 text-[14px] font-bold">
            <span
              className="h-5 w-5 shrink-0 rounded-full border-2 border-[var(--ink)]"
              style={{ background: myColor }}
            />
            <span className="min-w-0 flex-1">
              내 차례! 딱 <b className="text-[var(--coral)]">한 획</b>만 — 손을 떼면 넘어가요
            </span>
            <span className="shrink-0 text-[12px] text-[var(--ink2)]">
              {m.at + 1}/{total}획
            </span>
          </span>
        }
      />
    ) : (
      <Note tone="mint">
        <Avatar idx={avatarOf(st.drawer)} size={28} ring={m.colors[st.drawer]} />
        <span className="min-w-0 flex-1 truncate">
          <Who name={st.drawerNick} />
          님이 한 획 긋는 중…
        </span>
        <span className="text-[12px] text-[var(--ink2)]">
          {m.at + 1}/{total}획
        </span>
      </Note>
    );
  else if (voting)
    below = (
      <div className="sk-card-soft flex flex-col gap-2 px-3 py-2.5">
        <p className="sk-hand text-center text-[20px] leading-none">
          {inGame
            ? iVoted
              ? "투표 완료! 다른 사람을 기다려요"
              : "🕵️ 가짜 화가는 누구일까요?"
            : "다들 투표하는 중…"}
        </p>
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${Math.min(m.order.length, v ? 3 : 4)}, minmax(0, 1fr))`,
          }}
        >
          {m.order.map((u) => (
            <button
              key={u}
              type="button"
              disabled={!inGame || iVoted || u === uid}
              onClick={() => {
                playSfx("sfx-vote");
                voteFake(room.id, st.step, u).catch(() => {});
              }}
              className="sk-btn flex-col gap-0.5 px-1 py-1.5 text-[13px]"
            >
              <span className="relative">
                <Avatar idx={avatarOf(u)} size={34} ring={m.colors[u]} />
                {m.voted.includes(u) && (
                  <span className="absolute -right-1 -bottom-1 text-[11px]" title="투표함">
                    🗳️
                  </span>
                )}
              </span>
              <span className="max-w-full truncate font-bold">
                {u === uid ? "나" : nameOf(room, u)}
              </span>
            </button>
          ))}
        </div>
        <p className="text-center text-[12px] font-bold text-[var(--ink3)]">
          {m.voted.length}/{m.order.filter((u) => room.players[u]).length}명 투표 · 채팅으로 의심
          가는 사람을 몰아가 봐요!
        </p>
      </div>
    );
  else if (st.phase === "f-guess")
    below = isFaker ? (
      <div
        className="sk-card-soft flex flex-col gap-1.5 px-3 py-2.5"
        style={{ background: "#FFE1DF" }}
      >
        <p className="sk-hand text-[20px] leading-none">
          들켰어요! 마지막 기회 — 제시어를 맞히면 역전 승리
        </p>
        <TextBox
          placeholder={`주제는 「${m.topic}」 · 제시어는?`}
          max={20}
          remaining={9999}
          onSubmit={(x) => submitText(room.id, st.step, x)}
        />
      </div>
    ) : (
      <Note tone="coral">
        <Avatar idx={avatarOf(m.faker ?? "")} size={28} />
        🎯 가짜 화가를 찾았어요! 마지막으로 제시어를 맞히는 중…
      </Note>
    );

  // 결과 덮개
  let overlay: ReactNode = null;
  if (st.phase === "f-result") {
    const votes = m.votes ?? {};
    const count = (u: string) => Object.values(votes).filter((x) => x === u).length;
    const won = m.win === "fake";
    overlay = (
      <div className="sk-overlay sk-scroll overflow-y-auto">
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <span
            className="sk-pop sk-hand text-[34px] leading-none"
            style={{ color: won ? "#FF6B6B" : "#2EC4B6" }}
          >
            {m.win === "gone"
              ? "가짜가 도망갔어요"
              : won
                ? "🕵️ 가짜 화가 승리!"
                : "🎨 화가들 승리!"}
          </span>
          <div className="flex items-center gap-2">
            <Avatar idx={avatarOf(m.faker ?? "")} size={v ? 42 : 56} ring="#FF6B6B" />
            <div className="text-left">
              <div className="text-[12px] font-bold text-[var(--ink2)]">가짜 화가</div>
              <div className="sk-hand text-[24px] leading-none">{nameOf(room, m.faker ?? "")}</div>
            </div>
          </div>
          <p className="text-[14px] font-bold">
            제시어는 <span className="sk-hand text-[24px] text-[var(--grape)]">「{m.word}」</span>
            {m.guess !== undefined && (
              <span className="block text-[12.5px] text-[var(--ink2)]">
                가짜의 마지막 답: 「{m.guess}」 {won ? "⭕" : "❌"}
              </span>
            )}
          </p>
          <div className="flex flex-wrap justify-center gap-1">
            {m.order.map((u) => (
              <span
                key={u}
                className="flex items-center gap-1 rounded-full border-2 border-[var(--line)] bg-white py-0.5 pr-2 pl-0.5 text-[12px] font-bold"
              >
                <Avatar idx={avatarOf(u)} size={20} />
                {nameOf(room, u)} <span className="text-[var(--coral)]">🗳️{count(u)}</span>
              </span>
            ))}
          </div>
          <p className="text-[11.5px] text-[var(--ink3)]">
            {m.game < m.games ? `곧 다음 판 (${m.game}/${m.games})` : "곧 최종 결과"}
          </p>
        </div>
      </div>
    );
  }

  const small = !v && (st.phase === "f-vote" || st.phase === "f-guess");
  return (
    <div className="flex w-full flex-col gap-2">
      <div className={small ? "mx-auto w-[520px]" : "w-full"}>
        <SketchCanvas
          source={source}
          canDraw={myTurn}
          tool="pen"
          color={myColor ?? "#1F1F2A"}
          width={t.width}
          apiRef={apiRef}
        >
          {!v && st.phase === "f-draw" && (
            <div className="pointer-events-none absolute inset-x-0 top-2 z-[5] opacity-90">
              {orderRow}
            </div>
          )}
          {overlay}
        </SketchCanvas>
      </div>
      {v && st.phase === "f-draw" && orderRow}
      {below}
      {st.phase === "f-result" && (
        <div className="flex justify-center">
          <LikeButton room={room} uid={uid} likeKey={st.turnId} author="" />
        </div>
      )}
    </div>
  );
}

// ── 그림 속 거짓말 ──

function LieCenter({
  room,
  uid,
  v,
  m,
  secret,
  remaining,
}: {
  room: Room;
  uid: string;
  v: boolean;
  m: LieState;
  secret: LieSecret | null;
  remaining: number;
}) {
  const st = room.state;
  const inGame = m.players.includes(uid);
  const here = m.players.filter((u) => room.players[u]);
  const sheet = useSheet(room.id, st.phase === "l-draw" ? null : `l:${m.artist}`, st.step);

  if (st.phase === "l-draw") {
    if (inGame && !m.done.includes(uid) && secret?.prompt)
      return (
        <DrawPad
          key={st.step}
          roomId={room.id}
          step={st.step}
          v={v}
          remaining={remaining}
          head={
            <Note tone="sun">
              🤥 「<b>{secret.prompt}</b>」을(를) 그려요 — 제목은 비밀! 다른 사람들이 가짜 제목을
              지어요
            </Note>
          }
        />
      );
    return (
      <div className="sk-card flex min-h-[260px] w-full items-center justify-center p-4">
        <Waiting
          room={room}
          need={here}
          done={m.done}
          text={inGame ? "다 그렸어요! 다른 사람을 기다리는 중" : "다들 그리는 중…"}
        />
      </div>
    );
  }

  const artist = m.artist;
  const mineArt = artist === uid;
  const sheetBox = (
    <div className={st.phase === "l-write" ? "w-full" : v ? "w-full" : "mx-auto w-[470px]"}>
      <SheetView id={`l:${artist}:${st.step}`} strokes={sheet}>
        <span className="absolute top-2 left-2 z-[5] flex items-center gap-1 rounded-full border-2 border-[var(--ink)] bg-white/90 py-0.5 pr-2 pl-0.5 text-[12px] font-bold">
          <Avatar idx={avatarOf(artist)} size={22} /> {nameOf(room, artist)}의 그림
        </span>
      </SheetView>
    </div>
  );

  let below: ReactNode = null;
  if (st.phase === "l-write") {
    const writers = here.filter((u) => u !== artist);
    below = mineArt ? (
      <Note tone="grape">
        🎨 내 그림이에요! 다들 그럴듯한 가짜 제목을 짓는 중 ({m.done.length}/{writers.length})
      </Note>
    ) : !inGame ? (
      <Note tone="mint">
        다들 가짜 제목을 짓는 중… ({m.done.length}/{writers.length})
      </Note>
    ) : secret?.lie ? (
      <Note tone="mint">
        내 가짜 제목: 「<b>{secret.lie}</b>」 · 다른 사람 기다리는 중 ({m.done.length}/
        {writers.length})
      </Note>
    ) : (
      <div className="sk-card-soft flex flex-col gap-1.5 px-3 py-2.5">
        <p className="text-[13px] font-bold text-[var(--ink2)]">
          이 그림의 <b className="text-[var(--coral)]">그럴듯한 가짜 제목</b>을 써요. 남이 속아서
          고르면 +{50}점!
        </p>
        <TextBox
          placeholder="예: 다이어트 중인 펭귄"
          max={30}
          remaining={remaining}
          onSubmit={(x) => submitText(room.id, st.step, x)}
        />
      </div>
    );
  } else if (st.phase === "l-pick") {
    const opts = m.options ?? [];
    const myPick = secret?.pick;
    const canPick = inGame && !mineArt && !myPick;
    below = (
      <div className="sk-card-soft flex flex-col gap-2 px-3 py-2.5">
        <p className="sk-hand text-center text-[19px] leading-none">
          {mineArt
            ? "다들 진짜 제목을 고르는 중…"
            : myPick
              ? "골랐어요! 결과를 기다려요"
              : "진짜 제목은 무엇일까요?"}
        </p>
        <div className={`grid gap-1.5 ${v ? "grid-cols-1" : "grid-cols-2"}`}>
          {opts.map((o) => {
            const mine = secret?.mine?.includes(o.id);
            const picked = myPick === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={!canPick || mine}
                onClick={() => {
                  playSfx("sfx-pick");
                  pickOption(room.id, st.step, o.id).catch(() => {});
                }}
                className={`sk-btn justify-start px-3 py-2 text-left text-[15px] whitespace-normal ${picked ? "sk-btn-sun" : ""}`}
              >
                <span className="min-w-0 flex-1 break-keep">{o.text}</span>
                {mine && (
                  <span className="shrink-0 text-[11px] text-[var(--ink3)]">내가 쓴 것</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-center text-[12px] font-bold text-[var(--ink3)]">
          {m.done.length}/{here.filter((u) => u !== artist).length}명 골랐어요
        </p>
      </div>
    );
  } else if (st.phase === "l-show") {
    const show = [...(m.show ?? [])].sort((a, b) => Number(a.truth) - Number(b.truth));
    below = (
      <div className="sk-card-soft flex flex-col gap-1.5 px-3 py-2.5">
        <ul className="flex flex-col gap-1">
          {show.map((o, i) => (
            <li
              key={o.id}
              className="sk-pop flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border-2 px-2.5 py-1.5"
              style={{
                animationDelay: `${i * 0.35}s`,
                borderColor: o.truth ? "#2EC4B6" : "var(--line)",
                background: o.truth ? "rgba(46,196,182,0.15)" : "#fff",
              }}
            >
              <span className="text-[16px]">{o.truth ? "✅" : "🤥"}</span>
              <b className="min-w-0 text-[15px] break-keep">{o.text}</b>
              <span className="text-[11.5px] font-bold text-[var(--ink2)]">
                {o.truth
                  ? `진짜! (${nameOf(room, artist)})`
                  : o.authors.length
                    ? `${o.authors.map((u) => nameOf(room, u)).join(", ")}의 거짓말`
                    : "DOODLE의 함정"}
              </span>
              <span className="ml-auto flex items-center gap-0.5">
                {o.pickers.map((u) => (
                  <Avatar key={u} idx={avatarOf(u)} size={20} />
                ))}
                {o.pickers.length > 0 && (
                  <span className="text-[11px] font-extrabold text-[var(--coral)]">
                    {o.truth
                      ? `+${100}`
                      : o.authors.length
                        ? `속음! (+${50 * o.pickers.length})`
                        : "속음!"}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {sheetBox}
      {below}
      <div className="flex justify-center">
        <LikeButton room={room} uid={uid} likeKey={`l:${artist}`} author={artist} />
      </div>
    </div>
  );
}

// ── 그림 릴레이 ──

function RelayCenter({
  room,
  uid,
  v,
  m,
  secret,
  remaining,
  isLeader,
}: {
  room: Room;
  uid: string;
  v: boolean;
  m: RelayState;
  secret: RelaySecret | null;
  remaining: number;
  isLeader: boolean;
}) {
  const st = room.state;
  const inGame = m.order.includes(uid);
  const here = m.order.filter((u) => room.players[u]);
  const prevSheet = useSheet(room.id, st.phase === "r-desc" ? secret?.prev?.sheet : null, st.step);

  if (st.phase === "r-album")
    return <Album room={room} uid={uid} v={v} m={m} isLeader={isLeader} />;

  const waiting = (
    <div className="sk-card flex min-h-[260px] w-full items-center justify-center p-4">
      <Waiting
        room={room}
        need={here}
        done={m.done}
        text={inGame ? "냈어요! 다른 사람을 기다리는 중" : "다들 이어 가는 중…"}
      />
    </div>
  );
  if (!inGame || !secret || secret.done || m.done.includes(uid)) return waiting;

  if (secret.task === "write")
    return (
      <div className="sk-card flex w-full flex-col items-center gap-3 p-5">
        <Mascot pose="think" size={v ? 70 : 96} />
        <p className="sk-hand text-center text-[24px] leading-tight">
          아무 문장이나 써 주세요!
          <span className="block text-[14px] text-[var(--ink2)]">
            옆 사람이 이걸 그림으로 그려요
          </span>
        </p>
        <TextBox
          big
          placeholder="예: 토끼가 당근으로 칼싸움을 한다"
          max={60}
          remaining={remaining}
          onSubmit={(x) => submitText(room.id, st.step, x)}
          extra={(set) => (
            <button
              type="button"
              title="아무거나 추천"
              onClick={() => {
                playSfx("sfx-pick");
                set(randomStarter());
              }}
              className="sk-btn shrink-0 px-2.5 text-[18px]"
            >
              🎲
            </button>
          )}
        />
      </div>
    );

  if (secret.task === "draw")
    return (
      <DrawPad
        key={st.step}
        roomId={room.id}
        step={st.step}
        v={v}
        remaining={remaining}
        head={
          <Note tone="sun">
            ✏️ 이 문장을 그려요: 「<b className="break-keep">{secret.prev?.text ?? "?"}</b>」
          </Note>
        }
      />
    );

  return (
    <div className="flex w-full flex-col gap-2">
      <SheetView id={`desc:${st.step}`} strokes={prevSheet} />
      <div className="sk-card-soft flex flex-col gap-1.5 px-3 py-2.5">
        <p className="text-[13px] font-bold text-[var(--ink2)]">
          이 그림을 보고 어떤 장면인지 한 문장으로 써요
        </p>
        <TextBox
          placeholder="이 그림은…"
          max={60}
          remaining={remaining}
          onSubmit={(x) => submitText(room.id, st.step, x)}
        />
      </div>
    </div>
  );
}

/** 앨범: 한 줄씩, 한 장씩 같이 넘김 (리더가 넘기거나 시간이 지나면) */
function Album({
  room,
  uid,
  v,
  m,
  isLeader,
}: {
  room: Room;
  uid: string;
  v: boolean;
  m: RelayState;
  isLeader: boolean;
}) {
  const st = room.state;
  const [album, setAlbum] = useState<RelayEntry[][] | null>(null);
  useEffect(() => subscribeAlbum(room.id, setAlbum), [room.id]);
  const chain = m.album?.chain ?? 0;
  const page = m.album?.page ?? 0;
  const entries = album?.[chain] ?? [];
  const cur = entries[page];
  const prevEntry = page > 0 ? entries[page - 1] : null;
  const curSheet = useSheet(room.id, cur?.sheet, st.step);
  const prevSheet = useSheet(room.id, prevEntry?.sheet, st.step);
  const pageRef = useRef(`${chain}:${page}`);
  useEffect(() => {
    if (pageRef.current !== `${chain}:${page}`) playSfx("sfx-page");
    pageRef.current = `${chain}:${page}`;
  }, [chain, page]);
  const starter = entries[0]?.by ?? m.order[chain];

  const entryCard = (
    e: RelayEntry | undefined,
    strokes: Stroke[] | null,
    small: boolean,
    key: string
  ) =>
    !e ? null : e.sheet ? (
      <div className={small ? "mx-auto w-[44%] opacity-80" : v ? "w-full" : "mx-auto w-[540px]"}>
        <SheetView id={`${key}:${e.sheet}`} strokes={strokes}>
          <span className="absolute top-2 left-2 z-[5] flex items-center gap-1 rounded-full border-2 border-[var(--ink)] bg-white/90 py-0.5 pr-2 pl-0.5 text-[11.5px] font-bold">
            <Avatar idx={avatarOf(e.by)} size={20} /> {nameOf(room, e.by)}
          </span>
        </SheetView>
      </div>
    ) : (
      <div
        className={`sk-note sk-pop flex items-center gap-2 ${small ? "px-3 py-1.5 opacity-80" : "px-4 py-4"}`}
        style={{ rotate: small ? "0deg" : "-1deg" }}
      >
        <Avatar idx={avatarOf(e.by)} size={small ? 24 : 36} />
        <div className="min-w-0">
          <div className="text-[11.5px] font-bold text-[var(--ink2)]">{nameOf(room, e.by)}</div>
          <div
            className={`sk-hand leading-tight break-keep ${small ? "text-[17px]" : v ? "text-[24px]" : "text-[30px]"}`}
          >
            「{e.text}」
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Avatar idx={avatarOf(starter)} size={30} />
        <span className="sk-hand text-[20px] leading-none">
          {nameOf(room, starter)}의 줄{" "}
          <span className="text-[14px] text-[var(--ink3)]">
            ({page + 1}/{m.steps}장)
          </span>
        </span>
        <span className="ml-auto flex gap-1">
          {Array.from({ length: m.steps }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i <= page ? "bg-[var(--coral)]" : "bg-[var(--line)]"}`}
            />
          ))}
        </span>
      </div>
      {prevEntry && entryCard(prevEntry, prevSheet, true, "prev")}
      {prevEntry && <div className="text-center text-[18px] leading-none">⬇️</div>}
      {entryCard(cur, curSheet, false, "cur") ?? (
        <div className="sk-card flex h-[200px] items-center justify-center">
          <p className="sk-hand text-[18px] text-[var(--ink3)]">앨범 불러오는 중…</p>
        </div>
      )}
      <div className="flex items-center justify-center gap-2">
        {cur?.sheet && <LikeButton room={room} uid={uid} likeKey={cur.sheet} author={cur.by} />}
        {isLeader ? (
          <button
            type="button"
            onClick={tap(() => tick(room.id, st.step, true), "sfx-page")}
            className="sk-btn sk-btn-coral text-[18px]"
          >
            다음 장 ▶
          </button>
        ) : (
          <span className="text-[12.5px] font-bold text-[var(--ink3)]">
            방장이 넘기거나 잠시 뒤 자동으로 넘어가요
          </span>
        )}
      </div>
    </div>
  );
}

/** 대기실에서 보여 줄 모드 설명 */
export function ModeHow({ room, v }: { room: Room; v: boolean }) {
  const info = MODES[room.meta.mode];
  return (
    <div
      className="sk-note flex w-full max-w-[520px] flex-col gap-1 px-4 py-2.5 text-left"
      style={{ rotate: "-0.6deg" }}
    >
      <b className="sk-hand text-[20px] leading-none">
        {info.emoji} {info.name}
      </b>
      {!v &&
        info.how.map((h) => (
          <p key={h} className="text-[12.5px] leading-snug">
            · {h}
          </p>
        ))}
      {v && <p className="text-[12.5px]">{info.short}</p>}
    </div>
  );
}
