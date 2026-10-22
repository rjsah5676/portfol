/*
 * 디펜스 로딩 화면(GameLoader, Stage 가 씀)이 받을 것 — 그림 전부 · 글꼴 · 효과음.
 *  - 그림은 게임 자체 캐시(assets.ts img())에 decode 까지 → 판 · 정비소 · 보스 등장에서 하나씩 붙지 않음
 *  - 효과음은 파일만 받아 둠 (소리 엔진은 사용자가 처음 누를 때 audio.ts unlock 에서 바로 decode)
 *  - 배경음은 뺌: <audio> 가 받으면서 틀고(그림처럼 튀지 않음), 5곡 ≈ 13MB 라 느린 인터넷에서 입장이 너무 늦어짐
 * 새 그림 · 소리는 assets.ts 연결표에 넣으면 여기로 저절로 들어옴 (커서 · 글꼴만 여기서 따로).
 */
import { fontTask, type LoadTask } from "@/lib/preload";
import { SFX, artUrls, loadImg } from "@/lib/defense/assets";
import { fetchSfx } from "./audio";

/** css/defense.css 커서 그림 (data-cur · 화면 배율에 따라 골라 씀) */
const CURSORS = ["cursor", "cursor-hand", "cursor-grab"].flatMap((n) =>
  ["", "-1x", "-3x", "-4x", "-6x"].map((s) => `/defense/ui/${n}${s}.png`)
);
/** css/defense.css 갈무리 (보통 · 굵게 · 제목) */
const FONTS = ['12px "Galmuri11"', 'bold 12px "Galmuri11"', '12px "Galmuri14"'];

let done = false;

/** 받을 목록. 한 번 다 받았으면 빈 목록 → 다시 들어와도 로딩 화면 · 빈 칸 없이 바로 */
export function defenseTasks(): LoadTask[] {
  if (done) return [];
  const list: (() => Promise<unknown>)[] = [
    // 글꼴이 가장 큼(1.2MB) — 맨 앞에서 먼저 받기 시작
    fontTask(...FONTS),
    ...[...artUrls(), ...CURSORS].map((u) => () => loadImg(u)),
    ...Object.keys(SFX).map((n) => () => fetchSfx(n)),
  ];
  let left = list.length;
  return list.map(
    (t) => () =>
      t().finally(() => {
        if (--left === 0) done = true;
      })
  );
}
