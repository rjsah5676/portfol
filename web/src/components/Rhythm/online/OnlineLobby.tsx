"use client";

import { useEffect, useState } from "react";
import { sfx } from "@/lib/rhythm/sfx";
import type { OnlineLobbyRoom } from "@/realtime/rhythmOnline";

const DISP = "font-['Arial_Black','Segoe_UI_Black',Impact,sans-serif] font-black italic";
const KR = "font-['Nanum_Gothic',sans-serif]";

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
  onNick,
  onCreate,
  onJoin,
  onBack,
  err,
  ready,
}: {
  rooms: OnlineLobbyRoom[] | null;
  nick: string;
  member: boolean;
  onNick: (n: string) => void;
  onCreate: (name: string, max: number) => void;
  onJoin: (id: string) => void;
  onBack: () => void;
  err: string;
  /** 접속(익명 로그인 포함)이 끝났는지 */
  ready: boolean;
}) {
  const [name, setName] = useState("");
  const [max, setMax] = useState(4);
  const [typed, setTyped] = useState(nick);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT") return;
      e.preventDefault();
      sfx("ui-back", 0.7);
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

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
        src="/rhythm/play-pink.webp"
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-35"
      />
      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(6,4,26,0.75),rgba(6,4,26,0.55)_50%,rgba(6,4,26,0.9))]" />

      <div className="absolute inset-x-0 top-0 z-10 flex h-[5.4cqw] items-center justify-between border-b border-white/10 bg-black/35 px-[2.4cqw]">
        <div className="flex items-baseline gap-[1.2cqw]">
          <span className={`${DISP} text-[2.2cqw] tracking-[0.06em] text-white`}>ONLINE</span>
          <span className={`${KR} text-[1.1cqw] text-white/45`}>
            같은 곡을 같이 쳐서 점수 겨루기 — 내 음악도 돼요
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            sfx("ui-back", 0.7);
            onBack();
          }}
          className={`${KR} cursor-pointer rounded-[0.6cqw] border border-white/15 bg-white/5 px-[1.2cqw] py-[0.4cqw] text-[1.1cqw] text-white/75 hover:border-white/40 hover:text-white`}
        >
          ← 타이틀 (Esc)
        </button>
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
        <div className="absolute top-[7cqw] right-[2.4cqw] bottom-[2.4cqw] left-[2.4cqw] flex gap-[2cqw]">
          {/* 방 만들기 */}
          <div className="flex w-[28cqw] shrink-0 flex-col gap-[1cqw] rounded-[1.2cqw] border border-white/12 bg-[#0b0820]/80 p-[1.6cqw]">
            <div className={`${DISP} text-[1.5cqw] text-white`}>CREATE ROOM</div>
            <div className={`${KR} text-[1.05cqw] text-white/55`}>
              {member ? "" : "◦"}
              {nick} 님
              {!member && (
                <button
                  type="button"
                  className="ml-[0.6cqw] cursor-pointer text-white/40 underline hover:text-white"
                  onClick={() => onNick("")}
                >
                  이름 바꾸기
                </button>
              )}
            </div>
            <input
              className={`${KR} ${input}`}
              value={name}
              maxLength={20}
              placeholder="방 이름 (비우면 '내 이름의 방')"
              onChange={(e) => setName(e.target.value)}
            />
            <div className={`${KR} flex items-center gap-[0.6cqw] text-[1.1cqw] text-white/70`}>
              인원
              {[2, 3, 4, 6, 8].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMax(n)}
                  className={`cursor-pointer rounded-[0.5cqw] border px-[0.8cqw] py-[0.25cqw] font-mono text-[1.1cqw] ${
                    max === n
                      ? "border-[#F472B6] bg-[#F472B6]/20 text-white"
                      : "border-white/15 text-white/60 hover:border-white/40"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={btn()}
              disabled={busy}
              onClick={() => run(() => onCreate(name, max))}
            >
              방 만들기
            </button>
            <p className={`${KR} mt-auto text-[0.95cqw] leading-relaxed text-white/40`}>
              방장이 곡을 고르고, 각자 난이도를 골라 준비하면 방장이 시작해요. 다 같이 같은 순간에
              시작하고, 치는 동안 서로 점수가 보여요. 방장의 내 음악(mp3·영상)도 같이 칠 수 있어요.
            </p>
          </div>

          {/* 방 목록 */}
          <div className="flex min-w-0 flex-1 flex-col rounded-[1.2cqw] border border-white/12 bg-[#0b0820]/80 p-[1.6cqw]">
            <div className="mb-[1cqw] flex items-baseline justify-between">
              <span className={`${DISP} text-[1.5cqw] text-white`}>ROOMS</span>
              <span className="font-mono text-[1cqw] text-white/40">{rooms?.length ?? 0}</span>
            </div>
            {err && <p className={`${KR} mb-[0.8cqw] text-[1.1cqw] text-[#FB7185]`}>{err}</p>}
            <div className="min-h-0 flex-1 overflow-y-auto pr-[0.4cqw]">
              {rooms === null ? (
                <p className={`${KR} text-[1.1cqw] text-white/40`}>불러오는 중…</p>
              ) : rooms.length === 0 ? (
                <p className={`${KR} text-[1.1cqw] text-white/40`}>
                  열린 방이 없어요. 방을 만들어 보세요.
                </p>
              ) : (
                <div className="flex flex-col gap-[0.6cqw]">
                  {rooms.map((r) => {
                    const full = r.count >= r.max;
                    const ph = PHASE[r.phase];
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={full || busy}
                        onClick={() => run(() => onJoin(r.id))}
                        className="flex cursor-pointer items-center gap-[1cqw] rounded-[0.8cqw] border border-white/10 bg-white/[0.04] px-[1.2cqw] py-[0.8cqw] text-left transition-colors hover:border-[#F472B6]/70 hover:bg-[#F472B6]/10 disabled:cursor-default disabled:opacity-45"
                      >
                        <span
                          className={`${KR} shrink-0 rounded-full px-[0.7cqw] py-[0.15cqw] text-[0.9cqw] font-bold`}
                          style={{ color: ph.color, background: `${ph.color}22` }}
                        >
                          {ph.label}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`${KR} block truncate text-[1.3cqw] font-extrabold text-white`}
                          >
                            {r.name}
                          </span>
                          <span className={`${KR} block truncate text-[1cqw] text-white/45`}>
                            {r.song ? `♪ ${r.song}` : "곡 고르는 중"}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[1.2cqw] text-white/75">
                          {r.count}/{r.max}
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
