"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { asset, roomTint } from "@/lib/poker/assets";
import { playVoice } from "@/lib/poker/sfx";
import {
  CHARS,
  CHAR_IDS,
  GAMES,
  LEAGUES,
  TIERS,
  fmtShort,
  lookOf,
  type CharId,
  type GameKind,
  type Tier,
  type TierId,
  lookName,
} from "@/lib/poker/rules";
import type { BuyRankRow, LobbyTable, RankRow, Wallet } from "@/lib/poker/types";
import { createTable, getBuyRank, quickJoin, setChar, subscribeLobby } from "@/realtime/poker";
import type { Orient } from "./layout";
import MyPage from "./MyPage";
import PatchNotes, { LATEST } from "./PatchNotes";
import LobbyChar from "./LobbyChar";
import Sheet from "./Sheet";
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

export default function Lobby({
  wallet,
  rank,
  myNick,
  o,
  h,
  onEnter,
  topRight,
}: {
  wallet: Wallet;
  rank: RankRow[] | null;
  myNick: string;
  o: Orient;
  w: number;
  h: number;
  onEnter: (id: string) => void;
  onWallet: (w: Wallet) => void;
  topRight?: ReactNode;
}) {
  const [game, setGameState] = useState<GameKind>("holdem");
  const [tier, setTier] = useState<TierId>(1);
  const [tables, setTables] = useState<LobbyTable[] | null>(null);
  const [busy, setBusy] = useState("");
  const [sheet, setSheet] = useState<"" | "create" | "char" | "rank" | "me" | "mychar">("");
  const [form, setForm] = useState({ name: "", password: "", bots: true });
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
  const H = o === "h";
  const bar = 44;
  const info = CHARS[wallet.char];
  /** 그림 열쇠 (스킨을 입었으면 스킨) */
  const look = lookOf(wallet.char, wallet.wear);

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
        style={{ height: H ? bar - 8 : bar - 14, width: "auto" }}
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
    <div className="grid shrink-0 grid-cols-2 gap-[0.5em]" style={{ height: H ? "100%" : 112 }}>
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
            <ModeCards game={g} h={H} />
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
      style={{ gridTemplateRows: H ? "1fr auto" : "auto auto" }}
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
          {busy === "quick"
            ? "입장 중…"
            : locked
              ? `칩 ${fmtShort(T.min)}부터 입장 가능`
              : (
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
                    {!t.bots && (
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
          backgroundImage: `url(${asset.room("lobby", o)})`,
          filter: "brightness(0.5) saturate(0.85)",
        }}
      />
      {top}
      {H ? (
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
      ) : (
        // 세로판: 화면이 낮으면(전체화면 아닐 때) 열린 방이 찌그러지지 않게 전체가 스크롤됨
        <div
          className="pk-scroll absolute inset-x-0 bottom-0 flex flex-col gap-[0.55em] overflow-y-auto overscroll-contain p-[0.6em]"
          style={{ top: bar }}
        >
          {/* 세로판: 내 정보 한 줄 */}
          <div
            className="pk-frame pk-me relative isolate flex shrink-0 items-center gap-[0.6em] overflow-hidden p-[0.5em]"
            style={{ "--c": info.color } as CSSProperties}
          >
            <div className="pk-me-glow absolute inset-0 -z-10" />
            <button
              type="button"
              onClick={() => setSheet("mychar")}
              className="shrink-0 cursor-pointer"
              aria-label="내 캐릭터"
            >
              <Profile char={look} size={44} className="ring-2 ring-[var(--pk-brass)]" />
            </button>
            <button
              type="button"
              onClick={() => setSheet("me")}
              className="min-w-0 flex-1 cursor-pointer text-left"
              aria-label="마이페이지"
            >
              <div className="flex items-baseline gap-[0.4em]">
                <span className="min-w-0 truncate text-[1.1em] font-extrabold">{myNick}</span>
                <span
                  className="max-w-[45%] min-w-0 shrink truncate text-[0.8em] font-bold"
                  style={{ color: info.color }}
                >
                  {lookName(look)}
                </span>
                <span className="ml-auto shrink-0 text-[0.68em] text-white/40">마이페이지 ›</span>
              </div>
              <div className="flex items-center gap-[0.3em]">
                {}
                <img src={asset.chip("gold", "top")} alt="" className="h-[1.1em] w-[1.1em]" />
                <Money won={wallet.money} className="text-[1.2em] text-[#ffd84a]" />
              </div>
            </button>
            {myRank > 0 && (
              <button
                type="button"
                onClick={() => setSheet("rank")}
                className="flex shrink-0 flex-col items-center rounded-[8px] border border-[rgba(255,201,60,0.45)] bg-black/45 px-[0.8em] py-[0.2em] leading-tight"
              >
                <span className="text-[0.68em] text-white/55">순위</span>
                <span className="text-[1.2em] font-extrabold text-[#ffd84a]">{myRank}위</span>
              </button>
            )}
          </div>
          {mode}
          <div className="pk-frame shrink-0 p-[0.6em]">{tiers}</div>
          <div className="flex min-h-[17em] flex-1 flex-col">{rooms}</div>
        </div>
      )}

      {notes && <PatchNotes onClose={() => setNotes(false)} />}
      {/* 알림 토스트 */}
      {toast && (
        <div key={toast.key} role="status" className="pk-toast" style={{ bottom: H ? 90 : 110 }}>
          {toast.text}
        </div>
      )}

      {/* 창(바텀시트): 하나만 띄우고 내용만 바꿈 — 뒤로가기 기록이 한 번만 쌓이게 */}
      {sheet && (
        <Sheet
          key="sheet"
          mobile={!H}
          maxH={sheet === "me" ? h - (H ? 24 : 8) : Math.min(h - (H ? 24 : 8), H ? h : h * 0.9)}
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
                      bots: form.bots,
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
                  checked={form.bots}
                  onChange={(e) => setForm({ ...form, bots: e.target.checked })}
                  className="h-[1.1em] w-[1.1em] accent-[var(--pk-brass)]"
                />
                <span>바로 입장 허용</span>
              </label>
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
              o={o}
              onPick={(c) => void run("char", async () => (await setChar(c), setSheet("")))}
            />
          )}
          {sheet === "me" && (
            <MyPage
              wallet={wallet}
              compact={!H}
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
              className="pk-scroll min-h-0 flex-1 overflow-y-auto px-[0.9em] pb-[0.9em]"
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

/** 캐릭터 고르기: 전신 5명 */
function CharSelect({
  current,
  o,
  onPick,
}: {
  current: CharId;
  o: Orient;
  onPick: (c: CharId) => void;
}) {
  const [sel, setSel] = useState<CharId>(current);
  const info = CHARS[sel];
  return (
    <div className="flex min-h-0 flex-col gap-[0.6em] p-[0.9em] pt-[0.4em]">
      <div className="flex items-end justify-center" style={{ height: o === "h" ? 260 : 220 }}>
        {CHAR_IDS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={sel === c}
            onClick={() => {
              setSel(c);
              playVoice(c, "select");
            }}
            className="pk-pick h-full min-w-0 flex-1 cursor-pointer"
          >
            {}
            <img
              src={asset.full(c)}
              alt={CHARS[c].name}
              draggable={false}
              className="mx-auto h-full w-auto max-w-none object-contain"
            />
          </button>
        ))}
      </div>
      <div
        className="flex items-center gap-[0.6em] rounded-[8px] px-[0.7em] py-[0.45em]"
        style={{ background: `linear-gradient(90deg, ${info.color}55, transparent)` }}
      >
        <Profile char={sel} size={36} />
        <div>
          <div className="text-[0.95em] font-extrabold">{info.name}</div>
          <div className="text-[0.72em] text-white/65">{info.blurb}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onPick(sel)}
        className="pk-btn pk-btn-gold py-[0.6em] text-[0.92em]"
      >
        {sel === current ? "확인" : `${info.name}(으)로 변경`}
      </button>
    </div>
  );
}

/** 자금 순위 표 (로비 · 게임 머리말의 랭킹 모달에서 같이 씀) */
/** 순위 창: 자금 순위 / 구매 순위 탭 */
export function PokerRanks({ rank, myNick }: { rank: RankRow[] | null; myNick?: string }) {
  const [tab, setTab] = useState<"money" | "buy">("money");
  const [buy, setBuy] = useState<BuyRankRow[] | null>(null);
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
  return (
    <div>
      <div className="mb-1 flex gap-1 pt-1" role="tablist">
        {(
          [
            ["money", "자금 순위"],
            ["buy", "구매 순위"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              tab === k
                ? "bg-[var(--pk-brass)] text-black"
                : "bg-white/[0.06] text-white/60 hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "money" ? (
        <RankTable rank={rank} myNick={myNick} />
      ) : (
        <BuyRankTable rank={buy} myNick={myNick} />
      )}
    </div>
  );
}

/** 구매 순위: 스킨 · 캐릭터에 쓴 칩 합계, 산 개수 */
function BuyRankTable({ rank, myNick }: { rank: BuyRankRow[] | null; myNick?: string }) {
  if (rank === null) return <p className="py-6 text-center text-sm text-white/40">불러오는 중…</p>;
  if (!rank.length)
    return (
      <p className="py-6 text-center text-sm text-white/40">
        아직 아무도 안 샀어요. 상점에서 첫 손님이 되어 보세요.
      </p>
    );
  return (
    <ol className="divide-y divide-white/[0.07]">
      {rank.map((r, i) => {
        const me = myNick && r.nick === myNick;
        return (
          <li
            key={`${r.nick}-${i}`}
            className={`flex items-center gap-3 px-2 py-2 text-sm ${me ? "bg-[var(--pk-brass)]/10" : ""}`}
          >
            <span
              className={`w-6 text-center font-bold ${i < 3 ? "text-[var(--pk-brass)]" : "text-white/40"}`}
            >
              {i + 1}
            </span>
            <Profile char={r.look ?? r.char} size={30} />
            <span
              className={`min-w-0 flex-1 truncate ${me ? "font-bold text-[var(--pk-brass)]" : "text-white/85"}`}
            >
              {r.nick}
            </span>
            <span className="text-right text-xs leading-tight whitespace-nowrap text-white/45">
              스킨 {r.skins}
              <br />
              캐릭터 {r.chars}
            </span>
            <Money won={r.spent} className="text-base text-white" />
          </li>
        );
      })}
    </ol>
  );
}

export function RankTable({
  rank,
  myNick,
  limit,
}: {
  rank: RankRow[] | null;
  myNick?: string;
  limit?: number;
}) {
  if (rank === null) return <p className="py-6 text-center text-sm text-white/40">불러오는 중…</p>;
  const rows = limit ? rank.slice(0, limit) : rank;
  if (!rows.length)
    return (
      <p className="py-6 text-center text-sm text-white/40">
        아직 한 판도 안 쳤어요. 첫 기록의 주인공이 되어 보세요.
      </p>
    );
  return (
    <ol className="divide-y divide-white/[0.07]">
      {rows.map((r, i) => {
        const me = myNick && r.nick === myNick;
        return (
          <li
            key={`${r.nick}-${i}`}
            className={`flex items-center gap-3 px-2 py-2 text-sm ${me ? "bg-[var(--pk-brass)]/10" : ""}`}
          >
            <span
              className={`w-6 text-center font-bold ${i < 3 ? "text-[var(--pk-brass)]" : "text-white/40"}`}
            >
              {i + 1}
            </span>
            <Profile char={r.look ?? r.char} size={30} />
            <span
              className={`min-w-0 flex-1 truncate ${me ? "font-bold text-[var(--pk-brass)]" : "text-white/85"}`}
            >
              {r.nick}
            </span>
            <span className="text-xs text-white/40">{r.hands.toLocaleString()}판</span>
            <Money won={r.money} className="text-base text-white" />
          </li>
        );
      })}
    </ol>
  );
}
