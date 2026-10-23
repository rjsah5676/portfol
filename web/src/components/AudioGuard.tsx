"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { installAudioGuard, syncAudio } from "@/lib/audioGuard";

// 게임 코드가 소리 엔진을 만들기 전에 (이 파일이 불릴 때 바로) 감쌈
installAudioGuard();

/** 사이트 공통 소리 지킴이 (layout 에 하나) — 화면을 옮길 때마다 소리를 그 화면에 맞춤 */
export default function AudioGuard() {
  const path = usePathname();
  useEffect(() => {
    syncAudio();
  }, [path]);
  return null;
}
