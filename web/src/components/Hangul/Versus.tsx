"use client";

import { useState } from "react";
import { EMOTES, type VsAttack, type VsMsg, type VsRoom } from "@/lib/hangul/versus";
import { LOAD_MAX } from "@/lib/hangul/game";
import { IMG } from "./assets";

/*
 * 니들이 한글을 알아? 대전 「말싸움」 화면 조각들 (상태 · 통신은 HangulApp)
 *   VsLobby     대전 모드 고르기 (친구 방 · 훈장님 AI)
 *   VsWaiting   대기실 (초대 링크 · 시작)
 *   VsBar       판 위 띠: 나 vs 상대 먹물 · 남은 시간 · 이모트
 *   VsFeed      중계석: 오간 문장이 대화처럼
 *   VsIncoming  날아오는 공격 (도착까지 남은 초 + 문장)
 *   VsCutin     공격 도착 순간 상대 문장을 크게
 *   VsResult    판 끝: 승패 · 말싸움 기록 · 오늘의 한 마디 투표
 */

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const KIND: Record<VsMsg["kind"], string> = {
  send: "⚔️ 보냄",
  guard: "🛡 막음",
  counter: "↩️ 받아침!",
  block: "🛡 완벽 방어!",
};
const gradeCls = (g: string) => `hg-sgrade g-${g.replace(" ", "")}`;

export function VsLobby({
  busy,
  err,
  onFriend,
  onBot,
  onBack,
}: {
  busy: boolean;
  err: string | null;
  onFriend(): void;
  onBot(level: number): void;
  onBack(): void;
}) {
  return (
    <div className="hg-title hg-vs">
      <h2 className="hg-logo">
        ⚔️ <em>말싸움</em> 대전
      </h2>
      <p className="hg-title-sub">
        문장을 완성하면 <b>막기와 공격이 한 번에</b> — 내 판 먹물을 쓸고, 그 문장이 <b>먹물 떼</b>가
        되어 상대 판으로 날아가요. 날아오는 문장과 <b>이어지는 말</b>(같은 말 다시 쓰기)로 받아치면
        1.5배로 되돌아가요.
      </p>
      <div className="hg-modes">
        <button type="button" className="hg-mode is-solo" disabled={busy} onClick={onFriend}>
          <i aria-hidden>👥</i>
          <b>친구랑</b>
          <small>방 만들고 초대 링크 보내기</small>
        </button>
        <div className="hg-mode is-vs hg-botpick">
          <i aria-hidden>
            <img src={IMG.hunjangHmm} alt="" />
          </i>
          <b>훈장님이랑</b>
          <span>
            {[1, 2, 3].map((lv) => (
              <button key={lv} type="button" disabled={busy} onClick={() => onBot(lv)}>
                {["", "쉬움", "보통", "어려움"][lv]}
              </button>
            ))}
          </span>
        </div>
      </div>
      <p className="hg-vsnote is-on" role="status">
        {err ?? (busy ? "방 만드는 중…" : " ")}
      </p>
      <button type="button" className="hg-linkbtn" onClick={onBack}>
        ← 처음 화면
      </button>
    </div>
  );
}

export function VsWaiting({
  room,
  me,
  onStart,
  onBot,
  onLeave,
}: {
  room: VsRoom;
  me: string;
  onStart(): void;
  onBot(level: number): void;
  onLeave(): void;
}) {
  const [copied, setCopied] = useState(false);
  const host = room.host === me;
  const link =
    typeof location !== "undefined" ? `${location.origin}/games/hangul/?vs=${room.id}` : "";
  const opp = room.players.find((p) => p.uid !== me);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* 복사 실패 — 칸에서 직접 */
    }
  };
  return (
    <div className="hg-title hg-vs">
      <h2 className="hg-logo">
        ⚔️ <em>말싸움</em> 대기실
      </h2>
      <div className="hg-vsseats">
        {[0, 1].map((k) => {
          const p = room.players[k];
          return (
            <div
              key={k}
              className={`hg-vsseat${p ? "" : " is-empty"}${p?.uid === me ? " is-me" : ""}`}
            >
              <img src={p?.bot ? IMG.hunjangAngry : IMG.hunjang} alt="" draggable={false} />
              <b>{p ? p.name : "빈자리"}</b>
              <small>
                {p
                  ? p.uid === room.host
                    ? "방장"
                    : p.here
                      ? "준비됨"
                      : "자리 비움"
                  : "친구를 기다려요"}
              </small>
            </div>
          );
        })}
      </div>
      {(!opp || opp.bot) && host && (
        <div className="hg-vsinvite">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="초대 링크"
          />
          <button type="button" onClick={copy}>
            {copied ? "복사됨!" : "링크 복사"}
          </button>
        </div>
      )}
      {host && (
        <p className="hg-vsbots">
          혼자면 훈장님을 앉히세요:{" "}
          {[1, 2, 3].map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => onBot(lv)}
              className={opp?.bot === lv ? "is-on" : undefined}
            >
              {["", "쉬움", "보통", "어려움"][lv]}
            </button>
          ))}
        </p>
      )}
      {host ? (
        <button type="button" className="hg-go" disabled={!opp || !opp.here} onClick={onStart}>
          {opp ? "말싸움 시작!" : "상대를 기다리는 중…"}
        </button>
      ) : (
        <p className="hg-title-rule">방장이 시작하면 바로 붙어요</p>
      )}
      <button type="button" className="hg-linkbtn" onClick={onLeave}>
        ← 나가기
      </button>
    </div>
  );
}

export function VsBar({
  room,
  me,
  myLoad,
  left,
  emotes,
  onEmote,
}: {
  room: VsRoom;
  me: string;
  myLoad: number;
  left: number;
  emotes: { uid: string; e: string; at: number }[];
  onEmote(e: string): void;
}) {
  const mine = room.players.find((p) => p.uid === me);
  const opp = room.players.find((p) => p.uid !== me);
  const side = (name: string, ld: number, pts: number, uid: string | undefined, right = false) => {
    const em = emotes.filter((x) => x.uid === uid).at(-1);
    return (
      <div
        className={`hg-vsside${right ? " is-right" : ""}${ld >= LOAD_MAX * 0.7 ? " is-warn" : ""}`}
      >
        <b>
          {name}
          {em && (
            <span className="hg-vsemote" key={em.at}>
              {em.e}
            </span>
          )}
        </b>
        <span className="hg-vsload" aria-label={`먹물 ${ld}/${LOAD_MAX}`}>
          <i style={{ transform: `scaleX(${Math.min(1, ld / LOAD_MAX)})` }} />
          <em>
            먹물 {ld}/{LOAD_MAX}
          </em>
        </span>
        <small>{fmt(pts)}점</small>
      </div>
    );
  };
  const sec = Math.max(0, Math.ceil(left / 1000));
  return (
    <div className="hg-vsbar">
      {side(mine?.name ?? "나", myLoad, mine?.points ?? 0, me)}
      <div className="hg-vsclock">
        <b className={sec <= 30 ? "is-warn" : undefined}>
          {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
        </b>
        <span className="hg-vsemotes">
          {EMOTES.map((e) => (
            <button key={e} type="button" onClick={() => onEmote(e)} aria-label={`이모트 ${e}`}>
              {e}
            </button>
          ))}
        </span>
      </div>
      {side(opp?.name ?? "상대", opp?.load ?? 0, opp?.points ?? 0, opp?.uid, true)}
    </div>
  );
}

/** 중계석(왼쪽: 오간 문장) + 날아오는 공격(오른쪽) — 자리를 고정해서 공격이 오가도 판이 안 밀림 */
export function VsFeed({
  room,
  me,
  incoming,
  now,
}: {
  room: VsRoom;
  me: string;
  incoming: VsAttack[];
  now: number;
}) {
  const list = room.log.slice(-3);
  return (
    <div className="hg-vsfeed">
      <div className="hg-vsfeed-log" aria-live="polite">
        <span className="hg-vsfeed-mc">
          <img src={IMG.hunjang} alt="" />
          중계석
        </span>
        {!list.length && <p className="hg-dim">아직 아무 말도 안 했어요. 먼저 한 마디!</p>}
        {list.map((m) => (
          <p key={m.id} className={`hg-vsmsg${m.uid === me ? " is-me" : ""} k-${m.kind}`}>
            <span className={gradeCls(m.grade)}>{m.grade}</span>
            <q>{m.spaced}</q>
            <small>
              {KIND[m.kind]} · {fmt(m.points)}
            </small>
          </p>
        ))}
      </div>
      <VsIncoming list={incoming} now={now} />
    </div>
  );
}

function VsIncoming({ list, now }: { list: VsAttack[]; now: number }) {
  if (!list.length)
    return (
      <div className="hg-vsin is-empty">
        <em>날아오는 공격 없음 — 지금 보내면 상대는 몇 초 안에 막아야 해요</em>
      </div>
    );
  return (
    <div className="hg-vsin" role="status">
      {list.map((a) => (
        <p key={a.id} className={a.rally ? "is-rally" : undefined}>
          <b>{Math.max(0, (a.arriveAt - now) / 1000).toFixed(1)}초</b>
          <q>{a.spaced}</q>
          <small>
            먹물 {a.blobs}
            {a.heavy ? " + 단단한 놈" : ""}
            {a.rally ? ` · 받아치기 ${a.rally}번째!` : ""}
          </small>
        </p>
      ))}
      <em>이 문장과 이어지는 말로 받아치면 튕겨 낼 수 있어요</em>
    </div>
  );
}

export function VsCutin({ a, name }: { a: VsAttack; name: string }) {
  return (
    <div className="hg-vscut" key={a.id}>
      <small>
        {name}의 공격{a.rally ? ` · 받아치기 ${a.rally}번째` : ""}
      </small>
      <p>{a.spaced}</p>
      <b>먹물 {a.blobs}마리!</b>
    </div>
  );
}

export function VsResult({
  room,
  me,
  sharing,
  onVote,
  onAgain,
  onLeave,
  onShare,
}: {
  room: VsRoom;
  me: string;
  sharing: boolean;
  onVote(msg: string): void;
  onAgain(): void;
  onLeave(): void;
  onShare(m: VsMsg): void;
}) {
  if (room.phase !== "ended")
    return (
      <div className="hg-card">
        <img className="hg-cardteacher" src={IMG.hunjangHmm} alt="" draggable={false} />
        <h2>먹물에 덮였어요…</h2>
        <p className="hg-dim">판정을 기다리는 중</p>
      </div>
    );
  const win = room.winner === me;
  const draw = room.winner === null;
  const nameOf = (uid: string) => room.players.find((p) => p.uid === uid)?.name ?? "?";
  const myVote = room.log.find((m) => m.votes.includes(me))?.id;
  // 오늘의 한 마디: 표를 받은 문장 (없으면 점수 높은 것)
  const star = [...room.log].sort(
    (a, b) => b.votes.length - a.votes.length || b.points - a.points
  )[0];
  const why =
    room.reason === "ko"
      ? "먹물 KO"
      : room.reason === "left"
        ? "상대가 나감"
        : "시간 끝 — 먹물이 적은 쪽";
  return (
    <div className="hg-card hg-vsresult">
      <img
        className="hg-cardteacher"
        src={win ? IMG.hunjangWow : draw ? IMG.hunjangNod : IMG.hunjangAngry}
        alt=""
        draggable={false}
      />
      <h2>{draw ? "무승부!" : win ? "이겼다!" : "졌다…"}</h2>
      <p className="hg-dim">
        {why} · {room.players.map((p) => `${p.name} ${fmt(p.points)}점`).join(" vs ")}
      </p>
      {star && (
        <blockquote className="hg-best">
          {star.spaced}
          <small>
            오늘의 한 마디 · {nameOf(star.uid)}
            {star.votes.length ? ` · 👍 ${star.votes.length}` : ""}
          </small>
          <button
            type="button"
            className="hg-sharebtn"
            disabled={sharing}
            onClick={() => onShare(star)}
          >
            {sharing ? "만드는 중…" : "🖼 카드로 자랑하기"}
          </button>
        </blockquote>
      )}
      <div className="hg-vslog">
        <h3>말싸움 기록 · 상대 문장 중 제일 웃긴 것에 👍</h3>
        {room.log.map((m) => (
          <p key={m.id} className={`hg-vsmsg${m.uid === me ? " is-me" : ""} k-${m.kind}`}>
            <span className={gradeCls(m.grade)}>{m.grade}</span>
            <q>{m.spaced}</q>
            <small>
              {KIND[m.kind]} · {fmt(m.points)}
            </small>
            {m.uid !== me && (
              <button
                type="button"
                className={myVote === m.id ? "is-on" : undefined}
                onClick={() => onVote(m.id)}
                aria-label="오늘의 한 마디로 뽑기"
              >
                👍{m.votes.length ? ` ${m.votes.length}` : ""}
              </button>
            )}
          </p>
        ))}
        {!room.log.length && <p className="hg-dim">아무 말도 안 하고 끝났어요</p>}
      </div>
      <div className="hg-overbtns">
        <button type="button" className="hg-linkbtn" onClick={onLeave}>
          ← 처음 화면
        </button>
        {room.host === me ? (
          <button type="button" className="hg-go" onClick={onAgain}>
            한 판 더
          </button>
        ) : (
          <span className="hg-dim">방장이 한 판 더를 누르면 이어서</span>
        )}
      </div>
    </div>
  );
}
