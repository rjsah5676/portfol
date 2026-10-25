"use client";

import { useEffect, useState } from "react";
import { getLoveReset, resetLove } from "@/firestore/adminData";

const CONFIRM = "미연시 초기화";
const fmt = (t: number) => (t ? new Date(t).toLocaleString("ko-KR") : "한 번도 안 함");

/** 올인 러브 데이터 초기화: 진행은 각 브라우저에만 있어서, 초기화 시각을 올리면 다음 접속 때 각자 지워짐 */
export default function LoveReset() {
  const [at, setAt] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    getLoveReset().then((r) => setAt(r.at), (e: Error) => setMsg(e.message));
  }, []);
  const go = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await resetLove();
      setAt(r.at);
      setText("");
      setMsg("초기화했어요. 플레이어가 다음에 게임을 열 때 기록이 지워져요.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-red-400/30 bg-red-500/5 p-4 font-['Nanum_Gothic',sans-serif] text-sm text-white/80">
      <p className="font-bold text-red-300">올인 러브 데이터 초기화</p>
      <p className="mt-1 text-xs text-white/60">
        모든 플레이어의 세이브 · 본 엔딩 · 회상 CG · 읽은 대사 · 회차 기록 · 이름을 지워요. 설정(볼륨 · 글자 속도)은 그대로. 진행 기록은 각
        브라우저에 있어서, 플레이어가 다음에 게임을 열 때 지워져요.
      </p>
      <p className="mt-2 text-xs text-white/60">마지막 초기화: {at === null ? "불러오는 중…" : fmt(at)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={CONFIRM}
          className="rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-red-400/60"
        />
        <button
          type="button"
          disabled={busy || text !== CONFIRM}
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
