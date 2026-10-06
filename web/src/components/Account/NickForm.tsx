"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";

/** 별명 입력 (가입할 때 · 내 정보에서 바꿀 때 공용) */
export default function NickForm({
  submitLabel,
  onDone,
  inputRef,
}: {
  submitLabel: string;
  onDone?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const { profile, setNick } = useAuth();
  const [value, setValue] = useState(profile?.nick ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nick = value.trim();
  const unchanged = nick === (profile?.nick ?? "");

  const submit = async () => {
    if (busy || nick.length < 2 || unchanged) return;
    setBusy(true);
    setError("");
    try {
      await setNick(nick);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={value}
          maxLength={10}
          autoComplete="off"
          spellCheck={false}
          aria-label="별명"
          placeholder="별명"
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#121212] px-4 py-2 font-['Nanum_Gothic',sans-serif] text-sm text-white focus:border-[#6C63FF]/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || nick.length < 2 || unchanged}
          className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-default disabled:opacity-40"
        >
          {busy ? "…" : submitLabel}
        </button>
      </div>
      <p
        className={`font-['Nanum_Gothic',sans-serif] text-xs ${error ? "text-red-400" : "text-white/40"}`}
      >
        {error || "한글·영문·숫자 2~10자 · 다른 사람과 겹칠 수 없어요"}
      </p>
    </form>
  );
}
