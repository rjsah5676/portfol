"use client";

import { useEffect, useState } from "react";
import { getPatrolStats, resetPatrol } from "@/firestore/adminData";

/** 픽셀 순찰대 데이터 초기화 (재화 설계 바꿀 때 등). 확인 문구를 그대로 쳐야 버튼이 켜짐 */
export default function PatrolReset() {
  const [stats, setStats] = useState<{ profiles: number; runs: number; ranks: number; players: number } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => getPatrolStats().then(setStats, (e: Error) => setMsg(e.message));
  useEffect(() => {
    void load();
  }, []);
  const go = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await resetPatrol();
      setMsg(`지움: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
      setText("");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-red-400/30 bg-red-500/5 p-4 font-['Nanum_Gothic',sans-serif] text-sm text-white/80">
      <p className="font-bold text-red-300">픽셀 순찰대 데이터 초기화</p>
      <p className="mt-1 text-xs text-white/60">
        순찰대 프로필(장비 · 무기 · 코인 · 보석 · 설계도 · 별 · 상점 구매 기록) · 판 기록 · 랭킹 · 회원 순찰대 통계를 모두 지워요. GP 잔액 · 원장 · 이미 받은 업적은 그대로. 다음 접속 때 시작 선물부터 다시.
      </p>
      {stats && (
        <p className="mt-2 text-xs text-white/60">
          지금: 프로필 {stats.profiles} · 판 기록 {stats.runs} · 랭킹 {stats.ranks} · 통계 있는 회원 {stats.players}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="순찰대 초기화"
          className="rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-red-400/60"
        />
        <button
          type="button"
          disabled={busy || text !== "순찰대 초기화"}
          onClick={() => void go()}
          className="rounded-full bg-red-500/80 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-30"
        >
          모두 지우기
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-white/70">{msg}</p>}
    </div>
  );
}
