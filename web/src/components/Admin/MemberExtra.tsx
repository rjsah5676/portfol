"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal/ModalProvider";
import {
  getMemberDetail,
  setMemberBan,
  setMemberItem,
  type MemberBan,
  type MemberDetail,
} from "@/firestore/adminData";
import { POINT, fmtPoint } from "@/lib/points";

/*
 * 회원 펼친 줄의 오른쪽 아래: 게임 요약(격투 랭크 · 디펜스 · 업적) · 가진 상품 주기/빼기 · 이용 정지.
 * 서버: server/src/http/adminMembers.ts
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const GAME_NAME: Record<string, string> = {
  poker: "ANIME POKER",
  fight: "PIXEL FIGHT",
  defense: "LUCKY DEFENSE",
  rhythm: "PIXEL Rhythm Up",
};
const BAN_DAYS: { days: number | null; label: string }[] = [
  { days: 1, label: "1일" },
  { days: 3, label: "3일" },
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
  { days: null, label: "기한 없음" },
];

export const banActive = (b: MemberBan | null | undefined, now = Date.now()) =>
  !!b && (b.until === null || b.until > now);
export const banText = (b: MemberBan) =>
  b.until === null
    ? "기한 없음"
    : `${new Date(b.until).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}까지`;

export default function MemberExtra({
  uid,
  nick,
  onBan,
}: {
  uid: string;
  nick: string;
  onBan: (ban: MemberBan | null) => void;
}) {
  const modal = useModal();
  const [d, setD] = useState<MemberDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState<number | null>(3);
  const [reason, setReason] = useState("");

  useEffect(() => {
    getMemberDetail(uid)
      .then(setD)
      .catch(() => setFailed(true));
  }, [uid]);

  if (failed)
    return (
      <p className={`mt-4 text-xs text-red-300 ${KR}`}>
        회원 정보를 더 불러오지 못했어요.
      </p>
    );
  if (!d) return <p className="mt-4 font-mono text-xs text-white/30">…</p>;

  const toggle = async (id: string, name: string, give: boolean) => {
    const ok = await modal.confirm({
      title: give ? "상품 주기" : "상품 빼기",
      message: give
        ? `${nick} 님에게 「${name}」을 줄까요? ${POINT.name}는 빠지지 않아요.`
        : `${nick} 님의 「${name}」을 뺄까요? 쓴 ${POINT.name}는 돌려주지 않아요.`,
      confirmText: give ? "주기" : "빼기",
    });
    if (!ok) return;
    setBusy(id);
    setMsg("");
    try {
      const r = await setMemberItem(uid, id, give);
      setD({ ...d, items: r.items });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "바꾸지 못했어요.");
    } finally {
      setBusy("");
    }
  };

  const ban = async (lift: boolean) => {
    const ok = await modal.confirm({
      title: lift ? "정지 풀기" : "이용 정지",
      message: lift
        ? `${nick} 님의 이용 정지를 풀까요?`
        : `${nick} 님을 ${days === null ? "기한 없이" : `${days}일 동안`} 정지할까요? 게임 · 채팅 · 랭킹 등록 · 방명록 · 상점이 막히고 보기만 할 수 있어요.`,
      confirmText: lift ? "풀기" : "정지",
    });
    if (!ok) return;
    setBusy("ban");
    setMsg("");
    try {
      const r = await setMemberBan(uid, lift ? 0 : days, reason);
      setD({ ...d, ban: r.ban });
      onBan(r.ban);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "바꾸지 못했어요.");
    } finally {
      setBusy("");
    }
  };

  const games = [...new Set(d.shop.map((s) => s.game))];
  const banned = banActive(d.ban);

  return (
    <div className={`mt-5 flex flex-col gap-5 ${KR}`}>
      <ul className="flex flex-wrap gap-1.5 text-xs">
        <li className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
          업적 <span className="font-mono text-white/45">{d.achs}개</span>
        </li>
        {d.fight && (
          <li className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
            격투 랭크{" "}
            <span className="font-mono text-white/45">
              {d.fight.r} (최고 {d.fight.peak}) · {d.fight.w}승 {d.fight.l}패
            </span>
          </li>
        )}
        {d.defense && (
          <li className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
            디펜스 최고{" "}
            <span className="font-mono text-white/45">
              {d.defense.win ? "클리어" : `${d.defense.wave}웨이브`} · 오염{" "}
              {d.defense.glitch}
            </span>
          </li>
        )}
      </ul>

      <section>
        <div className="mb-2 text-xs text-white/45">
          가진 상품 (눌러서 주기 · 빼기)
        </div>
        <div className="flex flex-col gap-2">
          {games.map((g) => (
            <div key={g}>
              <div className="mb-1 font-mono text-[10px] text-white/30">
                {GAME_NAME[g] ?? g}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.shop
                  .filter((s) => s.game === g)
                  .map((s) => {
                    const has = d.items.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={!!busy}
                        onClick={() => void toggle(s.id, s.name, !has)}
                        title={`${fmtPoint(s.price)} · ${has ? "누르면 빼기" : "누르면 주기"}`}
                        className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                          has
                            ? "border-[#FDE68A]/50 bg-[#FDE68A]/10 text-[#FDE68A]"
                            : "border-white/10 text-white/40 hover:border-white/30 hover:text-white/75"
                        }`}
                      >
                        {has ? "✓ " : ""}
                        {s.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        className={`rounded-xl border p-3 ${banned ? "border-red-400/40 bg-red-500/[0.06]" : "border-white/10 bg-white/[0.02]"}`}
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-xs text-white/60">이용 정지</span>
          {banned && d.ban ? (
            <span className="text-xs text-red-300">
              정지 중 · {banText(d.ban)}
              {d.ban.reason && ` · ${d.ban.reason}`}
            </span>
          ) : (
            <span className="text-xs text-white/30">정지 안 됨</span>
          )}
        </div>
        {banned ? (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void ban(true)}
            className="cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs text-white/70 hover:border-[#6C63FF]/60 hover:text-white disabled:opacity-40"
          >
            정지 풀기
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {BAN_DAYS.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => setDays(b.days)}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                    days === b.days
                      ? "border-red-400/60 bg-red-500/10 text-red-200"
                      : "border-white/10 text-white/50 hover:text-white/80"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={reason}
                maxLength={100}
                onChange={(e) => setReason(e.target.value)}
                placeholder="사유 (회원에게 보여요)"
                className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#121212] px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-red-400/50 focus:outline-none"
              />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void ban(false)}
                className="shrink-0 cursor-pointer rounded-full border border-red-400/40 px-3 py-1.5 font-mono text-xs text-red-300 hover:border-red-400/80 hover:text-red-200 disabled:opacity-40"
              >
                정지
              </button>
            </div>
          </div>
        )}
      </section>
      {msg && <p className="text-xs text-red-300">{msg}</p>}
    </div>
  );
}
