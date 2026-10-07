"use client";

import { useEffect, useState } from "react";
import { BOT_IDS, BOT_INFO, DEFAULT_BOTS, GAMES, REVIVE, TIERS, fmtWon, type GameKind, type Tier, type TierId } from "@/lib/poker/rules";
import type { LobbyTable, RankRow, Wallet } from "@/lib/poker/types";
import { createTable, quickJoin, revive, subscribeLobby } from "@/realtime/poker";
import { Money, Portrait } from "./parts";

/*
 * 포커 로비: 내 돈 · 회생 → 게임 고르기(홀덤 / 7포커) → 판돈 3단계 중 하나로 바로 입장.
 * 아래에 열린 테이블 목록(친구와 같이 치려면 테이블을 직접 만들어 비밀번호를 걸 수 있음), 봇 소개, 자금 순위.
 */

const MODE_KEY = "poker_mode";

function stakeLine(game: GameKind, t: Tier) {
  return game === "holdem" ? `블라인드 ${fmtWon(t.sb)} / ${fmtWon(t.bb)}` : `기본 판돈 ${fmtWon(t.ante)}`;
}

export default function Lobby({
  wallet,
  rank,
  myNick,
  onEnter,
  onWallet,
}: {
  wallet: Wallet;
  rank: RankRow[] | null;
  myNick: string;
  onEnter: (id: string) => void;
  onWallet: (w: Wallet) => void;
}) {
  const [game, setGameState] = useState<GameKind>("holdem");
  const [tables, setTables] = useState<LobbyTable[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ tier: 1 as TierId, bots: DEFAULT_BOTS, name: "", password: "" });

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
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy("");
    }
  };

  const canRevive = wallet.money < REVIVE.under && wallet.reviveUsed < REVIVE.perDay;
  const reviveLeft = REVIVE.perDay - wallet.reviveUsed;
  const myRank = rank ? rank.findIndex((r) => r.nick === myNick) + 1 : 0;
  const shown = (tables ?? []).filter((t) => t.game === game);
  // 테이블 만들기: 봇 수는 그 게임의 자리 수에 맞추고(7포커는 3명까지), 입장컷이 안 되는 판돈으로는 만들지 않음
  const maxBots = Math.min(4, GAMES[game].seats - 2);
  const formBots = Math.min(form.bots, maxBots);
  const canCreate = wallet.money >= TIERS[form.tier - 1].min;

  return (
    <div className="pk mx-auto max-w-5xl px-3 pb-24 sm:px-6">
      {/* 내 돈 */}
      <section className="mt-2 grid gap-px overflow-hidden rounded-2xl border border-[var(--pk-line)] bg-[var(--pk-line)] sm:grid-cols-[1.4fr_1fr]">
        <div className="bg-[var(--pk-panel)] px-5 py-4 sm:px-6 sm:py-5">
          <div className="text-xs text-white/45">보유금액</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Money won={wallet.money} className="text-[2.6rem] leading-none text-[var(--pk-brass)] sm:text-[3.2rem]" />
            <span className="text-sm text-white/40">원</span>
            {myRank > 0 && <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-white/60">자금 순위 {myRank}위</span>}
          </div>
          {wallet.table && (
            <button
              type="button"
              onClick={() => onEnter(wallet.table!)}
              className="mt-3 cursor-pointer rounded-full bg-[var(--pk-call)] px-4 py-1.5 text-sm font-bold text-[#06231c] hover:brightness-110"
            >
              앉아 있던 테이블로 돌아가기
            </button>
          )}
        </div>
        <div className="flex flex-col justify-center gap-2 bg-[var(--pk-panel)] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between text-xs text-white/45">
            <span>회생</span>
            <span>
              오늘 남은 횟수 <b className="text-white/80">{reviveLeft}</b> / {REVIVE.perDay}
            </span>
          </div>
          <button
            type="button"
            disabled={!canRevive || busy === "revive"}
            onClick={() => run("revive", async () => onWallet(await revive()))}
            className="cursor-pointer rounded-xl bg-[var(--pk-brass)] px-4 py-2.5 text-sm font-bold text-[#2a1e05] transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/30"
          >
            {busy === "revive" ? "받는 중…" : `회생 받기 +${fmtWon(REVIVE.amount)}`}
          </button>
          <p className="text-[11px] leading-relaxed text-white/40">
            {canRevive
              ? "보유금액이 500만 원 아래라 지금 받을 수 있어요."
              : reviveLeft <= 0
                ? "오늘 회생은 다 썼어요. 자정에 다시 채워져요."
                : `보유금액이 ${fmtWon(REVIVE.under)} 원 아래로 내려가면 받을 수 있어요.`}
          </p>
        </div>
      </section>

      {/* 게임 고르기 */}
      <section className="mt-7">
        <div role="tablist" aria-label="게임" className="grid grid-cols-2 gap-2">
          {(Object.keys(GAMES) as GameKind[]).map((g) => {
            const on = g === game;
            return (
              <button
                key={g}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => setGame(g)}
                className={`cursor-pointer rounded-2xl border px-4 py-3 text-left transition sm:px-5 sm:py-4 ${
                  on ? "border-[var(--pk-brass)] bg-[#2a2412]" : "border-[var(--pk-line)] bg-[var(--pk-panel)] hover:border-white/25"
                }`}
              >
                <span className={`pk-title block text-2xl sm:text-3xl ${on ? "text-[var(--pk-brass)]" : "text-white/75"}`}>{GAMES[g].name}</span>
                <span className="mt-1 block text-xs text-white/45 sm:text-[13px]">
                  {GAMES[g].blurb} · {GAMES[g].seats}인
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 판돈 3단계 */}
      <section className="mt-3 grid gap-3 sm:grid-cols-3">
        {TIERS.map((t) => {
          const short = t.min - wallet.money;
          const locked = short > 0;
          return (
            <div key={t.id} className="flex flex-col overflow-hidden rounded-2xl border border-[var(--pk-line)] bg-[var(--pk-panel)]">
              <div className="pk-felt relative h-24 px-4 py-3" data-tier={t.id}>
                <div className="pk-title text-[1.7rem] leading-none text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.6)]">{t.name}</div>
                <div className="mt-2 text-xs text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">{t.blurb}</div>
                <div className="absolute right-3 bottom-2 flex -space-x-2">
                  {BOT_IDS.slice(0, 3).map((b) => (
                    <Portrait key={b} bot={b} name="" size={26} className="ring-2 ring-black/40" />
                  ))}
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-[13px]">
                <dt className="text-white/40">{game === "holdem" ? "블라인드" : "기본 판돈"}</dt>
                <dd className="text-right text-white/85">{game === "holdem" ? `${fmtWon(t.sb)} / ${fmtWon(t.bb)}` : fmtWon(t.ante)}</dd>
                <dt className="text-white/40">입장컷</dt>
                <dd className={`text-right ${locked ? "text-[var(--pk-danger)]" : "text-white/85"}`}>보유 {fmtWon(t.min)} 이상</dd>
                <dt className="text-white/40">봇 자금</dt>
                <dd className="text-right text-white/85">{fmtWon(t.botMoney)}</dd>
              </dl>
              <div className="mt-auto px-4 pb-4">
                <button
                  type="button"
                  disabled={locked || !!busy}
                  onClick={() => run(`q${t.id}`, async () => onEnter(await quickJoin(game, t.id)))}
                  className="w-full cursor-pointer rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#15161a] transition hover:bg-[var(--pk-brass)] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/35"
                >
                  {locked ? `${fmtWon(short)} 더 있어야 해요` : busy === `q${t.id}` ? "들어가는 중…" : "바로 입장"}
                </button>
              </div>
            </div>
          );
        })}
      </section>
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-[var(--pk-danger)]/40 bg-[var(--pk-danger)]/10 px-4 py-2.5 text-sm text-[#ffb3b5]">
          {error}
        </p>
      )}

      {/* 열린 테이블 */}
      <section className="mt-9">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-white">열린 {GAMES[game].name} 테이블</h2>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-sm text-white/80 hover:border-white/40"
          >
            {creating ? "닫기" : "테이블 만들기"}
          </button>
        </div>

        {creating && (
          <form
            className="mb-4 grid gap-4 rounded-2xl border border-[var(--pk-line)] bg-[var(--pk-panel)] p-4 sm:p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canCreate) return;
              run("create", async () => onEnter(await createTable({ game, ...form, bots: formBots })));
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset>
                <legend className="mb-1.5 text-xs text-white/45">판돈</legend>
                <div className="flex flex-wrap gap-1.5">
                  {TIERS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={form.tier === t.id}
                      disabled={wallet.money < t.min}
                      onClick={() => setForm((f) => ({ ...f, tier: t.id }))}
                      className={`cursor-pointer rounded-full px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-35 ${
                        form.tier === t.id ? "bg-[var(--pk-brass)] font-bold text-[#2a1e05]" : "bg-white/[0.06] text-white/70 hover:bg-white/10"
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-white/40">{stakeLine(game, TIERS[form.tier - 1])}</p>
              </fieldset>
              <fieldset>
                <legend className="mb-1.5 text-xs text-white/45">같이 앉을 봇</legend>
                <div className="flex flex-wrap gap-1.5">
                  {[0, 1, 2, 3, 4]
                    .filter((n) => n <= maxBots)
                    .map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={formBots === n}
                        onClick={() => setForm((f) => ({ ...f, bots: n }))}
                        className={`cursor-pointer rounded-full px-3 py-1.5 text-sm transition ${
                          formBots === n ? "bg-[var(--pk-brass)] font-bold text-[#2a1e05]" : "bg-white/[0.06] text-white/70 hover:bg-white/10"
                        }`}
                      >
                        {n === 0 ? "없음" : `${n}명`}
                      </button>
                    ))}
                </div>
                <p className="mt-1.5 text-[11px] text-white/40">사람이 들어오면 봇이 자리를 비켜 줘요.</p>
              </fieldset>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs text-white/45">
                테이블 이름
                <input
                  value={form.name}
                  maxLength={20}
                  placeholder={`${myNick}의 테이블`}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-[#15171c] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--pk-brass)] focus:outline-none"
                />
              </label>
              <label className="grid gap-1.5 text-xs text-white/45">
                비밀번호 (비우면 누구나 입장)
                <input
                  value={form.password}
                  maxLength={20}
                  autoComplete="off"
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="rounded-lg border border-white/10 bg-[#15171c] px-3 py-2 text-sm text-white focus:border-[var(--pk-brass)] focus:outline-none"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={!!busy || !canCreate}
              className="cursor-pointer rounded-xl bg-white py-2.5 text-sm font-bold text-[#15161a] hover:bg-[var(--pk-brass)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "create" ? "만드는 중…" : canCreate ? "테이블 만들고 앉기" : `보유금액이 ${TIERS[form.tier - 1].name} 입장컷(${fmtWon(TIERS[form.tier - 1].min)})보다 적어요`}
            </button>
          </form>
        )}

        {tables === null ? (
          <p className="py-10 text-center text-sm text-white/30">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm text-white/40">
            지금 열린 테이블이 없어요. 위에서 판돈을 골라 바로 입장하면 봇과 함께 새 테이블이 열려요.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {shown.map((t) => {
              const tier = TIERS[t.tier - 1];
              const full = t.humans + t.bots >= t.max && t.bots === 0;
              const short = wallet.money < tier.min;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={full || short}
                    onClick={() => onEnter(t.id)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[var(--pk-line)] bg-[var(--pk-panel)] px-3 py-2.5 text-left transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="pk-felt h-10 w-10 shrink-0 rounded-lg" data-tier={t.tier} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">
                        {t.locked && <span aria-label="비밀번호 있음">🔒 </span>}
                        {t.name}
                      </span>
                      <span className="block text-[11px] text-white/40">
                        {tier.name} · {stakeLine(t.game, tier)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-white/60">
                      <span className="block">
                        사람 <b className="text-white">{t.humans}</b> · 봇 {t.bots}
                      </span>
                      <span className="block text-white/35">{t.max}자리</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 봇 · 순위 */}
      <div className="mt-9 grid gap-8 lg:grid-cols-[1.25fr_1fr]">
        <section>
          <h2 className="mb-3 text-base font-bold text-white">테이블에서 만날 사람들</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {BOT_IDS.map((b) => (
              <li key={b} className="flex gap-3 rounded-xl border border-[var(--pk-line)] bg-[var(--pk-panel)] p-3">
                <Portrait bot={b} name={BOT_INFO[b].name} size={52} />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[15px] font-bold text-white">{BOT_INFO[b].name}</span>
                    <span className="text-xs text-white/40">
                      {BOT_INFO[b].age}세 · {BOT_INFO[b].style}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed break-keep text-white/55">{BOT_INFO[b].line}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-white/35">판돈이 커질수록 봇도 더 정확하게 쳐요. 봇은 자기 패와 테이블에 보이는 것만 봐요.</p>
        </section>
        <section>
          <h2 className="mb-3 text-base font-bold text-white">자금 순위</h2>
          <RankTable rank={rank} myNick={myNick} limit={10} />
        </section>
      </div>
    </div>
  );
}

export function RankTable({ rank, myNick, limit }: { rank: RankRow[] | null; myNick?: string; limit?: number }) {
  if (rank === null) return <p className="py-6 text-center text-sm text-white/30">불러오는 중…</p>;
  if (!rank.length)
    return <p className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-white/40">아직 한 판이라도 친 사람이 없어요. 첫 번째로 이름을 올려 보세요.</p>;
  const list = limit ? rank.slice(0, limit) : rank;
  return (
    <ol className="pk overflow-hidden rounded-xl border border-[var(--pk-line)]">
      {list.map((r, i) => (
        <li
          key={r.nick}
          className={`flex items-center gap-3 border-b border-[var(--pk-line)] px-3 py-2 last:border-b-0 ${r.nick === myNick ? "bg-[#2a2412]" : "bg-[var(--pk-panel)]"}`}
        >
          <span className={`pk-num w-6 text-center text-lg ${i < 3 ? "text-[var(--pk-brass)]" : "text-white/35"}`}>{i + 1}</span>
          <Portrait bot={null} name={r.nick} avatar={r.avatar} size={28} />
          <span className="min-w-0 flex-1 truncate text-sm text-white">{r.nick}</span>
          <span className="text-[11px] text-white/35">{r.hands.toLocaleString()}판</span>
          <Money won={r.money} className="text-lg text-white" />
        </li>
      ))}
    </ol>
  );
}
