"use client";

import { useEffect, useState } from "react";
import { HOME_TYPES, LOT_NAMES, homeRank, homeType } from "@/lib/stock/estate";
import type { HomeView } from "@/lib/stock/types";
import { getHome } from "@/realtime/stock";
import { bgm, sfx } from "@/lib/stock/sound";
import { AmyIdle } from "./Village";
import { Avatar, Btn, C, Empty, NUM, TopBar, WalletChip, won } from "./ui";

/** 집 등급 → 실내 그림 (0~3 원룸 · 4~7 아파트 · 8~9 저택) */
const interiorOf = (rank: number) => (rank >= 8 ? "mansion" : rank >= 4 ? "apt" : "small");

/*
 * 집 안 — 내 집이든 남의 집이든 들어가 봄 (GTA 식). 실내 그림 3종(원룸 · 아파트 · 저택, 35° 쿼터뷰) 위에 에이미가 서 있고, 명패 + 가진 집 목록 + 방문 수.
 * 가구는 아직 없음: furniture 칸이 비어 있고, 나중에 상점에서 산 가구를 그림 좌표(1536×1024 기준)로 놓는 구조.
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
    sfx("home");
    bgm("home");
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
  // 실내 그림(1536×1024)을 방 칸(화면 폭 − 오른쪽 패널 230)에 맞춤 — 세로를 채우고 가로는 잘릴 수 있음
  const roomScale = Math.max((w - 230) / 1536, 420 / 1024);

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
        {/* 방 — 실내 그림을 화면에 꽉 채움 (가운데 기준) · 에이미는 현관 앞 */}
        <div className={`relative flex-1 overflow-hidden ${entered ? "stk-enter" : ""}`} style={{ background: "#0b0f18" }}>
          <div className="absolute" style={{ left: "50%", top: "50%", width: 1536, height: 1024, transform: `translate(-50%, -50%) scale(${roomScale})` }}>
            <img src={`/stock/village/home_${interiorOf(rank)}.webp`} alt="" draggable={false} className="absolute top-0 left-0" style={{ width: 1536, height: 1024 }} />
            <AmyIdle x={768} y={900} scale={1.7} dir="front" />
            {/* 가구 칸 (비어 있음) */}
            {v.furniture.length === 0 && (
              <div className="absolute rounded-[12px] px-[18px] py-[8px] text-[24px]" style={{ left: 768, top: 600, transform: "translateX(-50%)", background: "rgba(10,13,22,0.55)", border: `1px dashed ${C.chipLine}`, color: C.mute }}>
                가구는 곧 상점에서 · 지금은 빈 방
              </div>
            )}
          </div>
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
