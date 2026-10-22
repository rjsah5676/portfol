/*
 * PIXEL Rhythm Up 로딩 목록 (components/GameLoader · lib/preload).
 *  - 처음(bootTasks): 타이틀 · 메뉴 · 곡 선택 재킷 · 플레이/결과 도트 그림 · 글꼴 · 효과음 · 메뉴 BGM · 타격음
 *  - 곡 시작(playArt): 그 곡 배경 · 재킷 · 테마 스킨 무대 (음원은 RhythmGame loadSong 이 받고 디코딩)
 * 곡 음원 · 곡 배경(bg)은 크고 많아서 처음엔 안 받음. 새 그림을 넣으면 여기에도 추가할 것.
 */
import { fontTask, type LoadTask } from "@/lib/preload";
import type { Song } from "@/lib/rhythm/music";
import { SAMPLE_HITS, hitSoundUrl, SKIN_THEME, type Skin } from "@/lib/rhythm/fx";
import { BGM_URL, SFX, sfxUrl } from "@/lib/rhythm/sfx";
import { COVERS, coverOf } from "./SongCarousel";

/** public/rhythm/px 도트 그림 전부 (타이틀 · 메뉴 · 판정 · 기어 · 결과 배너 · 랭크) */
const PX = [
  "title",
  "logo",
  "stage-blue",
  "stage-pink",
  "custom-cover",
  "gear",
  "hit",
  "ring",
  "judge-perfect",
  "judge-great",
  "judge-good",
  "judge-miss",
  "banner-clear",
  "banner-failed",
  "banner-fullcombo",
  "banner-allperfect",
  "rank-splus",
  "rank-s",
  "rank-a",
  "rank-b",
  "rank-c",
  "rank-f",
].map((n) => `/rhythm/px/${n}.webp`);

/** 테마 스킨 그림 (무대 · 기어 · 캐릭터) */
function skinArt(skin: Skin): string[] {
  const th = SKIN_THEME[skin];
  if (!th) return [];
  return [
    th.stage,
    th.gear,
    ...(th.art ? [th.art.intro, th.art.cheer, th.art.lose] : []),
    ...(th.idol ? [th.idol.sheet, th.idol.meta] : []),
  ];
}

const FONTS = ["16px Galmuri11", "700 16px Galmuri11", "16px Galmuri14"];
/** 글꼴을 이미 쓸 수 있으면 건너뜀 (다시 들어올 때 로딩 화면 없이 — 함수 할 일은 늘 다시 돌아서) */
const fontsReady = () => {
  try {
    return FONTS.every((f) => document.fonts.check(f));
  } catch {
    return false;
  }
};

/** 저장된 설정의 테마 스킨 (곡 선택 배경이 스킨 무대라서 처음에 같이) */
function savedSkin(): Skin | null {
  try {
    const s = JSON.parse(localStorage.getItem("rhythm_settings") ?? "null");
    return s && SKIN_THEME[s.skin as Skin] ? (s.skin as Skin) : null;
  } catch {
    return null;
  }
}

/** 첫 로딩 화면 할 일 */
export function bootTasks(): LoadTask[] {
  const skin = savedSkin();
  return [
    ...PX,
    // 곡 선택 목록 · 캐러셀 재킷
    ...Object.values(COVERS).map((c) => c.src),
    // 상점 미리보기
    ...Object.values(SKIN_THEME).map((t) => t!.preview),
    ...(skin ? skinArt(skin) : []),
    // 소리: HTTP 캐시까지 (디코딩은 첫 입력 뒤 — 그 전엔 오디오 컨텍스트를 못 만듦)
    ...SFX.map(sfxUrl),
    BGM_URL,
    ...SAMPLE_HITS.map(hitSoundUrl),
    ...(fontsReady() ? [] : [fontTask(...FONTS)]),
  ];
}

/**
 * 곡 시작 때 받을 그림. 곡 배경(bg)은 Stage 가 재킷 배경을 쓸 때만 (마우스 · 가로 화면 · 테마 스킨 아님 · 뮤비 없음)
 */
export function playArt(s: Song, skin: Skin, bg: string, wide: boolean): string[] {
  const th = SKIN_THEME[skin];
  return [
    ...PX,
    coverOf(s),
    ...(bg === "cover" && wide && !th && !s.video && s.bg ? [s.bg] : []),
    ...skinArt(skin),
  ];
}
