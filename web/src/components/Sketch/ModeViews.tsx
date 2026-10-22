"use client";

/*
 * DOODLE PARTY — 그림 맞히기 말고 다른 모드의 가운데 화면 (도화지 자리)
 *   가짜 화가(f-*) · 그림 릴레이(r-*)
 * 대기실 · 최종 결과는 SketchRoom 이 같이 그림.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { plainName } from "@/components/Nick";
import { avatarOf } from "@/lib/sketch/assets";
import {
  FAKE_LAPS,
  FAKE_QM_PICK_MS,
  LIKE_EMOJI,
  MEMORY_PEEK_MS,
  MODE_MS,
  MODE_POINTS,
  MODES,
  RELAY_VARIANTS,
  SPEED_MS,
} from "@/lib/sketch/modes";
import { randomStarter } from "@/lib/sketch/prompts";
import { playSfx } from "@/lib/sketch/sfx";
import {
  getSheet,
  likeDrawing,
  qmPick,
  submitSheet,
  submitText,
  subscribeAlbum,
  subscribeSecret,
  subscribeSheet,
  tick,
  voteFake,
  type FakeSecret,
  type FakeState,
  type GalleryItem,
  type RelayEntry,
  type RelaySecret,
  type RelayState,
  type SketchRoom as Room,
  type Stroke,
} from "@/realtime/sketch";
import { Avatar, Icon, Mascot, Who } from "./Art";
import SketchCanvas, {
  localSource,
  renderStrokes,
  serverSource,
  staticSource,
  type CanvasApi,
  type LocalSource,
} from "./SketchCanvas";
import {
  albumGif,
  albumImage,
  downloadBlob,
  downloadCanvas,
  galleryImage,
  safeName,
  type AlbumPage,
} from "./saveImage";
import Toolbar, { useTools } from "./Toolbar";
import { tap } from "./stage";

export type AnySecret = FakeSecret | RelaySecret | null;

/** 지금 단계가 다른 모드의 진행 중 단계인지 */
export const isModePhase = (phase: string) => /^[flr]-/.test(phase);

/** 단계 전체 시간 (시간 원 비율) */
export function phaseTotal(room: Room): number {
  const p = room.state.phase;
  const draw = room.meta.drawTime * 1000;
  const speed = room.meta.variant === "speed";
  return (
    (
      {
        "f-draw": MODE_MS.fakeStroke,
        "f-vote": MODE_MS.fakeVote,
        "f-guess": MODE_MS.fakeGuess,
        "f-result": MODE_MS.fakeResult,
        "f-pick": FAKE_QM_PICK_MS,
        "r-write": speed ? SPEED_MS.write : MODE_MS.relayWrite,
        "r-draw": speed ? SPEED_MS.draw : draw,
        "r-desc": speed ? SPEED_MS.desc : MODE_MS.relayDesc,
        "r-album":
          room.state.m?.kind === "relay" &&
          (room.state.m.album?.page ?? 0) >= room.state.m.steps - 1
            ? MODE_MS.relayLast
            : MODE_MS.relayPage,
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
          onPick={t.pickColor}
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
    if (st.phase === "f-pick")
      return (
        <span className="sk-hand truncate" style={{ fontSize: fs }}>
          🎩{" "}
          {s?.qm
            ? "출제자! 제시어를 골라 주세요"
            : `${nameOf(room, m.qm ?? "")}님이 제시어 고르는 중…`}
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
        {s?.qm ? (
          <span className="sk-hand truncate" style={{ fontSize: fs }}>
            🎩 출제자 · 「{s.word}」
          </span>
        ) : s?.faker ? (
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
  const total = m.order.length * (room.meta.laps || FAKE_LAPS);
  const voting = st.phase === "f-vote";
  const iVoted = m.voted.includes(uid);
  const inGame = m.order.includes(uid);
  const isFaker = !!secret?.faker;

  // 순서 · 색 줄 (출제자가 있으면 맨 앞에 🎩)
  const orderRow = (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {m.qm && (
        <span className="flex items-center gap-1 rounded-full border-2 border-dashed border-[var(--ink)] bg-white/80 py-0.5 pr-2 pl-0.5 text-[12px] font-bold">
          <Avatar idx={avatarOf(m.qm)} size={22} />
          🎩 <span className="max-w-[5.5em] truncate">{nameOf(room, m.qm)}</span>
        </span>
      )}
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
  if (st.phase === "f-draw" && secret?.qm)
    below = (
      <Note tone="sun">
        🎩 나는 출제자 — 그리진 않고 지켜봐요. 가짜가 이기면 나도 +{MODE_POINTS.qmWin}
        <span className="ml-auto shrink-0 text-[12px] text-[var(--ink2)]">
          {m.at + 1}/{total}획
        </span>
      </Note>
    );
  else if (st.phase === "f-draw")
    below = myTurn ? (
      <Toolbar
        compact={v}
        t={t}
        apiRef={apiRef}
        colors={[myColor]}
        noFill
        noEraser
        noUndo
        noShapes
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
  if (st.phase === "f-pick")
    overlay = (
      <div className="sk-overlay sk-scroll overflow-y-auto">
        {secret?.qm ? (
          <QmPicker room={room} choices={secret.choices ?? []} v={v} />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <Avatar idx={avatarOf(m.qm ?? "")} size={v ? 48 : 64} />
            <p className="sk-hand text-[26px] leading-tight">
              🎩 출제자 {nameOf(room, m.qm ?? "")}님이
              <br />
              제시어를 고르는 중…
            </p>
            <p className="text-[12.5px] font-bold text-[var(--ink2)]">
              출제자는 안 그리고, 가짜가 이기면 같이 점수를 받아요
            </p>
          </div>
        )}
      </div>
    );
  else if (st.phase === "f-result") {
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
          {m.qm && (
            <p className="text-[12.5px] font-bold text-[var(--ink2)]">
              🎩 출제자 {nameOf(room, m.qm)}
              {won && <span className="text-[var(--coral)]"> · 가짜 편 +{MODE_POINTS.qmWin}</span>}
            </p>
          )}
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

  // 한 획 긋고 나면 서버가 다음 차례로 넘길 때까지 더 못 그음
  const [drewAt, setDrewAt] = useState(-1);
  const small = !v && (st.phase === "f-vote" || st.phase === "f-guess");
  return (
    <div className="flex w-full flex-col gap-2">
      <div className={small ? "mx-auto w-[520px]" : "w-full"}>
        <SketchCanvas
          source={source}
          canDraw={myTurn && drewAt !== st.step}
          tool="pen"
          color={myColor ?? "#1F1F2A"}
          width={t.width}
          apiRef={apiRef}
          keepOnExit
          onStrokeEnd={() => setDrewAt(st.step)}
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

/** 출제자: 후보 3개 중 고르기 또는 직접 쓰기 (가짜가 눈치 못 채게 애매한 걸 고르면 유리) */
function QmPicker({
  room,
  choices,
  v,
}: {
  room: Room;
  choices: { topic: string; word: string }[];
  v: boolean;
}) {
  const st = room.state;
  const [own, setOwn] = useState(false);
  const [word, setWord] = useState("");
  const [topic, setTopic] = useState("");
  const [err, setErr] = useState("");
  const send = (pick: { index: number } | { word: string; topic: string }) => {
    playSfx("sfx-pick");
    setErr("");
    qmPick(room.id, st.step, pick).catch((e: unknown) => {
      playSfx("sfx-error");
      setErr(e instanceof Error ? e.message : "다시 해 주세요");
    });
  };
  return (
    <div className="flex w-full max-w-[520px] flex-col items-center gap-2.5 text-center">
      <p className="sk-hand text-[26px] leading-none">🎩 제시어를 골라 주세요</p>
      <p className="text-[12.5px] font-bold text-[var(--ink2)]">
        모두에게 주제만 보이고, 가짜 화가만 제시어를 몰라요. 가짜가 이기면 나도 +{MODE_POINTS.qmWin}
        !
      </p>
      {!own ? (
        <>
          <div className={`grid w-full gap-2 ${v ? "grid-cols-1" : "grid-cols-3"}`}>
            {choices.map((c, i) => (
              <button
                key={c.word}
                type="button"
                onClick={() => send({ index: i })}
                className="sk-btn flex-col gap-1 px-2 py-3"
              >
                <span className="rounded-full border-2 border-[var(--ink)] bg-[var(--sky)] px-2 py-0.5 text-[11.5px] font-extrabold text-white">
                  주제 · {c.topic}
                </span>
                <span className="sk-hand text-[26px] leading-none">{c.word}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={tap(() => setOwn(true), "sfx-click")}
            className="text-[13px] font-bold text-[var(--coral)] underline underline-offset-2"
          >
            ✍️ 직접 쓸래요
          </button>
        </>
      ) : (
        <div className="sk-card-soft flex w-full flex-col gap-2 px-3 py-3 text-left">
          <label className="text-[12.5px] font-bold">
            주제 힌트 (모두에게 보여요)
            <input
              value={topic}
              maxLength={12}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="예: 동물원"
              className="sk-input mt-1 w-full text-[15px]"
            />
          </label>
          <label className="text-[12.5px] font-bold">
            제시어 (가짜는 몰라요)
            <input
              value={word}
              maxLength={20}
              onChange={(e) => setWord(e.target.value)}
              placeholder="예: 기린"
              className="sk-input mt-1 w-full text-[15px]"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={tap(() => setOwn(false), "sfx-click")}
              className="sk-btn px-3 text-[14px]"
            >
              ← 후보 보기
            </button>
            <button
              type="button"
              disabled={!word.trim() || !topic.trim()}
              onClick={() => send({ word: word.trim(), topic: topic.trim() })}
              className="sk-btn sk-btn-coral ml-auto px-4 text-[16px]"
            >
              이걸로!
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-[12.5px] font-bold text-[var(--coral)]">{err}</p>}
      <p className="text-[11.5px] text-[var(--ink3)]">
        시간 안에 안 고르면 첫 번째 후보로 정해져요
      </p>
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

  // 🧠 기억해서: 앞 사람 것은 몇 초만 보여 주고 가림 (갈틱폰 「카피」처럼)
  const memory = room.meta.variant === "memory";
  if (secret.task === "draw")
    return (
      <DrawPad
        key={st.step}
        roomId={room.id}
        step={st.step}
        v={v}
        remaining={remaining}
        head={
          <Peek key={st.step} on={memory} ms={MEMORY_PEEK_MS.text}>
            <Note tone="sun">
              ✏️ 이 문장을 그려요: 「<b className="break-keep">{secret.prev?.text ?? "?"}</b>」
            </Note>
          </Peek>
        }
      />
    );

  return (
    <div className="flex w-full flex-col gap-2">
      <Peek key={st.step} on={memory} ms={MEMORY_PEEK_MS.sheet} big>
        <SheetView id={`desc:${st.step}`} strokes={prevSheet} />
      </Peek>
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

/**
 * 🧠 기억해서 그리기: ms 동안만 보여 주고 덮음 (남은 초를 띄움). on 이 아니면 그대로.
 * 단계마다 key 를 바꿔 달아서 새로 셈.
 */
function Peek({
  on,
  ms,
  big = false,
  children,
}: {
  on: boolean;
  ms: number;
  big?: boolean;
  children: ReactNode;
}) {
  const [left, setLeft] = useState(ms);
  useEffect(() => {
    if (!on) return;
    const t0 = Date.now();
    const t = setInterval(() => {
      const l = Math.max(0, ms - (Date.now() - t0));
      setLeft(l);
      if (!l) {
        clearInterval(t);
        playSfx("sfx-page");
      }
    }, 200);
    return () => clearInterval(t);
  }, [on, ms]);
  if (!on) return <>{children}</>;
  const hidden = left <= 0;
  return (
    <div className="relative">
      <div className={hidden ? "invisible" : ""}>{children}</div>
      {hidden ? (
        <div
          className={`absolute inset-0 z-[6] flex items-center justify-center rounded-[10px] border-[3px] border-dashed border-[var(--ink)] bg-[#FFF4C2] ${big ? "flex-col gap-1" : "gap-2"}`}
        >
          <span className={big ? "text-[44px] leading-none" : "text-[20px]"}>🧠</span>
          <span className={`sk-hand leading-none ${big ? "text-[26px]" : "text-[18px]"}`}>
            기억나는 대로!
          </span>
        </div>
      ) : (
        <span className="absolute top-1.5 right-1.5 z-[6] rounded-full border-2 border-[var(--ink)] bg-white px-2 py-0.5 text-[12px] font-extrabold">
          👀 {Math.ceil(left / 1000)}초
        </span>
      )}
    </div>
  );
}

/** 두 문장이 얼마나 달라졌는지 (글자 두 개씩 묶어 겹치는 비율) → 0~100 */
function changeRate(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.replace(/\s+/g, "");
    const out = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    if (t.length === 1) out.add(t);
    return out;
  };
  const x = grams(a);
  const y = grams(b);
  if (!x.size || !y.size) return 100;
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return Math.round((1 - (2 * both) / (x.size + y.size)) * 100);
}
const changeLabel = (r: number) =>
  r >= 90
    ? "완전히 딴 얘기 🤯"
    : r >= 70
      ? "많이 바뀌었어요 🤣"
      : r >= 40
        ? "조금씩 바뀌었어요 😆"
        : "거의 그대로! 👏";

/** 앨범 한 칸 (글은 말풍선, 그림은 액자) */
function FeedItem({
  room,
  uid,
  e,
  i,
  chain,
  step,
  v,
  fresh,
}: {
  room: Room;
  uid: string;
  e: RelayEntry;
  i: number;
  chain: number;
  step: number;
  v: boolean;
  fresh: boolean;
}) {
  const strokes = useSheet(room.id, e.sheet, step);
  const right = i % 2 === 1;
  const who = (
    <span className="flex items-center gap-1 text-[11.5px] font-bold text-[var(--ink2)]">
      <Avatar idx={avatarOf(e.by)} size={20} /> {nameOf(room, e.by)}
      <span className="font-normal text-[var(--ink3)]">
        {i === 0 ? "· 처음 문장" : e.sheet ? "· 그렸어요" : "· 그림을 보고"}
      </span>
    </span>
  );
  return (
    <div
      className={`flex flex-col gap-1 ${right ? "items-end" : "items-start"} ${fresh ? "sk-feed-in" : ""}`}
    >
      {who}
      {e.sheet ? (
        <div className={`flex items-end gap-1.5 ${right ? "flex-row-reverse" : ""}`}>
          <div
            className={v ? "w-[82vw] max-w-[360px]" : "w-[400px]"}
            style={{ rotate: right ? "0.8deg" : "-0.8deg" }}
          >
            <SheetView id={`feed:${e.sheet}`} strokes={strokes} />
          </div>
          <LikeButton room={room} uid={uid} likeKey={e.sheet} author={e.by} />
        </div>
      ) : (
        <div className={`flex max-w-[96%] items-end gap-1.5 ${right ? "flex-row-reverse" : ""}`}>
          <div
            className={`sk-note min-w-0 px-4 py-2.5 ${i === 0 ? "!bg-[#FFF4C2]" : ""}`}
            style={{
              rotate: right ? "1deg" : "-1deg",
              borderRadius: right ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
            }}
          >
            <div
              className={`sk-hand leading-tight break-keep ${v ? "text-[21px]" : "text-[26px]"}`}
            >
              「{e.text}」
            </div>
          </div>
          {/* 문장에도 따봉 → 판 끝 「베스트 드립」 (처음 문장은 빼고) */}
          {i > 0 && <LikeButton room={room} uid={uid} likeKey={`r:${chain}:${i}`} author={e.by} />}
        </div>
      )}
    </div>
  );
}

/**
 * 앨범: 한 사람의 줄을 대화창처럼 한 장씩 쌓아 가며 같이 봄 (리더가 넘기거나 시간이 지나면).
 * 줄 끝에선 처음 문장 ↔ 마지막 문장을 나란히 놓고 「변신율」로 얼마나 바뀌었는지 보여 줌.
 */
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
  const shown = entries.slice(0, page + 1).filter(Boolean);
  const last = page >= m.steps - 1;
  const starter = entries[0]?.by ?? m.order[chain];

  // 넘길 때 소리 + 맨 아래로 스크롤
  const feedRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(`${chain}:${page}`);
  useEffect(() => {
    if (pageRef.current !== `${chain}:${page}`)
      playSfx(page === 0 ? "sfx-stroke-turn" : "sfx-page");
    pageRef.current = `${chain}:${page}`;
    const el = feedRef.current;
    if (!el) return;
    const t = setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }), 80);
    return () => clearTimeout(t);
  }, [chain, page, album]);

  // 줄 끝: 잠깐 뒤 처음 ↔ 마지막 비교
  const [cmpAt, setCmpAt] = useState("");
  const cmpKey = `${chain}`;
  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => {
      setCmpAt(cmpKey);
      playSfx("jingle-reveal");
    }, 1600);
    return () => clearTimeout(t);
  }, [last, cmpKey]);
  useEffect(() => {
    if (!last || cmpAt !== cmpKey) return;
    const el = feedRef.current;
    if (el) setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }), 60);
  }, [last, cmpAt, cmpKey]);
  const first = entries[0];
  const lastText = [...shown].reverse().find((e) => e.text && e !== first);
  const showCmp = last && cmpAt === cmpKey && first?.text && lastText?.text;
  const rate = showCmp ? changeRate(first.text!, lastText.text!) : 0;

  return (
    <div className="flex w-full flex-col gap-2">
      {/* 누구의 줄인지 (줄마다 동그라미 하나) */}
      <div className="flex items-center gap-2">
        <span className="sk-hand text-[20px] leading-none whitespace-nowrap">
          🎞️ {nameOf(room, starter)}의 이야기
        </span>
        <span className="ml-auto flex items-center gap-1">
          {m.order.map((u, i) => (
            <span
              key={u}
              title={nameOf(room, u)}
              className={`relative rounded-full transition-all ${i === chain ? "scale-110 ring-[3px] ring-[var(--coral)]" : i < chain ? "opacity-45" : "opacity-80"}`}
            >
              <Avatar idx={avatarOf(u)} size={i === chain ? 30 : 22} />
              {i < chain && (
                <span className="absolute -right-1 -bottom-1 text-[11px] leading-none">✅</span>
              )}
            </span>
          ))}
        </span>
      </div>

      {/* 대화창처럼 쌓이는 앨범 */}
      <div
        ref={feedRef}
        className="sk-card flex flex-col gap-3 overflow-y-auto p-3 sm:p-4"
        style={{ height: v ? "58vh" : 498, background: "var(--paper, #fffdf6)" }}
      >
        {shown.length ? (
          shown.map((e, i) => (
            <div key={`${chain}:${i}`} className="flex flex-col gap-3">
              {i > 0 && (
                <div className="text-center text-[12px] font-bold text-[var(--ink3)]">
                  {e.sheet ? "⬇️ 이 문장을 그리면…" : "⬇️ 이 그림을 보고…"}
                </div>
              )}
              <FeedItem
                room={room}
                uid={uid}
                e={e}
                i={i}
                chain={chain}
                step={st.step}
                v={v}
                fresh={i === page}
              />
            </div>
          ))
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="sk-hand text-[18px] text-[var(--ink3)]">앨범 불러오는 중…</p>
          </div>
        )}
        {showCmp && (
          <div className="sk-feed-in mt-2 flex flex-col items-center gap-2 rounded-2xl border-[3px] border-dashed border-[var(--ink)] bg-white px-3 py-4 text-center">
            <div className="sk-hand text-[22px] leading-none">🔁 처음과 끝</div>
            <div className={`flex w-full items-stretch gap-2 ${v ? "flex-col" : ""}`}>
              <div className="sk-note flex-1 px-3 py-2">
                <div className="text-[11px] font-bold text-[var(--ink3)]">
                  처음 · {nameOf(room, first.by)}
                </div>
                <div className="sk-hand text-[20px] leading-tight break-keep">「{first.text}」</div>
              </div>
              <div className="self-center text-[22px]">{v ? "⬇️" : "➡️"}</div>
              <div className="sk-note flex-1 px-3 py-2 !bg-[#FFE3DA]">
                <div className="text-[11px] font-bold text-[var(--ink3)]">
                  마지막 · {nameOf(room, lastText.by)}
                </div>
                <div className="sk-hand text-[20px] leading-tight break-keep">
                  「{lastText.text}」
                </div>
              </div>
            </div>
            <div className="sk-pop flex items-baseline gap-2" style={{ animationDelay: "0.35s" }}>
              <span className="text-[13px] font-bold text-[var(--ink2)]">변신율</span>
              <span
                className="sk-hand leading-none text-[var(--coral)]"
                style={{ fontSize: v ? 34 : 44 }}
              >
                {rate}%
              </span>
              <span className="sk-hand text-[18px]">{changeLabel(rate)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2">
        <span className="flex gap-1">
          {Array.from({ length: m.steps }, (_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i <= page ? "bg-[var(--coral)]" : "bg-[var(--line)]"}`}
            />
          ))}
        </span>
        {/* 다 본 이야기는 이미지 한 장으로 저장 (갈틱폰처럼 공유용) */}
        {last && entries.length > 0 && (
          <>
            <SaveStoryButton room={room} entries={entries} />
            <SaveStoryButton room={room} entries={entries} kind="gif" />
          </>
        )}
        {isLeader ? (
          <button
            type="button"
            onClick={tap(() => tick(room.id, st.step, true), "sfx-page")}
            className="sk-btn sk-btn-coral text-[18px]"
          >
            {last ? (chain + 1 >= m.order.length ? "앨범 끝내기 ▶" : "다음 이야기 ▶") : "다음 장 ▶"}
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

// ───────────── 저장 · 시상 · 모아보기 ─────────────

/** 다 그린 그림 작은 미리보기 (도화지 컴포넌트 대신 이미지 한 장 — 여러 장 띄워도 가볍게) */
function Thumb({
  roomId,
  sheetKey,
  step,
  className = "",
}: {
  roomId: string;
  sheetKey: string;
  step: number;
  className?: string;
}) {
  const strokes = useSheet(roomId, sheetKey, step);
  const src = useMemo(
    () => (strokes ? renderStrokes(strokes, 0.4).toDataURL("image/png") : ""),
    [strokes]
  );
  return (
    <div
      className={`overflow-hidden rounded-[6px] border-[2.5px] border-[var(--ink)] bg-white ${className}`}
      style={{ aspectRatio: "4 / 3" }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--ink3)]">
          …
        </div>
      )}
    </div>
  );
}

/** 다 그린 그림 크게 */
function BigSheet({ roomId, sheetKey, step }: { roomId: string; sheetKey: string; step: number }) {
  const strokes = useSheet(roomId, sheetKey, step);
  return <SheetView id={`big:${sheetKey}`} strokes={strokes} />;
}

/** 릴레이 한 줄을 이미지(png) 또는 움직이는 GIF 로 */
async function saveStory(room: Room, entries: RelayEntry[], kind: "png" | "gif" = "png") {
  const pages: AlbumPage[] = await Promise.all(
    entries.filter(Boolean).map(async (e, i) => ({
      name: nameOf(room, e.by),
      role: i === 0 ? "처음 문장" : e.sheet ? "그렸어요" : "그림을 보고",
      ...(e.sheet ? { strokes: await getSheet(room.id, e.sheet) } : { text: e.text ?? "" }),
    }))
  );
  const first = entries[0];
  const lastText = [...entries].reverse().find((e) => e?.text && e !== first);
  const rate = first?.text && lastText?.text ? changeRate(first.text, lastText.text) : null;
  const starter = nameOf(room, first?.by ?? "");
  const opts = {
    title: `${starter}의 이야기`,
    pages,
    compare:
      rate !== null
        ? { first: first.text!, last: lastText!.text!, rate, label: changeLabel(rate) }
        : null,
  };
  const file = `doodle-party_${safeName(starter)}의_이야기`;
  if (kind === "gif") downloadBlob(await albumGif(opts), `${file}.gif`);
  else downloadCanvas(await albumImage(opts), `${file}.png`);
}

function SaveStoryButton({
  room,
  entries,
  label,
  kind = "png",
  className = "",
}: {
  room: Room;
  entries: RelayEntry[];
  label?: string;
  kind?: "png" | "gif";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      title={
        kind === "gif"
          ? "이 이야기를 한 장씩 넘어가는 GIF 로 저장"
          : "이 이야기를 이미지 한 장으로 저장"
      }
      onClick={() => {
        playSfx("sfx-click");
        setBusy(true);
        saveStory(room, entries, kind)
          .catch(() => playSfx("sfx-error"))
          .finally(() => setBusy(false));
      }}
      className={`sk-btn shrink-0 px-3 text-[15px] ${className}`}
    >
      {busy ? "만드는 중…" : (label ?? (kind === "gif" ? "🎞️ GIF" : "💾 저장"))}
    </button>
  );
}

interface Awards {
  pic: { key: string; by: string; n: number } | null;
  line: { text: string; by: string; n: number } | null;
  morph: { chain: number; rate: number; first: string; last: string } | null;
}

/**
 * 릴레이 판 끝: 텔레스트레이션 「가장 좋았던 그림 · 가장 웃긴 추측」처럼 시상 + 이야기 저장.
 *  🖼️ 베스트 그림 (따봉 1위) · 💬 베스트 드립 (문장 따봉 1위) · 🌀 최고의 변신 (변신율 1위)
 */
export function RelayEnd({ room, v }: { room: Room; v: boolean }) {
  const st = room.state;
  const [album, setAlbum] = useState<RelayEntry[][] | null>(null);
  useEffect(() => subscribeAlbum(room.id, setAlbum), [room.id]);
  const likes = st.likes;
  const awards = useMemo((): Awards | null => {
    if (!album) return null;
    const out: Awards = { pic: null, line: null, morph: null };
    album.forEach((chain, c) => {
      chain.forEach((e, k) => {
        if (!e) return;
        const n = likes?.[`r:${c}:${k}`]?.length ?? 0;
        if (e.sheet && n > 0 && (!out.pic || n > out.pic.n))
          out.pic = { key: e.sheet, by: e.by, n };
        if (!e.sheet && k > 0 && e.text && n > 0 && (!out.line || n > out.line.n))
          out.line = { text: e.text, by: e.by, n };
      });
      // 마지막 문장 (처음 문장 말고)
      const first = chain[0]?.text;
      const last = [...chain].reverse().find((e, i) => e?.text && i < chain.length - 1)?.text;
      if (first && last) {
        const rate = changeRate(first, last);
        if (!out.morph || rate > out.morph.rate) out.morph = { chain: c, rate, first, last };
      }
    });
    return out;
  }, [album, likes]);
  const card = (emoji: string, title: string, body: ReactNode, i: number) => (
    <div
      className="sk-card-soft sk-pop flex min-w-0 flex-col items-center gap-1 px-2.5 py-2"
      style={{ animationDelay: `${0.15 + i * 0.2}s` }}
    >
      <div className="sk-hand text-[18px] leading-none whitespace-nowrap">
        {emoji} {title}
      </div>
      {body}
    </div>
  );
  const who = (by: string, n?: number) => (
    <span className="flex items-center gap-1 text-[11.5px] font-bold">
      <Avatar idx={avatarOf(by)} size={18} />
      <span className="max-w-[90px] truncate">{nameOf(room, by)}</span>
      {n ? <span className="text-[var(--coral)]">👍{n}</span> : null}
    </span>
  );
  const none = <span className="text-[11.5px] text-[var(--ink3)]">따봉이 없었어요</span>;
  const a = awards;
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className={`grid w-full gap-2 ${v ? "grid-cols-1" : "grid-cols-3"}`}>
        {card(
          "🖼️",
          "베스트 그림",
          a?.pic ? (
            <>
              <Thumb roomId={room.id} sheetKey={a.pic.key} step={st.step} className="w-[120px]" />
              {who(a.pic.by, a.pic.n)}
            </>
          ) : (
            none
          ),
          0
        )}
        {card(
          "💬",
          "베스트 드립",
          a?.line ? (
            <>
              <span className="sk-hand line-clamp-3 text-center text-[17px] leading-tight break-keep">
                「{a.line.text}」
              </span>
              {who(a.line.by, a.line.n)}
            </>
          ) : (
            none
          ),
          1
        )}
        {card(
          "🌀",
          "최고의 변신",
          a?.morph ? (
            <>
              <span className="line-clamp-2 text-center text-[11.5px] leading-snug break-keep text-[var(--ink2)]">
                「{a.morph.first}」 → 「{a.morph.last}」
              </span>
              <span className="sk-hand text-[22px] leading-none text-[var(--coral)]">
                {a.morph.rate}%
              </span>
              {who(album?.[a.morph.chain]?.[0]?.by ?? "")}
            </>
          ) : (
            none
          ),
          2
        )}
      </div>
      {album && album.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-[12px] font-bold text-[var(--ink2)]">
            💾 이야기 저장 (사진 · GIF)
          </span>
          {album.map((chain, c) =>
            chain.length ? (
              <span key={c} className="flex items-center">
                <SaveStoryButton
                  room={room}
                  entries={chain}
                  label={nameOf(room, chain[0]?.by ?? "")}
                  className="!rounded-r-none !px-2 !py-1 text-[12.5px]"
                />
                <SaveStoryButton
                  room={room}
                  entries={chain}
                  kind="gif"
                  label="GIF"
                  className="!rounded-l-none !border-l-0 !px-1.5 !py-1 text-[11.5px]"
                />
              </span>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 그림 맞히기 판 끝: 「오늘의 그림」 모아보기 (드로풀 · 갈틱폰처럼 판이 끝나도 그림이 남게).
 * 그림마다 따봉(게임 중 누른 것과 합쳐짐) · 크게 보기 · 한 장으로 저장. 따봉 1위 그린 사람 = 인기상.
 */
export function ClassicGallery({ room, uid, v }: { room: Room; uid: string; v: boolean }) {
  const st = room.state;
  const gallery = st.gallery;
  const items = useMemo(() => gallery ?? [], [gallery]);
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState<GalleryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const likesOf = (key: string) => st.likes?.[key]?.length ?? 0;
  // 인기상: 받은 따봉 합이 가장 많은 사람 (2개 이상)
  const popular = useMemo(() => {
    const sum = new Map<string, number>();
    for (const g of items) sum.set(g.by, (sum.get(g.by) ?? 0) + (st.likes?.[g.key]?.length ?? 0));
    const top = [...sum.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? { by: top[0], n: top[1] } : null;
  }, [items, st.likes]);
  if (!items.length) return null;
  const save = async () => {
    setBusy(true);
    try {
      const cells = await Promise.all(
        items.map(async (g) => ({
          word: g.word,
          name: nameOf(room, g.by),
          likes: likesOf(g.key),
          strokes: await getSheet(room.id, `c:${g.key}`),
        }))
      );
      const cv = await galleryImage(`오늘의 그림 ${items.length}장`, cells);
      downloadCanvas(cv, `doodle-party_오늘의_그림.png`);
    } catch {
      playSfx("sfx-error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {popular && (
          <span className="sk-pop flex items-center gap-1 rounded-full border-2 border-[var(--ink)] bg-[var(--sun)] py-0.5 pr-2.5 pl-1 text-[12.5px] font-extrabold">
            <Avatar idx={avatarOf(popular.by)} size={22} /> 인기상 {nameOf(room, popular.by)} 👍
            {popular.n}
          </span>
        )}
        <button
          type="button"
          onClick={tap(() => setOpen(true), "sfx-open")}
          className="sk-btn text-[16px]"
        >
          🖼️ 오늘의 그림 {items.length}장
        </button>
      </div>
      {open && (
        <div
          className="sk-dim"
          onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            className={`sk-card sk-pop relative flex flex-col gap-3 p-4 ${v ? "max-h-[88%] w-[94%]" : "max-h-[90%] w-[860px] max-w-[94%]"}`}
          >
            <div className="flex items-center gap-2">
              <h2 className="sk-hand text-[26px] leading-none">🖼️ 오늘의 그림</h2>
              <span className="text-[12px] font-bold text-[var(--ink3)]">
                마음에 드는 그림에 따봉!
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                className="sk-btn ml-auto px-3 text-[14px]"
              >
                {busy ? "만드는 중…" : "💾 한 장으로 저장"}
              </button>
              <button
                type="button"
                aria-label="닫기"
                onClick={tap(() => setOpen(false), "sfx-close")}
                className="sk-btn sk-btn-ghost sk-btn-icon text-[13px]"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <ul
              className={`grid min-h-0 gap-3 overflow-y-auto pr-1 ${v ? "grid-cols-2" : "grid-cols-4"}`}
            >
              {items.map((g) => (
                <li key={g.key} className="flex min-w-0 flex-col gap-1">
                  <button type="button" onClick={tap(() => setBig(g), "sfx-click")}>
                    <Thumb roomId={room.id} sheetKey={`c:${g.key}`} step={st.step} />
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1">
                      <span className="sk-hand block truncate text-[17px] leading-tight">
                        {g.word || "(건너뜀)"}
                      </span>
                      <span className="block truncate text-[11px] font-bold text-[var(--ink2)]">
                        {nameOf(room, g.by)}
                      </span>
                    </span>
                    <LikeButton room={room} uid={uid} likeKey={g.key} author={g.by} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {big && (
            <div
              className="sk-dim"
              onPointerDown={(e) => e.target === e.currentTarget && setBig(null)}
            >
              <div className="sk-card sk-pop flex w-[640px] max-w-[94%] flex-col gap-2 p-3">
                <BigSheet roomId={room.id} sheetKey={`c:${big.key}`} step={st.step} />
                <div className="flex items-center gap-2">
                  <span className="sk-hand text-[24px] leading-none">{big.word || "(건너뜀)"}</span>
                  <span className="text-[12px] font-bold text-[var(--ink2)]">
                    {nameOf(room, big.by)}
                  </span>
                  <span className="ml-auto">
                    <LikeButton room={room} uid={uid} likeKey={big.key} author={big.by} />
                  </span>
                  <button
                    type="button"
                    onClick={tap(() => setBig(null), "sfx-close")}
                    className="sk-btn px-3 text-[14px]"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
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
        {room.meta.mode === "relay" && room.meta.variant !== "normal" && (
          <span className="ml-1.5 text-[16px] text-[var(--coral)]">
            · {RELAY_VARIANTS[room.meta.variant].emoji} {RELAY_VARIANTS[room.meta.variant].name}
          </span>
        )}
        {room.meta.mode === "fake" && room.meta.qm && (
          <span className="ml-1.5 text-[16px] text-[var(--coral)]">· 🎩 출제자</span>
        )}
      </b>
      {!v &&
        info.how.map((h) => (
          <p key={h} className="text-[12.5px] leading-snug">
            · {h}
          </p>
        ))}
      {room.meta.mode === "relay" && room.meta.variant !== "normal" && (
        <p className="text-[12.5px] leading-snug font-bold">
          · {RELAY_VARIANTS[room.meta.variant].desc}
        </p>
      )}
      {room.meta.mode === "fake" && room.meta.qm && (
        <p className="text-[12.5px] leading-snug font-bold">
          · 판마다 돌아가며 한 명이 출제자 — 제시어를 직접 고르고 안 그려요. 가짜가 이기면 출제자도
          점수!
        </p>
      )}
      {v && <p className="text-[12.5px]">{info.short}</p>}
    </div>
  );
}
