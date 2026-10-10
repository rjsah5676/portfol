"use client";

import { useEffect } from "react";
import { DIFFICULTIES, type Difficulty } from "@/lib/rhythm/chart";
import { sfx } from "@/lib/rhythm/sfx";
import type { LiveRow, OnlineRoom as Room } from "@/realtime/rhythmOnline";
import { RankEmblem } from "../Stage";
import TopButtons from "./TopButtons";

const DISP = "font-['Arial_Black','Segoe_UI_Black',Impact,sans-serif] font-black italic";
const KR = "font-['Nanum_Gothic',sans-serif]";
const diffOf = (d: Difficulty) => DIFFICULTIES.find((x) => x.key === d) ?? DIFFICULTIES[1];
const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export interface RoomSongView {
  cover: string;
  color: string;
  bpm: number;
  artist?: string;
  /** 난이도별 레벨 (아는 것만) */
  levels: Partial<Record<Difficulty, number>>;
}

/** 온라인 방: 곡 · 내 난이도 · 사람들 · 준비/시작 · 받는 중 · 관전 점수판 · 결과 */
export default function OnlineRoom({
  room,
  uid,
  live,
  songView,
  upload,
  load,
  err,
  onPick,
  onDiff,
  onReady,
  onStart,
  onBack,
  onLeave,
  fs,
  onToggleFs,
  onSettings,
  blocked = false,
}: {
  room: Room;
  uid: string;
  live: { round: number; rows: Record<string, LiveRow> } | null;
  songView: RoomSongView | null;
  /** 방장: 내 음악 올리는 진행 (null = 없음) */
  upload: { ratio: number; error: string } | null;
  /** 내가 곡 받는 진행 (loading 중) */
  load: { ratio: number; label: string; error: string } | null;
  err: string;
  onPick: () => void;
  onDiff: (d: Difficulty) => void;
  onReady: (r: boolean) => void;
  onStart: () => void;
  onBack: () => void;
  onLeave: () => void;
  fs: boolean;
  onToggleFs: () => void;
  onSettings: () => void;
  /** 설정 창이 떠 있으면 키 입력 안 받음 */
  blocked?: boolean;
}) {
  const host = room.meta.hostUid === uid;
  const me = room.players[uid];
  const song = room.song;
  const color = songView?.color ?? "#F472B6";
  const idle = room.phase === "lobby" || room.phase === "result";
  const players = Object.entries(room.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
  const others = players.filter(([u]) => u !== uid);
  const allReady = others.every(([, p]) => p.ready);
  const canStart = host && idle && !!song?.ready && allReady;
  const round = room.round;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || blocked) return;
      if (e.code === "Enter" && idle) {
        e.preventDefault();
        if (host) {
          if (canStart) onStart();
        } else if (me) onReady(!me.ready);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idle, host, canStart, me, onStart, onReady, blocked]);

  // 결과 · 관전 점수판 (점수 순)
  const results = round
    ? Object.entries(round.results).sort((a, b) => b[1].score - a[1].score)
    : [];
  const liveRows =
    live && round && live.round === round.no
      ? Object.entries(live.rows).sort((a, b) => b[1][0] - a[1][0])
      : [];

  const btnMain = `${DISP} cursor-pointer rounded-[0.9cqw] px-[3cqw] py-[1cqw] text-[1.8cqw] tracking-[0.08em] text-white transition-[filter,opacity] hover:brightness-110 disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100`;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#06041a]">
      {songView && (
        <img
          key={songView.cover}
          src={songView.cover}
          alt=""
          className="absolute inset-0 h-full w-full scale-125 object-cover opacity-35 blur-[2.4cqw]"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(6,4,26,0.6),rgba(6,4,26,0.45)_45%,rgba(6,4,26,0.88)_60%)]" />

      <div className="absolute inset-x-0 top-0 z-10 flex h-[5.4cqw] items-center justify-between border-b border-white/10 bg-black/35 px-[2.4cqw]">
        <div className="flex min-w-0 items-baseline gap-[1.2cqw]">
          <span className={`${DISP} shrink-0 text-[2.2cqw] tracking-[0.06em] text-white`}>
            ONLINE
          </span>
          <span className={`${KR} truncate text-[1.3cqw] font-bold text-white/80`}>
            {room.meta.name}
          </span>
          <span className="shrink-0 font-mono text-[1.05cqw] text-white/40">
            {players.length}/{room.meta.max}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-[0.6cqw]">
          <TopButtons fs={fs} onToggleFs={onToggleFs} onSettings={onSettings} />
          <button
            type="button"
            onClick={() => {
              sfx("ui-back", 0.7);
              onLeave();
            }}
            className={`${KR} cursor-pointer rounded-[0.6cqw] border border-white/15 bg-white/5 px-[1.2cqw] py-[0.4cqw] text-[1.05cqw] text-white/75 hover:border-[#F43F5E]/70 hover:text-white`}
          >
            방 나가기
          </button>
        </div>
      </div>

      {/* 왼쪽: 곡 · 내 난이도 */}
      <div className="absolute top-[7cqw] bottom-[2.4cqw] left-[2.6cqw] flex w-[42cqw] flex-col gap-[1.2cqw]">
        <div className="flex gap-[1.6cqw]">
          <div
            className="h-[14cqw] w-[14cqw] shrink-0 overflow-hidden rounded-[1cqw] border-[0.2cqw] bg-[linear-gradient(135deg,#1e1b4b,#0e3a4a)]"
            style={{ borderColor: color, boxShadow: `0 0 2.4cqw ${color}77` }}
          >
            {songView ? (
              <img src={songView.cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[5cqw]">🎵</div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="font-mono text-[1cqw] tracking-[0.25em]" style={{ color }}>
              {song ? (song.kind === "custom" ? "MY MUSIC · 방장" : "SONG") : "NO SONG"}
            </div>
            <div
              className={`${KR} mt-[0.3cqw] line-clamp-2 text-[2.3cqw] leading-tight font-extrabold break-keep text-white`}
            >
              {song?.title ?? (host ? "곡을 골라 주세요" : "방장이 곡을 고르는 중")}
            </div>
            {songView?.artist && (
              <div className="mt-[0.2cqw] font-mono text-[1.15cqw] font-bold text-white/80">
                {songView.artist}
              </div>
            )}
            {song && songView && (
              <div className="mt-[0.6cqw] flex gap-[1.2cqw] font-mono text-[1.1cqw] text-white/70">
                <span>
                  <span className="text-white/40">BPM </span>
                  {Math.round(songView.bpm)}
                </span>
                <span>
                  <span className="text-white/40">TIME </span>
                  {fmtTime(song.duration)}
                </span>
              </div>
            )}
            {song?.kind === "custom" && !song.ready && (
              <div className={`${KR} mt-[0.6cqw] text-[1.05cqw] text-[#FDE68A]`}>
                {host && upload
                  ? upload.error
                    ? `올리지 못했어요: ${upload.error}`
                    : `곡 파일 올리는 중… ${Math.round(upload.ratio * 100)}%`
                  : "방장이 곡 파일을 올리는 중…"}
              </div>
            )}
            {host && idle && (
              <button
                type="button"
                onClick={() => {
                  sfx("ui-select", 0.7);
                  onPick();
                }}
                className={`${KR} mt-[0.9cqw] w-fit cursor-pointer rounded-[0.6cqw] border px-[1.2cqw] py-[0.45cqw] text-[1.15cqw] font-bold text-white transition-colors hover:brightness-125`}
                style={{ borderColor: `${color}aa`, background: `${color}22` }}
              >
                ♪ 곡 고르기 {song ? "(바꾸기)" : ""}
              </button>
            )}
          </div>
        </div>

        {song && me && (
          <div className="rounded-[1cqw] border border-white/10 bg-black/35 p-[1.2cqw]">
            <div className={`${KR} mb-[0.7cqw] text-[1.05cqw] font-bold text-white/60`}>
              난이도 {host ? "(방장 — 모두 같은 난이도)" : "(방장이 골라요)"}
            </div>
            <div className="grid grid-cols-6 gap-[0.6cqw]">
              {DIFFICULTIES.filter((d) => !song.diffs.length || song.diffs.includes(d.key)).map(
                (d) => {
                  const on = me.diff === d.key;
                  const lv = songView?.levels[d.key];
                  return (
                    <button
                      key={d.key}
                      type="button"
                      disabled={!idle || !host}
                      onClick={() => {
                        if (on) return;
                        sfx("ui-move", 0.6);
                        onDiff(d.key);
                      }}
                      className="flex cursor-pointer flex-col items-center rounded-[0.7cqw] border-[0.15cqw] py-[0.5cqw] transition-colors disabled:cursor-default"
                      style={{
                        borderColor: on ? d.color : "rgba(255,255,255,0.12)",
                        background: on ? `${d.color}26` : "rgba(0,0,0,0.3)",
                      }}
                    >
                      <span
                        className="font-['Arial_Black',sans-serif] text-[0.85cqw] font-black"
                        style={{ color: d.color }}
                      >
                        {d.label}
                      </span>
                      <span className={`${DISP} text-[1.6cqw] text-white`}>{lv ?? "·"}</span>
                    </button>
                  );
                }
              )}
            </div>
          </div>
        )}

        {(err || load?.error) && (
          <p className={`${KR} text-[1.1cqw] text-[#FB7185]`}>{load?.error || err}</p>
        )}

        <div className="mt-auto flex items-center gap-[1.2cqw]">
          {idle &&
            me &&
            (host ? (
              <button
                type="button"
                disabled={!canStart}
                onClick={onStart}
                className={btnMain}
                style={{ background: `linear-gradient(90deg,#DB2777,#7C3AED)` }}
              >
                START
              </button>
            ) : (
              <button
                type="button"
                disabled={!song}
                onClick={() => {
                  sfx(me.ready ? "ui-back" : "ui-select", 0.7);
                  onReady(!me.ready);
                }}
                className={btnMain}
                style={{
                  background: me.ready
                    ? "rgba(74,222,128,0.35)"
                    : "linear-gradient(90deg,#DB2777,#7C3AED)",
                }}
              >
                {me.ready ? "READY ✓" : "READY"}
              </button>
            ))}
          <span className={`${KR} text-[1.05cqw] text-white/50`}>
            {room.phase === "loading"
              ? load
                ? `${load.label} ${Math.round(load.ratio * 100)}%`
                : "곡 받는 중…"
              : room.phase === "playing"
                ? round?.roster.includes(uid)
                  ? "다른 사람이 끝나길 기다리는 중…"
                  : "게임 중 — 이번 판이 끝나면 같이 칠 수 있어요"
                : host
                  ? !song
                    ? "곡을 골라 주세요"
                    : !song.ready
                      ? "곡 파일을 올리는 중이에요"
                      : allReady
                        ? "Enter — 시작"
                        : "모두 준비하면 시작할 수 있어요"
                  : me?.ready
                    ? "방장이 시작하길 기다리는 중"
                    : "Enter — 준비"}
          </span>
        </div>
      </div>

      {/* 오른쪽: 사람들 / 점수판 / 결과 */}
      <div className="absolute top-[7cqw] right-[2.4cqw] bottom-[2.4cqw] flex w-[48cqw] flex-col rounded-[1.2cqw] border border-white/12 bg-[#0b0820]/80 p-[1.4cqw]">
        {room.phase === "result" && results.length > 0 ? (
          <>
            <div className="mb-[0.9cqw] flex items-baseline justify-between">
              <span className={`${DISP} text-[1.6cqw] text-white`}>RESULT</span>
              {host && (
                <button
                  type="button"
                  onClick={onBack}
                  className={`${KR} cursor-pointer rounded-[0.5cqw] border border-white/20 px-[0.9cqw] py-[0.25cqw] text-[1cqw] text-white/70 hover:border-white/50 hover:text-white`}
                >
                  대기실로
                </button>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-[0.5cqw] overflow-y-auto">
              {results.map(([u, r], i) => {
                const d = diffOf(r.diff);
                return (
                  <div
                    key={u}
                    className="flex items-center gap-[1cqw] rounded-[0.8cqw] border px-[1cqw] py-[0.55cqw]"
                    style={{
                      borderColor: u === uid ? `${color}aa` : "rgba(255,255,255,0.08)",
                      background: i === 0 ? "rgba(250,204,21,0.1)" : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <span
                      className={`${DISP} w-[2cqw] text-center text-[1.6cqw] ${i === 0 ? "text-[#FDE68A]" : "text-white/60"}`}
                    >
                      {i + 1}
                    </span>
                    <RankEmblem rank={r.rank} className="h-[3.2cqw] w-[3.2cqw] shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`${KR} block truncate text-[1.25cqw] font-extrabold text-white`}
                      >
                        {r.nick}
                      </span>
                      <span className="font-mono text-[0.9cqw]" style={{ color: d.color }}>
                        {d.label}
                        <span className="text-white/45">
                          {" "}
                          · {r.acc.toFixed(2)}% · {r.maxCombo} combo
                          {r.failed
                            ? " · FAILED"
                            : r.ap
                              ? " · ALL PERFECT"
                              : r.fc
                                ? " · FULL COMBO"
                                : ""}
                        </span>
                      </span>
                    </span>
                    <span className={`${DISP} text-[1.6cqw] text-white tabular-nums`}>
                      {r.score.toLocaleString("en-US")}
                    </span>
                  </div>
                );
              })}
              {players.some(([u]) => !round?.results[u]) && (
                <p className={`${KR} mt-[0.4cqw] text-[1cqw] text-white/40`}>
                  이번 판에 안 친 사람:{" "}
                  {players
                    .filter(([u]) => !round?.results[u])
                    .map(([, p]) => p.nick)
                    .join(", ")}
                </p>
              )}
            </div>
          </>
        ) : room.phase === "playing" && liveRows.length > 0 ? (
          <>
            <div className={`${DISP} mb-[0.9cqw] text-[1.6cqw] text-white`}>LIVE</div>
            <div className="flex min-h-0 flex-1 flex-col gap-[0.5cqw] overflow-y-auto">
              {liveRows.map(([u, v], i) => (
                <div
                  key={u}
                  className="flex items-center gap-[1cqw] rounded-[0.8cqw] border border-white/8 bg-white/[0.03] px-[1cqw] py-[0.6cqw]"
                  style={{ opacity: v[4] ? 0.5 : 1 }}
                >
                  <span className={`${DISP} w-[2cqw] text-center text-[1.5cqw] text-white/70`}>
                    {i + 1}
                  </span>
                  <span
                    className={`${KR} min-w-0 flex-1 truncate text-[1.2cqw] font-bold text-white`}
                  >
                    {room.players[u]?.nick ?? "?"}
                    {v[4] ? " ✕" : v[5] ? " ✓" : ""}
                  </span>
                  <span className="font-mono text-[1cqw] text-white/50">{v[2].toFixed(2)}%</span>
                  <span className={`${DISP} text-[1.5cqw] text-white tabular-nums`}>
                    {v[0].toLocaleString("en-US")}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className={`${DISP} mb-[0.9cqw] text-[1.6cqw] text-white`}>PLAYERS</div>
            <div className="flex min-h-0 flex-1 flex-col gap-[0.5cqw] overflow-y-auto">
              {players.map(([u, p]) => {
                const d = diffOf(p.diff);
                const isHost = u === room.meta.hostUid;
                const loaded = round?.loaded.includes(u);
                return (
                  <div
                    key={u}
                    className="flex items-center gap-[1cqw] rounded-[0.8cqw] border px-[1.1cqw] py-[0.65cqw]"
                    style={{
                      borderColor: u === uid ? `${color}aa` : "rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <span className="w-[1.8cqw] text-center text-[1.3cqw]">
                      {isHost ? "👑" : ""}
                    </span>
                    <span
                      className={`${KR} min-w-0 flex-1 truncate text-[1.3cqw] font-extrabold text-white`}
                    >
                      {p.nick}
                      {u === uid && (
                        <span className="ml-[0.5cqw] text-[0.95cqw] text-white/40">(나)</span>
                      )}
                    </span>
                    {song && (
                      <span
                        className="font-['Arial_Black',sans-serif] text-[0.95cqw] font-black"
                        style={{ color: d.color }}
                      >
                        {d.label}
                        {songView?.levels[p.diff] !== undefined && (
                          <span className="ml-[0.3cqw] text-white/70">
                            {songView.levels[p.diff]}
                          </span>
                        )}
                      </span>
                    )}
                    <span
                      className={`${KR} w-[6cqw] text-right text-[1.05cqw] font-bold`}
                      style={{
                        color:
                          room.phase === "loading"
                            ? loaded
                              ? "#4ADE80"
                              : "#FBBF24"
                            : isHost || p.ready
                              ? "#4ADE80"
                              : "rgba(255,255,255,0.35)",
                      }}
                    >
                      {room.phase === "loading"
                        ? round?.roster.includes(u)
                          ? loaded
                            ? "받음 ✓"
                            : "받는 중…"
                          : "관전"
                        : isHost
                          ? "방장"
                          : p.ready
                            ? "준비 ✓"
                            : "대기"}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
