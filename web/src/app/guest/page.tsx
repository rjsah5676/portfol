"use client";

import { useEffect, useMemo, useState } from "react";
import Faded from "@/components/Faded";
import { useAuth } from "@/lib/AuthContext";
import { useModal } from "@/components/Modal/ModalProvider";
import {
  NOTE_COLORS,
  addGuestEntry,
  deleteGuestEntry,
  subscribeGuestEntries,
  type GuestEntry,
  type NoteColor,
} from "@/firestore/guestbook";
import "@/css/guest.css";

const NAME_MAX = 12;
const CONTENTS_MAX = 50;
const PAGE = 24;

// 어두운 배경에서 튀지 않게 채도 낮춘 포스트잇 색
const NOTE_BG: Record<NoteColor, string> = {
  lavender: "#D4CFFB",
  yellow: "#F4E6A6",
  mint: "#C3E7D3",
  pink: "#F3CCD9",
  sky: "#C8DDF3",
};

const hand = "font-['Gaegu','Nanum_Gothic',cursive]";

const colorOf = (e: GuestEntry): NoteColor =>
  e.color && NOTE_BG[e.color] ? e.color : NOTE_COLORS[Math.abs(e.id) % NOTE_COLORS.length];

/** id 기준으로 항상 같은 기울기 (-2.4° ~ 2.4°) */
const tiltOf = (id: number) => ((Math.abs(id) % 7) - 3) * 0.8;

function dateLabel(e: GuestEntry) {
  // id가 타임스탬프인 글은 날짜만 짧게, 예전 글은 저장된 문자열 그대로
  if (e.id > 1e12) {
    const d = new Date(e.id);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  }
  return e.date;
}

function Note({
  entry,
  isNew,
  onDelete,
}: {
  entry: GuestEntry;
  isNew: boolean;
  onDelete?: () => void;
}) {
  return (
    // 테이프·그림자가 메모 밖으로 삐져나와서, 다단(columns) 경계에서 잘린 조각이
    // 이전 열 맨 아래에 남지 않도록 여백까지 포함한 래퍼 단위로 열을 나눔
    <div className="inline-block w-full break-inside-avoid pt-3 pb-7">
      <article
        style={
          {
            "--r": `${tiltOf(entry.id)}deg`,
            background: NOTE_BG[colorOf(entry)],
          } as React.CSSProperties
        }
        className={`group relative rounded-[3px] px-5 pt-7 pb-4 text-[#2b2833] shadow-[0_12px_24px_-8px_rgba(0,0,0,.6)] transition-transform duration-300 [transform:rotate(var(--r))] hover:z-10 hover:[transform:rotate(0deg)_translateY(-4px)_scale(1.02)] ${
          isNew ? "note-drop" : ""
        }`}
      >
        {/* 마스킹 테이프 */}
        <span className="absolute -top-2.5 left-1/2 h-5 w-16 -translate-x-1/2 -rotate-3 bg-white/40 shadow-[0_1px_2px_rgba(0,0,0,.15)]" />
        {/* 접힌 모서리 */}
        <span className="absolute right-0 bottom-0 h-5 w-5 bg-[linear-gradient(135deg,transparent_50%,rgba(0,0,0,.12)_50%)]" />

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="메모 삭제"
            className="absolute top-2 right-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/10 font-mono text-xs text-black/50 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500 hover:text-white [@media(hover:none)]:opacity-100"
          >
            ✕
          </button>
        )}

        <p className={`${hand} text-[22px] leading-snug break-words whitespace-pre-wrap`}>
          {entry.contents}
        </p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <span className={`${hand} truncate text-lg font-bold text-black/60`}>— {entry.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-black/35">{dateLabel(entry)}</span>
        </div>
      </article>
    </div>
  );
}

export default function GuestPage() {
  const { user } = useAuth();
  const modal = useModal();
  const [list, setList] = useState<GuestEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [name, setName] = useState("");
  const [contents, setContents] = useState("");
  const [color, setColor] = useState<NoteColor>("lavender");
  const [sending, setSending] = useState(false);
  const [newId, setNewId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(
    () =>
      subscribeGuestEntries(
        (entries) => {
          setList(entries);
          setLoaded(true);
        },
        (e) => {
          console.error(e);
          setError("방명록을 불러오지 못했습니다.");
          setLoaded(true);
        }
      ),
    []
  );

  const visible = useMemo(() => list.slice(0, shown), [list, shown]);
  const canSubmit = name.trim() !== "" && contents.trim() !== "" && !sending;

  async function submit() {
    if (!canSubmit) return;
    setSending(true);
    setError("");
    try {
      const id = await addGuestEntry({
        name: name.trim().slice(0, NAME_MAX),
        contents: contents.trim().slice(0, CONTENTS_MAX),
        color,
      });
      setNewId(id);
      setContents("");
    } catch (e) {
      console.error(e);
      setError("등록에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  async function remove(entry: GuestEntry) {
    const ok = await modal.confirm({
      title: "메모 삭제",
      message: `${entry.name}님의 메모를 삭제할까요?`,
      confirmText: "삭제",
      cancelText: "취소",
    });
    if (!ok) return;
    try {
      await deleteGuestEntry(entry.docId);
    } catch (e) {
      console.error(e);
      setError("삭제에 실패했습니다.");
    }
  }

  return (
    <Faded>
      <div className="mx-auto max-w-5xl px-5 pt-16 pb-24 sm:px-6">
        {/* 헤더 */}
        <div className="mb-10 flex flex-col gap-2">
          <div className="font-mono text-sm text-[#8B84FF]">guest box</div>
          <h1
            className={`${hand} text-[34px] leading-tight font-bold break-keep text-white sm:text-5xl`}
          >
            메모 한 장 붙이고 가세요
          </h1>
          <p className="font-['Nanum_Gothic',sans-serif] text-sm text-white/50">
            지나가다 들르셨다면 한마디 남겨주세요.
            {loaded && list.length > 0 && (
              <span className="ml-2 font-mono text-xs text-white/30">
                · {list.length}장 붙어 있음
              </span>
            )}
          </p>
        </div>

        {/* 작성 메모 */}
        <div className="mb-14 flex justify-center">
          <div
            style={{ background: NOTE_BG[color] }}
            className="relative w-full max-w-md -rotate-1 rounded-[3px] px-6 pt-8 pb-5 text-[#2b2833] shadow-[0_18px_36px_-10px_rgba(0,0,0,.7)] transition-colors duration-300"
          >
            <span className="absolute -top-3 left-1/2 h-6 w-20 -translate-x-1/2 rotate-2 bg-white/45 shadow-[0_1px_2px_rgba(0,0,0,.15)]" />

            <textarea
              value={contents}
              maxLength={CONTENTS_MAX}
              onChange={(e) => setContents(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
              }}
              rows={3}
              placeholder="여기에 한마디…"
              className={`${hand} w-full resize-none bg-[repeating-linear-gradient(transparent,transparent_31px,rgba(0,0,0,.09)_31px,rgba(0,0,0,.09)_32px)] text-[22px] leading-[32px] placeholder:text-black/30 focus:outline-none`}
            />

            <div className="mt-3 flex items-center gap-2">
              <span className={`${hand} text-lg text-black/50`}>—</span>
              <input
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="이름"
                className={`${hand} min-w-0 flex-1 border-b border-dashed border-black/25 bg-transparent pb-0.5 text-lg font-bold placeholder:font-normal placeholder:text-black/30 focus:border-black/50 focus:outline-none`}
              />
              <span className="shrink-0 font-mono text-[10px] text-black/40">
                {contents.length}/{CONTENTS_MAX}
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="flex gap-1.5">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`${c} 메모`}
                    onClick={() => setColor(c)}
                    style={{ background: NOTE_BG[c] }}
                    className={`h-6 w-6 cursor-pointer rounded-full border-2 transition-transform hover:scale-110 ${
                      color === c ? "scale-110 border-[#2b2833]" : "border-black/15"
                    }`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="cursor-pointer rounded-full bg-[#2b2833] px-5 py-2 font-mono text-sm text-white transition-colors hover:bg-[#6C63FF] disabled:cursor-not-allowed disabled:opacity-30"
              >
                {sending ? "붙이는 중…" : "붙이기"}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mb-6 text-center font-mono text-xs text-red-400">{error}</p>}

        {/* 메모 보드 */}
        {!loaded ? (
          <p className="py-10 text-center font-mono text-sm text-white/30">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className={`${hand} py-10 text-center text-2xl text-white/40`}>
            아직 비어 있어요. 첫 메모를 붙여주세요!
          </p>
        ) : (
          <>
            <div className="columns-1 gap-6 px-1 sm:columns-2 lg:columns-3">
              {visible.map((e) => (
                <Note
                  key={e.docId}
                  entry={e}
                  isNew={e.id === newId}
                  onDelete={user ? () => remove(e) : undefined}
                />
              ))}
            </div>
            {list.length > shown && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="cursor-pointer rounded-full border border-white/15 px-5 py-2 font-mono text-xs text-white/60 transition-colors hover:border-[#6C63FF]/60 hover:text-white"
                >
                  더 보기 ({list.length - shown})
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Faded>
  );
}
