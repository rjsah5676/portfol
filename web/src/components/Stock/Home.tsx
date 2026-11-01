"use client";

import { useEffect, useState } from "react";
import { HOME_TYPES, LOT_NAMES, homeRank, homeType } from "@/lib/stock/estate";
import type { HomeView } from "@/lib/stock/types";
import { getHome } from "@/realtime/stock";
import { Avatar, Btn, C, Empty, NUM, TopBar, WalletChip, won } from "./ui";

/*
 * 집 안 — 내 집이든 남의 집이든 들어가 봄 (GTA 식). 지금은 집 종류별 분위기(배경 톤) + 명패 + 가진 집 목록 + 방문 수.
 * 가구는 아직 없음: furniture 칸이 비어 있고, 나중에 상점에서 산 가구를 여기 좌표로 놓는 구조.
 * 아트가 들어오면 집 종류별 실내 그림(HOME_TYPES.id → img) 으로 배경을 바꿈.
 */

export default function Home({
  uid,
  me,
  total,
  w,
  onBack,
  onEstate,
  toast,
}: {
  /** 비어 있으면 내 집 */
  uid: string;
  me: string;
  total: number | null;
  w: number;
  onBack: () => void;
  /** 집이 없을 때 부동산으로 */
  onEstate: () => void;
  toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void;
}) {
  // 어느 집을 불러왔는지 같이 들고 있어서, uid 가 바뀌면 자연히 「여는 중」으로 돌아감
  const [got, setGot] = useState<{ uid: string; v: HomeView | null; entered: boolean } | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getHome(uid || undefined).then(
      (x) => {
        if (!live) return;
        setGot({ uid, v: x, entered: false });
        setPick(x.best?.id ?? null);
        setTimeout(() => live && setGot((g) => (g && g.uid === uid ? { ...g, entered: true } : g)), 50);
      },
      (e) => {
        if (!live) return;
        setGot({ uid, v: null, entered: false });
        toast((e as Error).message, "warn");
      }
    );
    return () => {
      live = false;
    };
  }, [uid, toast]);
  const v = got?.uid === uid ? got.v : undefined;
  const entered = got?.uid === uid && got.entered;
  if (v === undefined) return <Empty>문을 여는 중…</Empty>;
  if (!v)
    return (
      <div className="flex h-full flex-col">
        <TopBar onBack={onBack} title="집" right={<WalletChip value={total} />} />
        <div className="flex flex-1 flex-col items-center justify-center gap-[10px]">
          <div className="text-[13px]" style={{ color: C.mute }}>
            {uid && uid !== me ? "아직 집이 없는 분이에요." : "아직 집이 없어요."}
          </div>
          {(!uid || uid === me) && (
            <Btn tone="gold" className="h-[40px] px-[16px]" onClick={onEstate}>
              부동산에서 집 사기
            </Btn>
          )}
        </div>
      </div>
    );
  const cur = v.homes.find((x) => x.id === pick) ?? v.best;
  const t = cur ? homeType(cur.type) : null;
  const rank = cur ? homeRank(cur.type) : 0;
  const label = cur ? (cur.lot ? LOT_NAMES[cur.lot] : `${cur.no}호 ${t?.name ?? ""}`) : "";
  // 실내 분위기: 등급이 높을수록 넓고 밝은 방 (아트 전 자리표시)
  const roomW = Math.round(Math.min(w - 260, 420 + rank * 40));

  return (
    <div className="flex h-full flex-col">
      <TopBar onBack={onBack} title={v.mine ? "내 집" : `${v.owner.nick}의 집`} right={<WalletChip value={total} />}>
        {v.homes.length > 1 && (
          <select value={cur?.id ?? ""} onChange={(e) => setPick(e.target.value)} className="h-[26px] rounded-[6px] px-[6px] text-[11px]" style={{ background: C.chip, border: `1px solid ${C.chipLine}`, color: C.text }}>
            {v.homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.lot ? LOT_NAMES[h.lot] : `${h.no}호 ${homeType(h.type)?.name}`}
              </option>
            ))}
          </select>
        )}
      </TopBar>
      <div className="relative flex min-h-0 flex-1">
        {/* 방 (아트 전: 종류별 톤 + 창문 + 바닥) */}
        <div className={`relative flex flex-1 items-end justify-center overflow-hidden ${entered ? "stk-enter" : ""}`} style={{ background: `radial-gradient(ellipse at 50% 20%, ${t?.tone ?? "#2f3542"} 0%, #0f1420 90%)` }}>
          <div className="absolute" style={{ left: "50%", top: "12%", width: roomW * 0.28, height: roomW * 0.2, transform: "translateX(-50%)", background: rank >= 5 ? "linear-gradient(180deg,#c9e6ff,#5aa0e6)" : "linear-gradient(180deg,#8ea6c4,#3f5e86)", borderRadius: 6, border: "4px solid #1b2232", boxShadow: "0 0 40px rgba(120,170,255,0.25)" }} />
          <div className="absolute bottom-0 left-0 right-0" style={{ height: "34%", background: `linear-gradient(180deg, ${t?.tone ?? "#2f3542"}cc, #0b0f18)`, borderTop: `2px solid ${C.line}` }} />
          {/* 가구 칸 (비어 있음) */}
          {v.furniture.length === 0 && (
            <div className="absolute bottom-[14%] left-1/2 -translate-x-1/2 rounded-[8px] px-[10px] py-[4px] text-[10px]" style={{ background: "rgba(10,13,22,0.6)", border: `1px dashed ${C.chipLine}`, color: C.mute }}>
              가구는 곧 상점에서 · 지금은 빈 방
            </div>
          )}
          {/* 명패 */}
          <div className="absolute top-[10px] left-[12px] flex items-center gap-[8px] rounded-[10px] px-[10px] py-[6px]" style={{ background: "rgba(10,13,22,0.75)", border: `1px solid ${C.gold}` }}>
            <Avatar look={v.owner.look} size={30} ring={C.gold} />
            <div>
              <div className="text-[13px] font-black" style={{ color: C.gold }}>
                {v.owner.nick}
              </div>
              <div className={`text-[10px] ${NUM}`} style={{ color: C.mute }}>
                {label}
              </div>
            </div>
          </div>
          <div className="absolute right-[12px] bottom-[10px] text-[10px]" style={{ color: C.mute }}>
            방문 {v.visits}번
          </div>
        </div>
        <div className="flex w-[230px] flex-col gap-[6px] p-[10px]" style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }}>
          <div className="text-[12px] font-bold">{v.mine ? "내 집" : `${v.owner.nick}의 집`} · {v.homes.length}채</div>
          <div className="text-[10px]" style={{ color: C.mute }}>
            집값 합 <b className={NUM} style={{ color: C.text }}>{won(v.value)}</b> · 출석 +{won(v.daily)}/일
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-[4px] overflow-y-auto">
            {v.homes.map((h) => {
              const ht = homeType(h.type);
              return (
                <button key={h.id} type="button" onClick={() => setPick(h.id)} className="flex cursor-pointer items-center gap-[6px] rounded-[8px] px-[8px] py-[5px] text-left" style={{ background: h.id === cur?.id ? C.goldBg : C.panel2, border: `1px solid ${h.id === cur?.id ? C.gold : C.line}` }}>
                  <span className="h-[10px] w-[10px] rounded-full" style={{ background: ht?.tone }} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[11px] font-bold ${NUM}`}>{h.lot ? LOT_NAMES[h.lot] : `${h.no}호`}</div>
                    <div className="truncate text-[9px]" style={{ color: C.mute }}>
                      {ht?.name} · {HOME_TYPES.length - homeRank(h.type)}등급
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {v.mine ? (
            <Btn className="h-[34px] text-[12px]" onClick={onEstate}>
              🏠 부동산으로
            </Btn>
          ) : (
            <div className="text-[10px]" style={{ color: C.mute }}>
              놀러 왔어요 · 이 집 주인의 집값 순위는 부동산 명패에서
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
