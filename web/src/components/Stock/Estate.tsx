"use client";

import { useEffect, useState } from "react";
import { DAILY, HOME_TYPES, LOT_NAMES, MAX_UNITS, RESALE, dailyOf, homeType, resaleOf } from "@/lib/stock/estate";
import type { EstateView } from "@/lib/stock/types";
import { attend, buyHome, getEstate, sellHome } from "@/realtime/stock";
import { Avatar, Btn, C, Empty, NUM, Sheet, TopBar, WalletChip, won } from "./ui";

/*
 * 부동산 — 집 10단계(고시원 → 언덕 위 대저택). 가격 고정 · 되팔면 50% · 집이 있으면 하루 한 번 출석 보너스(집값의 0.2%).
 * 단독형(저택 · 대저택)은 마을에 실제로 서 있는 자리를 선착순으로 삼. 산 집은 「내 집」에서 들어가 보고, 남의 집도 구경.
 */

export default function Estate({
  total,
  cash,
  onBack,
  onChanged,
  onVisit,
  toast,
}: {
  total: number | null;
  cash: number;
  onBack: () => void;
  onChanged: () => void;
  /** 남의 집 구경 */
  onVisit: (uid: string) => void;
  toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void;
}) {
  const [v, setV] = useState<EstateView | null>(null);
  const [tab, setTab] = useState<"buy" | "mine">("buy");
  const [ask, setAsk] = useState<null | { kind: "buy"; type: string; lot?: string } | { kind: "sell"; id: string }>(null);
  const load = () =>
    void getEstate().then(setV, (e) => toast((e as Error).message, "warn"));
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
  const claim = () =>
    void attend().then(
      (r) => {
        if (r) toast(`출석 보너스 +${won(r.amount)} (집 ${r.homes}채)`, "up");
        onChanged();
        load();
      },
      (e) => toast((e as Error).message, "warn")
    );
  const freeLots = (type: string) => v?.lots.filter((l) => l.type === type && !l.owner) ?? [];

  return (
    <div className="flex h-full flex-col">
      <TopBar onBack={onBack} title="부동산" right={<WalletChip value={total} />}>
        <div className="flex gap-[4px]">
          <Btn active={tab === "buy"} className="h-[26px] px-[10px] text-[12px]" onClick={() => setTab("buy")}>
            🏠 집 사기
          </Btn>
          <Btn active={tab === "mine"} className="h-[26px] px-[10px] text-[12px]" onClick={() => setTab("mine")}>
            🔑 내 집 {v?.units.length ? `(${v.units.length})` : ""}
          </Btn>
        </div>
      </TopBar>
      {!v ? (
        <Empty>불러오는 중…</Empty>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto p-[10px]">
            {tab === "buy" ? (
              <>
                <div className="text-[10px] leading-snug" style={{ color: C.mute }}>
                  집으로 바꾼 돈은 주식으로 날릴 수 없어요. 되팔면 {Math.round(RESALE * 100)}%를 돌려받고, 집이 있으면 하루 첫 방문 때 집값의 {(DAILY * 100).toFixed(1)}%를 출석 보너스로 받아요.
                </div>
                <div className="grid grid-cols-5 gap-[6px]">
                  {HOME_TYPES.map((u, k) => {
                    const house = u.kind === "house";
                    const left = house ? freeLots(u.id).length : null;
                    const top = k >= 7;
                    return (
                      <div key={u.id} className="flex flex-col gap-[3px] rounded-[10px] p-[8px]" style={{ background: `linear-gradient(180deg, ${u.tone}, ${C.panel2})`, border: `1px solid ${top ? C.gold : C.line}` }}>
                        <div className="text-[12px] font-black leading-tight" style={{ color: top ? C.gold : C.text }}>
                          {u.name}
                        </div>
                        <div className={`text-[12px] font-bold ${NUM}`}>{won(u.price)}</div>
                        <div className="min-h-[26px] text-[9px] leading-snug" style={{ color: C.mute }}>
                          {u.blurb}
                        </div>
                        <div className={`text-[9px] ${NUM}`} style={{ color: C.green }}>
                          출석 +{won(dailyOf(u.price))}/일
                        </div>
                        {house && (
                          <div className="text-[9px]" style={{ color: left ? C.text : C.up }}>
                            남은 자리 {left}/{u.lots!.length}
                          </div>
                        )}
                        <Btn tone="gold" className="h-[28px] text-[11px]" disabled={cash < u.price || v.units.length >= MAX_UNITS || (house && !left)} onClick={() => setAsk({ kind: "buy", type: u.id })}>
                          {house ? "자리 고르기" : "분양받기"}
                        </Btn>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] font-bold">마을의 단독주택 자리</div>
                <div className="grid grid-cols-5 gap-[4px]">
                  {v.lots.map((l) => (
                    <div key={l.lot} className="flex items-center gap-[4px] rounded-[8px] px-[6px] py-[4px] text-[10px]" style={{ background: C.panel2, border: `1px solid ${l.owner ? C.line : "#36C2A066"}` }}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">{l.name}</div>
                        <div className="truncate" style={{ color: C.mute }}>
                          {homeType(l.type)?.name}
                        </div>
                      </div>
                      {l.owner ? (
                        <button type="button" onClick={() => onVisit(l.owner!.uid)} className="flex cursor-pointer items-center gap-[3px]" title={`${l.owner.nick}의 집 구경`}>
                          <Avatar look={l.owner.look} size={18} />
                          <span className="max-w-[44px] truncate">{l.owner.nick}</span>
                        </button>
                      ) : (
                        <span style={{ color: C.green }}>빈 자리</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : v.units.length ? (
              <>
                <div className="flex items-center gap-[8px] rounded-[10px] px-[10px] py-[8px]" style={{ background: C.goldBg, border: `1px solid ${C.gold}` }}>
                  <div className="flex-1 text-[12px]">
                    <b style={{ color: C.gold }}>오늘 출석 보너스</b>{" "}
                    <span className={NUM}>+{won(v.daily.amount)}</span>
                    <div className="text-[10px]" style={{ color: C.mute }}>
                      집 {v.units.length}채 · 집값 합의 {(DAILY * 100).toFixed(1)}% · 하루 한 번
                    </div>
                  </div>
                  <Btn tone="gold" className="h-[34px] px-[12px] text-[12px]" disabled={v.daily.claimed} onClick={claim}>
                    {v.daily.claimed ? "오늘 받음" : "받기"}
                  </Btn>
                </div>
                <div className="grid grid-cols-3 gap-[6px]">
                  {v.units.map((u) => {
                    const t = homeType(u.type);
                    return (
                      <div key={u.id} className="flex items-center gap-[6px] rounded-[8px] px-[8px] py-[6px]" style={{ background: `linear-gradient(90deg, ${t?.tone ?? C.panel2}, ${C.panel2})`, border: `1px solid ${C.line}` }}>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-[12px] font-bold ${NUM}`}>{u.lot ? LOT_NAMES[u.lot] : `${u.no}호`}</div>
                          <div className="truncate text-[10px]" style={{ color: C.mute }}>
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
                <Btn className="h-[38px] text-[13px]" onClick={() => onVisit("")}>
                  🔑 내 집 들어가기
                </Btn>
              </>
            ) : (
              <div className="rounded-[8px] p-[10px] text-[11px]" style={{ background: C.panel2, color: C.mute }}>
                아직 집이 없어요. 「집 사기」에서 첫 집을 골라 보세요.
              </div>
            )}
          </div>
          <div className="flex w-[230px] flex-col gap-[6px] p-[10px]" style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }}>
            <div className="text-[12px] font-bold" style={{ color: C.gold }}>
              🏢 입구 명패 TOP 5
            </div>
            {v.plate.length ? (
              v.plate.map((p, k) => (
                <button key={k} type="button" onClick={() => onVisit(p.uid)} className="flex cursor-pointer items-center gap-[6px] rounded-[8px] px-[6px] py-[4px] text-left" style={{ background: C.panel2 }} title="집 구경">
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
                </button>
              ))
            ) : (
              <div className="text-[11px]" style={{ color: C.mute }}>
                첫 입주자가 되어 보세요
              </div>
            )}
            <div className="mt-auto text-[10px]" style={{ color: C.mute }}>
              입주 {v.residents}세대 · 이름을 누르면 그 집에 놀러 가요
            </div>
          </div>
        </div>
      )}

      {ask && v && (
        <Sheet title={ask.kind === "buy" ? "집 사기" : "집 팔기"} onClose={() => setAsk(null)} width={360}>
          <div className="flex flex-col gap-[10px] p-[14px] text-[13px]">
            {ask.kind === "buy" && (
              <>
                <p>
                  <b>{homeType(ask.type)?.name}</b>을 <b>{won(homeType(ask.type)?.price ?? 0)}</b>에 살까요?
                  <br />
                  <span className="text-[11px]" style={{ color: C.mute }}>
                    되팔면 {won(resaleOf(homeType(ask.type)?.price ?? 0))} · 출석 보너스 +{won(dailyOf(homeType(ask.type)?.price ?? 0))}/일
                  </span>
                </p>
                {homeType(ask.type)?.kind === "house" && (
                  <div className="grid grid-cols-2 gap-[4px]">
                    {freeLots(ask.type).map((l) => (
                      <Btn key={l.lot} active={ask.lot === l.lot} className="h-[30px] text-[11px]" onClick={() => setAsk({ ...ask, lot: l.lot })}>
                        {l.name}
                      </Btn>
                    ))}
                  </div>
                )}
              </>
            )}
            {ask.kind === "sell" && <p>이 집을 {won(resaleOf(homeType(v.units.find((u) => u.id === ask.id)?.type ?? "")?.price ?? 0))}에 팔까요? (산 값의 {Math.round(RESALE * 100)}%)</p>}
            <div className="flex gap-[8px]">
              <Btn
                tone="gold"
                className="h-[42px] flex-1"
                disabled={ask.kind === "buy" && homeType(ask.type)?.kind === "house" && !ask.lot}
                onClick={() => void run(ask.kind === "buy" ? buyHome(ask.type, ask.lot) : sellHome(ask.id), ask.kind === "buy" ? "내 집이 생겼어요!" : "팔았어요")}
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
