"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal/Modal";
import RankAvatar from "@/components/RankAvatar";
import { useAuth } from "@/lib/AuthContext";
import { getUserCard } from "@/lib/api/social";
import { fmtWon } from "@/lib/poker/rules";
import type { UserCard } from "@/lib/social";
import { friendByNick, openChat, openReport, social, useSocial } from "@/lib/socialStore";
import { KR, btn, presenceLine } from "./parts";

/* 정보보기: 그 회원의 공개 정보 (게임 기록 등). 이메일 · GP · 방문 기록 같은 개인 정보는 서버가 아예 안 줌 */

const ONLINE_NAME: Record<string, string> = {
  chess: "체스",
  janggi: "장기",
  omok: "오목",
};

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/6 py-2 last:border-0">
      <span className="text-xs text-white/45">{k}</span>
      <span className="text-right font-mono text-[13px] text-white/90 tabular-nums">{v}</span>
    </div>
  );
}

export default function UserCardModal() {
  const s = useSocial();
  const nick = s.ui.card;
  const close = () => social.setUi({ card: null });
  return (
    <Modal open={!!nick} onClose={close} title="정보 보기" size="sm" closeButton>
      {nick && <CardBody key={nick} nick={nick} close={close} />}
    </Modal>
  );
}

function CardBody({ nick, close }: { nick: string; close: () => void }) {
  const s = useSocial();
  const { profile } = useAuth();
  const [card, setCard] = useState<UserCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getUserCard(nick)
      .then((c) => alive && setCard(c))
      .catch((e: Error) => alive && setErr(e.message || "정보를 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [nick]);

  // 친구 상태는 실시간 목록이 더 새것
  const live = card && s.status === "ready" ? friendByNick(card.nick) : undefined;
  const rel =
    card?.rel === "self"
      ? "self"
      : (live?.status ?? (s.status === "ready" ? null : (card?.rel ?? null)));
  const pres = live && live.status === "friends" ? live : card?.presence;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setMsg((e as Error).message || "잠시 후 다시 해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={KR}>
      {err && <p className="py-8 text-center text-sm text-white/55">{err}</p>}
      {!err && !card && (
        <p className="py-8 text-center font-mono text-xs text-white/35">불러오는 중…</p>
      )}
      {card && (
        <>
          <div className="flex items-center gap-3">
            <RankAvatar avatar={card.pic} name={card.nick} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-lg font-bold text-white">
                {card.badge && <span className="mr-1">{card.badge}</span>}
                {card.nick}
              </div>
              <div className="mt-0.5 text-xs text-white/45">
                {pres ? (
                  <span className={pres.online ? "text-[#6EE7B7]" : ""}>
                    ● {presenceLine(pres)}
                  </span>
                ) : (
                  <>{new Date(card.since).toLocaleDateString("ko-KR")} 가입</>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ["게임", card.plays.toLocaleString()],
              ["업적", card.achs.toLocaleString()],
              ["친구", card.friends.toLocaleString()],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/[0.04] py-2.5">
                <div className="font-mono text-base font-bold text-white tabular-nums">{v}</div>
                <div className="text-[11px] text-white/40">{k}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-white/8 px-3">
            {card.poker && (
              <Row
                k="ANIME POKER"
                v={`${fmtWon(card.poker.money)} · ${card.poker.hands.toLocaleString()}판 ${card.poker.wins.toLocaleString()}승`}
              />
            )}
            {card.fight && (
              <Row
                k="PIXEL FIGHT"
                v={
                  card.fight.rating
                    ? `레이팅 ${card.fight.rating.r} · ${card.fight.rating.rank}/${card.fight.rating.of}위`
                    : `${card.fight.matches.toLocaleString()}경기`
                }
              />
            )}
            {card.rhythm && (
              <Row
                k="PIXEL Rhythm Up"
                v={`BP ${card.rhythm.bp.toLocaleString()} · ${card.rhythm.rank}/${card.rhythm.of}위`}
              />
            )}
            {card.defense && (
              <Row
                k="PIXEL LUCKY DEFENSE"
                v={`최고 ${card.defense.wave}웨이브 · ${card.defense.wins.toLocaleString()}번 클리어`}
              />
            )}
            {card.sketch && (
              <Row
                k="DOODLE PARTY"
                v={`${card.sketch.games.toLocaleString()}판 · 1등 ${card.sketch.wins.toLocaleString()}번`}
              />
            )}
            {card.online.map((o) => (
              <Row
                key={o.game}
                k={`온라인 ${ONLINE_NAME[o.game] ?? o.game}`}
                v={`${o.w}승 ${o.l}패${o.d ? ` ${o.d}무` : ""}`}
              />
            ))}
            {!card.poker &&
              !card.fight &&
              !card.rhythm &&
              !card.defense &&
              !card.sketch &&
              !card.online.length && (
                <p className="py-4 text-center text-xs text-white/35">
                  아직 남긴 게임 기록이 없어요
                </p>
              )}
          </div>
          {pres && (
            <p className="mt-2 text-right text-[11px] text-white/30">
              {new Date(card.since).toLocaleDateString("ko-KR")} 가입
            </p>
          )}

          {rel !== "self" && profile && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {rel === "friends" && live && (
                <button
                  type="button"
                  className={btn.primary}
                  onClick={() => {
                    close();
                    openChat(live.uid);
                  }}
                >
                  메시지 보내기
                </button>
              )}
              {rel === "in" && live && (
                <button
                  type="button"
                  disabled={busy}
                  className={btn.primary}
                  onClick={() => act(() => social.accept(live.uid), "이제 친구예요")}
                >
                  친구 요청 수락
                </button>
              )}
              {rel === "out" && <span className="text-xs text-white/45">친구 요청을 보냈어요</span>}
              {!rel && (
                <button
                  type="button"
                  disabled={busy || s.status !== "ready"}
                  className={btn.primary}
                  onClick={() => act(() => social.request(card.nick), "친구 요청을 보냈어요")}
                >
                  친구 추가
                </button>
              )}
              <button
                type="button"
                className={`${btn.danger} ml-auto`}
                onClick={() => openReport(card.nick)}
              >
                신고하기
              </button>
            </div>
          )}
          {msg && <p className="mt-2 text-xs break-keep text-[#C4B5FD]">{msg}</p>}
        </>
      )}
    </div>
  );
}
