"use client";

import { useEffect, useState } from "react";
import { LANDMARKS, MAX_UNITS, RESALE, UNIT_TYPES, resaleOf, unitType } from "@/lib/stock/estate";
import type { EstateView } from "@/lib/stock/types";
import { bidLot, buyUnit, getEstate, sellUnit } from "@/realtime/stock";
import { Avatar, Btn, C, Empty, NUM, Sheet, TopBar, WalletChip, won } from "./ui";

/*
 * 부동산 · 경매장 + 주식 아파트.
 * 집은 임대수익 없이 가격 고정 · 되팔면 90% → 사는 이유는 ① 꼴아박기 보험 ② 과시 (명패 · 이름표).
 */

export default function Estate({
  total,
  cash,
  onBack,
  onChanged,
  toast,
}: {
  total: number | null;
  cash: number;
  onBack: () => void;
  onChanged: () => void;
  toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void;
}) {
  const [v, setV] = useState<EstateView | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [tab, setTab] = useState<"apt" | "lot">("apt");
  const [ask, setAsk] = useState<null | { kind: "buy"; type: string } | { kind: "sell"; id: string } | { kind: "bid"; lot: string; amount: number }>(null);
  const load = () =>
    void getEstate().then(
      (x) => (setV(x), setLoadedAt(Date.now())),
      (e) => toast((e as Error).message, "warn")
    );
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (p: Promise<EstateView>, ok: string) => {
    try {
      setV(await p);
      toast(ok, "up");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "warn");
    } finally {
      setAsk(null);
    }
  };
  const left = v ? Math.max(0, v.endsAt - loadedAt) : 0;
  const days = Math.floor(left / 86400_000);

  return (
    <div className="flex h-full flex-col">
      <TopBar onBack={onBack} title="부동산 · 경매장" right={<WalletChip value={total} />}>
        <div className="flex gap-[4px]">
          <Btn active={tab === "apt"} className="h-[26px] px-[10px] text-[12px]" onClick={() => setTab("apt")}>
            🏢 주식 아파트
          </Btn>
          <Btn active={tab === "lot"} className="h-[26px] px-[10px] text-[12px]" onClick={() => setTab("lot")}>
            🏡 명당 경매
          </Btn>
        </div>
      </TopBar>
      {!v ? (
        <Empty>불러오는 중…</Empty>
      ) : tab === "apt" ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto p-[10px]">
            <div className="grid grid-cols-4 gap-[8px]">
              {UNIT_TYPES.map((u) => (
                <div key={u.id} className="flex flex-col gap-[4px] rounded-[10px] p-[10px]" style={{ background: C.panel2, border: `1px solid ${u.id === "ph" ? C.gold : C.line}` }}>
                  <div className="text-[14px] font-black" style={{ color: u.id === "ph" ? C.gold : C.text }}>
                    {u.name}
                  </div>
                  <div className={`text-[13px] font-bold ${NUM}`}>{won(u.price)}</div>
                  <div className="min-h-[28px] text-[10px] leading-snug" style={{ color: C.mute }}>
                    {u.blurb}
                  </div>
                  <Btn tone="gold" className="h-[32px] text-[12px]" disabled={cash < u.price || v.units.length >= MAX_UNITS} onClick={() => setAsk({ kind: "buy", type: u.id })}>
                    분양받기
                  </Btn>
                </div>
              ))}
            </div>
            <div className="text-[12px] font-bold">내 호실 ({v.units.length}/{MAX_UNITS})</div>
            {v.units.length ? (
              <div className="grid grid-cols-3 gap-[6px]">
                {v.units.map((u) => {
                  const t = unitType(u.type);
                  return (
                    <div key={u.id} className="flex items-center gap-[6px] rounded-[8px] px-[8px] py-[6px]" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
                      <div className="flex-1">
                        <div className={`text-[13px] font-bold ${NUM}`}>{u.no}호</div>
                        <div className="text-[10px]" style={{ color: C.mute }}>
                          {t?.name} · 되팔면 {won(resaleOf(t?.price ?? 0))}
                        </div>
                      </div>
                      <Btn tone="ghost" className="h-[26px] px-[8px] text-[11px]" onClick={() => setAsk({ kind: "sell", id: u.id })}>
                        팔기
                      </Btn>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[8px] p-[10px] text-[11px]" style={{ background: C.panel2, color: C.mute }}>
                아직 집이 없어요. 집으로 바꾼 돈은 주식으로 날릴 수 없어요 (되팔면 {Math.round(RESALE * 100)}%를 돌려받아요).
              </div>
            )}
          </div>
          <div className="flex w-[240px] flex-col gap-[6px] p-[10px]" style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }}>
            <div className="text-[12px] font-bold" style={{ color: C.gold }}>
              🏢 입구 명패 TOP 5
            </div>
            {v.plate.length ? (
              v.plate.map((p, k) => (
                <div key={k} className="flex items-center gap-[6px] rounded-[8px] px-[6px] py-[4px]" style={{ background: C.panel2 }}>
                  <span className={`w-[14px] text-[12px] font-black ${NUM}`} style={{ color: k === 0 ? C.gold : C.mute }}>
                    {k + 1}
                  </span>
                  <Avatar look={p.look} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold">{p.nick}</div>
                    <div className="truncate text-[10px]" style={{ color: C.mute }}>
                      {p.top}
                    </div>
                  </div>
                  <span className={`text-[11px] font-bold ${NUM}`}>{won(p.value)}</span>
                </div>
              ))
            ) : (
              <div className="text-[11px]" style={{ color: C.mute }}>
                첫 입주자가 되어 보세요
              </div>
            )}
            <div className="mt-auto text-[10px]" style={{ color: C.mute }}>
              입주 {v.residents}세대 · 호실은 끝없이 늘어나요
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[6px] overflow-y-auto p-[10px]">
          <div className="text-[11px]" style={{ color: C.mute }}>
            {v.next} 시즌 주인을 뽑는 경매 · 마감까지 {days}일 · 입찰금은 바로 맡겨 두고, 더 높은 입찰이 오면 돌려받아요 · 낙찰되면 입찰금은 사라져요
          </div>
          <div className="grid grid-cols-2 gap-[6px]">
            {v.lots.map((l) => {
              const lm = LANDMARKS.find((x) => x.id === l.id)!;
              return (
                <div key={l.id} className="flex items-center gap-[8px] rounded-[10px] px-[10px] py-[8px]" style={{ background: C.panel2, border: `1px solid ${l.bid?.mine ? C.gold : C.line}` }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{l.name}</div>
                    <div className="flex items-center gap-[4px] text-[10px]" style={{ color: C.mute }}>
                      {l.owner ? (
                        <>
                          <Avatar look={l.owner.look} size={14} /> {l.owner.nick}의 집 ({l.ownerSeason})
                        </>
                      ) : (
                        "빈집"
                      )}
                    </div>
                    <div className={`text-[11px] ${NUM}`} style={{ color: l.bid ? C.text : C.mute }}>
                      {l.bid ? (
                        <>
                          최고 {won(l.bid.amount)} · {l.bid.mine ? <b style={{ color: C.gold }}>내 입찰</b> : l.bid.nick}
                        </>
                      ) : (
                        `시작가 ${won(lm.min)}`
                      )}
                    </div>
                  </div>
                  <Btn tone="gold" className="h-[32px] px-[10px] text-[12px]" disabled={cash < (l.bid?.mine ? l.minNext - l.bid.amount : l.minNext)} onClick={() => setAsk({ kind: "bid", lot: l.id, amount: l.minNext })}>
                    {won(l.minNext)}
                    <br />
                    입찰
                  </Btn>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ask && v && (
        <Sheet title="확인" onClose={() => setAsk(null)} width={340}>
          <div className="flex flex-col gap-[10px] p-[14px] text-[13px]">
            {ask.kind === "buy" && (
              <p>
                <b>{unitType(ask.type)?.name}</b>을 <b>{won(unitType(ask.type)?.price ?? 0)}</b>에 분양받을까요?
                <br />
                <span className="text-[11px]" style={{ color: C.mute }}>
                  되팔면 {won(resaleOf(unitType(ask.type)?.price ?? 0))}을 돌려받아요.
                </span>
              </p>
            )}
            {ask.kind === "sell" && <p>이 호실을 {won(resaleOf(unitType(v.units.find((u) => u.id === ask.id)?.type ?? "")?.price ?? 0))}에 팔까요?</p>}
            {ask.kind === "bid" && (
              <p>
                <b>{LANDMARKS.find((x) => x.id === ask.lot)?.name}</b>에 <b>{won(ask.amount)}</b>로 입찰할까요?
              </p>
            )}
            <div className="flex gap-[8px]">
              <Btn
                tone="gold"
                className="h-[42px] flex-1"
                onClick={() =>
                  void run(
                    ask.kind === "buy" ? buyUnit(ask.type) : ask.kind === "sell" ? sellUnit(ask.id) : bidLot(ask.lot, ask.amount),
                    ask.kind === "buy" ? "분양 완료!" : ask.kind === "sell" ? "팔았어요" : "입찰했어요"
                  )
                }
              >
                확인
              </Btn>
              <Btn tone="ghost" className="h-[42px] w-[80px]" onClick={() => setAsk(null)}>
                취소
              </Btn>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
