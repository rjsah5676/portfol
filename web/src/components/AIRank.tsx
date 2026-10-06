"use client";

import { useEffect, useState, type ReactNode } from "react";
import RankList from "./RankList";
import { addAIRank, getAIRanks, type AIRankColl, type AIRankRow } from "@/firestore/aiRankings";
import { clockLabel, pointsOf, type ScoreResult } from "@/lib/aiScore";

/*
 * 체스·장기·오목 AI 랭킹 모드 공통 UI: 내 차례 시간 재기, 랭킹 모드 스위치, 기록 등록, 순위표.
 */

export interface TurnClock {
  /** 지금까지 쓴 시간(ms) */
  used: number;
  /** 지금 내 차례가 시작된 시각 (내 차례가 아니면 null) */
  since: number | null;
}
export const NEW_CLOCK: TurnClock = { used: 0, since: null };

/** 내 차례(active)인 동안만 시간이 흐르는 시계. 저장·복원은 clock/setClock으로 */
export function useTurnClock(active: boolean) {
  const [clock, setClock] = useState<TurnClock>(NEW_CLOCK);
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 차례가 바뀔 때 시계 켜고 끄기
    setClock((c) => {
      if (active && c.since === null) return { ...c, since: Date.now() };
      if (!active && c.since !== null) return { used: c.used + Date.now() - c.since, since: null };
      return c;
    });
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  const live = clock.since !== null ? Math.max(0, (now || clock.since) - clock.since) : 0;
  return { clock, setClock, seconds: Math.floor((clock.used + live) / 1000) };
}

/** 대국 시작 화면의 랭킹 모드 스위치 */
export function RankedToggle({
  on,
  onChange,
  desc = "무르기 불가 · 이기면 상대 실력, 기물 차이, 적은 수, 짧은 시간으로 점수를 매겨요",
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  desc?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        on
          ? "border-[#FDE047]/50 bg-[#FDE047]/10"
          : "border-white/10 bg-white/[0.03] hover:border-white/25"
      }`}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-['Nanum_Gothic',sans-serif] text-sm text-white">🏆 랭킹 모드</span>
        <span className="font-['Nanum_Gothic',sans-serif] text-[11px] text-white/45">{desc}</span>
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-[#FDE047]/80" : "bg-white/15"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

const NAME_KEY = "ai-rank:name";

/** 이긴 뒤 점수 내역 + 이름 입력해서 등록 */
export function RankSubmit({
  coll,
  result,
  entry,
  done = false,
  onSaved,
}: {
  coll: AIRankColl;
  result: ScoreResult;
  entry: { opp: string; moves: number; seconds: number; lead: number };
  /** 이미 등록한 판 (새로고침해도 두 번 못 올리게) */
  done?: boolean;
  onSaved?: () => void;
}) {
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(done ? "done" : "idle");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 지난번 이름 채우기 (마운트 1회)
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
  }, []);
  const submit = async () => {
    const n = name.trim().slice(0, 12);
    if (!n || state === "sending" || state === "done") return;
    setState("sending");
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {}
    try {
      await addAIRank(coll, { name: n, score: result.score, ...entry });
      setState("done");
      onSaved?.();
    } catch {
      setState("error");
    }
  };
  return (
    <div className="rounded-xl border border-[#FDE047]/30 bg-[#FDE047]/[0.06] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-['Nanum_Gothic',sans-serif] text-xs text-white/60">랭킹 점수</span>
        <span className="font-mono text-xl font-bold text-[#FDE047] tabular-nums">
          {result.points.toLocaleString()}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px] text-white/45">
        <div className="flex justify-between">
          <span>기본 (순위는 센 상대를 이긴 기록이 항상 위)</span>
          <span className="tabular-nums">{result.base.toLocaleString()}</span>
        </div>
        {result.parts.map((p) => (
          <div key={p.label} className="flex justify-between">
            <span>
              {p.label} <span className="text-white/30">{p.detail}</span>
            </span>
            <span className="tabular-nums">×{p.factor.toFixed(2)}</span>
          </div>
        ))}
      </div>
      {state === "done" ? (
        <p className="mt-2.5 font-['Nanum_Gothic',sans-serif] text-xs text-[#FDE047]/90">
          등록했어요!
        </p>
      ) : (
        <div className="mt-2.5 flex gap-1.5">
          <input
            value={name}
            maxLength={12}
            placeholder="이름"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#1C1E24] px-3 py-1.5 font-['Nanum_Gothic',sans-serif] text-sm text-white focus:border-[#FDE047]/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || state === "sending"}
            className="cursor-pointer rounded-full bg-[#FDE047]/90 px-4 py-1.5 font-mono text-xs font-bold text-[#1C1E24] hover:bg-[#FDE047] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state === "sending" ? "…" : "등록"}
          </button>
        </div>
      )}
      {state === "error" && (
        <p className="mt-1.5 font-mono text-[11px] text-red-400">
          등록에 실패했어요. 다시 눌러 주세요
        </p>
      )}
    </div>
  );
}

/** 1~3위 미리보기용 (헤더 랭킹 버튼·시상대) */
export function useAIRankTop(coll: AIRankColl) {
  const [top, setTop] = useState<AIRankRow[]>([]);
  useEffect(() => {
    let alive = true;
    getAIRanks(coll, 3)
      .then((r) => alive && setTop(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [coll]);
  return top;
}

/** 순위표 (refresh가 바뀌면 다시 불러옴) */
export function RankBoard({
  coll,
  oppLabel,
  refresh = 0,
  vs = true,
  bare = false,
  skip = 0,
}: {
  coll: AIRankColl;
  oppLabel: (opp: string) => ReactNode;
  refresh?: number;
  /** 상대 표기 앞에 "vs" 붙이기 (표기에 이미 vs가 있으면 false) */
  vs?: boolean;
  /** 모달 안처럼 테두리·제목 없이 */
  bare?: boolean;
  /** 위쪽 몇 등 빼기 (시상대로 따로 보여 줄 때) */
  skip?: number;
}) {
  const [rows, setRows] = useState<AIRankRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getAIRanks(coll)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [coll, refresh]);
  return (
    <div className={bare ? "" : "rounded-xl border border-white/10 bg-[#1C1E24] p-3"}>
      {bare ? (
        <p className="mb-2 px-1.5 text-[11px] text-white/40">
          더 센 상대를 이긴 기록이 항상 위 · 같은 상대끼리는 판 점수 순
        </p>
      ) : (
        <div className="mb-1.5 px-1.5 font-mono text-xs text-white/40">🏆 랭킹 TOP 10</div>
      )}
      {failed ? (
        <p className="py-3 font-mono text-xs text-white/30">랭킹을 불러오지 못했어요</p>
      ) : !rows ? (
        <p className="py-3 font-mono text-xs text-white/30">불러오는 중…</p>
      ) : (
        <RankList
          rows={rows.map((r) => ({
            name: r.name,
            value: pointsOf(r.score).toLocaleString(),
            sub: (
              <>
                {vs && "vs "}
                {oppLabel(r.opp)} · {r.moves}수 · {clockLabel(r.seconds)}
              </>
            ),
            date: r.createdAt,
          }))}
          skip={skip}
        />
      )}
    </div>
  );
}
