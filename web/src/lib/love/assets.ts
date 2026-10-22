/*
 * 올인 러브 — 그림 · 소리 목록. 주소만 채우면 화면에 바로 입혀짐 (null = 임시 모양)
 * 게임은 로딩 화면에서 전부 받은 뒤 시작 (진행률 막대)
 */
import type { BgId, BgmId, CharKey, EndingInfo, SfxId, Who } from "./types";

const B = "/love";
const P = "/poker";

/** 스탠딩 (배경 없는 누끼). 표정 차분은 들어오면 face 키로 추가 — 없으면 base */
export const STAND: Record<CharKey, Record<string, string | null>> = {
  yeonseo: { base: `${B}/char/yeonseo-base.webp` },
  amy: { base: `${B}/char/amy-base.webp` },
  boss: { base: null },
};

/** 배경 — 없으면 단색 그라데이션 */
export const BG: Record<BgId, string | null> = {
  pub: `${B}/bg/pub-night.webp`,
  alley: `${B}/bg/alley-rain.webp`,
  vip: `${B}/bg/vip.webp`,
  store: `${B}/bg/store.webp`,
  arcade: `${B}/bg/arcade.webp`,
  room: `${B}/bg/room.webp`,
  black: null,
};
export const BG_FALLBACK: Record<BgId, string> = {
  pub: "linear-gradient(180deg,#2a1d14,#120c08)",
  alley: "linear-gradient(180deg,#141a26,#06080d)",
  vip: "linear-gradient(180deg,#2a0d12,#080203)",
  store: "linear-gradient(180deg,#e9eef2,#b9c4cc)",
  arcade: "linear-gradient(180deg,#3a1f4a,#120a1c)",
  room: "linear-gradient(180deg,#3a3140,#18141c)",
  black: "#000",
};

/** 이름표 옆 동그란 얼굴 (카메오는 포커 프로필 재사용) */
export const FACE_ICON: Partial<Record<Who, string>> = {
  yeonseo: `${P}/char/yeonseo/profile.webp`,
  amy: `${P}/char/amy/profile.webp`,
  taeyang: `${P}/char/taeyang/profile.webp`,
  jeongmin: `${P}/char/jeongmin/profile.webp`,
};

export const NAME: Record<Who, string> = {
  yeonseo: "연서",
  amy: "에이미",
  boss: "백상현",
  me: "{name}",
  narr: "",
  taeyang: "태양",
  jeongmin: "정민",
  chunhee: "춘희 이모",
};
/** 이름표 색 */
export const NAME_COLOR: Record<Who, string> = {
  yeonseo: "#8fa8ff",
  amy: "#7fd3ff",
  boss: "#e0b46a",
  me: "#e8e2d4",
  narr: "#e8e2d4",
  taeyang: "#ffb36b",
  jeongmin: "#c7a8ff",
  chunhee: "#f0a8a0",
};

/** 임시 소리 — 포커 소리 재사용 (나중에 전용 소리로 교체) */
export const SFX: Record<SfxId, string> = {
  chip: `${P}/sound/sfx-chip-1.mp3`,
  deal: `${P}/sound/sfx-deal-1.mp3`,
  shuffle: `${P}/sound/sfx-shuffle.mp3`,
  click: `${P}/sound/sfx-press-ui.mp3`,
  win: `${P}/sound/jingle-win.mp3`,
  lose: `${P}/sound/jingle-lose.mp3`,
  phone: `${P}/sound/sfx-turn.mp3`,
  heart: `${P}/sound/sfx-tick.mp3`,
  stamp: `${P}/sound/sfx-stamp.mp3`,
};
/** 포커 BGM 그대로(펍 감성) + 미연시 전용 BGM(Gemini 제작) */
export const BGM: Record<BgmId, string | null> = {
  pub: `${P}/sound/bgm-lobby1.mp3`,
  vip: `${P}/sound/bgm-vip.mp3`,
  night: `${P}/sound/bgm-lobby2.mp3`,
  allin: `${P}/sound/bgm-allin.mp3`,
  title: `${B}/sound/bgm-title.aac`,
  amy: `${B}/sound/bgm-amy.aac`,
  yeonseo: `${B}/sound/bgm-yeonseo.aac`,
  rain: `${B}/sound/bgm-rain.aac`,
  heart: `${B}/sound/bgm-heart.aac`,
  threat: `${B}/sound/bgm-threat.aac`,
  spoker: `${B}/sound/bgm-spoker.aac`,
  confide: `${B}/sound/bgm-confide.aac`,
  daily: `${P}/sound/bgm-lobby2.mp3`, // 임시: 제미나이 생성 실패 → 포커 곡
  comic: `${P}/sound/bgm-lobby1.mp3`, // 임시
  badend: null, // 임시: 무음 (결정적 순간 무음 연출과 같음)
};
/** 한 번만 재생하고 멈추는 곡 */
export const BGM_ONCE: BgmId[] = ["badend"];

export const CARD_BACK = `${P}/card/back-mid.webp`;

/** 타이틀 화면: 키아트(캐릭터 + 펍, UI 없음) · 로고(누끼) */
export const TITLE = { bg: `${B}/ui/title-bg.webp`, logo: `${B}/ui/title-logo.webp` };

/** 로딩 화면에서 전부 받는 목록 */
export function preloadList(): { img: string[]; audio: string[] } {
  const img = new Set<string>();
  for (const c of Object.values(STAND)) for (const u of Object.values(c)) if (u) img.add(u);
  for (const u of Object.values(BG)) if (u) img.add(u);
  for (const u of Object.values(FACE_ICON)) if (u) img.add(u);
  img.add(CARD_BACK);
  img.add(TITLE.bg);
  img.add(TITLE.logo);
  return { img: [...img], audio: [...new Set([...Object.values(SFX), ...Object.values(BGM).filter((u): u is string => !!u)])] };
}

/** 엔딩 18개 (M1 에서 실제로 볼 수 있는 건 fired · ghost · plain) */
export const ENDINGS: EndingInfo[] = [
  { id: "amy_true", no: 1, kind: "true", title: "Your Side", copy: "이기지 않아도, 네 편이면 돼.", hint: "에이미 · ???의 장부" },
  { id: "amy_good", no: 2, kind: "good", title: "작은 방, 큰 침대", copy: "판은 끝났다. 숙제는 남았다.", hint: "에이미 · 신뢰" },
  { id: "amy_friend", no: 3, kind: "normal", title: "딜러랑 단골", copy: "선은 안 넘었다. 그래서 오래 갔다.", hint: "에이미 · 한 걸음 덜" },
  { id: "amy_fall", no: 4, kind: "bad", title: "군번줄", copy: "나는 아빠랑 달라. …달랐어야 했는데.", hint: "에이미 · 도박욕", review: "rev_amy_fall" },
  { id: "amy_ruin", no: 5, kind: "bad", title: "둘이서 올인", copy: "같이 앉으면, 같이 무너진다.", hint: "에이미 · 틸트", review: "rev_amy_ruin" },
  { id: "yeon_true", no: 6, kind: "true", title: "Tell", copy: "처음 들은 웃음소리였다.", hint: "연서 · ???의 장부" },
  { id: "yeon_good", no: 7, kind: "good", title: "바닷가 마을", copy: "빚은 남았다. 장갑은 벗었다.", hint: "연서 · 도망" },
  { id: "yeon_sad", no: 8, kind: "normal", title: "다른 도시의 딜러", copy: "TV 속 그녀는 여전히 웃지 않았다.", hint: "연서 · 타이밍" },
  { id: "yeon_vanish", no: 9, kind: "bad", title: "빈자리", copy: "그 자리엔 다른 하우스 플레이어가 앉아 있었다.", hint: "연서 · 위험", review: "rev_yeon_vanish" },
  { id: "yeon_obsess", no: 10, kind: "bad", title: "다른 테이블엔 서지 마요", copy: "무표정한 사랑은 조용히 선을 넘는다.", hint: "연서 · 독점", review: "rev_yeon_obsess" },
  { id: "grand", no: 11, kind: "true", title: "All In", copy: "셋이 앉은 마지막 판.", hint: "두 개의 진실" },
  { id: "plain", no: 12, kind: "normal", title: "평범한 알바생", copy: "아무 일도 일어나지 않았다. 아무 일도.", hint: "아무도 고르지 않기", review: "rev_plain" },
  { id: "dealer", no: 13, kind: "bad", title: "하우스 딜러", copy: "돈은 많아졌다. 단골은 사라졌다.", hint: "사장의 제안", review: "rev_dealer" },
  { id: "me_fall", no: 14, kind: "bad", title: "손", copy: "3년 만에 앉은 자리는 너무 편했다.", hint: "틸트", review: "rev_me_fall" },
  { id: "clash", no: 15, kind: "bad", title: "수라장", copy: "둘 다 놓지 않으려다, 둘 다 놓쳤다.", hint: "둘 다", review: "rev_clash" },
  { id: "fired", no: 16, kind: "bad", title: "손이 굳었다", copy: "전설의 손, 수습 딱지도 못 떼다.", hint: "근무 중에 두 번 앉기", review: "rev_fired" },
  { id: "ghost", no: 17, kind: "bad", title: "읽씹", copy: "답장은 끝내 오지 않았다. 내가 안 했으니까.", hint: "메시지 세 번 무시", review: "rev_ghost" },
  { id: "data0", no: 18, kind: "hidden", title: "Data 0", copy: "너 없이도 이길 수 있어.", hint: "???" },
];
