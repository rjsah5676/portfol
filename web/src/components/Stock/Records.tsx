"use client";

import { useEffect, useState } from "react";
import { STOCKS } from "@/lib/stock/battle";
import { PRESETS, PRESET_IDS } from "@/lib/stock/solo";
import type { BRecords, SoloHistoryRow, StockMe, StockRankRow } from "@/lib/stock/types";
import { battleRecords, getRank, soloHistory } from "@/realtime/stock";
import { Avatar, Btn, C, Empty, NUM, TopBar, WalletChip, mult, pct, signColor, won } from "./ui";

/*
 * 명예의 전당: 총자산 순위 · 주간 손익 순위 · 내 솔로 기록(복기) · 내 대전 전적.
 */

export type RecTab = "assets" | "week" | "solo" | "battle";

export default function Records({
  me,
  total,
  tab: tab0,
  onBack,
  onReview,
  onBattleGame,
}: {
  me: StockMe | null;
  total: number | null;
  tab?: RecTab;
  onBack: () => void;
  onReview: (id: string) => void;
  onBattleGame: (id: string) => void;
}) {
  const [tab, setTab] = useState<RecTab>(tab0 ?? "assets");
  const [rank, setRank] = useState<StockRankRow[] | null>(null);
  const [solo, setSolo] = useState<SoloHistoryRow[] | null>(null);
  const [battle, setBattle] = useState<BRecords | null>(null);
  useEffect(() => {
    if (tab === "assets" || tab === "week") void getRank(tab).then(setRank, () => setRank([]));
    else if (tab === "solo") void soloHistory().then(setSolo, () => setSolo([]));
    else void battleRecords().then(setBattle, () => setBattle({ stats: { games: 0, wins: 0, rankSum: 0, best: null, top3: 0 }, list: [] }));
  }, [tab]);

  const TABS: [RecTab, string][] = [
    ["assets", "총자산 순위"],
    ["week", "주간 손익"],
    ["solo", "내 솔로"],
    ["battle", "내 대전"],
  ];
  return (
    <div className="flex h-full flex-col">
      <TopBar onBack={onBack} title="명예의 전당" right={<WalletChip value={total} />}>
        <div className="flex gap-[4px]">
          {TABS.map(([k, t]) => (
            <Btn key={k} active={tab === k} className="h-[26px] px-[10px] text-[12px]" onClick={() => setTab(k)}>
              {t}
            </Btn>
          ))}
        </div>
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto p-[10px]">
        {(tab === "assets" || tab === "week") &&
          (rank === null ? (
            <Empty>불러오는 중…</Empty>
          ) : !rank.length ? (
            <Empty>{tab === "week" ? "이번 주에 끝난 솔로 판이 아직 없어요." : "아직 순위가 없어요."}</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-[6px]">
              {rank.map((r, k) => (
                <div key={k} className="flex items-center gap-[8px] rounded-[8px] px-[8px] py-[6px]" style={{ background: r.nick === me?.nick ? C.goldBg : C.panel2, border: `1px solid ${r.nick === me?.nick ? C.gold : C.line}` }}>
                  <span className={`w-[22px] text-center text-[14px] font-black ${NUM}`} style={{ color: k < 3 ? C.gold : C.mute }}>
                    {k + 1}
                  </span>
                  <Avatar look={r.look} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold">{r.nick}</div>
                    <div className={`text-[10px] ${NUM}`} style={{ color: C.mute }}>
                      {tab === "assets" ? `${r.games}판 · 솔로 승률 ${Math.round(r.sub * 100)}%` : `이번 주 ${r.sub}판`}
                    </div>
                  </div>
                  <b className={`text-[13px] ${NUM}`} style={{ color: tab === "week" ? signColor(r.value) : C.text }}>
                    {tab === "week" && r.value > 0 ? "+" : ""}
                    {won(r.value)}
                  </b>
                </div>
              ))}
            </div>
          ))}
        {tab === "solo" && (
          <div className="flex flex-col gap-[8px]">
            {me && (
              <div className="grid grid-cols-5 gap-[6px]">
                <Card k="판 수" v={`${me.solo.games}`} />
                <Card k="승률" v={me.solo.games ? `${Math.round((me.solo.wins / me.solo.games) * 100)}%` : "-"} />
                <Card k="평균 수익률" v={me.solo.games ? pct(me.solo.sumRet / me.solo.games) : "-"} />
                <Card k="최고" v={me.solo.best !== null ? pct(me.solo.best) : "-"} color={C.up} />
                <Card k="최저" v={me.solo.worst !== null ? pct(me.solo.worst) : "-"} color={C.down} />
              </div>
            )}
            {me && me.solo.games > 0 && (
              <div className="flex flex-wrap gap-[6px] text-[11px]">
                {PRESET_IDS.map((p) => {
                  const s = me.solo.byPreset[p];
                  return (
                    <span key={p} className="rounded-full px-[10px] py-[3px]" style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.mute }}>
                      {PRESETS[p].name} <b style={{ color: C.text }}>{s?.games ? `${Math.round((s.wins / s.games) * 100)}%` : "-"}</b> ({s?.games ?? 0}판)
                    </span>
                  );
                })}
              </div>
            )}
            {solo === null ? (
              <Empty>불러오는 중…</Empty>
            ) : !solo.length ? (
              <Empty>아직 끝낸 판이 없어요.</Empty>
            ) : (
              solo.map((g) => (
                <button key={g.id} type="button" onClick={() => onReview(g.id)} className="flex cursor-pointer items-center gap-[10px] rounded-[8px] px-[10px] py-[6px] text-left" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
                  <span className={`w-[70px] text-[11px] ${NUM}`} style={{ color: C.mute }}>
                    {new Date(g.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} {new Date(g.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="w-[110px] truncate text-[13px] font-bold">{g.name}</span>
                  <span className="w-[54px] text-[11px]" style={{ color: C.gold }}>
                    {PRESETS[g.preset].name}
                  </span>
                  <span className={`w-[70px] text-right text-[13px] font-bold ${NUM}`} style={{ color: signColor(g.ret) }}>
                    {pct(g.ret)}
                  </span>
                  <span className={`flex-1 text-right text-[12px] ${NUM}`} style={{ color: signColor(g.pnl) }}>
                    {g.pnl >= 0 ? "+" : ""}
                    {won(g.pnl)}
                  </span>
                  <span className="text-[11px]" style={{ color: C.mute }}>
                    복기 ›
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        {tab === "battle" &&
          (battle === null ? (
            <Empty>불러오는 중…</Empty>
          ) : (
            <div className="flex flex-col gap-[8px]">
              <div className="grid grid-cols-5 gap-[6px]">
                <Card k="판 수" v={`${battle.stats.games}`} />
                <Card k="1등" v={`${battle.stats.wins}번`} color={C.gold} />
                <Card k="평균 순위" v={battle.stats.games ? (battle.stats.rankSum / battle.stats.games).toFixed(1) : "-"} />
                <Card k="최고 배수" v={battle.stats.best !== null ? mult(battle.stats.best) : "-"} color={C.up} />
                <div className="flex flex-col rounded-[8px] px-[8px] py-[6px]" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
                  <span className="text-[10px]" style={{ color: C.mute }}>
                    최근 10판 순위
                  </span>
                  <div className="mt-[4px] flex h-[24px] items-end gap-[2px]">
                    {battle.list
                      .slice(0, 10)
                      .reverse()
                      .map((g) => (
                        <i key={g.id} className="w-[6px] rounded-[2px]" style={{ height: `${Math.max(12, 100 - ((g.rank - 1) / Math.max(1, g.n - 1)) * 88)}%`, background: g.rank === 1 ? C.gold : C.chipLine }} />
                      ))}
                  </div>
                </div>
              </div>
              {!battle.list.length ? (
                <Empty>아직 대전 기록이 없어요.</Empty>
              ) : (
                battle.list.map((g) => (
                  <button key={g.id} type="button" onClick={() => onBattleGame(g.id)} className="flex cursor-pointer items-center gap-[10px] rounded-[8px] px-[10px] py-[6px] text-left" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
                    <span className={`w-[70px] text-[11px] ${NUM}`} style={{ color: C.mute }}>
                      {new Date(g.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} {new Date(g.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`w-[60px] text-[14px] font-black ${NUM}`} style={{ color: g.rank === 1 ? C.gold : C.text }}>
                      {g.rank}
                      <span className="text-[11px] font-normal" style={{ color: C.mute }}>
                        /{g.n}
                      </span>
                    </span>
                    <span className={`w-[70px] text-[13px] font-bold ${NUM}`} style={{ color: signColor(g.mult - 1) }}>
                      {mult(g.mult)}
                    </span>
                    <span className="w-[80px] text-[11px]" style={{ color: C.mute }}>
                      {g.main !== null ? `주력 ${STOCKS[g.main].name}` : "-"}
                    </span>
                    <span className="flex-1 text-[11px]" style={{ color: C.mute }}>
                      사람 {g.humans} · 봇 {g.bots}
                      {g.humans === 1 && <span className="ml-[4px] rounded-[4px] px-[4px]" style={{ background: C.chip }}>봇전</span>}
                    </span>
                    <span className="text-[11px]" style={{ color: C.mute }}>
                      결과 ›
                    </span>
                  </button>
                ))
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

const Card = ({ k, v, color }: { k: string; v: string; color?: string }) => (
  <div className="flex flex-col rounded-[8px] px-[8px] py-[6px]" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
    <span className="text-[10px]" style={{ color: C.mute }}>
      {k}
    </span>
    <b className={`text-[15px] ${NUM}`} style={{ color: color ?? C.text }}>
      {v}
    </b>
  </div>
);
