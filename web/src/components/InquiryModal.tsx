"use client";

import { useRef, useState } from "react";
import Modal from "@/components/Modal/Modal";
import { addInquiry, EMAIL_RE, INQUIRY_LIMITS } from "@/firestore/inquiries";

const THROTTLE_KEY = "inquiry_last_sent";
const THROTTLE_MS = 60_000;

const input =
  "w-full rounded-lg border border-white/10 bg-[#15171c] px-3.5 py-2.5 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/30 transition-colors focus:border-[#6C63FF]/60 focus:outline-none";

export default function InquiryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  // 스팸 봇용 함정 필드: 사람에게는 안 보임. 값이 들어오면 조용히 무시
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const close = () => {
    onClose();
    // 닫을 때 완료 화면은 초기화 (입력 중이던 내용은 유지)
    if (done) {
      setDone(false);
      setMessage("");
    }
    setError("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setError("");
    if (!name.trim() || !message.trim()) return setError("이름과 문의 내용을 입력해주세요.");
    if (!EMAIL_RE.test(email.trim())) return setError("답변 받을 이메일 주소를 확인해주세요.");
    if (website) return setDone(true);

    try {
      const last = Number(localStorage.getItem(THROTTLE_KEY) ?? 0);
      if (Date.now() - last < THROTTLE_MS)
        return setError("잠시 후 다시 보내주세요. (1분에 한 번)");
    } catch {}

    setSending(true);
    try {
      await addInquiry({ name, email, phone, message });
      try {
        localStorage.setItem(THROTTLE_KEY, String(Date.now()));
      } catch {}
      setDone(true);
    } catch (err) {
      console.error(err);
      setError("전송에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title="문의하기" initialFocusRef={nameRef}>
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#6C63FF]/20 font-mono text-xl text-[#A9A3FF]">
            ✓
          </div>
          <p className="text-white/85">문의가 접수되었습니다.</p>
          <p className="text-xs text-white/45">
            <span className="text-white/70">{email}</span> 로 답변드릴게요.
          </p>
          <button
            type="button"
            onClick={close}
            className="mt-2 cursor-pointer rounded-full bg-[#6C63FF] px-6 py-2 font-mono text-sm text-white hover:bg-[#5b52f0]"
          >
            닫기
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-2.5">
          <p className="mb-1 text-xs text-white/45">
            채용·협업·사이트 관련 무엇이든 남겨주세요. 입력하신 이메일로 답변드립니다.
          </p>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={INQUIRY_LIMITS.name}
            placeholder="이름 / 회사"
            autoComplete="name"
            className={input}
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={INQUIRY_LIMITS.email}
            placeholder="이메일 (답변 받을 주소)"
            autoComplete="email"
            className={input}
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={INQUIRY_LIMITS.phone}
            placeholder="연락처 (선택)"
            autoComplete="tel"
            className={input}
          />
          <div className="relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={INQUIRY_LIMITS.message}
              rows={5}
              placeholder="문의 내용"
              className={`${input} resize-none pb-6`}
            />
            <span className="pointer-events-none absolute right-3 bottom-2.5 font-mono text-[10px] text-white/30">
              {message.length}/{INQUIRY_LIMITS.message}
            </span>
          </div>
          {/* 봇 함정 필드 */}
          <input
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />
          {error && <p className="font-mono text-xs text-red-400">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="cursor-pointer rounded-full border border-white/15 px-4 py-2 font-mono text-sm text-white/60 hover:text-white"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={sending}
              className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-2 font-mono text-sm text-white hover:bg-[#5b52f0] disabled:opacity-40"
            >
              {sending ? "보내는 중…" : "보내기"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
