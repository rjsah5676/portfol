"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import Avatar from "./Avatar";

/** 올리는 사진 한 변 (px). 가운데를 정사각형으로 잘라 이 크기로 줄여서 보냄 → 수십 KB */
const SIDE = 256;

/** 고른 사진을 가운데 정사각형으로 잘라 줄임 (원본은 서버로 보내지 않음) */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, SIDE, SIDE);
  bmp.close();
  const to = (type: string) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.86));
  // WebP 를 못 만드는 브라우저(구형 사파리)는 PNG 가 돌아옴 → 그럴 땐 JPEG 로
  const webp = await to("image/webp");
  const blob = webp?.type === "image/webp" ? webp : await to("image/jpeg");
  if (!blob) throw new Error("no blob");
  return blob;
}

/** 내 정보: 프로필 사진 바꾸기 · 기본 사진으로 되돌리기 */
export default function AvatarForm() {
  const { account, profile, setAvatar } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!account || !profile) return null;

  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError(
        e instanceof Error && e.name === "ApiError"
          ? e.message
          : "사진을 바꾸지 못했어요. 다른 사진으로 다시 해 보세요."
      );
    } finally {
      setBusy(false);
    }
  };

  const btn =
    "cursor-pointer rounded-full border border-white/10 px-4 py-1.5 font-mono text-xs text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:cursor-default disabled:opacity-40";

  return (
    <div className="flex items-center gap-5">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        aria-label="프로필 사진 바꾸기"
        className="group relative shrink-0 cursor-pointer rounded-full disabled:cursor-default"
      >
        <Avatar profile={profile} photo={account.photoURL} size="xl" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 font-['Nanum_Gothic',sans-serif] text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? "올리는 중…" : "바꾸기"}
        </span>
      </button>
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "올리는 중…" : "사진 고르기"}
          </button>
          {profile.avatar && (
            <button type="button" className={btn} disabled={busy} onClick={() => run(() => setAvatar(null))}>
              기본 사진으로
            </button>
          )}
        </div>
        <p
          className={`mt-2 font-['Nanum_Gothic',sans-serif] text-xs ${error ? "text-red-400" : "text-white/35"}`}
        >
          {error || "가운데를 정사각형으로 잘라서 올려요. 헤더와 내 정보에 보여요."}
        </p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // 같은 파일을 다시 골라도 반응하게
          if (file) run(async () => setAvatar(await shrink(file)));
        }}
      />
    </div>
  );
}
