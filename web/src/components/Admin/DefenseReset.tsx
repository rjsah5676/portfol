"use client";

import { useEffect, useState } from "react";
import { getDefenseStats, resetDefense } from "@/firestore/adminData";

/** 픽셀 운빨 디펜스 데이터 초기화 (베타 승급 등). 확인 문구를 그대로 쳐야 버튼이 켜짐 */
export default function DefenseReset() {
  const [stats, setStats] = useState<{ profiles: number; ranks: number; runs: number } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => getDefenseStats().then(setStats, (e: Error) => setMsg(e.message));
  useEffect(() => {
    void load();
  }, []);
  const go = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await resetDefense();
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
      <p className="font-bold text-red-300">픽셀 운빨 디펜스 데이터 초기화</p>
      <p className="mt-1 text-xs text-white/60">
        정비소 프로필(재화 · 유닛 레벨 · 연구 · 유물) · 시즌/주간 랭킹 · 판 기록 · 회원 디펜스 통계를 모두 지워요. GP 잔액 · 원장 · GP 로 산 블록 테마는 그대로.
      </p>
      {stats && (
        <p className="mt-2 text-xs text-white/60">
          지금: 프로필 {stats.profiles} · 랭킹 {stats.ranks} · 판 기록 {stats.runs}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="디펜스 초기화"
          className="rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-red-400/60"
        />
        <button
          type="button"
          disabled={busy || text !== "디펜스 초기화"}
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
