"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/components/Modal/ModalProvider";
import {
  getAdminNotice,
  putNotice,
  removeNotice,
  type SiteNotice,
} from "@/firestore/adminData";

/*
 * 관리자 · 사이트 공지: 모든 페이지 메뉴 아래에 뜨는 한 줄 (점검 · 이벤트 · 업데이트 알림).
 * 새로 올리면 전에 닫았던 사람에게도 다시 보임. 기한을 정하면 그때 저절로 내려감.
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const input =
  "w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#6C63FF]/70";
const label = "mb-1 block text-xs text-white/55";
const TONES: { key: SiteNotice["tone"]; label: string; cls: string }[] = [
  { key: "info", label: "알림", cls: "border-[#6C63FF] bg-[#6C63FF]/20" },
  { key: "event", label: "이벤트", cls: "border-[#FDE68A]/70 bg-[#FDE68A]/15" },
  { key: "warn", label: "점검", cls: "border-red-400/70 bg-red-500/15" },
];
const SPANS: { h: number | null; label: string }[] = [
  { h: null, label: "내릴 때까지" },
  { h: 3, label: "3시간" },
  { h: 24, label: "하루" },
  { h: 72, label: "3일" },
  { h: 168, label: "7일" },
];
const fmt = (t: number) =>
  new Date(t).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function NoticeEditor() {
  const modal = useModal();
  const [cur, setCur] = useState<SiteNotice | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [tone, setTone] = useState<SiteNotice["tone"]>("info");
  const [span, setSpan] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    getAdminNotice()
      .then((r) => {
        setCur(r.notice);
        setNow(Date.now());
        if (r.notice) {
          setText(r.notice.text);
          setLink(r.notice.link ?? "");
          setTone(r.notice.tone);
        }
      })
      .catch(() => setCur(null));
  }, []);

  const live = cur && (cur.until === null || cur.until > now);

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await putNotice({
        text: text.trim(),
        link: link.trim(),
        tone,
        until: span === null ? null : Date.now() + span * 3600_000,
      });
      setCur(r.notice);
      setNow(Date.now());
      setMsg("올렸어요 — 새로 들어오는 사람부터 보여요 (최대 30초)");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "올리지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  const takeDown = async () => {
    if (
      !(await modal.confirm({
        title: "공지 내리기",
        message: "지금 공지를 내릴까요?",
        confirmText: "내리기",
      }))
    )
      return;
    setBusy(true);
    try {
      await removeNotice();
      setCur(null);
      setMsg("내렸어요");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "내리지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${KR} flex flex-col gap-6`}>
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-white/85">지금 공지</span>
          {cur === undefined ? (
            <span className="font-mono text-xs text-white/30">…</span>
          ) : live && cur ? (
            <span className="text-xs text-[#2DD4BF]">
              올라가 있음 ·{" "}
              {cur.until === null ? "내릴 때까지" : `${fmt(cur.until)}까지`}
            </span>
          ) : (
            <span className="text-xs text-white/35">
              {cur ? "기한이 지나 안 보임" : "없음"}
            </span>
          )}
        </div>
        {live && cur && (
          <p className="text-sm break-keep text-white/70">{cur.text}</p>
        )}
        {cur && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void takeDown()}
            className="mt-3 cursor-pointer rounded-full border border-red-400/30 px-3 py-1.5 font-mono text-xs text-red-300/90 hover:border-red-400/70 disabled:opacity-40"
          >
            내리기
          </button>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div
          className="mb-4 flex flex-wrap gap-2"
          role="radiogroup"
          aria-label="종류"
        >
          {TONES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={tone === t.key}
              onClick={() => setTone(t.key)}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                tone === t.key
                  ? `${t.cls} text-white`
                  : "border-white/15 text-white/60 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3">
          <label>
            <span className={label}>내용 (200자, 한 줄로 보여요)</span>
            <input
              value={text}
              maxLength={200}
              onChange={(e) => setText(e.target.value)}
              placeholder="예: 10월 20일 새벽 2시~3시 서버 점검이 있어요"
              className={input}
            />
          </label>
          <label>
            <span className={label}>
              링크 (선택 — /faq/ 같은 사이트 주소나 https:// 주소)
            </span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/games/defense/"
              className={`${input} font-mono`}
            />
          </label>
          <div>
            <span className={label}>보이는 기간</span>
            <div className="flex flex-wrap gap-1.5">
              {SPANS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setSpan(s.h)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                    span === s.h
                      ? "border-[#6C63FF] bg-[#6C63FF]/15 text-white"
                      : "border-white/10 text-white/50 hover:text-white/80"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void save()}
            className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 text-sm font-bold text-white hover:bg-[#5b52f0] disabled:opacity-30"
          >
            {busy ? "올리는 중…" : cur ? "새로 올리기" : "올리기"}
          </button>
          {msg && <span className="text-xs text-white/70">{msg}</span>}
        </div>
        <p className="mt-3 text-[11px] text-white/35">
          새로 올리면 전에 닫았던 사람에게도 다시 보여요. 관리자 화면에서는 안
          보여요.
        </p>
      </section>
    </div>
  );
}
