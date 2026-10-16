"use client";

import { useEffect, useState } from "react";
import { sfx } from "@/lib/rhythm/sfx";
import type { OnlineLobbyRoom } from "@/realtime/rhythmOnline";
import TopButtons from "./TopButtons";

const DISP = "pru-t";
const KR = "";

const PHASE: Record<OnlineLobbyRoom["phase"], { label: string; color: string }> = {
  lobby: { label: "대기 중", color: "#4ADE80" },
  loading: { label: "곧 시작", color: "#FBBF24" },
  playing: { label: "게임 중", color: "#F472B6" },
  result: { label: "결과", color: "#60A5FA" },
};

/** 온라인 로비: 방 목록 · 방 만들기 · (비회원) 이름 정하기 */
export default function OnlineLobby({
  rooms,
  nick,
  member,
  avatar,
  onNick,
  onCreate,
  onJoin,
  onBack,
  err,
  ready,
  fs,
  onToggleFs,
  onSettings,
  blocked = false,
}: {
  rooms: OnlineLobbyRoom[] | null;
  nick: string;
  member: boolean;
  /** 회원 프로필 사진 (없으면 이름 첫 글자) */
  avatar?: string | null;
  onNick: (n: string) => void;
  onCreate: (name: string, max: number) => void;
  onJoin: (id: string) => void;
  onBack: () => void;
  err: string;
  /** 접속(익명 로그인 포함)이 끝났는지 */
  ready: boolean;
  fs: boolean;
  onToggleFs: () => void;
  onSettings: () => void;
  /** 설정 창이 떠 있으면 Esc 안 받음 */
  blocked?: boolean;
}) {
  const [name, setName] = useState("");
  const [max, setMax] = useState(4);
  const [typed, setTyped] = useState(nick);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown =
    rooms && q
      ? rooms.filter((r) => r.name.toLowerCase().includes(q) || r.song.toLowerCase().includes(q))
      : rooms;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape" || blocked) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT") return;
      e.preventDefault();
      sfx("ui-back", 0.7);
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, blocked]);

  const needNick = !member && !nick;
  const run = async (fn: () => unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded-[0.6cqw] border border-white/15 bg-black/40 px-[1cqw] py-[0.6cqw] text-[1.25cqw] text-white outline-none placeholder:text-white/30 focus:border-[#F472B6]";
  const btn = (on = true) =>
    `${KR} cursor-pointer rounded-[0.7cqw] px-[1.6cqw] py-[0.7cqw] text-[1.25cqw] font-extrabold transition-colors disabled:cursor-default disabled:opacity-40 ${
      on
        ? "bg-[linear-gradient(90deg,#DB2777,#7C3AED)] text-white hover:brightness-110"
        : "border border-white/20 bg-white/5 text-white/80 hover:border-white/50"
    }`;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#06041a]">
      <img
        src="/rhythm/px/stage-pink.webp"
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-35"
      />
      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(6,4,26,0.75),rgba(6,4,26,0.55)_50%,rgba(6,4,26,0.9))]" />

      <div className="absolute inset-x-0 top-0 z-10 flex h-[5.4cqw] items-center justify-between border-b border-white/10 bg-black/35 px-[2.4cqw]">
        <div className="flex items-baseline gap-[1.2cqw]">
          <span className={`${DISP} text-[2.2cqw] tracking-[0.06em] text-white`}>ONLINE</span>
          <span className={`${KR} text-[1.1cqw] text-white/45`}>온라인 모드</span>
        </div>
        <div className="flex items-center gap-[0.6cqw]">
          <TopButtons fs={fs} onToggleFs={onToggleFs} onSettings={onSettings} />
          <button
            type="button"
            onClick={() => {
              sfx("ui-back", 0.7);
              onBack();
            }}
            className={`${KR} cursor-pointer rounded-[0.6cqw] border border-white/15 bg-white/5 px-[1.2cqw] py-[0.4cqw] text-[1.05cqw] text-white/75 hover:border-white/40 hover:text-white`}
          >
            ← 타이틀 (Esc)
          </button>
        </div>
      </div>

      {!ready ? (
        <div
          className={`${KR} absolute inset-0 flex items-center justify-center text-[1.5cqw] text-white/60`}
        >
          {err || "접속 중…"}
        </div>
      ) : needNick ? (
        <form
          className="absolute top-1/2 left-1/2 flex w-[34cqw] -translate-x-1/2 -translate-y-1/2 flex-col gap-[1cqw] rounded-[1.2cqw] border border-white/15 bg-[#0b0820]/90 p-[2cqw]"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onNick(typed);
          }}
        >
          <div className={`${KR} text-[1.5cqw] font-extrabold text-white`}>온라인에서 쓸 이름</div>
          <input
            autoFocus
            className={`${KR} ${input}`}
            value={typed}
            maxLength={10}
            placeholder="이름 (10자까지)"
            onChange={(e) => setTyped(e.target.value)}
          />
          <p className={`${KR} text-[1cqw] text-white/45`}>
            로그인하면 별명으로 나와요. 비회원 이름 앞에는 ◦ 표시가 붙어요.
          </p>
          <button type="submit" className={btn()} disabled={!typed.trim()}>
            확인
          </button>
        </form>
      ) : (
        <div className="absolute top-[7cqw] right-[2.4cqw] bottom-[2.4cqw] left-[2.4cqw] flex gap-[1.8cqw]">
          {/* 왼쪽: 방 만들기 + 하는 법 */}
          <div className="flex w-[31cqw] shrink-0 flex-col gap-[1.2cqw]">
            <div className="relative flex flex-col gap-[1.2cqw] overflow-hidden rounded-[1.2cqw] border border-[#F472B6]/35 bg-[#0b0820]/85 px-[1.8cqw] py-[1.6cqw] shadow-[0_0.35cqw_0_rgba(12,7,24,0.6)]">
              <div className="pointer-events-none absolute -top-[6cqw] -right-[6cqw] h-[14cqw] w-[14cqw] rounded-full bg-[#EC4899]/25 blur-[3cqw]" />
              <div className="relative flex items-center justify-between gap-[1cqw]">
                <span className={`${DISP} text-[1.6cqw] tracking-[0.04em] text-white`}>
                  CREATE ROOM
                </span>
                <span
                  className={`${KR} flex min-w-0 items-center gap-[0.5cqw] rounded-full border border-white/15 bg-white/5 py-[0.2cqw] pr-[0.9cqw] pl-[0.25cqw] text-[1cqw]`}
                >
                  {avatar ? (
                    <img
                      src={avatar}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-[1.8cqw] w-[1.8cqw] shrink-0 rounded-full bg-white/10 object-cover"
                    />
                  ) : (
                    <span className="flex h-[1.8cqw] w-[1.8cqw] shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#DB2777,#7C3AED)] text-[0.9cqw] font-bold text-white">
                      {[...(nick || "?")][0]}
                    </span>
                  )}
                  <span className="truncate font-bold text-white/85">
                    {member ? "" : "◦"}
                    {nick}
                  </span>
                  {!member && (
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer text-white/40 hover:text-white"
                      onClick={() => onNick("")}
                      title="이름 바꾸기"
                    >
                      ✎
                    </button>
                  )}
                </span>
              </div>
              <label className={`${KR} relative block text-[0.95cqw] font-bold text-white/50`}>
                방 이름
                <input
                  className={`${KR} ${input} mt-[0.5cqw]`}
                  value={name}
                  maxLength={20}
                  placeholder={`${nick || "내 이름"}의 방`}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className={`${KR} relative text-[0.95cqw] font-bold text-white/50`}>
                인원
                <div className="mt-[0.5cqw] grid grid-cols-5 overflow-hidden rounded-[0.6cqw] border border-white/15">
                  {[2, 3, 4, 6, 8].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setMax(n);
                        sfx("ui-move", 0.5);
                      }}
                      className={`cursor-pointer border-r border-white/10 py-[0.45cqw] font-mono text-[1.2cqw] font-bold transition-colors last:border-r-0 ${
                        max === n
                          ? "bg-[#F472B6]/30 text-white"
                          : "bg-black/30 text-white/50 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className={`${btn()} relative mt-[0.6cqw] w-full py-[0.9cqw] text-[1.4cqw] shadow-[0_0.4cqw_2cqw_-0.4cqw_rgba(219,39,119,0.7)]`}
                disabled={busy}
                onClick={() => run(() => onCreate(name, max))}
              >
                방 만들기
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-[1cqw] pru-box [--f:rgba(12,7,24,0.8)] px-[1.8cqw] py-[1.4cqw]">
              <span className={`${DISP} text-[1.15cqw] tracking-[0.06em] text-white/80`}>
                HOW IT WORKS
              </span>
              <div className="grid grid-cols-[2.6cqw_1fr] items-start gap-x-[0.9cqw] gap-y-[1cqw]">
                {[
                  ["01", "방장이 곡을 골라요", "내장곡이나 방장의 내 음악(mp3·영상)"],
                  ["02", "방장이 난이도까지 정하면 READY", "모두 같은 곡 · 같은 난이도로 겨뤄요"],
                ].map(([no, t, d]) => (
                  <div key={no} className="contents">
                    <span className="mt-[0.15cqw] rounded-[0.3cqw] bg-[#22D3EE] text-center pru-t text-[0.95cqw] font-bold text-[#06041a]">
                      {no}
                    </span>
                    <span className="min-w-0">
                      <span className={`${KR} block text-[1.1cqw] font-bold text-white/85`}>
                        {t}
                      </span>
                      <span className={`${KR} mt-[0.15cqw] block text-[0.95cqw] text-white/40`}>
                        {d}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 오른쪽: 방 목록 */}
          <div className="flex min-w-0 flex-1 flex-col pru-box [--f:rgba(12,7,24,0.8)] p-[1.6cqw]">
            <div className="mb-[1cqw] flex items-center gap-[0.8cqw]">
              <span className={`${DISP} text-[1.6cqw] tracking-[0.04em] text-white`}>ROOMS</span>
              <span className="rounded-full bg-white/10 px-[0.7cqw] py-[0.1cqw] font-mono text-[1cqw] text-white/70">
                {rooms?.length ?? 0}
              </span>
              <input
                className={`${KR} ml-auto w-[16cqw] rounded-full border border-white/15 bg-black/40 px-[1cqw] py-[0.3cqw] text-[1cqw] text-white outline-none placeholder:text-white/30 focus:border-[#F472B6]`}
                value={query}
                placeholder="🔍 방 이름·곡 검색"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {err && <p className={`${KR} mb-[0.8cqw] text-[1.1cqw] text-[#FB7185]`}>{err}</p>}
            <div className="min-h-0 flex-1 overflow-y-auto pr-[0.4cqw]">
              {shown === null ? (
                <p className={`${KR} text-[1.1cqw] text-white/40`}>불러오는 중…</p>
              ) : shown.length === 0 && q ? (
                <p className={`${KR} pt-[2cqw] text-center text-[1.1cqw] text-white/40`}>
                  &lsquo;{query.trim()}&rsquo; 검색 결과가 없어요
                </p>
              ) : shown.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-[0.8cqw] text-center">
                  <span className="text-[4.5cqw] opacity-80">🎮</span>
                  <span className={`${KR} text-[1.5cqw] font-extrabold text-white/80`}>
                    열린 방이 없어요
                  </span>
                  <span className={`${KR} text-[1.05cqw] text-white/40`}>
                    왼쪽에서 방을 만들고 친구를 불러 보세요
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-[0.7cqw]">
                  {shown.map((r) => {
                    const full = r.count >= r.max;
                    const ph = PHASE[r.phase];
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={full || busy}
                        onClick={() => run(() => onJoin(r.id))}
                        className="group relative flex cursor-pointer items-center gap-[1.2cqw] overflow-hidden rounded-[0.9cqw] border border-white/10 bg-white/[0.04] py-[0.9cqw] pr-[1.6cqw] pl-[2.2cqw] text-left transition-colors hover:border-[#F472B6]/70 hover:bg-[#F472B6]/10 disabled:cursor-default disabled:opacity-45"
                      >
                        <span
                          className="absolute inset-y-0 left-0 w-[0.35cqw]"
                          style={{ background: ph.color }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-[0.7cqw]">
                            <span
                              className={`${KR} truncate text-[1.35cqw] font-extrabold text-white`}
                            >
                              {r.name}
                            </span>
                            <span
                              className={`${KR} shrink-0 rounded-full px-[0.6cqw] py-[0.1cqw] text-[0.85cqw] font-bold`}
                              style={{ color: ph.color, background: `${ph.color}22` }}
                            >
                              {ph.label}
                            </span>
                          </span>
                          <span
                            className={`${KR} mt-[0.2cqw] block truncate text-[1cqw] text-white/45`}
                          >
                            {r.song ? `♪ ${r.song}` : "곡 고르는 중"}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-[0.35cqw]">
                          <span className="flex gap-[0.25cqw]">
                            {Array.from({ length: r.max }, (_, i) => (
                              <span
                                key={i}
                                className={`h-[0.7cqw] w-[0.7cqw] rounded-full ${i < r.count ? "bg-[#F472B6]" : "bg-white/15"}`}
                              />
                            ))}
                          </span>
                          <span className="font-mono text-[1cqw] text-white/60">
                            {full ? "가득 참" : `${r.count}/${r.max}`}
                          </span>
                        </span>
                        <span
                          className={`${KR} shrink-0 text-[1.1cqw] font-bold text-white/30 transition-colors group-hover:text-white`}
                        >
                          입장 →
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
