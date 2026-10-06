"use client";

import { useEffect, useMemo, useState } from "react";
import { timeLabel, useActiveRoomPrompt } from "@/components/Chess/ChessLobby";
import { SETUPS, type Setup } from "@/lib/janggi/engine";
import {
  ActiveRoomError,
  createRoom,
  findMyActiveRoom,
  isPauseExpired,
  subscribeRooms,
  colorOf,
  serverNow,
  MAX_SPECTATORS,
  WAITING_STALE_MS,
  type JanggiRoom,
  type Color,
} from "@/firestore/janggiGame";

const TIME_OPTIONS = [0, 1, 3, 5, 10, 15, 30];
const INC_OPTIONS = [0, 2, 3, 5, 10];

const input =
  "w-full rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none";
const primaryBtn =
  "cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm whitespace-nowrap text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-xs text-white/40">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => onChange(o.v)}
            className={`cursor-pointer rounded-full px-3 py-1 font-mono text-xs transition-colors ${
              value === o.v
                ? "bg-[#6C63FF] text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 로비에 노출할 방인지 */
function isVisible(r: JanggiRoom, now: number) {
  const updated = r.updatedAt?.toMillis() ?? now;
  if (r.status === "closed") return false;
  if (r.status === "waiting") return now - updated < WAITING_STALE_MS;
  if (r.status === "playing") return now - updated < 2 * 60 * 60_000;
  return now - updated < 10 * 60_000; // ended
}

interface Props {
  uid: string;
  nick: string;
  onChangeNick: () => void;
  onEnter: (roomId: string, as?: "play" | "watch") => void;
}

export default function JanggiLobby({ uid, nick, onChangeNick, onEnter }: Props) {
  const [rooms, setRooms] = useState<JanggiRoom[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => serverNow());

  const [title, setTitle] = useState("");
  const [color, setColor] = useState<Color | "r">("w");
  const [timeMin, setTimeMin] = useState(10);
  const [incSec, setIncSec] = useState(0);
  const [password, setPassword] = useState("");
  const [setupW, setSetupW] = useState<Setup>("heeh");
  const [setupB, setSetupB] = useState<Setup>("heeh");
  const [creating, setCreating] = useState(false);
  const promptActive = useActiveRoomPrompt((id) => onEnter(id));

  async function onJoin(roomId: string) {
    const active = await findMyActiveRoom(uid).catch(() => null);
    if (active && active.id !== roomId) return promptActive(active);
    onEnter(roomId, "play");
  }

  useEffect(
    () =>
      subscribeRooms(
        (r) => {
          setRooms(r);
          setLoaded(true);
        },
        (e) => {
          console.error(e);
          setError("방 목록을 불러오지 못했습니다.");
          setLoaded(true);
        }
      ),
    []
  );

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 15_000);
    return () => clearInterval(t);
  }, []);

  const { mine, open } = useMemo(() => {
    const mine: JanggiRoom[] = [];
    const open: JanggiRoom[] = [];
    rooms.forEach((r) => {
      if (isPauseExpired(r, now)) return; // 2시간 넘게 멈춘 대국은 종료 취급
      if (colorOf(r, uid) && (r.status === "playing" || r.status === "waiting")) mine.push(r);
      else if (isVisible(r, now)) open.push(r);
    });
    return { mine, open };
  }, [rooms, uid, now]);

  async function onCreate() {
    if (!title.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const id = await createRoom({
        name: title,
        uid,
        nick,
        color,
        timeMin,
        incSec: timeMin ? incSec : 0,
        password,
        variant: `${setupW}/${setupB}`,
      });
      onEnter(id);
    } catch (e) {
      setCreating(false);
      if (e instanceof ActiveRoomError) return promptActive(e.room);
      console.error(e);
      setError("방 생성에 실패했습니다.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pt-12 pb-24 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="font-mono text-sm text-[#8B84FF]">온라인 대국</div>
        <button type="button" onClick={onChangeNick} className={ghostBtn}>
          {nick} · 닉네임 변경
        </button>
      </div>

      {mine.length > 0 && (
        <div className="mb-6 rounded-xl border border-[#6C63FF]/40 bg-[#6C63FF]/10 p-3">
          <div className="mb-2 px-1 font-mono text-xs text-[#8B84FF]">진행중인 내 게임</div>
          {mine.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onEnter(r.id)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/80 transition-colors hover:bg-white/5"
            >
              <span className="truncate font-['Nanum_Gothic',sans-serif]">
                {r.locked && "🔒 "}
                {r.name}
              </span>
              <span className="shrink-0 font-mono text-xs text-[#8B84FF]">돌아가기 →</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-8 rounded-xl border border-white/10 bg-[#1C1E24] p-2">
        <div className="hidden grid-cols-[1fr_9rem_5rem_7.5rem] gap-2 px-3 py-2 font-mono text-xs text-white/40 sm:grid">
          <span>방 제목</span>
          <span>대국자</span>
          <span>시간</span>
          <span />
        </div>
        {!loaded ? (
          <p className="px-3 py-6 text-center font-mono text-sm text-white/30">불러오는 중…</p>
        ) : open.length === 0 ? (
          <p className="px-3 py-6 text-center font-['Nanum_Gothic',sans-serif] text-sm text-white/30">
            열린 방이 없습니다. 새로 만들어보세요!
          </p>
        ) : (
          open.map((r) => {
            const seatOpen = r.status === "waiting" && (!r.whiteUid || !r.blackUid);
            const specCount = Object.keys(r.spectators).length;
            return (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2.5 font-['Nanum_Gothic',sans-serif] text-sm text-white/70 sm:grid-cols-[1fr_9rem_5rem_7.5rem]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      r.status === "waiting"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : r.status === "playing"
                          ? "bg-[#6C63FF]/20 text-[#A9A3FF]"
                          : "bg-white/10 text-white/40"
                    }`}
                  >
                    {r.status === "waiting"
                      ? "대기"
                      : r.status === "playing"
                        ? r.pausedAt
                          ? "일시정지"
                          : "대국중"
                        : "종료"}
                  </span>
                  <span className="truncate text-white/85">
                    {r.locked && "🔒 "}
                    {r.name}
                  </span>
                </span>
                <span className="order-3 col-span-2 truncate text-xs text-white/40 sm:order-none sm:col-span-1">
                  <span className="text-[#7FA8F0]">楚 {r.whiteName || "—"}</span>
                  {"  vs  "}
                  <span className="text-[#F08A8F]">漢 {r.blackName || "—"}</span>
                  <span className="ml-2 sm:hidden">· {timeLabel(r)}</span>
                </span>
                <span className="hidden font-mono text-xs text-white/40 sm:block">
                  {timeLabel(r)}
                </span>
                <span className="flex justify-end gap-1.5">
                  {seatOpen && (
                    <button type="button" onClick={() => onJoin(r.id)} className={ghostBtn}>
                      참여
                    </button>
                  )}
                  {r.status !== "ended" && (
                    <button
                      type="button"
                      disabled={specCount >= MAX_SPECTATORS}
                      onClick={() => onEnter(r.id, "watch")}
                      className={ghostBtn}
                      title={`관전 ${specCount}/${MAX_SPECTATORS}`}
                    >
                      관전 {specCount}/{MAX_SPECTATORS}
                    </button>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#1C1E24] p-4 sm:p-5">
        <div className="mb-4 font-mono text-xs text-white/40">새 방 만들기</div>
        <div className="flex flex-col gap-4">
          <input
            value={title}
            maxLength={20}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onCreate()}
            placeholder="방 제목 (20자)"
            className={input}
          />
          <Segmented
            label="내 진영 (초가 선공, 한은 덤 1.5)"
            value={color}
            onChange={setColor}
            options={[
              { v: "w", label: "초 (선공)" },
              { v: "b", label: "한 (후공)" },
              { v: "r", label: "랜덤" },
            ]}
          />
          <Segmented
            label="초 상차림"
            value={setupW}
            onChange={setSetupW}
            options={SETUPS.map((o) => ({ v: o.v, label: o.label }))}
          />
          <Segmented
            label="한 상차림"
            value={setupB}
            onChange={setSetupB}
            options={SETUPS.map((o) => ({ v: o.v, label: o.label }))}
          />
          <Segmented
            label="제한 시간 (1인당)"
            value={timeMin}
            onChange={setTimeMin}
            options={TIME_OPTIONS.map((v) => ({ v, label: v === 0 ? "무제한" : `${v}분` }))}
          />
          {timeMin > 0 && (
            <Segmented
              label="수당 추가 시간"
              value={incSec}
              onChange={setIncSec}
              options={INC_OPTIONS.map((v) => ({ v, label: v === 0 ? "없음" : `+${v}초` }))}
            />
          )}
          <input
            value={password}
            maxLength={20}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호 (비우면 공개방 · 초대 링크로는 비번 없이 입장)"
            aria-label="비밀번호"
            className={input}
          />
          {error && <p className="font-mono text-xs text-red-400">{error}</p>}
          <button
            type="button"
            onClick={onCreate}
            disabled={!title.trim() || creating}
            className={primaryBtn}
          >
            {creating ? "생성 중…" : "방 생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
