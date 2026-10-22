"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { asset, roomTint } from "@/lib/poker/assets";
import { playVoice } from "@/lib/poker/sfx";
import { preloadAll } from "@/lib/preload";
import { lobbyWarm } from "@/lib/poker/preloadList";
import {
  CHARS,
  CHAR_IDS,
  CHAR_PRICE,
  GAMES,
  LEAGUES,
  TIERS,
  charOwned,
  fmtEok,
  fmtShort,
  lookOf,
  type CharId,
  type GameKind,
  type Look,
  type Tier,
  type TierId,
  lookName,
} from "@/lib/poker/rules";
import { fmtPoint } from "@/lib/points";
import { AchievementRank } from "@/components/Points/Achievements";
import type { BuyRankRow, LobbyTable, RankRow, Wallet } from "@/lib/poker/types";
import { createTable, getBuyRank, quickJoin, setChar, subscribeLobby } from "@/realtime/poker";
import MyPage from "./MyPage";
import PatchNotes, { LATEST } from "./PatchNotes";
import LobbyChar from "./LobbyChar";
import Sheet from "./Sheet";
import type { ShopTab } from "./Shop";
import { Money, PlayingCard, Profile } from "./parts";

/*
 * ANIME POKER 로비 (무대 안): 내 돈 · 캐릭터 → 홀덤 / 7포커 → 판돈 3단계 → 바로 입장 / 방 만들기 / 열린 방 목록, 자금 순위.
 */

const MODE_KEY = "poker_mode";

function stakeLine(game: GameKind, t: Tier) {
  return game === "holdem"
    ? `판돈 ${fmtShort(t.ante)} · 블라인드 ${fmtShort(t.sb)}/${fmtShort(t.bb)}`
    : `판돈 ${fmtShort(t.ante)}`;
}

/** 이번 접속에서 로비에 마지막으로 고른 단계 (페이지를 새로 열 때까지 유지) */
let lastTier: TierId | null = null;

export default function Lobby({
  wallet,
  rank,
  myNick,
  h,
  onEnter,
  onShop,
  topRight,
}: {
  wallet: Wallet;
  rank: RankRow[] | null;
  myNick: string;
  w: number;
  h: number;
  onEnter: (id: string) => void;
  onWallet: (w: Wallet) => void;
  /** 상점 열기 (캐릭터 고르기에서 안 산 캐릭터를 고르면 캐릭터 탭으로) */
  onShop?: (t: ShopTab) => void;
  topRight?: ReactNode;
}) {
  const [game, setGameState] = useState<GameKind>("holdem");
  // 처음 고른 방: 접속해서 처음 로비가 뜰 때만 내 칩으로 앉을 수 있는 가장 높은 단계, 그 뒤로는(방에서 나와 돌아와도) 마지막에 고른 단계
  const [tier, setTier] = useState<TierId>(
    () => (lastTier ??= [...TIERS].reverse().find((t) => wallet.money >= t.min)?.id ?? 1)
  );
  useEffect(() => {
    lastTier = tier;
  }, [tier]);
  const [tables, setTables] = useState<LobbyTable[] | null>(null);
  const [busy, setBusy] = useState("");
  const [sheet, setSheet] = useState<"" | "create" | "char" | "rank" | "me" | "mychar">("");
  const [form, setForm] = useState({ name: "", password: "", quick: true, bots: true });
  const [menu, setMenu] = useState(false);
  const [notes, setNotes] = useState(false);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSeq = useRef(0);
  const say = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, key: ++toastSeq.current });
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장해 둔 모드를 처음 한 번 읽음
      if (saved === "seven" || saved === "holdem") setGameState(saved);
    } catch {}
    return subscribeLobby(setTables);
  }, []);
  const setGame = (g: GameKind) => {
    setGameState(g);
    try {
      localStorage.setItem(MODE_KEY, g);
    } catch {}
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      say(e instanceof Error ? e.message : "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy("");
    }
  };

  const myRank = rank ? rank.findIndex((r) => r.nick === myNick) + 1 : 0;
  const T = TIERS[tier - 1];
  const L = LEAGUES[T.league - 1];
  // 고른 종목 · 리그의 방만 (같은 리그 세 방을 같이, 판돈 낮은 방부터)
  const shown = (tables ?? [])
    .filter((t) => t.game === game && TIERS[t.tier - 1]?.league === T.league)
    .sort((a, b) => a.tier - b.tier);
  /** 리그 탭: 같은 순서(1~3번째 방)를 유지하며 옮김 */
  const pickLeague = (lg: number) => setTier(((lg - 1) * 3 + T.step) as TierId);
  const locked = wallet.money < T.min;
  const bar = 44;
  const info = CHARS[wallet.char];
  /** 그림 열쇠 (스킨을 입었으면 스킨) */
  const look = lookOf(wallet.char, wallet.wear);
  // 로비에 있는 동안 테이블 공통 그림 · 내 캐릭터의 테이블 그림을 미리 (안 기다림 — 테이블 들어갈 때 로딩이 짧아짐)
  useEffect(() => {
    void preloadAll(lobbyWarm(look, game));
  }, [look, game]);

  // ── 조각들 ──
  const top = (
    <div
      className="absolute inset-x-0 top-0 z-30 flex items-center gap-[0.6em] px-[0.8em]"
      style={{
        height: bar,
        background: "linear-gradient(180deg, rgba(0,0,0,0.85), rgba(0,0,0,0.35))",
        borderBottom: "1px solid rgba(214,175,92,0.25)",
      }}
    >
      {}
      <img
        src={asset.logo}
        alt="ANIME POKER"
        draggable={false}
        style={{ height: bar - 8, width: "auto" }}
      />
      <span className="rounded-[4px] bg-[var(--pk-danger)] px-[0.45em] text-[0.62em] leading-[1.6em] font-extrabold tracking-wider">
        BETA
      </span>
      <button
        type="button"
        onClick={() => setNotes(true)}
        className="pk-btn pk-btn-ghost flex h-[28px] items-center gap-[0.35em] px-[0.6em] text-[0.74em]"
      >
        패치노트
        <span className="text-[#ffd84a]">{LATEST.split(" ")[0]}</span>
      </button>
      <span className="ml-auto flex items-center gap-[0.45em]">
        {/* 내 정보 버튼 (누르면 메뉴: 캐릭터 · 순위 · 마이페이지) */}
        <span className="relative hidden sm:flex">
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            aria-expanded={menu}
            className="pk-me-chip"
          >
            <Profile char={look} size={26} className="ring-2 ring-[var(--pk-brass)]" />
            <span className="hidden max-w-[9em] truncate text-[0.8em] text-white/75 sm:inline">
              <b className="text-white">{myNick}</b>님 어서오세요
            </span>
            <svg
              viewBox="0 0 12 12"
              className="h-[0.7em] w-[0.7em] text-white/60"
              fill="currentColor"
              aria-hidden
            >
              <path d="M2 4l4 4 4-4z" />
            </svg>
          </button>
          {menu && (
            <>
              <span className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div className="pk-frame pk-pop absolute top-[calc(100%+6px)] right-0 z-50 grid w-[13em] gap-[0.3em] p-[0.45em] text-[0.82em]">
                {(
                  [
                    ["캐릭터 변경", () => setSheet("char")],
                    ["순위", () => setSheet("rank")],
                  ] as const
                ).map(([label, fn]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => (setMenu(false), fn())}
                    className="pk-btn pk-btn-ghost px-[0.8em] py-[0.5em] text-left"
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => (setMenu(false), setSheet("me"))}
                  className="pk-btn pk-btn-ghost px-[0.8em] py-[0.5em] text-left"
                >
                  마이페이지
                </button>
              </div>
            </>
          )}
        </span>
        {topRight}
      </span>
    </div>
  );

  const me = (
    <div
      className="pk-frame pk-me relative flex h-full flex-col overflow-hidden"
      style={{ "--c": info.color } as CSSProperties}
    >
      {/* 뒷배경: 방 그림 + 캐릭터 색 빛 + 무늬 */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-35"
        style={{ backgroundImage: `url(${asset.room("lobby", "v")})` }}
      />
      <div className="pk-me-glow absolute inset-0" />
      <div className="pk-me-rays absolute inset-0" />
      {}
      {/* 내 캐릭터: 누르면 반응 (스킨이면 동작이 더 많음) */}
      <LobbyChar
        key={look}
        look={look}
        className="absolute inset-x-0 top-[3%] h-[78%]"
        style={{
          maskImage: "linear-gradient(180deg,#000 62%,transparent 96%)",
          WebkitMaskImage: "linear-gradient(180deg,#000 62%,transparent 96%)",
        }}
      />
      <div className="relative mt-auto grid gap-[0.45em] p-[0.7em]">
        <div className="flex items-center gap-[0.5em]">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[1.05em] font-extrabold" style={{ color: info.color }}>
              {lookName(look)}
            </div>
            <div className="truncate text-[1.3em] leading-tight font-extrabold">{myNick}</div>
          </div>
          {myRank > 0 && (
            <div className="flex shrink-0 flex-col items-center rounded-[8px] border border-[rgba(255,201,60,0.45)] bg-black/45 px-[0.7em] py-[0.2em] leading-tight">
              <span className="text-[0.7em] text-white/55">순위</span>
              <span className="text-[1.15em] font-extrabold text-[#ffd84a]">{myRank}위</span>
            </div>
          )}
        </div>
        {/* 보유 칩 */}
        <div className="pk-wallet">
          {}
          <img
            src={asset.chip("gold", "stack")}
            alt=""
            draggable={false}
            className="h-[2em] w-[2em]"
          />
          <div className="min-w-0">
            <div className="text-[0.7em] text-white/50">보유 칩</div>
            <Money won={wallet.money} className="text-[1.35em] leading-none text-[#ffd84a]" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-[0.35em]">
          <button
            type="button"
            onClick={() => setSheet("char")}
            className="pk-btn pk-btn-ghost py-[0.45em] text-[0.78em]"
          >
            캐릭터
          </button>
          <button
            type="button"
            onClick={() => setSheet("rank")}
            className="pk-btn pk-btn-ghost py-[0.45em] text-[0.78em]"
          >
            순위
          </button>
          <button
            type="button"
            onClick={() => setSheet("me")}
            className="pk-btn pk-btn-ghost py-[0.45em] text-[0.78em]"
          >
            마이페이지
          </button>
        </div>
      </div>
    </div>
  );

  const mode = (
    <div className="grid shrink-0 grid-cols-2 gap-[0.5em]" style={{ height: "100%" }}>
      {(["holdem", "seven"] as const).map((g) => (
        <button
          key={g}
          type="button"
          aria-pressed={game === g}
          onClick={() => setGame(g)}
          className="pk-mode isolate flex h-full cursor-pointer flex-col"
        >
          {/* 펠트 위 카드: 홀덤 = 바닥 5장 + 내 패 2장, 7포커 = 7장 부채꼴 */}
          <div
            className="relative min-h-0 flex-1 overflow-hidden"
            style={{
              background: "radial-gradient(120% 90% at 50% 40%, #1f8a5b, #0b4a30 70%, #062a1b)",
            }}
          >
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background:
                  "repeating-linear-gradient(45deg, rgba(0,0,0,0.25) 0 2px, transparent 2px 5px)",
              }}
            />
            <ModeCards game={g} h />
          </div>
          <div className="flex min-w-0 items-baseline gap-[0.5em] border-t border-[rgba(214,175,92,0.3)] bg-black/70 px-[0.7em] py-[0.35em]">
            <span className="shrink-0 text-[1.1em] font-extrabold whitespace-nowrap">
              {GAMES[g].name}
            </span>
            <span className="pk-frame-title min-w-0 truncate text-[0.7em]">
              {g === "holdem" ? "TEXAS HOLD'EM" : "SEVEN POKER"}
            </span>
            <span className="ml-auto shrink-0 rounded-[4px] bg-white/10 px-[0.45em] text-[0.8em] font-bold whitespace-nowrap text-white/80">
              {GAMES[g].seats}인
            </span>
          </div>
        </button>
      ))}
    </div>
  );

  const tiers = (
    <div
      className="grid h-full gap-[0.5em]"
      style={{ gridTemplateRows: "1fr auto" }}
    >
      <div className="grid min-h-0 gap-[0.45em]" style={{ gridTemplateRows: "auto 1fr" }}>
        {/* 리그 탭: 일반 · 도박꾼 · 타짜 */}
        <div className="pk-seg pk-league">
          {LEAGUES.map((lg) => {
            const open = wallet.money >= TIERS[(lg.id - 1) * 3].min;
            return (
              <button
                key={lg.id}
                type="button"
                aria-pressed={T.league === lg.id}
                onClick={() => pickLeague(lg.id)}
                style={{ "--lc": lg.color } as CSSProperties}
              >
                {!open && <span className="mr-[0.25em] text-[0.85em]">🔒</span>}
                {lg.name}
              </button>
            );
          })}
        </div>
        <div className="grid min-h-0 grid-cols-3 gap-[0.45em]">
          {TIERS.filter((t) => t.league === T.league).map((t) => {
            const lock = wallet.money < t.min;
            const on = tier === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setTier(t.id);
                  if (lock) say(`${t.name}은 칩 ${fmtShort(t.min)}부터 앉을 수 있어요`);
                }}
                className={`relative flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-[8px] border-2 text-left transition ${on ? "border-[var(--pk-brass)] shadow-[0_0_14px_rgba(255,201,60,0.35)]" : "border-white/10 hover:border-white/30"}`}
              >
                <div
                  className="relative min-h-[3.2em] flex-1 overflow-hidden bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${asset.room(t.id, "h")})`,
                    filter: roomTint(t.id),
                  }}
                >
                  <img
                    src={asset.table(t.id, "h")}
                    alt=""
                    draggable={false}
                    className="absolute inset-x-[6%] bottom-[-6%] w-[88%]"
                  />
                  {lock && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[1.3em]">
                      🔒
                    </span>
                  )}
                </div>
                <div
                  className={`relative px-[0.55em] py-[0.35em] ${on ? "bg-[#2a2110]" : "bg-black/70"}`}
                >
                  <div className="text-[1.05em] font-extrabold">{t.name}</div>
                  <div className="text-[0.76em] leading-snug whitespace-nowrap text-white/70">
                    판돈 {fmtShort(t.ante)}
                    {game === "holdem" && (
                      <>
                        <br />
                        <span className="text-white/50">블라인드</span> {fmtShort(t.sb)}·
                        {fmtShort(t.bb)}
                      </>
                    )}
                  </div>
                  <div
                    className={`flex items-center gap-[0.25em] text-[0.78em] font-bold ${lock ? "text-[#ff8a8a]" : "text-[#e9c879]"}`}
                  >
                    <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
                    {fmtShort(t.min)}부터
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-[0.4em]">
        <button
          type="button"
          disabled={locked || !!busy}
          onClick={() => run("quick", async () => onEnter(await quickJoin(game, tier)))}
          className="pk-btn pk-btn-gold flex-1 py-[0.75em] text-[1.05em]"
        >
          {busy === "quick" ? (
            "입장 중…"
          ) : locked ? (
            `칩 ${fmtShort(T.min)}부터 입장 가능`
          ) : (
            <>
              <b className="pk-quick-game">{GAMES[game].name}</b>
              <span className="opacity-80"> · {T.name}</span> 바로 입장
            </>
          )}
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => setSheet("create")}
          className="pk-btn pk-btn-ghost px-[1em] text-[0.85em]"
        >
          방 만들기
        </button>
      </div>
    </div>
  );

  const rooms = (
    <div className="pk-frame flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-[0.5em] border-b border-[rgba(214,175,92,0.25)] bg-black/40 px-[0.8em] py-[0.5em]">
        <span className="pk-frame-title">열린 방</span>
        <span className="rounded-[4px] bg-white/10 px-[0.45em] text-[0.8em] font-bold text-white/80">
          {GAMES[game].name} · {L.name} {shown.length}
        </span>
      </div>
      <div
        className={`pk-scroll min-h-0 flex-1 overflow-y-auto p-[0.45em] ${tables !== null && shown.length === 0 ? "flex items-center justify-center" : "grid auto-rows-max content-start gap-[0.35em]"}`}
      >
        {tables === null ? (
          <p className="p-[1em] text-center text-[0.75em] text-white/40">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-[0.5em] py-[1.5em] text-center">
            <div className="flex -space-x-[0.6em] opacity-60">
              {[48, 45, 50].map((c, i) => (
                <PlayingCard
                  key={c}
                  card={c}
                  w={40}
                  style={{ transform: `rotate(${(i - 1) * 12}deg)` }}
                />
              ))}
            </div>
            <p className="text-[0.92em] text-white/60">
              아직 열린 {GAMES[game].name} · {L.name} 방이 없어요
            </p>
            <button
              type="button"
              disabled={locked}
              onClick={() => setSheet("create")}
              className="pk-btn pk-btn-ghost px-[1.2em] py-[0.45em] text-[0.88em]"
            >
              방 만들기
            </button>
          </div>
        ) : (
          shown.map((t) => {
            const tt = TIERS[t.tier - 1];
            const lock = wallet.money < tt.min;
            const color = ["#8fd35f", "#4fc9e0", "#ff6f91"][tt.step - 1];
            return (
              <button
                key={t.id}
                type="button"
                disabled={lock || !!busy}
                onClick={() => onEnter(t.id)}
                className="group flex w-full cursor-pointer items-center gap-[0.6em] overflow-hidden rounded-[6px] border border-white/[0.08] bg-white/[0.03] py-[0.45em] pr-[0.55em] text-left hover:border-[rgba(214,175,92,0.5)] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ boxShadow: `inset 3px 0 0 ${color}` }}
              >
                <div className="min-w-0 flex-1 pl-[0.7em]">
                  <div className="flex items-center gap-[0.35em]">
                    <span className="text-[0.74em] font-extrabold" style={{ color }}>
                      {tt.name}
                    </span>
                    {t.locked && <span className="text-[0.62em]">🔒</span>}
                    {!t.quick && (
                      <span className="rounded-[3px] bg-white/10 px-[0.3em] text-[0.64em] text-white/60">
                        친구방
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[0.95em] font-bold">{t.name}</div>
                  <div className="text-[0.72em] text-white/55">{stakeLine(t.game, tt)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-[0.25em]">
                  <div className="flex gap-[3px]">
                    {Array.from({ length: t.max }, (_, i) => (
                      <span
                        key={i}
                        className="h-[7px] w-[7px] flex-none rounded-full"
                        style={{ background: i < t.players ? color : "rgba(255,255,255,0.15)" }}
                      />
                    ))}
                  </div>
                  <span className="pk-btn pk-btn-call px-[0.8em] py-[0.2em] text-[0.76em]">
                    {t.players >= t.max ? "가득" : "입장"}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="absolute inset-0">
      <div
        className="pk-bg"
        style={{
          backgroundImage: `url(${asset.room("lobby", "h")})`,
          filter: "brightness(0.5) saturate(0.85)",
        }}
      />
      {top}
      {(
        <div
          className="absolute inset-x-0 bottom-0 grid grid-cols-[27%_1fr_26%] gap-[0.7em] p-[0.8em]"
          style={{ top: bar }}
        >
          {me}
          <div className="grid min-h-0 grid-rows-[38%_1fr] gap-[0.7em]">
            {mode}
            <div className="pk-frame min-h-0 p-[0.6em]">{tiers}</div>
          </div>
          <div className="flex min-h-0 flex-col">{rooms}</div>
        </div>
      )}

      {notes && <PatchNotes onClose={() => setNotes(false)} />}
      {/* 알림 토스트 */}
      {toast && (
        <div key={toast.key} role="status" className="pk-toast" style={{ bottom: 90 }}>
          {toast.text}
        </div>
      )}

      {/* 창(바텀시트): 하나만 띄우고 내용만 바꿈 — 뒤로가기 기록이 한 번만 쌓이게 */}
      {sheet && (
        <Sheet
          key="sheet"
          mobile={false}
          maxH={h - 24}
          wide={sheet === "me" ? 760 : 640}
          fill={sheet === "me"}
          title={
            sheet === "create"
              ? `${GAMES[game].name} · ${L.name} ${T.name} 방 만들기`
              : sheet === "char"
                ? "캐릭터"
                : sheet === "rank"
                  ? "순위"
                  : sheet === "mychar"
                    ? "내 캐릭터"
                    : undefined
          }
          onClose={() => setSheet("")}
        >
          {sheet === "create" && (
            <form
              className="grid gap-[0.6em] p-[0.9em] pt-[0.5em]"
              onSubmit={(e) => {
                e.preventDefault();
                void run("create", async () =>
                  onEnter(
                    await createTable({
                      game,
                      tier,
                      name: form.name,
                      password: form.password,
                      quick: form.quick,
                      bots: form.quick && form.bots,
                    })
                  )
                );
              }}
            >
              <input
                value={form.name}
                maxLength={20}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={`방 이름 (${myNick}의 테이블)`}
                aria-label="방 이름"
                className="rounded-[6px] border border-white/15 bg-black/50 px-[0.7em] py-[0.55em] text-[0.9em] text-white placeholder:text-white/35 focus:border-[var(--pk-brass)] focus:outline-none"
              />
              <input
                value={form.password}
                maxLength={40}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="비밀번호 (비우면 공개 방)"
                aria-label="비밀번호"
                className="rounded-[6px] border border-white/15 bg-black/50 px-[0.7em] py-[0.55em] text-[0.9em] text-white placeholder:text-white/35 focus:border-[var(--pk-brass)] focus:outline-none"
              />
              <label className="flex cursor-pointer items-center gap-[0.6em] rounded-[6px] bg-white/[0.05] px-[0.7em] py-[0.55em] text-[0.85em]">
                <input
                  type="checkbox"
                  checked={form.quick}
                  onChange={(e) => setForm({ ...form, quick: e.target.checked })}
                  className="h-[1.1em] w-[1.1em] accent-[var(--pk-brass)]"
                />
                <span>바로 입장 허용</span>
              </label>
              {/* 봇은 바로 입장을 허용한 방에만 (친구방은 사람끼리) */}
              {form.quick && (
                <label className="-mt-[0.3em] ml-[1.2em] flex cursor-pointer items-center gap-[0.6em] rounded-[6px] bg-white/[0.05] px-[0.7em] py-[0.5em] text-[0.82em]">
                  <input
                    type="checkbox"
                    checked={form.bots}
                    onChange={(e) => setForm({ ...form, bots: e.target.checked })}
                    className="h-[1.1em] w-[1.1em] accent-[var(--pk-brass)]"
                  />
                  <span>봇 참가 가능</span>
                </label>
              )}
              <button
                type="submit"
                disabled={!!busy}
                className="pk-btn pk-btn-gold py-[0.6em] text-[0.92em]"
              >
                {busy === "create" ? "만드는 중…" : "만들고 앉기"}
              </button>
            </form>
          )}
          {sheet === "char" && (
            <CharSelect
              current={wallet.char}
              owned={wallet.chars}
              onPick={(c) => void run("char", async () => (await setChar(c), setSheet("")))}
              onShop={() => (setSheet(""), onShop?.("chars"))}
            />
          )}
          {sheet === "me" && (
            <MyPage
              wallet={wallet}
              compact={false}
              onChar={() => setSheet("char")}
              onRank={() => setSheet("rank")}
            />
          )}
          {sheet === "mychar" && (
            // 폰: 내 캐릭터 크게 (로비 칸이 좁아 대기 영상 · 터치 반응을 못 보니까)
            <div className="flex min-h-0 flex-col items-center gap-[0.5em] px-[0.9em] pb-[0.9em]">
              <LobbyChar
                key={look}
                look={look}
                className="w-full shrink-0"
                style={{ height: Math.round(Math.min(h * 0.56, 460)) }}
              />
              <div className="w-full min-w-0 text-center leading-tight">
                <div className="truncate text-[1.35em] font-extrabold">{myNick}</div>
                <div className="truncate text-[0.95em] font-bold" style={{ color: info.color }}>
                  {lookName(look)}
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-[0.4em]">
                <button
                  type="button"
                  onClick={() => setSheet("rank")}
                  className="pk-btn pk-btn-ghost py-[0.55em] text-[0.9em]"
                >
                  순위
                </button>
                <button
                  type="button"
                  onClick={() => setSheet("char")}
                  className="pk-btn pk-btn-gold py-[0.55em] text-[0.9em]"
                >
                  캐릭터 변경
                </button>
              </div>
            </div>
          )}
          {sheet === "rank" && (
            <div
              data-sheet-scroll
              className="pk-scroll min-h-0 flex-1 overflow-y-auto px-[0.9em]"
            >
              <PokerRanks rank={rank} myNick={myNick} />
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

/** 모드 카드의 그림: 펠트 위에 그 게임처럼 카드를 늘어놓음 */
function ModeCards({ game, h }: { game: "holdem" | "seven"; h: boolean }) {
  const w = h ? 34 : 22;
  if (game === "holdem")
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[8%]">
        <div className="flex gap-[3px]">
          {[48, 44, 21, 2, 40].map((c, i) => (
            <PlayingCard
              key={c}
              card={c}
              w={w}
              style={{ transform: `translateY(${i === 2 ? 0 : 0}px)` }}
            />
          ))}
        </div>
        <div className="flex">
          {[36, 32].map((c, i) => (
            <PlayingCard
              key={c}
              card={c}
              w={w * 1.15}
              win
              style={{ transform: `rotate(${i ? 8 : -8}deg)`, marginLeft: i ? -w * 0.35 : 0 }}
            />
          ))}
        </div>
      </div>
    );
  const cards: (number | null)[] = [48, 49, 50, 51, 44, 45, null];
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className="relative"
        style={{ width: w * 1.1, height: w * 1.1 * 1.4, marginTop: w * 0.5 }}
      >
        {cards.map((c, i) => (
          <PlayingCard
            key={i}
            card={c}
            w={w * 1.1}
            tier={3}
            win={i < 4}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              transform: `rotate(${(i - 3) * 12}deg)`,
              transformOrigin: "50% 240%",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** 캐릭터 고르기: 위에 고른 캐릭터 소개(상반신 · 나이 · 생일), 아래에 프로필 줄 (늘어나면 옆으로 넘김) */
function CharSelect({
  current,
  owned,
  onPick,
  onShop,
}: {
  current: CharId;
  owned: CharId[];
  onPick: (c: CharId) => void;
  onShop: () => void;
}) {
  const [sel, setSel] = useState<CharId>(current);
  const info = CHARS[sel];
  const locked = !charOwned(sel, owned);
  const price = CHAR_PRICE[sel] ?? 0;
  return (
    <div className="flex min-h-0 flex-col gap-[0.7em] p-[0.9em] pt-[0.4em]">
      {/* 고른 캐릭터 */}
      <div
        className="pk-cs-hero"
        style={{ "--c": info.color, height: 230 } as React.CSSProperties}
      >
        {}
        <img src={asset.pose(sel, "idle")} alt="" draggable={false} className="pk-cs-bust" />
        <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center gap-[0.25em] py-[0.6em] pr-[0.9em]">
          <div className="flex items-baseline gap-[0.45em]">
            <span className="text-[1.5em] leading-none font-extrabold">{info.name}</span>
            {locked && <span className="pk-cs-lock">🔒 {fmtPoint(price)}</span>}
          </div>
          <div className="pk-num text-[0.82em] text-white/75">
            {info.age}세 · {info.birthday} ({info.sign})
          </div>
          <p className="text-[0.8em] leading-snug text-white/70">{info.blurb}</p>
        </div>
      </div>

      {/* 프로필 줄: 좁으면 옆으로 넘김 */}
      <div className="pk-cs-row pk-scroll" role="listbox" aria-label="캐릭터">
        {CHAR_IDS.map((c) => {
          const lock = !charOwned(c, owned);
          return (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={sel === c}
              onClick={() => {
                setSel(c);
                playVoice(c, "select");
              }}
              className="pk-cs-item"
              style={{ "--c": CHARS[c].color } as React.CSSProperties}
            >
              <Profile char={c} size={54} className={lock ? "opacity-55 grayscale-[0.6]" : ""} />
              <span className="pk-cs-name">{CHARS[c].name}</span>
              {lock && <span className="pk-cs-badge">🔒</span>}
              {c === current && <span className="pk-cs-now">사용 중</span>}
            </button>
          );
        })}
      </div>

      {locked ? (
        <button
          type="button"
          onClick={onShop}
          className="pk-btn pk-btn-gold py-[0.6em] text-[0.92em]"
        >
          상점에서 {info.name} 구매하기 · 칩 {fmtEok(price)}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onPick(sel)}
          className="pk-btn pk-btn-gold py-[0.6em] text-[0.92em]"
        >
          {sel === current ? "확인" : `${info.name}(으)로 변경`}
        </button>
      )}
    </div>
  );
}

export type PokerRankTab = "money" | "buy" | "ach";

/** 순위 한 줄 (자금 · 구매 순위가 같은 모양을 씀) */
interface RankItem {
  nick: string;
  look: Look;
  value: ReactNode;
  sub: ReactNode;
}

/**
 * 순위 창: 자금 · 구매 · 업적 순위 탭 — 로비 「순위」와 게임 머리말의 랭킹 창에서 같이 씀.
 * 1~3위는 시상대(캐릭터 얼굴 크게), 4위부터 줄, 맨 아래에 내 순위가 늘 붙어 있음.
 * (무대 밖 머리말 창에서도 같은 색이 나오게 색은 변수 대신 값으로)
 */
export function PokerRanks({
  rank,
  myNick,
  tab: tabP,
  onTab,
}: {
  rank: RankRow[] | null;
  myNick?: string;
  /** 바깥에서 탭을 쥘 때 (머리말 창 제목이 탭 따라 바뀜) */
  tab?: PokerRankTab;
  onTab?: (t: PokerRankTab) => void;
}) {
  const [tabS, setTabS] = useState<PokerRankTab>("money");
  const [buy, setBuy] = useState<BuyRankRow[] | null>(null);
  const tab = tabP ?? tabS;
  const setTab = onTab ?? setTabS;
  useEffect(() => {
    if (tab !== "buy") return;
    let alive = true;
    getBuyRank()
      .then((r) => alive && setBuy(r))
      .catch(() => alive && setBuy((cur) => cur ?? []));
    return () => {
      alive = false;
    };
  }, [tab]);
  const items: RankItem[] | null =
    tab === "money"
      ? (rank?.map((r) => ({
          nick: r.nick,
          look: r.look ?? r.char,
          value: <Money won={r.money} />,
          sub: `${r.hands.toLocaleString()}판`,
        })) ?? null)
      : tab === "buy"
        ? (buy?.map((r) => ({
            nick: r.nick,
            look: r.look ?? r.char,
            value: <span className="pk-num">{fmtPoint(r.spent)}</span>,
            sub: `스킨 ${r.skins} · 캐릭터 ${r.chars}`,
          })) ?? null)
        : null;
  return (
    <div className="flex flex-col gap-[0.7em] pb-[0.9em]">
      <div className="pk-seg" role="tablist">
        {(
          [
            ["money", "자금 순위"],
            ["buy", "구매 순위"],
            ["ach", "업적 순위"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "ach" ? (
        <AchievementRank game="poker" />
      ) : (
        <RankBoard
          items={items}
          myNick={myNick}
          empty={
            tab === "money"
              ? "아직 한 판도 안 쳤어요. 첫 기록의 주인공이 되어 보세요."
              : "아직 아무도 안 샀어요. 상점에서 첫 손님이 되어 보세요."
          }
        />
      )}
    </div>
  );
}

/** 시상대 색: 금 · 은 · 동 */
const PODIUM = ["#ffd84a", "#d9dde6", "#e0954a"];

function RankBoard({ items, myNick, empty }: { items: RankItem[] | null; myNick?: string; empty: string }) {
  if (items === null) return <p className="py-[2em] text-center text-[0.88em] text-white/40">불러오는 중…</p>;
  if (!items.length) return <p className="py-[2em] text-center text-[0.88em] text-white/40">{empty}</p>;
  const meIdx = myNick ? items.findIndex((r) => r.nick === myNick) : -1;
  const top = items.slice(0, 3);
  return (
    <div className="flex flex-col gap-[0.35em]">
      {/* 시상대: 2위 · 1위 · 3위 */}
      <div className="pk-podium">
        {[1, 0, 2].map((i) =>
          top[i] ? (
            <div
              key={i}
              className={`pk-podium-col ${i === 0 ? "pk-podium-1" : ""}`}
              style={{ "--m": PODIUM[i] } as CSSProperties}
            >
              <div className="pk-podium-face">
                <Profile char={top[i].look} size={i === 0 ? 70 : 54} />
                <span className="pk-podium-no">{i + 1}</span>
              </div>
              <div className={`pk-podium-nick ${i === meIdx ? "pk-podium-me" : ""}`}>{top[i].nick}</div>
              <div className="pk-podium-val">{top[i].value}</div>
              <div className="pk-podium-sub">{top[i].sub}</div>
              <div className="pk-podium-step" style={{ height: [44, 30, 20][i] }} />
            </div>
          ) : (
            <div key={i} />
          )
        )}
      </div>
      {items.length > 3 && (
        <ol className="grid gap-[0.3em]">
          {items.slice(3).map((r, j) => {
            const i = j + 3;
            return (
              <li key={`${r.nick}-${i}`} className={`pk-rank-row ${i === meIdx ? "pk-rank-me" : ""}`}>
                <span className="pk-rank-no">{i + 1}</span>
                <Profile char={r.look} size={34} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-bold">{r.nick}</span>
                  <span className="block truncate text-[0.78em] text-white/45">{r.sub}</span>
                </span>
                <span className="pk-rank-val">{r.value}</span>
              </li>
            );
          })}
        </ol>
      )}
      {/* 내 순위: 아래에 늘 붙어 있음 */}
      {myNick && (
        <div className="pk-rank-mine">
          {meIdx >= 0 ? (
            <>
              <span className="pk-rank-no">{meIdx + 1}</span>
              <Profile char={items[meIdx].look} size={30} />
              <span className="min-w-0 flex-1 truncate font-bold">
                내 순위 <span className="font-normal text-white/50">· {items[meIdx].sub}</span>
              </span>
              <span className="pk-rank-val">{items[meIdx].value}</span>
            </>
          ) : (
            <span className="flex-1 text-center text-white/55">내 순위 · 아직 순위에 없어요</span>
          )}
        </div>
      )}
    </div>
  );
}
