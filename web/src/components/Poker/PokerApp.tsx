"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import NickForm from "@/components/Account/NickForm";
import { useAuth } from "@/lib/AuthContext";
import { BOT_IDS, BOT_INFO, REVIVE, START_MONEY, TIERS, fmtWon } from "@/lib/poker/rules";
import type { RankRow, Wallet } from "@/lib/poker/types";
import { getRank, subscribeWallet, watchClock } from "@/realtime/poker";
import Lobby, { RankTable } from "./Lobby";
import { Portrait } from "./parts";
import TableView from "./TableView";

/*
 * 포커 페이지의 몸통. 회원만 칠 수 있음:
 *   로그인 전 → 소개 + 로그인 버튼 / 별명 전 → 별명 정하기 / 회원 → 로비, 주소에 ?t=<테이블> 이 있으면 그 테이블
 */

export function useRank(): RankRow[] | null {
  const [rank, setRank] = useState<RankRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getRank()
        .then((r) => alive && setRank(r))
        .catch(() => alive && setRank((cur) => cur ?? []));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return rank;
}

export default function PokerApp({ rank }: { rank: RankRow[] | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const tableId = params.get("t");
  const { loading, account, profile, login } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [failed, setFailed] = useState("");
  const [loginError, setLoginError] = useState("");
  const nick = profile?.nick;

  useEffect(() => {
    if (!nick) return;
    watchClock();
    return subscribeWallet(
      (w) => {
        setWallet(w);
        setFailed("");
      },
      (e) => setFailed(e.message)
    );
  }, [nick]);

  const go = (id: string | null) => router.push(id ? `/games/poker/?t=${id}` : "/games/poker/");

  if (loading) return <p className="pk py-20 text-center text-sm text-white/40">로그인 상태를 확인하는 중…</p>;

  if (!account || !profile) {
    return (
      <div className="pk mx-auto max-w-5xl px-3 pb-24 sm:px-6">
        <section className="mt-2 overflow-hidden rounded-3xl border border-[var(--pk-line)]">
          <div className="pk-felt relative px-6 py-10 sm:px-10 sm:py-14" data-tier="2">
            <p className="pk-title text-[2.6rem] leading-[1.05] text-white drop-shadow-[0_3px_4px_rgba(0,0,0,0.5)] sm:text-6xl">
              가입하면
              <br />
              <span className="pk-num text-[1.5em] text-[var(--pk-brass)]">{fmtWon(START_MONEY)}</span> 원
            </p>
            <p className="mt-4 max-w-md text-sm leading-relaxed break-keep text-white/85 sm:text-base">
              홀덤과 7포커를 같은 돈으로 쳐요. 봇 네 명이 늘 앉아 있고, 친구와 테이블을 따로 열 수도 있어요. 다 잃어도 하루 {REVIVE.perDay}번, {fmtWon(REVIVE.amount)} 원씩 다시 받아요.
            </p>
            <div className="mt-6 max-w-sm">
              {!account ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginError("");
                      login().catch(() => setLoginError("로그인하지 못했어요. 잠시 후 다시 시도해주세요."));
                    }}
                    className="cursor-pointer rounded-xl bg-white px-6 py-3 text-[15px] font-bold text-[#15161a] shadow-lg transition hover:bg-[var(--pk-brass)]"
                  >
                    Google로 로그인하고 시작하기
                  </button>
                  <p className="mt-2 text-xs text-white/70">회원만 칠 수 있어요. 진짜 돈이 아니라 이 사이트 안에서만 쓰는 게임 머니예요.</p>
                  {loginError && <p className="mt-1 text-xs text-[#ffd0d0]">{loginError}</p>}
                </>
              ) : (
                <div className="rounded-2xl bg-black/45 p-4">
                  <p className="mb-2 text-sm text-white">별명을 정하면 바로 {fmtWon(START_MONEY)} 원이 들어와요.</p>
                  <NickForm submitLabel="시작하기" />
                </div>
              )}
            </div>
            <div className="absolute right-5 bottom-5 hidden -space-x-3 sm:flex">
              {BOT_IDS.map((b) => (
                <Portrait key={b} bot={b} name={BOT_INFO[b].name} size={68} className="ring-4 ring-black/35" />
              ))}
            </div>
          </div>
          <div className="grid gap-px bg-[var(--pk-line)] sm:grid-cols-3">
            {TIERS.map((t) => (
              <div key={t.id} className="bg-[var(--pk-panel)] px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="pk-felt h-5 w-5 rounded-full" data-tier={t.id} aria-hidden />
                  <span className="pk-title text-lg text-white">{t.name}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-white/50">
                  보유 {fmtWon(t.min)} 원부터 · 홀덤 블라인드 {fmtWon(t.sb)}/{fmtWon(t.bb)} · 7포커 판돈 {fmtWon(t.ante)}
                </p>
              </div>
            ))}
          </div>
        </section>
        <section className="mx-auto mt-9 max-w-xl">
          <h2 className="mb-3 text-base font-bold text-white">자금 순위</h2>
          <RankTable rank={rank} limit={10} />
        </section>
      </div>
    );
  }

  if (failed && !wallet)
    return (
      <p role="alert" className="pk py-20 text-center text-sm text-[#ffb3b5]">
        {failed}
      </p>
    );
  if (!wallet) return <p className="pk py-20 text-center text-sm text-white/40">지갑을 여는 중…</p>;

  if (tableId) return <TableView key={tableId} id={tableId} uid={account.uid} wallet={wallet} onExit={() => go(null)} onWallet={setWallet} />;
  return <Lobby wallet={wallet} rank={rank} myNick={profile.nick} onEnter={go} onWallet={setWallet} />;
}
