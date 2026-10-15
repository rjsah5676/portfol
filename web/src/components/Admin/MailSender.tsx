"use client";

import { useCallback, useEffect, useState } from "react";
import { adminMailList, adminRemoveMail, adminSendMail } from "@/lib/api/mail";
import type { MailAdminRow } from "@/lib/mail";
import { POINT, fmtPoint } from "@/lib/points";

/*
 * 관리자 · 우편: 모든 회원 또는 별명으로 골라 보내기 (GP 첨부 가능) + 보낸 우편 목록 · 회수.
 * 받는 사람은 플로팅 버튼의 우편함에서 「받기」를 눌러야 GP 가 들어감.
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const input =
  "w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6C63FF]/70";
const label = "mb-1 block text-xs text-white/55";
const fmt = (t: number) =>
  new Date(t).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function MailSender() {
  const [all, setAll] = useState(true);
  const [nicks, setNicks] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [points, setPoints] = useState(0);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState<MailAdminRow[] | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(() => {
    adminMailList()
      .then((r) => {
        setSent(r.list);
        setNow(Date.now());
      })
      .catch(() => setSent([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const to = all
    ? ("*" as const)
    : nicks
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const can = title.trim() && (all || to.length > 0) && !busy;

  async function send() {
    const who = all ? "모든 회원" : `${to.length}명`;
    if (
      !window.confirm(
        `${who}에게 「${title.trim()}」${points ? ` (${fmtPoint(points)})` : ""} 우편을 보낼까요?`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminSendMail({
        to,
        title: title.trim(),
        body: body.trim(),
        points,
        days,
      });
      setMsg(`보냈어요 — ${r.to === "*" ? "모든 회원" : `${r.to}명`}`);
      setTitle("");
      setBody("");
      setPoints(0);
      load();
    } catch (e) {
      setMsg((e as Error).message || "보내지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: MailAdminRow) {
    if (
      !window.confirm(
        `「${m.title}」를 회수할까요? 아직 안 받은 사람은 더 못 받아요. (이미 받은 ${POINT.name}는 그대로)`,
      )
    )
      return;
    await adminRemoveMail(m.id).catch(() => {});
    load();
  }

  return (
    <div className={`${KR} flex flex-col gap-8`}>
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div
          className="mb-4 flex flex-wrap gap-2"
          role="radiogroup"
          aria-label="받는 사람"
        >
          {[
            { v: true, t: "모든 회원" },
            { v: false, t: "별명으로 고르기" },
          ].map((o) => (
            <button
              key={o.t}
              type="button"
              role="radio"
              aria-checked={all === o.v}
              onClick={() => setAll(o.v)}
              className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                all === o.v
                  ? "border-[#6C63FF] bg-[#6C63FF]/20 text-white"
                  : "border-white/15 text-white/60 hover:text-white"
              }`}
            >
              {o.t}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {!all && (
            <label className="sm:col-span-2">
              <span className={label}>
                받는 사람 별명 (쉼표 · 띄어쓰기로 여러 명)
              </span>
              <input
                value={nicks}
                onChange={(e) => setNicks(e.target.value)}
                placeholder="예: 포인트맨, 건모"
                className={input}
              />
            </label>
          )}
          <label className="sm:col-span-2">
            <span className={label}>
              제목 (원장에도 「우편 · 제목」으로 남아요)
            </span>
            <input
              value={title}
              maxLength={40}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 점검 보상"
              className={input}
            />
          </label>
          <label className="sm:col-span-2">
            <span className={label}>내용 (선택)</span>
            <textarea
              value={body}
              maxLength={500}
              rows={3}
              onChange={(e) => setBody(e.target.value)}
              className={`${input} resize-y`}
            />
          </label>
          <label>
            <span className={label}>첨부 {POINT.name} (0 이면 알림만)</span>
            <input
              type="number"
              min={0}
              step={100}
              value={points}
              onChange={(e) =>
                setPoints(Math.max(0, Math.floor(Number(e.target.value) || 0)))
              }
              className={`${input} font-mono`}
            />
          </label>
          <label>
            <span className={label}>받을 수 있는 기간 (일, 최대 90)</span>
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) =>
                setDays(
                  Math.min(
                    90,
                    Math.max(1, Math.floor(Number(e.target.value) || 1)),
                  ),
                )
              }
              className={`${input} font-mono`}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!can}
            onClick={() => void send()}
            className="rounded-full bg-[#6C63FF] px-5 py-2 text-sm font-bold text-white hover:bg-[#5b52f0] disabled:opacity-30"
          >
            {busy ? "보내는 중…" : "우편 보내기"}
          </button>
          {msg && <span className="text-xs text-white/70">{msg}</span>}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold text-white/80">보낸 우편</h3>
        {!sent ? (
          <p className="py-4 font-mono text-xs text-white/30">불러오는 중…</p>
        ) : sent.length === 0 ? (
          <p className="py-4 text-xs text-white/40">아직 보낸 우편이 없어요</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sent.map((m) => {
              const over = m.until <= now;
              return (
                <li
                  key={m.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs ${over ? "opacity-50" : ""}`}
                >
                  <b className="text-sm text-white">{m.title}</b>
                  {m.points > 0 && (
                    <span className="font-mono text-[#FDE68A]">
                      +{fmtPoint(m.points)}
                    </span>
                  )}
                  <span className="text-white/55">
                    {m.to === "*" ? "모든 회원" : m.to.join(", ")}
                  </span>
                  <span className="text-white/45">받음 {m.got}명</span>
                  <span className="font-mono text-white/35">
                    {fmt(m.at)} ~ {fmt(m.until)}
                    {over && " (끝남)"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(m)}
                    className="ml-auto rounded-full border border-white/15 px-3 py-1 text-white/60 hover:border-red-400/60 hover:text-red-300"
                  >
                    회수
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
