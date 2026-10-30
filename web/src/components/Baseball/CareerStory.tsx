"use client";

/*
 * 육성 메인 스토리 장면: 챕터 띠(「3주차 · 방출당한 남자」) → 대사(말하는 사람 상반신 + 이름표) → 고르기 · 감독 지시 카드.
 * 대사 · 등장인물은 lib/baseball/story.ts
 */
import { useEffect, useState } from "react";
import { TRAINS, type Career } from "@/lib/baseball/career";
import { charById, faceUrl } from "@/lib/baseball/data";
import { isBond } from "@/lib/baseball/bonds";
import { CAST, isCast, orderText, type SLine, type StoryScene } from "@/lib/baseball/story";
import { ORDER_REWARD } from "@/lib/baseball/career";
import { artUrl, markSeen, seenSet } from "./CareerBonds";
import { Btn, font } from "./ui";
import { sfx } from "./sfx";

const BG: Record<string, string> = {
  stadium: "linear-gradient(180deg, rgba(10,14,34,0.55) 0%, rgba(10,14,34,0.25) 40%, rgba(10,14,34,0.85) 100%)",
  night: "linear-gradient(180deg, rgba(4,6,20,0.85) 0%, rgba(8,10,30,0.6) 45%, rgba(4,6,18,0.92) 100%)",
};

function who(w: SLine["who"], c: Career) {
  if (w === "narr") return { name: "", role: "", color: "#c9d2ff", img: null as string | null, full: false };
  if (w === "me") return { name: c.name, role: "나", color: "#FF8A3D", img: null, full: false };
  if (isCast(w)) return { ...CAST[w], img: CAST[w].img, full: false };
  if (isBond(w)) {
    const ch = charById(w);
    return { name: ch.name, role: "트레이너", color: ch.color, img: artUrl(w), full: true };
  }
  return { name: "", role: "", color: "#fff", img: null, full: false };
}

/** 장면 하나. 끝나면 onDone(고른 번호 · 없으면 -1) */
export function StorySceneView({ c, scene, onDone }: { c: Career; scene: StoryScene; onDone: (pick: number) => void }) {
  // 0 = 챕터 띠 · 1 = 대사 · 2 = 고른 뒤 대답 · 3 = 감독 지시 카드
  const [stage, setStage] = useState(0);
  const [i, setI] = useState(0);
  const [pick, setPick] = useState(-1);
  const [seen, setSeen] = useState(false);
  const [log, setLog] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장값 확인
    setSeen(seenSet().has(scene.key));
    sfx.cutin();
    const t = window.setTimeout(() => setStage((s) => (s === 0 ? 1 : s)), 1500);
    return () => window.clearTimeout(t);
  }, [scene.key]);
  const lines = scene.lines;
  const end = i >= lines.length - 1;
  const cur: SLine = stage === 2 && pick >= 0 && scene.choices ? scene.choices[pick].reply : lines[Math.min(i, lines.length - 1)];
  const sp = who(cur.who, c);
  const finish = (p: number) => {
    markSeen(scene.key);
    onDone(p);
  };
  const advance = () => {
    if (log) return setLog(false);
    if (stage === 0) return setStage(1);
    if (stage === 1) {
      if (!end) {
        sfx.ui();
        return setI((v) => v + 1);
      }
      if (scene.choices) return;
      if (scene.order) return setStage(3);
      return finish(-1);
    }
    if (stage === 2) {
      if (scene.order) return setStage(3);
      return finish(pick);
    }
    finish(pick);
  };
  const bgImg = "url(/baseball/field/field_bg.webp)";
  return (
    <div
      className="absolute inset-0 z-40 cursor-pointer overflow-hidden select-none"
      style={{ background: `${BG[scene.place] ?? BG.stadium}, ${bgImg} center 30% / cover no-repeat, #0b0e1c`, imageRendering: "pixelated" }}
      data-space={stage === 1 && end && scene.choices ? undefined : "pointer"}
      onPointerDown={(e) => {
        e.stopPropagation();
        advance();
      }}
    >
      {/* 챕터 띠 */}
      {stage === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="absolute h-[150px] w-[140%] -rotate-[4deg] bg-[#0a0818]/90" style={{ animation: "pxbBand 0.35s ease-out both", borderTop: "6px solid #FF8A3D", borderBottom: "6px solid #FF8A3D" }} />
          <div className="relative text-center" style={{ animation: "pxbSlide 0.4s 0.1s ease-out both" }}>
            <div className={`${font.title} text-[64px] leading-none text-[#FF8A3D] italic`} style={{ textShadow: "0 4px 0 #000" }}>
              {scene.title}
            </div>
            <div className={`${font.title} mt-2 text-[28px] text-white`}>{scene.sub}</div>
          </div>
          <style>{`@keyframes pxbBand{from{transform:rotate(-4deg) scaleX(0)}to{transform:rotate(-4deg) scaleX(1)}}@keyframes pxbSlide{from{opacity:0;transform:translateX(120px)}to{opacity:1;transform:none}}`}</style>
        </div>
      )}
      {/* 왼쪽 위: 챕터 이름 */}
      {stage > 0 && (
        <div className="absolute top-4 left-5 rounded-xl border border-[#FF8A3D]/60 bg-black/65 px-4 py-1.5">
          <span className={`${font.title} text-[18px] text-[#FF8A3D]`}>{scene.title}</span>
          <span className={`${font.title} ml-2 text-[16px] text-white/85`}>{scene.sub}</span>
        </div>
      )}
      {stage > 0 && stage < 3 && (
        <div className="absolute top-4 right-5 z-10 flex gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          {stage === 1 && !end && (
            <button
              type="button"
              className="cursor-pointer rounded-lg border px-3 py-1 text-[12.5px]"
              style={{ borderColor: seen ? "#ffd23f" : "rgba(255,255,255,0.2)", background: seen ? "#ffd23f26" : "rgba(0,0,0,0.6)", color: seen ? "#ffd23f" : "rgba(255,255,255,0.8)" }}
              onClick={() => {
                sfx.ui();
                setI(lines.length - 1);
              }}
            >
              {seen ? "본 장면 — 바로 넘기기 ⏭" : "건너뛰기 ⏭"}
            </button>
          )}
          {i > 0 && (
            <button type="button" className="cursor-pointer rounded-lg border border-white/20 bg-black/60 px-3 py-1 text-[12.5px] text-white/80" onClick={() => setLog((v) => !v)}>
              로그
            </button>
          )}
        </div>
      )}
      {/* 말하는 사람 */}
      {stage > 0 && stage < 3 && sp.img && (
        <img
          key={cur.who}
          src={sp.img}
          alt={sp.name}
          className={`pointer-events-none absolute object-contain drop-shadow-[0_0_30px_rgba(0,0,0,0.7)] ${sp.full ? "right-[40px] bottom-[18px] h-[500px] w-auto" : "right-[70px] bottom-[150px] h-[340px] w-[340px] rounded-[28px]"}`}
          style={{
            animation: "pxbIn 0.18s ease-out both",
            ...(sp.full ? {} : { background: `radial-gradient(circle at 50% 60%, ${sp.color}55 0%, transparent 70%)`, maskImage: "linear-gradient(180deg, #000 72%, transparent 100%)", WebkitMaskImage: "linear-gradient(180deg, #000 72%, transparent 100%)" }),
          }}
        />
      )}
      <style>{`@keyframes pxbIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
      {log && (
        <div className="absolute top-[64px] left-1/2 z-20 max-h-[300px] w-[560px] -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/15 bg-black/85 p-4 text-left text-[14px] leading-relaxed text-white/85">
          {lines.slice(0, i + 1).map((l, k) => {
            const s = who(l.who, c);
            return (
              <div key={k} className="mb-1">
                {s.name && <b style={{ color: s.color }}>{s.name}: </b>}
                {l.text}
              </div>
            );
          })}
        </div>
      )}
      {/* 대화창 */}
      {stage > 0 && stage < 3 && (
        <div className="absolute bottom-5 left-5 w-[680px] rounded-2xl border-2 bg-[#0d1124]/95 px-5 py-4 shadow-2xl" style={{ borderColor: `${sp.color}aa` }}>
          {sp.name && (
            <div className={`${font.title} absolute -top-[18px] left-4 rounded-lg px-3 py-0.5 text-[17px] text-black`} style={{ background: sp.color }}>
              {sp.role && sp.role !== "나" ? <span className="mr-1 text-[13px] opacity-70">{sp.role}</span> : null}
              {sp.name}
            </div>
          )}
          <div className={`min-h-[52px] text-[17px] leading-relaxed ${cur.who === "narr" ? "text-[#c9d2ff] italic" : "text-white/95"}`}>{cur.text}</div>
          {stage === 1 && end && scene.choices && (
            <div className="mt-3 flex flex-col gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
              {scene.choices.map((ch, k) => (
                <Btn
                  key={k}
                  className="flex items-center gap-2 px-3 py-2 text-left text-[15px]"
                  onClick={() => {
                    sfx.ui();
                    setPick(k);
                    setStage(2);
                  }}
                >
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-white/15 text-[13px]">{k + 1}</span>
                  <span>{ch.text}</span>
                </Btn>
              ))}
            </div>
          )}
          {stage === 2 && pick >= 0 && scene.choices && (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(scene.choices[pick].fx).map(([k, v]) => (
                <span key={k} className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-bold text-[#ffd23f]">
                  {k === "cond" ? "컨디션 ↑" : k === "sp" ? `스킬P +${v}` : `자금 +${v}`}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1 text-right text-[11px] text-white/40">{stage === 1 && end && scene.choices ? "고르기" : stage === 1 && !end ? `눌러서 넘기기 ▶ ${i + 1}/${lines.length}` : "눌러서 계속 ▶"}</div>
        </div>
      )}
      {/* 감독 지시 카드 */}
      {stage === 3 && scene.order && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="flex w-[520px] items-center gap-4 rounded-2xl border-2 border-[#ffcf4a] bg-[#0d1124]/95 p-5 shadow-2xl" style={{ animation: "pxbIn 0.25s ease-out both" }}>
            <img src={CAST.oh.img} alt={CAST.oh.name} className="h-[110px] w-[110px] rounded-xl bg-[#ffcf4a]/20 object-cover" />
            <div className="flex-1">
              <div className={`${font.title} text-[15px] text-[#ffcf4a]`}>이번 주 감독 지시</div>
              <div className={`${font.title} mt-1 text-[28px] text-white`}>{orderText(scene.order)}</div>
              <div className="mt-1 text-[13px] text-white/70">
                {TRAINS[scene.order.key].name}을 이번 주 안에 {scene.order.need}번 하면 스킬P +{ORDER_REWARD.sp} · 자금 +{ORDER_REWARD.money}
              </div>
              <div className="mt-2 text-right text-[11px] text-white/40">눌러서 연습장으로 ▶</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 경기 전 · 경기 뒤 한두 줄 (얼굴 + 이름 + 말) */
export function StoryLines({ c, lines }: { c: Career; lines: SLine[] }) {
  if (!lines.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {lines.map((l, k) => {
        const s = who(l.who, c);
        const w = l.who;
        const img = isCast(w) ? CAST[w].img : w !== "me" && w !== "narr" ? faceUrl(w) : null;
        return (
          <div key={k} className="flex items-center gap-2 rounded-xl bg-black/35 px-2 py-1.5">
            {img && <img src={img} alt={s.name} className="h-[40px] w-[40px] shrink-0 rounded-lg object-cover object-top" style={{ background: `${s.color}33` }} />}
            <div className="min-w-0 text-[13px] leading-snug">
              <b style={{ color: s.color }}>
                {s.role && s.role !== "나" ? `${s.role} ` : ""}
                {s.name}
              </b>
              <span className="ml-1.5 text-white/85">{l.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
