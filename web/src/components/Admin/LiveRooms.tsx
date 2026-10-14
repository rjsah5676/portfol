"use client";

import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/components/Modal/ModalProvider";
import { plainName } from "@/components/Nick";
import {
  closeLiveRoom,
  getLiveRooms,
  getPokerSettings,
  setPokerSettings,
  type LiveGame,
  type LiveRoom,
} from "@/firestore/adminData";
import { ago } from "./Overview";

/*
 * 지금 열려 있는 방 (스케치 퀴즈 · 픽셀 격투 · 포커 테이블 · BEAT DASH · 디펜스 멀티). 서버 메모리에만 있는 방이라 여기서만 보임.
 * 방을 닫으면 안에 있던 사람들은 로비로 나가짐. 10초마다 다시 읽음.
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const GAMES: { key: LiveGame; label: string }[] = [
  { key: "sketch", label: "스케치 퀴즈" },
  { key: "fight", label: "픽셀 격투" },
  { key: "poker", label: "포커" },
  { key: "rhythm", label: "BEAT DASH" },
  { key: "defense", label: "디펜스 멀티" },
];
const STATUS: Record<string, { label: string; on: boolean }> = {
  waiting: { label: "대기", on: false },
  wait: { label: "대기", on: false },
  ended: { label: "끝남", on: false },
  choosing: { label: "진행 중", on: true },
  drawing: { label: "진행 중", on: true },
  reveal: { label: "진행 중", on: true },
  play: { label: "대전 중", on: true },
  playing: { label: "진행 중", on: true },
  hand: { label: "진행 중", on: true },
};

export default function LiveRooms() {
  const modal = useModal();
  const [rooms, setRooms] = useState<Record<LiveGame, LiveRoom[]> | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setRooms(await getLiveRooms());
      setFailed(false);
    } catch (e) {
      console.error(e);
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음 한 번 + 10초마다 조회
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const close = async (game: LiveGame, room: LiveRoom) => {
    const ok = await modal.confirm({
      title: "방 닫기",
      message: `"${room.name}" 방을 닫을까요? 안에 있는 ${room.players.length}명은 로비로 나가요.`,
      confirmText: "닫기",
    });
    if (!ok) return;
    setBusy(room.id);
    try {
      await closeLiveRoom(game, room.id);
      await load();
    } catch (e) {
      console.error(e);
      await modal.alert({ title: "닫지 못했어요", message: "잠시 후 다시 시도해주세요." });
    } finally {
      setBusy("");
    }
  };

  const all = rooms ? GAMES.flatMap((g) => (rooms[g.key] ?? []).map((r) => ({ g, r }))) : [];

  return (
    <div className="grid gap-3">
      <PokerBots />
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#1C1E24]">
        {!rooms ? (
          <p className={`py-10 text-center text-sm text-white/30 ${KR}`}>
            {failed ? "불러오지 못했어요." : "불러오는 중…"}
          </p>
        ) : all.length === 0 ? (
          <p className={`py-10 text-center text-sm text-white/30 ${KR}`}>
            지금 열려 있는 방이 없어요.
          </p>
        ) : (
          <ul>
            {all.map(({ g, r }) => {
              const st = STATUS[r.status] ?? { label: r.status, on: false };
              return (
                <li
                  key={`${g.key}-${r.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.06] px-4 py-3 last:border-0 md:px-5"
                >
                  <span className={`w-20 shrink-0 text-xs text-white/45 ${KR}`}>{g.label}</span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className={`block truncate text-sm text-white/90 ${KR}`}>{r.name}</span>
                    <span className={`block truncate text-xs text-white/40 ${KR}`}>
                      {r.players.length ? r.players.map(plainName).join(", ") : "아무도 없음"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono text-xs ${st.on ? "text-[#2DD4BF]" : "text-white/40"}`}
                  >
                    {st.label} · {r.players.length}명
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-white/30">
                    {ago(r.createdAt)}
                  </span>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => close(g.key, r)}
                    className="shrink-0 cursor-pointer rounded-full border border-red-400/30 px-3 py-1 font-mono text-xs text-red-300/90 transition-colors hover:border-red-400/70 hover:text-red-200 disabled:opacity-35"
                  >
                    닫기
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 포커 봇 늘리기 켜기 / 끄기 (바로 반영, 서버에 저장) */
function PokerBots() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getPokerSettings()
      .then((s) => setOn(s.botBoost))
      .catch(() => setOn(null));
  }, []);
  const toggle = async () => {
    if (on === null || busy) return;
    setBusy(true);
    try {
      setOn((await setPokerSettings(!on)).botBoost);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[#1C1E24] px-4 py-3 md:px-5">
      <div className={`min-w-0 flex-1 basis-60 ${KR}`}>
        <div className="text-sm text-white/90">포커 봇 늘리기</div>
        <div className="text-xs leading-relaxed text-white/40">
          켜면: 테이블마다 봇 3명 이상 · 빨리 들어옴 · 사람이 2분 넘게 치고 있으면 빈자리(한 자리
          빼고)까지 채움 · 로비 봇 방 6개. 끄면 예전처럼(봇 2명~ · 천천히 · 정한 수까지만 · 로비 봇
          방 3개)
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!on}
        disabled={on === null || busy}
        onClick={toggle}
        className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-40 ${on ? "bg-[#2DD4BF]" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`}
        />
      </button>
      <span
        className={`w-10 shrink-0 font-mono text-xs ${on ? "text-[#2DD4BF]" : "text-white/40"}`}
      >
        {on === null ? "…" : on ? "켜짐" : "꺼짐"}
      </span>
    </div>
  );
}
