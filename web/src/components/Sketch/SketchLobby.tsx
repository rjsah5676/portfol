"use client";

import { useEffect, useRef, useState } from "react";
import {
  cleanupEmptyRoom,
  createRoom,
  serverNow,
  subscribeLobby,
  type LobbyRoom,
  type TurnMode,
} from "@/realtime/sketch";

const field =
  "rounded-lg border border-white/10 bg-[#15171c] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none";
const seg = (on: boolean) =>
  `cursor-pointer rounded-full px-3 py-1.5 font-mono text-xs transition-colors ${
    on ? "bg-[#6C63FF] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
  }`;
/** 직접 입력 범위 (DB 규칙과 같게) */
const TIME_MIN = 30;
const TIME_MAX = 300;
const ROUNDS_MIN = 1;
const ROUNDS_MAX = 10;

/** 고르기 버튼 옆 직접 입력칸 — 칸을 벗어나면 범위 안으로 맞춤 */
function NumInput({
  value,
  min,
  max,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    const v = Number.isFinite(n) && raw.trim() ? Math.min(max, Math.max(min, n)) : value;
    onChange(v);
    setText(String(v));
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 py-0.5 pr-3 pl-1 font-mono text-xs text-white/60">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={focus ? text : String(value)}
        onFocus={() => {
          setFocus(true);
          setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Math.round(Number(e.target.value));
          if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={(e) => {
          setFocus(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="w-12 rounded-full bg-[#15171c] px-2 py-1 text-center text-white [appearance:textfield] focus:outline-none focus:ring-1 focus:ring-[#6C63FF]/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {unit}
      <span className="text-white/30">
        ({min}~{max})
      </span>
    </span>
  );
}

const PHASE_LABEL: Record<string, string> = {
  waiting: "대기 중",
  choosing: "게임 중 · 참가 가능",
  drawing: "게임 중 · 참가 가능",
  reveal: "게임 중 · 참가 가능",
  ended: "게임 끝",
};

export default function SketchLobby({
  uid,
  nick,
  onEnter,
}: {
  uid: string;
  nick: string;
  onEnter: (roomId: string) => void;
}) {
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [max, setMax] = useState(8);
  const [turnMode, setTurnMode] = useState<TurnMode>("winner");
  const [drawTime, setDrawTime] = useState(80);
  const [rounds, setRounds] = useState(2);
  const [hints, setHints] = useState(true);
  const [password, setPassword] = useState("");

  // 아무도 없는 방 정리 — 1분 넘은 방만, 세션당 한 번씩 확인 (실제 접속자가 있으면 지우지 않음)
  const checked = useRef(new Set<string>());
  useEffect(
    () =>
      subscribeLobby((list) => {
        setRooms(list);
        for (const r of list) {
          if (checked.current.has(r.id) || serverNow() - r.createdAt < 60_000) continue;
          checked.current.add(r.id);
          cleanupEmptyRoom(r.id);
        }
      }),
    []
  );

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await createRoom(uid, nick, {
        name,
        max,
        turnMode,
        drawTime,
        rounds,
        hints,
        password,
      });
      onEnter(id);
    } catch (e) {
      console.error(e);
      setError("방을 만들지 못했어요. 잠시 후 다시 시도해주세요.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 pt-6 pb-24">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/50">
          방을 만들거나 들어가서 같이 그려요 · 최대 8명
        </p>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white hover:bg-[#5b52f0]"
        >
          {creating ? "닫기" : "+ 방 만들기"}
        </button>
      </div>

      {creating && (
        <div className="mb-8 grid gap-4 rounded-2xl border border-white/10 bg-[#1C1E24] p-5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder={`${nick}의 방`}
            aria-label="방 이름"
            className={field}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 font-mono text-[11px] text-white/40">최대 인원</div>
              <div className="flex flex-wrap gap-1">
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={seg(max === n)}
                    onClick={() => setMax(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[11px] text-white/40">다음에 그릴 사람</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={seg(turnMode === "winner")}
                  onClick={() => setTurnMode("winner")}
                >
                  맞힌 사람
                </button>
                <button
                  type="button"
                  className={seg(turnMode === "order")}
                  onClick={() => setTurnMode("order")}
                >
                  입장 순서
                </button>
              </div>
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[11px] text-white/40">그리는 시간</div>
              <div className="flex flex-wrap gap-1">
                {[60, 80, 100, 120].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={seg(drawTime === t)}
                    onClick={() => setDrawTime(t)}
                  >
                    {t}초
                  </button>
                ))}
                <NumInput
                  value={drawTime}
                  min={TIME_MIN}
                  max={TIME_MAX}
                  unit="초"
                  onChange={setDrawTime}
                />
              </div>
            </div>
            <div>
              <div className="mb-1.5 font-mono text-[11px] text-white/40">
                한 사람당 그리는 횟수
              </div>
              <div className="flex flex-wrap gap-1">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={seg(rounds === n)}
                    onClick={() => setRounds(n)}
                  >
                    {n}번
                  </button>
                ))}
                <NumInput
                  value={rounds}
                  min={ROUNDS_MIN}
                  max={ROUNDS_MAX}
                  unit="번"
                  onChange={setRounds}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-1.5 font-mono text-xs text-white/60">
              <input
                type="checkbox"
                checked={hints}
                onChange={(e) => setHints(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#6C63FF]"
              />
              시간이 지나면 힌트 공개 (첫 글자 → 초성)
            </label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={20}
              placeholder="비밀번호 (비우면 공개방)"
              aria-label="비밀번호"
              className={`${field} min-w-0 flex-1`}
            />
          </div>
          {error && <p className="font-mono text-xs text-red-300">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={create}
            className="cursor-pointer rounded-full bg-[#6C63FF] py-2.5 font-mono text-sm text-white hover:bg-[#5b52f0] disabled:opacity-50"
          >
            {busy ? "만드는 중…" : "방 만들기"}
          </button>
        </div>
      )}

      {rooms === null ? (
        <p className="py-12 text-center font-mono text-sm text-white/30">불러오는 중…</p>
      ) : rooms.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-[#1C1E24] py-14 text-center font-['Nanum_Gothic',sans-serif] text-sm text-white/40">
          열린 방이 없어요. 방을 만들고 친구에게 초대 링크를 보내보세요!
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rooms.map((r) => {
            const full = r.count >= r.max;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={full}
                  onClick={() => onEnter(r.id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#1C1E24] px-4 py-3 text-left transition-colors hover:border-[#6C63FF]/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-['Nanum_Gothic',sans-serif] text-sm text-white">
                      {r.locked && "🔒 "}
                      {r.name}
                    </span>
                    <span className="font-mono text-[11px] text-white/35">
                      {PHASE_LABEL[r.phase] ?? r.phase} ·{" "}
                      {r.turnMode === "winner" ? "맞힌 사람 순" : "입장 순"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono text-sm ${full ? "text-red-300" : "text-white/70"}`}
                  >
                    {r.count}/{r.max}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
