"use client";

import { useEffect, useState } from "react";
import { rpc } from "@/lib/api/socket";
import type { HouseWire } from "@/lib/gmtown/types";
import { HOUSE_TIERS, houseTier, npcById, type HouseTier, type NpcId } from "@/lib/gmtown/world";

/*
 * NPC 대화창 (로아식: 아래 넓은 판 — 왼쪽 초상 · 이름판 · 한 글자씩 나오는 말 · 오른쪽 고르기).
 * 부동산 중개인 민트: 집 보기(단계별 매물) → 계약 확인 → GP 로 계약 (서버 gmtown.house.buy). 집 안은 곧 열림.
 * 1~4 숫자 키로 고르기 · Esc 닫기 (닫기는 GMTownApp 이 Esc 로).
 */

type View = "talk" | "info" | "list" | "confirm" | "done";
const fmt = (n: number) => n.toLocaleString("ko-KR");

export default function NpcDialog({
  id,
  phone,
  onClose,
  onSys,
  onGoHome,
  onBought,
}: {
  id: NpcId;
  phone: boolean;
  onClose: () => void;
  /** 채팅창 시스템 줄 */
  onSys: (t: string) => void;
  /** 내 집으로 들어가기 */
  onGoHome: () => void;
  /** 계약함 (마을의 우리 집 건물이 섬) */
  onBought?: () => void;
}) {
  const npc = npcById(id)!;
  const [house, setHouse] = useState<HouseWire | null>(null);
  const [view, setView] = useState<View>("talk");
  const [pick, setPick] = useState<HouseTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState("어서 오세요! 마을 부동산이에요 🏠 오늘은 어떤 집을 보러 오셨어요?");
  /** 말이 시작된 때 (한 글자씩 보이기) · 눌러서 다 보기 */
  const [lineAt, setLineAt] = useState(() => Date.now());
  const [, setTick] = useState(0);
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    void rpc<HouseWire>("gmtown.house").then(setHouse, () => setHouse({ tier: 0, gp: null, inv: {}, layout: [] }));
  }, []);
  // 한 글자씩 (시작 시각에서 지난 만큼)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30);
    return () => window.clearInterval(t);
  }, []);
  // eslint-disable-next-line react-hooks/purity -- 지난 시간으로 글자 수 (렌더마다 다시 계산)
  const shown = skip ? line.length : Math.min(line.length, Math.floor((Date.now() - lineAt) / 22));
  const say = (t: string, v?: View) => {
    setLine(t);
    setLineAt(Date.now());
    setSkip(false);
    if (v) setView(v);
  };

  const guest = house?.gp === null;
  const tier = house?.tier ?? 0;
  const next = houseTier(tier + 1);

  const buy = () => {
    if (!pick || busy) return;
    setBusy(true);
    void rpc<HouseWire>("gmtown.house.buy", { tier: pick.tier }).then(
      (h) => {
        setHouse(h);
        setBusy(false);
        onBought?.();
        onSys(`${pick.name} 계약 완료! (${fmt(pick.price)} GP)`);
        say(
          tier === 0
            ? `계약 완료예요! 여기 ${pick.name} 열쇠요 🔑 기본 가구도 넣어 뒀어요. 바로 들어가 보실래요?`
            : `${pick.name}(으)로 넓혀 드렸어요! 이사 축하드려요 🎉`,
          "done"
        );
      },
      (e) => {
        setBusy(false);
        say((e as Error).message || "앗, 계약이 안 됐어요. 잠시 후 다시 해 주세요.", "list");
      }
    );
  };

  type Opt = { label: string; on: () => void; gold?: boolean; disabled?: boolean };
  const opts: Opt[] =
    view === "talk"
      ? [
          {
            label: tier ? "집을 넓히고 싶어요" : "집 보러 왔어요",
            gold: true,
            on: () =>
              guest
                ? say("집 계약은 회원만 할 수 있어요. 로그인하고 오시면 바로 도와드릴게요!", "info")
                : say(
                    tier
                      ? `지금은 ${houseTier(tier)!.name}에 사시죠? ${next ? `다음은 ${next.name}이에요.` : "벌써 제일 좋은 집이에요!"}`
                      : "지금 나와 있는 매물이에요. 처음엔 원룸부터 계약할 수 있어요!",
                    "list"
                  ),
          },
          ...(tier
            ? [
                {
                  label: "내 집에 가고 싶어요",
                  on: onGoHome,
                },
              ]
            : []),
          {
            label: "이 마을 집은 어떤 곳이에요?",
            on: () =>
              say(
                "집은 사람마다 따로예요! 저기 「우리 집」 문으로 들어가면 나만의 집이 나와요. 가구를 사서 꾸미고, 2층 집 · 정원 주택으로 넓히고, 같은 채널 친구를 초대할 수도 있어요 💌",
                "info"
              ),
          },
          { label: "그냥 구경했어요", on: onClose },
        ]
      : view === "info"
        ? [
            { label: "알겠어요!", gold: true, on: () => say("또 궁금한 거 있으면 물어보세요!", "talk") },
            { label: "집 보러 왔어요", on: () => (guest ? say("집 계약은 회원만 할 수 있어요. 로그인하고 오시면 바로 도와드릴게요!", "info") : say(tier ? "지금 나와 있는 매물이에요." : "지금 나와 있는 매물이에요. 처음엔 원룸부터 계약할 수 있어요!", "list")) },
            { label: "고마워요, 안녕!", on: onClose },
          ]
      : view === "list"
        ? [
            ...(next
              ? [{ label: `${next.name} 계약하기 · ${fmt(next.price)} GP`, gold: true, disabled: guest, on: () => (setPick(next), say(`${next.name}, ${fmt(next.price)} GP 예요. 계약할까요?`, "confirm")) }]
              : []),
            { label: "다른 얘기 할래요", on: () => say("네, 또 궁금한 거 있으세요?", "talk") },
            { label: "나중에 올게요", on: onClose },
          ]
        : view === "confirm"
          ? [
              {
                label: busy ? "계약하는 중…" : `계약할게요 (${fmt(pick?.price ?? 0)} GP)`,
                gold: true,
                disabled: busy || (house?.gp ?? 0) < (pick?.price ?? 0),
                on: buy,
              },
              { label: "다시 생각할게요", on: () => say("천천히 골라 보세요!", "list") },
            ]
          : [
              { label: "내 집 들어가 볼래요", gold: true, on: onGoHome },
              { label: "다른 집도 볼래요", on: () => say("지금 나와 있는 매물이에요.", "list") },
              { label: "고마워요!", on: onClose },
            ];

  // 숫자 키
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.key === "Enter") && !skip) {
        e.preventDefault();
        setSkip(true);
        return;
      }
      const k = Number(e.key);
      if (k >= 1 && k <= opts.length && !opts[k - 1].disabled) {
        e.preventDefault();
        opts[k - 1].on();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const lack = view === "confirm" && pick && (house?.gp ?? 0) < pick.price;

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-gradient-to-t from-black/60 via-black/20 to-transparent" onClick={onClose}>
      {/* 매물판 (집 보기 · 확인) */}
      {(view === "list" || view === "confirm") && (
        <div
          className={`gmt-lo gmt-pop absolute left-1/2 w-[min(94%,720px)] -translate-x-1/2 rounded-xl p-3 ${phone ? "top-2" : "top-[12%]"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <b className="flex items-center gap-1.5">
              <span className="text-[17px]">🏠</span>
              <span className="gmt-lo-title text-[17px]">마을 부동산 매물</span>
            </b>
            <span className="text-[12px] text-white/70">
              내 GP <b className="text-[#FFE6A0]">{house?.gp === null ? "회원만" : fmt(house?.gp ?? 0)}</b>
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {HOUSE_TIERS.map((h) => {
              const own = h.tier <= tier;
              const isNext = h.tier === tier + 1;
              const sel = pick?.tier === h.tier && view === "confirm";
              return (
                <button
                  type="button"
                  key={h.tier}
                  disabled={!isNext || guest}
                  onClick={() => (setPick(h), say(`${h.name}, ${fmt(h.price)} GP 예요. 계약할까요?`, "confirm"))}
                  className={`relative flex flex-col items-center rounded-lg border px-1.5 py-2 text-center enabled:cursor-pointer enabled:hover:bg-[#e9cf8e]/10 ${
                    sel
                      ? "border-[#ffe7a8] bg-[#e9cf8e]/15"
                      : own
                        ? "border-[#4FD1A5]/50 bg-[#4FD1A5]/8"
                        : isNext
                          ? "border-[#c9a45c]/60 bg-white/5"
                          : "border-white/10 bg-black/25 opacity-60"
                  }`}
                >
                  <span className={phone ? "text-[22px]" : "text-[30px]"}>{h.icon}</span>
                  <b className="mt-0.5 text-[13px]">{h.name}</b>
                  <span className="text-[11.5px] font-bold text-[#FFE6A0]">{fmt(h.price)} GP</span>
                  {!phone && <span className="mt-1 text-[10.5px] leading-snug text-white/60">{h.desc}</span>}
                  <span
                    className={`mt-1.5 rounded px-1.5 py-[1px] text-[10px] font-bold ${
                      own ? "bg-[#4FD1A5]/20 text-[#9be7c4]" : isNext ? "bg-[#e9cf8e]/20 text-[#FFE6A0]" : "bg-white/10 text-white/45"
                    }`}
                  >
                    {own ? (h.tier === tier ? "지금 내 집" : "지난 단계") : isNext ? "눌러서 계약" : "앞 단계 먼저"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 고르기 (로아식: 대화판 위 오른쪽에 세로로) + 대화판 */}
      <div className="relative mb-3 flex w-[min(96%,920px)] flex-col items-end gap-2" onClick={(e) => e.stopPropagation()}>
        <div className={`gmt-pop flex flex-col gap-1.5 ${phone ? "w-[min(60%,300px)]" : "w-[min(46%,340px)]"}`}>
          {opts.map((o, i) => (
            <button
              key={o.label}
              type="button"
              disabled={o.disabled}
              onClick={o.on}
              className={`group flex cursor-pointer items-center gap-2 rounded-lg px-3 text-left font-bold shadow-lg disabled:cursor-not-allowed disabled:opacity-45 ${
                phone ? "h-9 text-[12.5px]" : "h-10 text-[13.5px]"
              } ${o.gold ? "gmt-gold-btn" : "gmt-dark-btn"}`}
            >
              <span className={`flex h-5 min-w-5 items-center justify-center rounded text-[10.5px] ${o.gold ? "bg-black/15" : "bg-white/12 text-white/75"}`}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <span className={`text-[15px] transition-transform group-enabled:group-hover:translate-x-0.5 ${o.gold ? "text-black/45" : "text-white/40"}`}>›</span>
            </button>
          ))}
        </div>
        <div className={`gmt-lo gmt-pop relative flex w-full items-stretch gap-3 rounded-xl ${phone ? "p-2" : "p-3"}`}>
          {/* 초상 */}
          <div className={`relative shrink-0 self-end overflow-hidden rounded-lg border border-[#c9a45c]/40 bg-gradient-to-b from-[#3a5a4a] to-[#14201a] ${phone ? "h-[84px] w-[84px]" : "h-[132px] w-[132px]"}`}>
            <img src="/gmtown/char/npc_agent.webp" alt={npc.name} className="h-full w-full object-cover object-top" draggable={false} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-baseline gap-2">
              <b className="text-[16px] text-[#9BF0C8]">{npc.name}</b>
              <span className="text-[11.5px] text-[#F2D27A]">&lt;{npc.title}&gt;</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="대화 닫기"
                className="ml-auto h-7 w-7 cursor-pointer rounded-md text-[15px] text-white/70 hover:bg-white/10"
              >
                ✕
              </button>
            </div>
            <p
              className={`mt-1 min-h-[3.2em] flex-1 cursor-pointer leading-relaxed text-white/92 ${phone ? "text-[12.5px]" : "text-[15px]"}`}
              onClick={() => setSkip(true)}
            >
              {line.slice(0, shown)}
              {shown < line.length && <span className="animate-pulse text-white/50">▍</span>}
            </p>
            {lack && <p className="text-[11.5px] text-[#ff9b9b]">GP 가 모자라요 — 출석 · 게임으로 모아 오세요!</p>}
            {!phone && <p className="text-right text-[10.5px] text-white/35">숫자 키로 고르기 · Space 로 말 넘기기 · Esc 닫기</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
