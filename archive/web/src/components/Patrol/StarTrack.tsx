"use client";

/*
 * 픽셀 순찰대 — 별 보상 트랙: 스테이지 별을 모은 만큼 칸마다 보상 (받을 수 있는 칸은 한 번에)
 */
import { useState, type CSSProperties } from "react";
import { STAR_TRACK } from "@/lib/patrol/economy";
import { GRADE_NAME, type GGrade } from "@/lib/patrol/gear";
import { giveText } from "@/lib/patrol/shop";
import { WEAPONS, type WeaponId } from "@/lib/survivor/data";
import { patrol, type PatrolProfile } from "@/realtime/patrol";
import { sfx } from "../Survivor/audio";
import { Modal, btn } from "./ui";

const wname = (w: WeaponId) => WEAPONS[w].name;
const gname = (g: GGrade) => GRADE_NAME[g];
/** 지금 받을 수 있는 칸 수 */
export const starReady = (p: PatrolProfile) => STAR_TRACK.slice(p.starTrack).filter((x) => p.starSum >= x.n).length;
/** 다음 칸 (다 받았으면 null) */
export const starNext = (p: PatrolProfile) => STAR_TRACK[p.starTrack] ?? null;

export default function StarTrack({ prof, onProf, onClose }: { prof: PatrolProfile; onProf(p: PatrolProfile): void; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; c: string } | null>(null);
  const ready = starReady(prof);
  const max = STAR_TRACK[STAR_TRACK.length - 1].n;
  const claim = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await patrol.starClaim();
      onProf(r.profile);
      sfx("legend");
      setMsg({ t: `받았어요 — ${r.got.flatMap((x) => giveText(x.give, wname, gname)).join(" · ")}`, c: "#4ff0c8" });
    } catch (e) {
      sfx("warn");
      setMsg({ t: (e as Error).message, c: "#ff8fb8" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="별 보상" sub="스테이지 별(클리어 · 목표 · 보스 시간)을 모으면 칸마다 보상 — 챕터가 늘면 칸도 늘어요" onClose={onClose} w={820}>
      <div className="mt-[12px] flex items-center gap-[12px]">
        <b className="pts-title text-[30px] text-[#ffd23a]">★ {prof.starSum}</b>
        <div className="pts-bar h-[12px] flex-1" style={{ "--c": "#ffd23a" } as CSSProperties}>
          <i style={{ width: `${Math.min(100, (prof.starSum / max) * 100)}%` }} />
        </div>
        <span className="text-[12px] text-[#a9a2d6]">/ {max}</span>
      </div>
      <div className="mt-[14px] grid grid-cols-9 gap-[8px]">
        {STAR_TRACK.map((x, i) => {
          const got = i < prof.starTrack;
          const can = !got && prof.starSum >= x.n;
          const c = got ? "#4a4290" : can ? "#ffd23a" : "#2a2468";
          return (
            <div key={x.n} className="flex flex-col items-center gap-[4px] px-[4px] py-[8px] text-center" style={{ background: can ? "#3a2f8a" : "#16123d", boxShadow: `0 0 0 2px ${c}`, opacity: got ? 0.55 : 1 }}>
              <b className="text-[13px]" style={{ color: can ? "#ffd23a" : "#e8e4ff" }}>
                ★{x.n}
              </b>
              {giveText(x.give, wname, gname).map((t) => (
                <span key={t} className="text-[10px] leading-[13px] text-[#e8e4ff]">
                  {t}
                </span>
              ))}
              <span className="mt-auto text-[10px]" style={{ color: got ? "#6b63a3" : can ? "#ffd23a" : "#6b63a3" }}>
                {got ? "받음" : can ? "받기!" : `${x.n - prof.starSum}개 더`}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-[14px] flex items-center gap-[12px]">
        <span className="text-[12px]" style={{ color: msg?.c ?? "#a9a2d6" }}>
          {msg ? msg.t : "별 3개: 클리어 · 체력 50% 이상(특수 판은 목표) · 보스 빨리 처치"}
        </span>
        <button type="button" disabled={!ready || busy} onClick={() => void claim()} className="pts-btn ml-auto h-[40px] w-[180px] text-[15px]" style={btn("#ffd23a")}>
          {ready ? `${ready}칸 받기` : "모으는 중"}
        </button>
      </div>
    </Modal>
  );
}
