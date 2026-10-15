"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { claimAllMail, claimMail, getMail } from "@/lib/api/mail";
import { MAIL_EVENT, type MailItem } from "@/lib/mail";
import { POINT, fmtPoint } from "@/lib/points";

/*
 * 우편함 (플로팅 버튼 → 모달 안). 관리자가 보낸 우편을 보고 「받기」로 GP 를 받음.
 * 받으면 플로팅 버튼 숫자도 같이 줄게 MAIL_EVENT 를 알림.
 */

const DAY = 24 * 3600 * 1000;
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
function left(until: number) {
  const d = Math.ceil((until - Date.now()) / DAY);
  return d <= 1 ? "오늘까지" : `${d}일 남음`;
}

const announce = (unread: number) =>
  window.dispatchEvent(new CustomEvent(MAIL_EVENT, { detail: unread }));

export default function Mailbox() {
  const { profile, login, setPoints } = useAuth();
  const [list, setList] = useState<MailItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    getMail()
      .then((r) => {
        setList(r.list);
        setErr(false);
        announce(r.unread);
      })
      .catch(() => setErr(true));
  }, []);
  useEffect(() => {
    if (profile) load();
  }, [profile, load]);

  if (!profile)
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center font-['Nanum_Gothic',sans-serif]">
        <span className="text-4xl" aria-hidden="true">
          📪
        </span>
        <p className="text-sm break-keep text-white/60">
          로그인하면 우편을 받을 수 있어요
        </p>
        <button
          type="button"
          onClick={() => void login()}
          className="cursor-pointer rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm text-white hover:border-white/35"
        >
          Google로 로그인
        </button>
      </div>
    );

  const unread = (list ?? []).filter((m) => m.gotAt === null);
  const pending = unread.reduce((s, m) => s + m.points, 0);

  async function run(key: string, fn: () => ReturnType<typeof claimAllMail>) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      setPoints(r.points);
      setMsg(
        r.reward > 0
          ? `+${fmtPoint(r.reward)} 받았어요`
          : r.count > 1
            ? `우편 ${r.count}통을 확인했어요`
            : "확인했어요",
      );
    } catch (e) {
      setMsg(
        (e as Error).message || "받지 못했어요. 잠시 뒤에 다시 해 주세요.",
      );
    } finally {
      setBusy(null);
      load();
    }
  }

  return (
    <div className="font-['Nanum_Gothic',sans-serif]">
      {list && list.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <span className="text-xs break-keep text-white/55">
            {unread.length > 0 ? (
              <>
                안 받은 우편 <b className="text-white">{unread.length}통</b>
                {pending > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <b className="font-mono text-[#FDE68A]">
                      {fmtPoint(pending)}
                    </b>
                  </>
                )}
              </>
            ) : (
              "모두 받았어요"
            )}
          </span>
          {unread.length > 1 && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("*", claimAllMail)}
              className="cursor-pointer rounded-lg bg-[#FDE047] px-3 py-1.5 text-xs font-bold whitespace-nowrap text-black hover:brightness-110 disabled:opacity-50"
            >
              {busy === "*" ? "받는 중…" : "모두 받기"}
            </button>
          )}
        </div>
      )}
      {msg && (
        <p className="mb-2 rounded-lg bg-[#FDE047]/10 px-3 py-1.5 text-center text-xs text-[#FDE68A]">
          {msg}
        </p>
      )}
      {err && (
        <p className="mb-2 text-center text-xs text-red-300">
          우편을 불러오지 못했어요.
        </p>
      )}
      {!list ? (
        !err && (
          <p className="py-8 text-center font-mono text-xs text-white/30">
            불러오는 중…
          </p>
        )
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="text-4xl" aria-hidden="true">
            📭
          </span>
          <p className="text-sm text-white/60">받은 우편이 없습니다</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((m) => {
            const done = m.gotAt !== null;
            return (
              <li
                key={m.id}
                className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-2.5 rounded-xl border px-2.5 py-2.5 ${
                  done
                    ? "border-white/5 bg-white/[0.02] opacity-60"
                    : "border-[#FDE047]/30 bg-[#FDE047]/[0.05]"
                }`}
              >
                <span className="pt-0.5 text-center text-xl" aria-hidden>
                  {done ? "📨" : m.points > 0 ? "🎁" : "✉️"}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <b className="text-sm break-keep text-white">{m.title}</b>
                    {m.points > 0 && (
                      <span className="font-mono text-[11px] whitespace-nowrap text-[#FDE68A]/85">
                        +{fmtPoint(m.points)}
                      </span>
                    )}
                  </span>
                  {m.body && (
                    <span className="mt-0.5 block text-xs leading-relaxed break-keep whitespace-pre-line text-white/60">
                      {m.body}
                    </span>
                  )}
                  <span className="mt-1 block font-mono text-[10px] text-white/35">
                    {fmtDate(m.at)}
                    {!done && ` · ${left(m.until)}`}
                  </span>
                </span>
                <span className="justify-self-end pt-0.5">
                  {done ? (
                    <span className="text-[11px] whitespace-nowrap text-white/40">
                      {m.points > 0 ? "받음" : "확인함"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void run(m.id, () => claimMail(m.id))}
                      className="cursor-pointer rounded-lg bg-[#FDE047] px-3 py-1.5 text-xs font-bold whitespace-nowrap text-black hover:brightness-110 disabled:opacity-50"
                    >
                      {busy === m.id
                        ? "받는 중…"
                        : m.points > 0
                          ? "받기"
                          : "확인"}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-relaxed break-keep text-white/35">
        우편은 기한 안에 「받기」를 눌러야 들어와요. 받은 {POINT.name}는
        마이페이지 내역에 「우편」으로 남아요.
      </p>
    </div>
  );
}
