"use client";

import { useEffect, useState } from "react";
import {
  getSuspectReset,
  getSuspectStats,
  resetSuspect,
  resetSuspectRankings,
} from "@/firestore/adminData";
import { kstDay } from "@/lib/suspect/engine";

const CONFIRM = "데일리 초기화";
const RANK_CONFIRM = "데일리 랭킹 초기화";
const fmt = (t: number) => (t ? new Date(t).toLocaleString("ko-KR") : "한 번도 안 함");
const box =
  "rounded-xl border border-red-400/30 bg-red-500/5 p-4 font-['Nanum_Gothic',sans-serif] text-sm text-white/80";
const input =
  "rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-red-400/60";
const btn = "rounded-full bg-red-500/80 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-30";

/**
 * 오늘의 용의자 초기화 (server/src/http/suspect.ts)
 *  - 데일리 초기화: 판 진행 · 해결 수 · 연속 해결 · 최고 기록은 각 브라우저에 있어서, 초기화 시각을 올리면 다음 접속 때 각자 지워짐
 *  - 데일리 랭킹 초기화: 오늘(또는 전체) 랭킹 기록을 서버에서 지움
 */
export default function SuspectReset() {
  const [at, setAt] = useState<number | null>(null);
  const [stats, setStats] = useState<{ today: number; total: number } | null>(null);
  const [text, setText] = useState("");
  const [rankText, setRankText] = useState("");
  const [scope, setScope] = useState<"today" | "all">("today");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [rankMsg, setRankMsg] = useState("");
  const loadStats = () => getSuspectStats().then(setStats, (e: Error) => setRankMsg(e.message));
  useEffect(() => {
    getSuspectReset().then((r) => setAt(r.at), (e: Error) => setMsg(e.message));
    void loadStats();
  }, []);

  const goReset = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await resetSuspect();
      setAt(r.at);
      setText("");
      setMsg("초기화했어요. 플레이어가 다음에 게임을 열 때 진행 기록이 지워져요.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const goRanks = async () => {
    setBusy(true);
    setRankMsg("");
    try {
      const r = await resetSuspectRankings(scope === "all" ? "all" : kstDay());
      setRankText("");
      setRankMsg(`랭킹 기록 ${r.deleted}개를 지웠어요.`);
      await loadStats();
    } catch (e) {
      setRankMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <div className={box}>
        <p className="font-bold text-red-300">데일리 초기화 (진행 기록)</p>
        <p className="mt-1 text-xs text-white/60">
          모든 플레이어의 오늘의 사건 판 진행 · 푼 기록 · 해결 수 · 연속 해결 · 난이도별 최고 기록을 지워요. 입문
          튜토리얼을 끝낸 것과 랭킹 이름은 그대로. 진행은 각 브라우저에 있어서, 플레이어가 다음에 게임을 열 때
          지워져요. 랭킹 기록은 안 지워요 (아래).
        </p>
        <p className="mt-2 text-xs text-white/60">마지막 초기화: {at === null ? "불러오는 중…" : fmt(at)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={CONFIRM} className={input} />
          <button type="button" disabled={busy || text !== CONFIRM} onClick={() => void goReset()} className={btn}>
            모두 지우기
          </button>
        </div>
        {msg && <p className="mt-2 text-xs text-white/70">{msg}</p>}
      </div>

      <div className={box}>
        <p className="font-bold text-red-300">데일리 랭킹 초기화</p>
        <p className="mt-1 text-xs text-white/60">
          오늘의 사건 랭킹 기록을 서버에서 지워요. 오늘(한국 시간 {kstDay().slice(4, 6)}/{kstDay().slice(6, 8)}) 네
          난이도만, 또는 지난 날짜까지 전부. 지운 뒤엔 같은 사람이 다시 풀어 올릴 수 있어요.
        </p>
        {stats && (
          <p className="mt-2 text-xs text-white/60">
            지금: 오늘 {stats.today}개 · 전체 {stats.total}개
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "today" | "all")}
            className={input}
          >
            <option value="today">오늘만</option>
            <option value="all">전체</option>
          </select>
          <input
            value={rankText}
            onChange={(e) => setRankText(e.target.value)}
            placeholder={RANK_CONFIRM}
            className={input}
          />
          <button
            type="button"
            disabled={busy || rankText !== RANK_CONFIRM}
            onClick={() => void goRanks()}
            className={btn}
          >
            지우기
          </button>
        </div>
        {rankMsg && <p className="mt-2 text-xs text-white/70">{rankMsg}</p>}
      </div>
    </div>
  );
}
