"use client";

/*
 * 음성 검수 화면 (개발 중에만: /games/love?review=voices)
 * 음성 붙은 대사 전부 — 어떤 장면 · 앞 대사 흐름 · A/B 테이크 듣기 · "화면에서 보기"로 실제 게임 화면 + 음성
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { NAME, NAME_COLOR } from "@/lib/love/assets";
import { findLine } from "@/lib/love/engine";
import { SCENES } from "@/lib/love/script";
import type { Who } from "@/lib/love/types";
import { VOICE_ALL, VOICE_TAKE, voiceFile } from "@/lib/love/voices";

export interface VoiceRow {
  n: number;
  id: string;
  who: Who;
  text: string;
  tag?: string;
  gen?: boolean;
  scene: string | null;
  i: number;
  ctx: { who: Who; text: string }[];
  after: { who: Who; text: string } | null;
}

export const voiceRows = (): VoiceRow[] =>
  VOICE_ALL.map((v, k) => {
    const loc = findLine(v.text);
    const ctx: VoiceRow["ctx"] = [];
    let after: VoiceRow["after"] = null;
    if (loc) {
      const steps = SCENES[loc.scene];
      for (let j = loc.i - 1; j >= 0 && ctx.length < 4; j--) {
        const st = steps[j];
        if (st.t === "say") ctx.unshift({ who: st.who, text: st.text });
      }
      for (let j = loc.i + 1; j < steps.length; j++) {
        const st = steps[j];
        if (st.t === "say") {
          after = { who: st.who, text: st.text };
          break;
        }
        if (st.t === "choice" || st.t === "goto") break;
      }
    }
    return {
      n: k + 1,
      id: v.id,
      who: v.who,
      text: v.text,
      tag: v.tag,
      gen: v.gen,
      scene: loc?.scene ?? null,
      i: loc?.i ?? 0,
      ctx,
      after,
    };
  });

export default function VoiceReview({
  name,
  last,
  onJump,
  onBack,
}: {
  name: string;
  last: string | null;
  onJump: (r: VoiceRow) => void;
  onBack: () => void;
}) {
  const all = useMemo(() => voiceRows(), []);
  // 줄이 많아지면(풀보이스) 찾기 · 캐릭터 거르기
  const [q, setQ] = useState("");
  const [who, setWho] = useState<"all" | "yeonseo" | "amy">("all");
  const rows = all.filter(
    (r) =>
      (who === "all" || r.who === who) &&
      (!q || r.text.includes(q) || (r.scene ?? "").includes(q) || String(r.n) === q)
  );
  const [playing, setPlaying] = useState<string | null>(null);
  const el = useRef<HTMLAudioElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const sub = (t: string) => t.replaceAll("{name}", name);
  const nm = (w: Who) => (w === "me" ? sub("{name}") : w === "narr" ? "" : NAME[w]);

  const stop = () => {
    el.current?.pause();
    el.current = null;
    setPlaying(null);
  };
  const play = (file: string) => {
    const was = playing;
    stop();
    if (was === file) return;
    const a = new Audio(`/love/voice/${file}.mp3`);
    a.volume = 0.95;
    el.current = a;
    setPlaying(file);
    a.onended = () => setPlaying((p) => (p === file ? null : p));
    a.play().catch(() => setPlaying(null));
  };
  useEffect(() => () => el.current?.pause(), []);
  // 화면에서 보고 돌아오면 보던 줄로 스크롤
  useEffect(() => {
    if (!last) return;
    box.current?.querySelector(`[data-id="${last}"]`)?.scrollIntoView({ block: "center" });
  }, [last]);

  return (
    <div
      className="absolute inset-0 flex flex-col bg-[#0b0806]/95 text-[1.25cqw] text-white/85"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-[1cqw] border-b border-white/10 px-[2cqw] py-[1cqw]">
        <div className="lv-logo text-[2cqw]">음성 검수</div>
        <div className="flex-1 text-[1.1cqw] text-white/55">
          {rows.length}줄 · 바꿀 줄은 번호로 알려 줘 — <b className="text-[#ffd27a]">“7 b”</b> (B
          테이크로) / <b className="text-[#ffd27a]">“12 다시: 더 낮고 떨리게”</b> (새로 생성) /{" "}
          <b className="text-[#ffd27a]">“20 빼”</b> (음성 없이)
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="대사 · 장면 · 번호 찾기"
          className="w-[16cqw] rounded-[0.4cqw] border border-white/20 bg-black/40 px-[0.8cqw] py-[0.4cqw] text-[1.1cqw] text-white outline-none"
        />
        {(["all", "yeonseo", "amy"] as const).map((w) => (
          <button
            key={w}
            className={`lv-cfg-step ${who === w ? "lv-cfg-on" : ""}`}
            onClick={() => setWho(w)}
          >
            {w === "all" ? "전부" : NAME[w]}
          </button>
        ))}
        <button className="lv-btn-ghost" onClick={onBack}>
          타이틀
        </button>
      </div>
      <div ref={box} className="flex-1 overflow-y-auto px-[2cqw] py-[1cqw]">
        {rows.map((r) => {
          const take = VOICE_TAKE[r.id] ?? "a";
          return (
            <div
              key={r.id}
              data-id={r.id}
              className={`mb-[1cqw] rounded-[0.6cqw] border px-[1.3cqw] py-[0.9cqw] ${last === r.id ? "border-[#ffd27a]/70 bg-[#ffd27a]/[.06]" : "border-white/10 bg-white/[.03]"}`}
            >
              <div className="mb-[0.5cqw] flex items-center gap-[0.8cqw] text-[1.05cqw] text-white/50">
                <b className="text-[1.5cqw] text-[#ffd27a]">#{r.n}</b>
                <span style={{ color: NAME_COLOR[r.who] }}>{NAME[r.who]}</span>
                <span>{r.id}</span>
                <span>· 장면 {r.scene ?? "⚠ 대본에 없음"}</span>
                {r.tag && <span>· 연기 {(r.tag.match(/\[[^\]]+\]/g) ?? []).join(" ")}</span>}
                <span>· 쓰는 테이크 {take.toUpperCase()}</span>
              </div>
              {r.ctx.map((c, j) => (
                <div key={j} className="truncate text-[1.1cqw] text-white/40">
                  {nm(c.who) && <span className="mr-[0.5cqw] text-white/55">{nm(c.who)}</span>}
                  {sub(c.text)}
                </div>
              ))}
              <div className="my-[0.4cqw] text-[1.45cqw] font-bold text-white">
                <span className="mr-[0.6cqw]" style={{ color: NAME_COLOR[r.who] }}>
                  {NAME[r.who]}
                </span>
                {sub(r.text)}
              </div>
              {r.after && (
                <div className="truncate text-[1.1cqw] text-white/40">
                  ↳{" "}
                  {nm(r.after.who) && (
                    <span className="mr-[0.5cqw] text-white/55">{nm(r.after.who)}</span>
                  )}
                  {sub(r.after.text)}
                </div>
              )}
              <div className="mt-[0.6cqw] flex gap-[0.6cqw]">
                {(r.gen && take === "a" ? (["a"] as const) : (["a", "b"] as const)).map((t) => {
                  const f = voiceFile(r, t);
                  return (
                    <button
                      key={t}
                      className={`lv-btn-ghost ${take === t ? "!border-[#ffd27a]" : ""}`}
                      onClick={() => play(f)}
                    >
                      {playing === f ? "■" : "▶"} {r.gen && take === "a" ? "듣기" : t.toUpperCase()}
                      {take === t && !(r.gen && take === "a") ? " (사용 중)" : ""}
                    </button>
                  );
                })}
                <button
                  className="lv-btn-gold"
                  disabled={!r.scene}
                  onClick={() => {
                    stop();
                    onJump(r);
                  }}
                >
                  화면에서 보기
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
