"use client";

import RankList from "@/components/RankList";
import GameHeader from "@/components/GameHeader";
import { REACTION_GUIDE } from "@/data/gameGuides";
import { useState, useEffect, useRef, useCallback } from "react";
import Faded from "@/components/Faded";
import {
  getTopReactionScores,
  addReactionScore,
  type ReactionScore,
  toReactionScore,
  type ReactionScoreRow,
} from "@/firestore/reactionGame";
import { useInitial } from "@/lib/api/InitialData";
import { beginRun, RANK_NAME_MAX } from "@/lib/api/rankRun";
import { useAutoRank } from "@/lib/useAutoRank";

const ROUNDS = 5;
const MIN_DELAY = 1500;
const MAX_DELAY = 4500;
// 사람 반응속도 하한(~100ms)보다 빠르면 신호 보고 누른 게 아니라 예측한 걸로 보고 다시
const ANTICIPATION_MS = 100;

type Phase = "idle" | "waiting" | "go" | "early" | "result" | "done";

function RankBox({ list, highlight }: { list: ReactionScore[]; highlight?: number }) {
  if (!list.length)
    return <div className="mb-10 font-mono text-sm text-white/30">랭킹 불러오는 중…</div>;
  return (
    <div className="mx-auto mb-10 max-w-sm rounded-2xl border border-white/10 bg-[#1C1E24] p-3 text-left">
      <RankList
        rows={list.map((r) => ({
          name: r.name,
          member: r.member,
          value: `${r.score}ms`,
          date: r.createdAt,
        }))}
        highlight={highlight}
      />
    </div>
  );
}

export default function RspeedPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<number[]>([]);
  // 서버가 미리 읽어둔 랭킹으로 시작 (layout.tsx) → 첫 화면부터 순위가 보임. 없으면 아래에서 읽어옴
  const initialRanks = useInitial<ReactionScoreRow[]>("rankings");
  const [list, setList] = useState<ReactionScore[]>(() =>
    (initialRanks ?? []).map(toReactionScore)
  );
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedRank, setSubmittedRank] = useState<number | undefined>();

  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 파란색이 실제로 그려지는 프레임 시각(performance.now 기준)
  const goAtRef = useRef<number | null>(null);

  const loadRankings = useCallback(() => getTopReactionScores(10).then(setList), []);
  useEffect(() => {
    loadRankings();
    return () => {
      if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
    };
  }, [loadRankings]);

  // 색이 바뀐 렌더가 커밋된 뒤 다음 프레임 시각을 시작점으로 잡음
  // (setState 시점이 아니라 화면에 파란색이 보이는 시점에 가깝게)
  useEffect(() => {
    if (phase !== "go") return;
    const id = requestAnimationFrame((t) => {
      goAtRef.current = t;
    });
    return () => cancelAnimationFrame(id);
  }, [phase]);

  const startRound = () => {
    goAtRef.current = null;
    setPhase("waiting");
    const delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
    delayTimerRef.current = setTimeout(() => setPhase("go"), delay);
  };

  const reset = () => {
    setResults([]);
    setName("");
    setSubmittedRank(undefined);
    setPhase("idle");
  };

  // onClick은 손을 뗄 때 발생해서 수십 ms가 더 붙음 -> 누르는 순간(pointerdown) 기준
  const press = (timeStamp: number) => {
    switch (phase) {
      case "idle":
        // 5회 중 첫 회를 시작할 때 (랭킹 등록용)
        beginRun("reaction");
        startRound();
        break;
      case "early":
      case "result":
        startRound();
        break;
      case "waiting":
        if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
        setPhase("early");
        break;
      case "go": {
        const goAt = goAtRef.current;
        if (goAt === null) return;
        const ms = Math.round(timeStamp - goAt);
        if (ms < ANTICIPATION_MS) {
          setPhase("early");
          return;
        }
        const next = [...results, ms];
        setResults(next);
        setPhase(next.length >= ROUNDS ? "done" : "result");
        break;
      }
    }
  };

  // 스페이스/엔터로도 가능
  const pressRef = useRef(press);
  useEffect(() => {
    pressRef.current = press;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.code !== "Space" && e.code !== "Enter")) return;
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      pressRef.current(e.timeStamp);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const avg = results.length ? Math.round(results.reduce((a, b) => a + b, 0) / results.length) : 0;
  const best = results.length ? Math.min(...results) : 0;
  const isRanked = phase === "done" && (list.length < 10 || avg < list[list.length - 1].score);

  async function submitScore(as = name) {
    const trimmed = as.trim();
    if (!trimmed || trimmed.length > 20 || submitting || submittedRank !== undefined) return;
    setSubmitting(true);
    try {
      // 한 사람당 가장 좋은 기록 하나만 남음 → 돌아온 id 가 랭킹에 있는 내 기록
      const id = await addReactionScore(trimmed, avg);
      const top = await getTopReactionScores(10);
      setList(top);
      setSubmittedRank(top.findIndex((s) => s.id === id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "기록을 등록하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  // 회원은 이름을 묻지 않고 5회가 끝나면 바로 등록 (서버가 내 최고 기록만 남김)
  const auto = useAutoRank(phase === "done", (nick) => submitScore(nick));

  const header = (
    <GameHeader
      icon="⚡"
      title="반응속도 테스트"
      en="Reaction"
      accent="#60A5FA"
      desc="파란색이 되는 순간 클릭, 5회 평균"
      guide={REACTION_GUIDE}
      rank={{
        top: list
          .slice(0, 3)
          .map((r) => ({ name: r.name, member: r.member, value: `${r.score}ms` })),
        sub: "5회 평균",
        render: () => (
          <RankList
            rows={list.map((r) => ({
              name: r.name,
              member: r.member,
              value: `${r.score}ms`,
              date: r.createdAt,
            }))}
            skip={3}
          />
        ),
      }}
    />
  );

  if (phase === "done") {
    return (
      <Faded>
        <div className="mx-auto max-w-xl px-4 pt-6 pb-24 text-center sm:px-6">
          {header}
          <div className="mb-2 font-mono text-lg text-white/60">평균</div>
          <div className="mb-2 font-mono text-5xl font-bold text-white">{avg} ms</div>
          <div className="mb-6 font-mono text-sm text-white/40">최고 {best} ms</div>
          <div className="mb-8 flex justify-center gap-2 font-mono text-xs text-white/50">
            {results.map((ms, i) => (
              <span
                key={i}
                className={`rounded-full border px-3 py-1 ${ms === best ? "border-[#6C63FF]/60 text-white" : "border-white/10"}`}
              >
                {ms}
              </span>
            ))}
          </div>

          {!auto.member && isRanked && submittedRank === undefined && (
            <div className="mb-8">
              <p className="mb-4 font-['Nanum_Gothic',sans-serif] text-white/70">
                10위 안에 들었어요! 이름을 입력해주세요.
              </p>
              <form
                className="flex justify-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitScore();
                }}
              >
                <input
                  value={name}
                  maxLength={RANK_NAME_MAX}
                  placeholder={`이름 (${RANK_NAME_MAX}자)`}
                  onChange={(e) => setName(e.target.value)}
                  className="w-36 rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 text-center text-white focus:border-[#6C63FF]/50 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-default disabled:opacity-40"
                >
                  {submitting ? "등록 중" : "제출"}
                </button>
              </form>
            </div>
          )}

          {submittedRank !== undefined && <RankBox list={list} highlight={submittedRank} />}

          <button
            type="button"
            onClick={reset}
            className="cursor-pointer rounded-full border border-white/10 px-6 py-2 font-mono text-sm text-white/70 transition-colors hover:text-white"
          >
            다시하기
          </button>
        </div>
      </Faded>
    );
  }

  const stage = {
    idle: {
      bg: "bg-[#1C1E24] hover:bg-[#23252c]",
      title: "시작",
      sub: `파란색으로 바뀌면 최대한 빨리 누르세요 · ${ROUNDS}회 평균`,
    },
    waiting: { bg: "bg-red-500", title: "기다리세요…", sub: "파란색이 되면 클릭" },
    go: { bg: "bg-blue-500", title: "지금!", sub: "" },
    early: { bg: "bg-amber-500", title: "너무 빨라요!", sub: "눌러서 이번 라운드 다시" },
    result: {
      bg: "bg-[#1C1E24] hover:bg-[#23252c]",
      title: `${results[results.length - 1]} ms`,
      sub: "눌러서 다음 라운드",
    },
  }[phase];

  return (
    <Faded>
      <div className="mx-auto max-w-xl px-4 pt-6 pb-24 text-center sm:px-6">
        {header}
        <div className="mb-4 flex items-center justify-between font-mono text-sm text-white/50">
          <span>
            {Math.min(results.length + (phase === "idle" ? 0 : 1), ROUNDS)} / {ROUNDS}
          </span>
          <span>{results.length ? results.join(" · ") : "-"}</span>
        </div>
        <button
          type="button"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            press(e.timeStamp);
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={`flex h-[min(60vh,360px)] w-full cursor-pointer touch-manipulation flex-col items-center justify-center rounded-3xl select-none ${stage.bg}`}
        >
          <span className="font-mono text-4xl font-bold text-white">{stage.title}</span>
          {stage.sub && (
            <span className="mt-3 font-['Nanum_Gothic',sans-serif] text-sm text-white/70">
              {stage.sub}
            </span>
          )}
        </button>
        <p className="mt-4 font-mono text-xs text-white/30">스페이스바 / 엔터로도 가능</p>
      </div>
    </Faded>
  );
}
