"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { allSettled, preloadAll, type LoadTask } from "@/lib/preload";

/*
 * 게임 로딩 화면: 게임에 쓰는 그림 · 소리를 다 받은 뒤에 게임 화면을 염 (느린 인터넷에서 그림이 하나씩 붙는 걸 안 보이게).
 *
 *   <GameLoader tasks={() => [...주소, () => 게임자체로더()]} title="PIXEL FIGHT" accent="#FF5C7A" className="aspect-video">
 *     <게임 />
 *   </GameLoader>
 *
 * - 게임은 다 받은 뒤에 처음 그려짐 (그 전엔 같은 자리 · 같은 크기에 진행률 화면)
 * - 금방(0.15초 안) 끝나면 로딩 화면을 아예 안 보임 → 다시 들어왔을 때 깜빡임 없음
 * - 오래 걸리면(15초) 「받은 것부터 시작」 버튼 — 한 파일 때문에 영영 못 들어가는 일 없게
 * - 게임 안에서 판 · 곡 · 방에 들어갈 때처럼 중간에 받을 것은 usePreload + LoadingPanel 로 같은 모양
 *
 * 새 게임 · 새 에셋을 넣을 때도 그 게임의 tasks 에 꼭 추가할 것.
 */

const SHOW_AFTER_MS = 150;
const SKIP_AFTER_MS = 15_000;

export interface PreloadState {
  ready: boolean;
  loaded: number;
  total: number;
  /** 로딩 화면을 보여 줄 때인가 (금방 끝날 땐 false) */
  show: boolean;
  /** 오래 걸려서 건너뛰기 버튼을 보여 줄 때 */
  slow: boolean;
  skip: () => void;
}

/**
 * tasks 를 받고 끝나면 ready. key 가 바뀌면 다시 (예: 고른 캐릭터 · 곡). tasks 가 null 이면 아무것도 안 함(ready).
 */
export function usePreload(
  tasks: (() => LoadTask[]) | LoadTask[] | null,
  key: unknown = 0
): PreloadState {
  const fresh = () => {
    const list = typeof tasks === "function" ? tasks() : tasks;
    return {
      key,
      list,
      ready: !list || allSettled(list),
      loaded: 0,
      total: list?.length ?? 0,
      show: false,
      slow: false,
    };
  };
  const [st, setSt] = useState(fresh);
  // key 가 바뀌면 처음부터 (렌더 중에 맞춰서 한 프레임도 옛 상태를 안 보이게)
  if (st.key !== key) setSt(fresh());

  const { ready, list } = st;
  useEffect(() => {
    if (ready) return;
    let alive = true;
    const showT = setTimeout(() => alive && setSt((s) => ({ ...s, show: true })), SHOW_AFTER_MS);
    const slowT = setTimeout(() => alive && setSt((s) => ({ ...s, slow: true })), SKIP_AFTER_MS);
    void preloadAll(
      list ?? [],
      (loaded, total) => alive && setSt((s) => ({ ...s, loaded, total }))
    ).then(() => {
      if (alive) setSt((s) => ({ ...s, ready: true }));
    });
    return () => {
      alive = false;
      clearTimeout(showT);
      clearTimeout(slowT);
    };
  }, [ready, list]);

  return {
    ready: st.ready,
    loaded: st.loaded,
    total: st.total,
    show: st.show,
    slow: st.slow,
    skip: () => setSt((s) => ({ ...s, ready: true })),
  };
}

/** 진행률 화면 (게임 칸을 꽉 채움). 게임 안 오버레이로도 씀 */
export function LoadingPanel({
  state,
  title,
  accent = "#8B84FF",
  sub = "그림 · 소리 받는 중",
  className = "",
  style,
}: {
  state: Pick<PreloadState, "loaded" | "total" | "slow" | "skip">;
  title?: ReactNode;
  accent?: string;
  sub?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const pct = state.total ? Math.floor((state.loaded / state.total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={`${typeof title === "string" ? title + " " : ""}불러오는 중`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`flex flex-col items-center justify-center gap-4 bg-[#0d0e12] px-6 text-center select-none ${className}`}
      style={style}
    >
      {title && (
        <div className="font-mono text-lg font-bold tracking-[0.08em] text-white/90 sm:text-2xl">
          {title}
        </div>
      )}
      <div className="w-[min(22rem,72%)]">
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full transition-[width] duration-200 ease-out"
            style={{
              width: `${Math.max(3, pct)}%`,
              background: accent,
              boxShadow: `0 0 12px ${accent}66`,
            }}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between font-mono text-[11px] text-white/45 tabular-nums sm:text-xs">
          <span className="font-['Nanum_Gothic',sans-serif]">{sub}</span>
          <span>
            <b className="text-white/80">{pct}%</b>
            {state.total > 0 && (
              <span className="ml-1.5 text-white/30">
                {state.loaded}/{state.total}
              </span>
            )}
          </span>
        </div>
      </div>
      {state.slow && (
        <button
          type="button"
          onClick={state.skip}
          className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 font-['Nanum_Gothic',sans-serif] text-xs text-white/65 transition-colors hover:border-white/40 hover:text-white"
        >
          연결이 느려요 · 받은 것부터 시작
        </button>
      )}
    </div>
  );
}

/**
 * 게임을 감싸는 로딩 화면. 다 받기 전엔 children 을 그리지 않음 (같은 자리에 className 크기의 진행률 화면).
 * 금방 끝나면(다시 들어왔을 때) 빈 칸만 잠깐 → 바로 게임.
 */
export default function GameLoader({
  tasks,
  title,
  accent,
  className = "",
  style,
  children,
}: {
  tasks: (() => LoadTask[]) | LoadTask[];
  title?: ReactNode;
  accent?: string;
  /** 진행률 화면의 크기 · 모양 (게임 칸과 같게: 예 "aspect-video w-full rounded-xl") */
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const st = usePreload(tasks);
  if (st.ready) return <>{children}</>;
  if (!st.show) return <div aria-hidden className={`bg-[#0d0e12] ${className}`} style={style} />;
  return (
    <LoadingPanel state={st} title={title} accent={accent} className={className} style={style} />
  );
}
