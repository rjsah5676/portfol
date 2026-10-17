"use client";

import { useEffect, useRef } from "react";
import type { RogueReport } from "@/lib/rogue/rules";
import { rogue, type RogueFinishOut } from "@/realtime/rogue";

/*
 * PIXEL RESET STORY (픽셀 리셋 스토리) 게임 판 — 게임은 public/rogue/index.html 을 iframe 으로 띄우고, postMessage 로 서버와 이어 줌
 *   게임 → rogue:start {key}        판 시작 (회원이면 서버 판 번호를 받아서 rogue:run 으로 돌려줌, 아니면 guest)
 *   게임 → rogue:end {key, run, rep} 판 끝 → rogue.finish → rogue:saved {best, rank, ach} 또는 {err}
 * 같은 출처(origin) · 그 iframe 에서 온 것만 받음
 */
export default function RogueFrame({ onFinish }: { onFinish?: (o: RogueFinishOut) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const cb = useRef(onFinish);
  useEffect(() => {
    cb.current = onFinish;
  }, [onFinish]);

  // 게임 화면은 5:3 + 위쪽 줄(임베드면 여백 4px) — 폭에 맞춰 높이를 잡되 화면 높이를 넘지 않게
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      el.style.height = `${Math.min(Math.round((w - 8) * 0.6 + 42), Math.max(320, window.innerHeight - 80))}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  useEffect(() => {
    const send = (msg: object) =>
      frame.current?.contentWindow?.postMessage(msg, window.location.origin);
    const on = async (e: MessageEvent) => {
      if (
        e.origin !== window.location.origin ||
        !frame.current ||
        e.source !== frame.current.contentWindow
      )
        return;
      const d = e.data as { type?: string; key?: string; run?: string; rep?: RogueReport } | null;
      if (!d || typeof d.type !== "string") return;
      if (d.type === "rogue:start") {
        try {
          const { run } = await rogue.start();
          send({ type: "rogue:run", key: d.key, run });
        } catch (err) {
          send({
            type: "rogue:run",
            key: d.key,
            run: null,
            guest: (err as { code?: string }).code === "MEMBER_ONLY",
          });
        }
      } else if (d.type === "rogue:end" && d.run && d.rep) {
        try {
          const o = await rogue.finish(d.run, d.rep);
          send({ type: "rogue:saved", key: d.key, ...o });
          cb.current?.(o);
        } catch (err) {
          send({
            type: "rogue:saved",
            key: d.key,
            err: err instanceof Error ? err.message : "서버 오류",
          });
        }
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  return (
    <div
      ref={box}
      className="w-full overflow-hidden rounded-xl border border-white/10 bg-[#0b0d17]"
      style={{ height: 520 }}
    >
      <iframe
        ref={frame}
        src="/rogue/index.html"
        title="PIXEL RESET STORY 게임 화면"
        allow="fullscreen; autoplay; clipboard-write"
        className="block h-full w-full border-0"
      />
    </div>
  );
}
