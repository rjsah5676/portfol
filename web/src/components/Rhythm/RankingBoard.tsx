"use client";

import { rankDateLabel } from "@/lib/rankDate";
import { useEffect, useState } from "react";
import {
  addRhythmRanking,
  getRhythmTop,
  RHYTHM_NAME_MAX,
  type RhythmRanking,
} from "@/firestore/rhythmRankings";
import type { Result } from "./Stage";

const NAME_KEY = "rhythm_name";

function List({
  list,
  highlight,
  game = false,
}: {
  list: RhythmRanking[];
  highlight?: string | null;
  /** 게임 화면 안(결과 화면): 글자 크기를 화면 폭에 맞춤 */
  game?: boolean;
}) {
  if (!list.length)
    return (
      <p
        className={`text-center font-mono text-white/30 ${game ? "py-[2cqw] text-[1.1cqw]" : "py-6 text-xs"}`}
      >
        아직 기록이 없어요. 첫 번째가 되어보세요.
      </p>
    );
  if (game) return <GameList list={list} highlight={highlight} />;
  return (
    <ol className="divide-y divide-white/5">
      {list.map((r, i) => (
        <li
          key={r.id}
          className={`flex items-center font-mono ${
            game
              ? "gap-[0.9cqw] px-[0.4cqw] py-[0.45cqw] text-[1.05cqw]"
              : "gap-3 px-1 py-1.5 text-xs"
          } ${r.id === highlight ? "rounded-md bg-[#6C63FF]/20" : ""}`}
        >
          <span
            className={`w-5 text-right ${i === 0 ? "text-[#FDE047]" : i < 3 ? "text-white/80" : "text-white/35"}`}
          >
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate font-['Nanum_Gothic',sans-serif] text-white/85">
            {r.name}
          </span>
          {r.ap ? (
            <span className={`${game ? "text-[0.85cqw]" : "text-[10px]"} text-[#7DF9FF]`}>AP</span>
          ) : r.fc ? (
            <span className={`${game ? "text-[0.85cqw]" : "text-[10px]"} text-[#4ADE80]`}>FC</span>
          ) : null}
          <span className={`${game ? "w-[5.4cqw]" : "w-14"} text-right text-white/40`}>
            {r.acc.toFixed(2)}%
          </span>
          <span className={`${game ? "w-[6.6cqw]" : "w-20"} text-right text-white`}>
            {r.score.toLocaleString("en-US")}
          </span>
          {!game && (
            <span className="hidden w-[3.75rem] text-right text-[11px] text-white/30 tabular-nums sm:inline">
              {rankDateLabel(r.createdAt)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

const MEDAL = ["#FDE047", "#E2E8F0", "#FB923C"];
const DISP = "font-['Arial_Black','Segoe_UI_Black',Impact,sans-serif] font-black italic";

/** 게임 화면 안 랭킹: 순위 배지 + 이름 + 점수 줄 (1~3위는 금·은·동) */
function GameList({ list, highlight }: { list: RhythmRanking[]; highlight?: string | null }) {
  return (
    <ol className="flex flex-col gap-[0.35cqw] py-[0.3cqw]">
      {list.map((r, i) => {
        const medal = MEDAL[i];
        const me = r.id === highlight;
        return (
          <li
            key={r.id}
            className={`relative flex items-center gap-[0.8cqw] overflow-hidden rounded-[0.5cqw] border py-[0.35cqw] pr-[0.9cqw] pl-[0.4cqw] [animation:bd-slide-left_300ms_ease-out_backwards] ${
              me ? "border-[#F472B6]/70 bg-[#F472B6]/20" : "border-white/[0.07] bg-white/[0.04]"
            }`}
            style={{
              animationDelay: `${i * 40}ms`,
              ...(medal && !me
                ? { background: `linear-gradient(90deg, ${medal}26, rgba(255,255,255,0.03) 60%)` }
                : null),
            }}
          >
            <span
              className={`${DISP} flex h-[2cqw] w-[2.6cqw] shrink-0 -skew-x-12 items-center justify-center rounded-[0.35cqw] text-[1.15cqw]`}
              style={
                medal
                  ? { background: medal, color: "#1a1030", boxShadow: `0 0 0.8cqw ${medal}88` }
                  : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }
              }
            >
              <span className="skew-x-12">{i + 1}</span>
            </span>
            <span className="min-w-0 flex-1 truncate font-['Nanum_Gothic',sans-serif] text-[1.15cqw] font-bold text-white/90">
              {r.name}
            </span>
            {(r.ap || r.fc) && (
              <span
                className="shrink-0 rounded-[0.3cqw] px-[0.35cqw] font-mono text-[0.8cqw] font-bold text-black"
                style={{ background: r.ap ? "#7DF9FF" : "#FDE047" }}
              >
                {r.ap ? "AP" : "FC"}
              </span>
            )}
            <span className="w-[4.6cqw] shrink-0 text-right font-mono text-[0.95cqw] text-white/45">
              {r.acc.toFixed(2)}%
            </span>
            <span
              className={`${DISP} w-[7cqw] shrink-0 text-right text-[1.25cqw] text-white tabular-nums`}
            >
              {r.score.toLocaleString("en-US")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function useTop(songId: string, diff: string, refresh: number) {
  const [state, setState] = useState<{ key: string; list: RhythmRanking[]; error: boolean } | null>(
    null
  );
  const key = `${songId}:${diff}:${refresh}`;
  useEffect(() => {
    let alive = true;
    getRhythmTop(songId, diff)
      .then((list) => alive && setState({ key, list, error: false }))
      .catch(() => alive && setState({ key, list: [], error: true }));
    return () => {
      alive = false;
    };
  }, [songId, diff, key]);
  return state?.key === key ? state : null;
}

/** 곡 선택 화면: 현재 곡·난이도 TOP 10 */
export function RankingBoard({
  songId,
  diff,
  label,
  bare = false,
  game = false,
}: {
  songId: string;
  diff: string;
  label: string;
  /** 모달 안처럼 테두리·제목 없이 */
  bare?: boolean;
  /** 게임 화면(곡 선택) 안: 목록만, 글자 크기는 화면 폭 기준 */
  game?: boolean;
}) {
  const top = useTop(songId, diff, 0);
  if (game)
    return !top ? (
      <p className="py-[1.4cqw] text-center font-mono text-[1.05cqw] text-white/30">불러오는 중…</p>
    ) : top.error ? (
      <p className="py-[1.4cqw] text-center font-mono text-[1.05cqw] text-red-300/80">
        랭킹을 불러오지 못했어요.
      </p>
    ) : (
      <List list={top.list} game />
    );
  return (
    <div className={bare ? "" : "rounded-xl border border-white/10 bg-[#1C1E24] p-4"}>
      {!bare && (
        <p className="mb-2 font-mono text-sm font-bold text-white">
          랭킹 <span className="text-xs font-normal text-white/40">· {label} TOP 10</span>
        </p>
      )}
      {!top ? (
        <p className="py-6 text-center font-mono text-xs text-white/30">불러오는 중…</p>
      ) : top.error ? (
        <p className="py-6 text-center font-mono text-xs text-red-300/80">
          랭킹을 불러오지 못했습니다.
        </p>
      ) : (
        <List list={top.list} />
      )}
    </div>
  );
}

/** 결과 화면: 이름 넣고 등록 + TOP 10 */
export function SubmitRanking({
  result,
  label,
  game = false,
}: {
  result: Result;
  label: string;
  /** 게임 화면(결과) 안에 맞춘 모양 */
  game?: boolean;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [myId, setMyId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const top = useTop(result.songId, result.diff, refresh);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 지난번 이름 복원(마운트 1회)
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
  }, []);

  const submit = async () => {
    const n = name.trim();
    if (!n || status === "saving" || status === "done") return;
    setStatus("saving");
    try {
      const id = await addRhythmRanking(result.songId, result.diff, {
        name: n,
        score: result.score,
        acc: result.acc,
        maxCombo: result.maxCombo,
        fc: result.fc,
        ap: result.ap,
      });
      try {
        localStorage.setItem(NAME_KEY, n);
      } catch {}
      setMyId(id);
      setStatus("done");
      setRefresh((r) => r + 1);
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  };

  const myRank = top && myId ? top.list.findIndex((r) => r.id === myId) : -1;

  if (game)
    return (
      <div className="flex h-full flex-col rounded-[0.9cqw] border border-white/10 bg-black/45 px-[1.4cqw] py-[1.1cqw]">
        <div className="flex items-baseline justify-between gap-[1cqw]">
          <span className="font-['Arial_Black','Segoe_UI_Black',sans-serif] text-[1.5cqw] font-black tracking-[0.12em] text-white italic">
            RANKING
          </span>
          <span className="truncate font-mono text-[0.95cqw] text-white/40">{label} TOP 10</span>
        </div>
        {status === "done" ? (
          <p className="mt-[0.8cqw] rounded-[0.6cqw] bg-[#A78BFA]/15 px-[1cqw] py-[0.6cqw] text-center font-mono text-[1.1cqw] text-white/80">
            등록 완료{myRank >= 0 ? ` · ${myRank + 1}위` : top ? " · TOP 10 밖" : ""}
          </p>
        ) : (
          <form
            className="mt-[0.8cqw] flex gap-[0.6cqw]"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, RHYTHM_NAME_MAX))}
              placeholder="이름을 넣고 기록 등록"
              maxLength={RHYTHM_NAME_MAX}
              className="min-w-0 flex-1 rounded-[0.6cqw] border border-white/15 bg-black/40 px-[1cqw] py-[0.55cqw] font-['Nanum_Gothic',sans-serif] text-[1.2cqw] text-white placeholder:text-white/30 focus:border-[#A78BFA] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!name.trim() || status === "saving"}
              className="shrink-0 cursor-pointer rounded-[0.6cqw] bg-[linear-gradient(90deg,#7c3aed,#db2777)] px-[1.4cqw] font-['Nanum_Gothic',sans-serif] text-[1.2cqw] font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "saving" ? "등록 중…" : "등록"}
            </button>
          </form>
        )}
        {status === "error" && (
          <p className="mt-[0.4cqw] font-mono text-[1cqw] text-red-300/80">
            등록하지 못했어요. 잠시 후 다시 시도해주세요.
          </p>
        )}
        <div className="mt-[0.8cqw] min-h-0 flex-1 bd-scroll overflow-y-auto border-t border-white/10 pt-[0.4cqw]">
          {!top ? (
            <p className="py-[2cqw] text-center font-mono text-[1.1cqw] text-white/30">
              불러오는 중…
            </p>
          ) : top.error ? (
            <p className="py-[2cqw] text-center font-mono text-[1.1cqw] text-red-300/80">
              랭킹을 불러오지 못했어요.
            </p>
          ) : (
            <List list={top.list} highlight={myId} game />
          )}
        </div>
      </div>
    );

  return (
    <div className="rounded-2xl border border-white/10 bg-[#1C1E24] p-5">
      <p className="mb-3 font-mono text-sm font-bold text-white">
        랭킹 <span className="text-xs font-normal text-white/40">· {label} TOP 10</span>
      </p>
      {status === "done" ? (
        <p className="mb-3 rounded-lg bg-white/5 px-3 py-2 text-center font-mono text-xs text-white/70">
          등록 완료{myRank >= 0 ? ` · ${myRank + 1}위` : top ? " · TOP 10 밖" : ""}
        </p>
      ) : (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, RHYTHM_NAME_MAX))}
            placeholder="이름"
            maxLength={RHYTHM_NAME_MAX}
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#15171c] px-4 py-2 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/25 focus:border-[#6C63FF]/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!name.trim() || status === "saving"}
            className="shrink-0 cursor-pointer rounded-full bg-[#6C63FF] px-4 py-2 font-mono text-sm text-white hover:bg-[#5b52f0] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "saving" ? "등록 중…" : "등록"}
          </button>
        </form>
      )}
      {status === "error" && (
        <p className="mb-2 font-mono text-xs text-red-300/80">
          등록하지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      )}
      {!top ? (
        <p className="py-6 text-center font-mono text-xs text-white/30">불러오는 중…</p>
      ) : top.error ? (
        <p className="py-6 text-center font-mono text-xs text-red-300/80">
          랭킹을 불러오지 못했습니다.
        </p>
      ) : (
        <List list={top.list} highlight={myId} />
      )}
    </div>
  );
}
