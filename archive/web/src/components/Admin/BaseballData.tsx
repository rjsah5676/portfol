"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/http";
import { API_URL } from "@/lib/api/config";

/*
 * 픽셀 프로야구 플레이 데이터 (밸런스 분석용). 브라우저가 보낸 기록을 종류별로 보고 NDJSON 으로 내려받음.
 *   종류: career_start(새 선수) · game(육성 경기) · season(시즌 결산) · retire(은퇴) · pick(특수능력 · 축복 고르기)
 *         · match(연습 경기) · derby(홈런 더비) · bond_battle(인연 대결)
 *   서버: GET /api/admin/baseball/summary · /logs · /export
 */

interface Summary {
  total: number;
  players: number;
  kinds: Record<string, number>;
  first: number | null;
  last: number | null;
}
interface Row {
  id: string;
  at: number;
  pid: string;
  uid: string | null;
  kind: string;
  v: number;
  data: Record<string, unknown>;
}
const KIND_NAME: Record<string, string> = {
  career_start: "새 선수",
  game: "육성 경기",
  season: "시즌 결산",
  retire: "은퇴",
  pick: "고르기 (특수능력 · 축복)",
  match: "연습 경기",
  derby: "홈런 더비",
  bond_battle: "인연 대결",
};
const fmt = (t: number | null) => (t ? new Date(t).toLocaleString("ko-KR") : "-");

/** 한 줄 요약 (표에 보여 줄 것만) */
function brief(r: Row) {
  const d = r.data as Record<string, any>;
  const l = d.line as { ab?: number; h?: number; hr?: number; rbi?: number } | undefined;
  const ln = l ? `${l.ab ?? 0}타수 ${l.h ?? 0}안타 ${l.hr ?? 0}홈런 ${l.rbi ?? 0}타점` : "";
  switch (r.kind) {
    case "game":
      return `${d.season}년차 ${d.week}주 · ${d.mode} · ${ln} · 평가 ${["S", "A", "B", "C", "D"][d.grade] ?? "-"} · 종합 ${d.ovr}`;
    case "season":
      return `${d.season}년차 결산 · ${ln} · 종합 ${d.ovr}${d.talentReveal ? ` · 재능 ${d.talentReveal}` : ""}`;
    case "retire":
      return `은퇴 · 종합 ${d.ovr} · ${d.type} · 타격 ${d.stats?.hit} 파워 ${d.stats?.power} 주루 ${d.stats?.run}`;
    case "pick":
      return `${d.from} · ${(d.options ?? []).join(", ")} → ${d.chosen ?? "넘김"}`;
    case "match":
      return `${d.mode} 난이도 ${d.diff} · ${d.score?.[0]}:${d.score?.[1]} · 타율 ${d.bat?.ab ? (d.bat.h / d.bat.ab).toFixed(3) : "-"}`;
    case "derby":
      return `${d.dist}m · 홈런 ${d.hr}`;
    case "bond_battle":
      return `${d.char} ${d.pts}/${d.need}점`;
    case "career_start":
      return `${d.type} · 덱 ${(d.deck ?? []).join(", ")}`;
    default:
      return JSON.stringify(d).slice(0, 120);
  }
}

export default function BaseballData() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [kind, setKind] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setMsg("");
    try {
      const [s, r] = await Promise.all([
        api<Summary>("/api/admin/baseball/summary", { auth: true }),
        api<Row[]>(`/api/admin/baseball/logs?limit=200${kind ? `&kind=${kind}` : ""}`, { auth: true }),
      ]);
      setSum(s);
      setRows(r);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }, [kind]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음 · 종류 바꿀 때 불러오기
    void load();
  }, [load]);
  const download = async () => {
    setBusy(true);
    setMsg("");
    try {
      const { auth } = await import("@/firebase");
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_URL}/api/admin/baseball/export${kind ? `?kind=${kind}` : ""}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`내려받기 실패 (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `baseball-${kind || "all"}-${new Date().toISOString().slice(0, 10)}.ndjson`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="font-['Nanum_Gothic',sans-serif] text-sm text-white/80">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div>
          <div className="text-xs text-white/50">기록 · 플레이어(브라우저)</div>
          <div className="font-mono text-lg text-white">
            {sum ? `${sum.total.toLocaleString()}줄 · ${sum.players.toLocaleString()}명` : "…"}
          </div>
          <div className="text-[11px] text-white/45">
            {fmt(sum?.first ?? null)} ~ {fmt(sum?.last ?? null)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["", ...Object.keys(KIND_NAME)].map((k) => (
            <button
              key={k || "all"}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full border px-3 py-1 text-xs ${kind === k ? "border-[#FF8A3D] text-[#FF8A3D]" : "border-white/15 text-white/65"}`}
            >
              {k ? KIND_NAME[k] : "전체"} {k && sum?.kinds[k] ? `(${sum.kinds[k]})` : !k && sum ? `(${sum.total})` : ""}
            </button>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={() => void download()} className="ml-auto rounded-full bg-[#FF8A3D] px-4 py-1.5 text-xs font-bold text-black disabled:opacity-40">
          {busy ? "받는 중…" : `${kind ? KIND_NAME[kind] : "전체"} 내려받기 (NDJSON)`}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-white/45">
        한 줄 = 기록 하나 (JSON). 육성 기록엔 그때 선수 상태(종합 · 능력치 · 특수능력 · 축복 레벨 · 덱 · 호감)가 같이 들어 있어요. 관리자 본인 플레이는 안 남아요.
      </p>
      {msg && <p className="mt-2 text-xs text-red-300">{msg}</p>}
      <table className="mt-3 w-full text-left text-xs">
        <thead className="text-white/45">
          <tr>
            <th className="py-1 pr-2 font-normal">시각</th>
            <th className="py-1 pr-2 font-normal">플레이어</th>
            <th className="py-1 pr-2 font-normal">종류</th>
            <th className="py-1 font-normal">내용</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-white/5 align-top">
              <td className="py-1 pr-2 font-mono whitespace-nowrap text-white/55">{fmt(r.at)}</td>
              <td className="py-1 pr-2 font-mono text-white/55">
                {r.pid.slice(0, 6)}
                {r.uid ? " · 회원" : ""}
              </td>
              <td className="py-1 pr-2 whitespace-nowrap">{KIND_NAME[r.kind] ?? r.kind}</td>
              <td className="py-1 text-white/75">{brief(r)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-white/40">
                아직 기록이 없어요
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
