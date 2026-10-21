"use client";

import { useEffect, useState } from "react";
import { getMarbleStats, resetMarble } from "@/firestore/adminData";

/** 다이스 타운 데이터 초기화 (베타 승급 등). 확인 문구를 그대로 쳐야 버튼이 켜짐 */
export default function MarbleReset() {
  const [stats, setStats] = useState<{ profiles: number; players: number } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => getMarbleStats().then(setStats, (e: Error) => setMsg(e.message));
  useEffect(() => {
    void load();
  }, []);
  const go = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await resetMarble();
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
      <p className="font-bold text-red-300">다이스 타운 데이터 초기화</p>
      <p className="mt-1 text-xs text-white/60">
        마블 프로필(별사탕 · 부품 · 캐릭터 · 아이템 · 일일 패스 · 상점 구매 기록) · 회원 마블 통계(승수 · 업적 지표)를 모두 지워요. GP 잔액 · 원장은 그대로. 진행 중인 방은 서버 메모리라 그대로예요.
      </p>
      {stats && (
        <p className="mt-2 text-xs text-white/60">
          지금: 프로필 {stats.profiles} · 통계 있는 회원 {stats.players}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="마블 초기화"
          className="rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-red-400/60"
        />
        <button
          type="button"
          disabled={busy || text !== "마블 초기화"}
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
