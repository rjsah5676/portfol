"use client";

import { useCallback, useEffect, useState } from "react";
import { adminReports, adminSetReport } from "@/lib/api/social";
import type { ReportRow } from "@/lib/social";
import { openUserCard } from "@/lib/socialStore";

/*
 * 관리자 · 신고: 회원 이름 메뉴의 「신고하기」로 들어온 것. 처리하면 「처리함」으로 옮김 (메모를 남길 수 있음).
 * 제재(이용 정지)는 「회원」 탭에서 별명으로 찾아서.
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const fmt = (t: number) =>
  new Date(t).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function Reports() {
  const [status, setStatus] = useState<"open" | "done">("open");
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [open, setOpen] = useState(0);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    adminReports(status)
      .then((r) => {
        setRows(r.list);
        setOpen(r.open);
        setErr(false);
      })
      .catch(() => setErr(true));
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={KR}>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist">
        {(
          [
            ["open", `처리 전 ${open}`],
            ["done", "처리함"],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={status === k}
            onClick={() => {
              setRows(null);
              setStatus(k);
            }}
            className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
              status === k
                ? "border-[#6C63FF] bg-[#6C63FF]/20 text-white"
                : "border-white/15 text-white/60 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
        <button
          type="button"
          onClick={load}
          className="ml-auto rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs text-white/60 hover:text-white"
        >
          새로고침
        </button>
      </div>
      {err && <p className="py-4 text-sm text-red-300">신고 목록을 불러오지 못했어요.</p>}
      {!rows && !err && <p className="py-4 font-mono text-xs text-white/30">불러오는 중…</p>}
      {rows && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-white/40">
          {status === "open" ? "처리할 신고가 없어요" : "처리한 신고가 없어요"}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {rows?.map((r) => (
          <ReportItem key={r.id} r={r} onChanged={load} />
        ))}
      </ul>
    </div>
  );
}

function ReportItem({ r, onChanged }: { r: ReportRow; onChanged: () => void }) {
  const [note, setNote] = useState(r.note);
  const [busy, setBusy] = useState(false);
  const [showDms, setShowDms] = useState(false);
  const save = async (status?: "open" | "done") => {
    setBusy(true);
    try {
      await adminSetReport(r.id, { note, ...(status && { status }) });
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const who = (u: { uid: string; nick: string }) => (
    <button
      type="button"
      onClick={() => openUserCard(u.nick)}
      className="cursor-pointer font-bold text-white hover:underline"
      title={u.uid}
    >
      {u.nick}
    </button>
  );
  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="rounded-full bg-[#F43F5E]/15 px-2 py-0.5 text-xs text-[#FDA4AF]">
          {r.reason}
        </span>
        <span className="text-white/45">대상</span>
        {who(r.target)}
        <span className="text-white/45">· 신고</span>
        {who(r.from)}
        <span className="ml-auto font-mono text-[11px] text-white/35">{fmt(r.at)}</span>
      </div>
      {r.text && (
        <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-white/80">
          {r.text}
        </p>
      )}
      <p className="mt-1 font-mono text-[11px] break-all text-white/30">
        화면 {r.where || "-"} · 대상 uid {r.target.uid}
      </p>
      {r.dms.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowDms((v) => !v)}
            className="text-xs text-[#C4B5FD] hover:underline"
          >
            두 사람 메시지 {r.dms.length}개 {showDms ? "접기" : "보기"}
          </button>
          {showDms && (
            <ol className="mt-1.5 max-h-64 overflow-y-auto rounded-lg bg-black/25 p-2 text-xs">
              {r.dms.map((m, i) => (
                <li key={i} className="py-0.5">
                  <span className="font-mono text-white/30">{fmt(m.at)}</span>{" "}
                  <b className={m.from === r.target.uid ? "text-[#FDA4AF]" : "text-white/60"}>
                    {m.from === r.target.uid ? r.target.nick : r.from.nick}
                  </b>{" "}
                  <span className="break-words whitespace-pre-wrap text-white/80">{m.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="처리 메모 (예: 3일 정지)"
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-[#6C63FF]/70"
        />
        {r.status === "open" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save("done")}
            className="rounded-full bg-[#6C63FF] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#5b52f0] disabled:opacity-40"
          >
            처리함
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || note === r.note}
              onClick={() => void save()}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:text-white disabled:opacity-40"
            >
              메모 저장
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save("open")}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:text-white disabled:opacity-40"
            >
              다시 열기
            </button>
          </>
        )}
        {r.doneAt && (
          <span className="font-mono text-[10px] text-white/30">처리 {fmt(r.doneAt)}</span>
        )}
      </div>
    </li>
  );
}
