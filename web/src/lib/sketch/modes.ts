/*
 * DOODLE PARTY 게임 모드 · 깜짝 챌린지 · 시간 (서버 server/src/games/sketch.ts 와 화면이 같이 씀)
 *
 * classic  그림 맞히기   한 명이 그리고 나머지가 채팅으로 맞힘
 * fake     가짜 화가     한 도화지에 돌아가며 한 획씩. 한 명만 제시어를 모름 → 투표로 가짜 찾기
 * lie      그림 속 거짓말 각자 엉뚱한 제시어를 그리고, 남의 그림에 그럴듯한 가짜 제목 → 진짜 고르기
 * relay    그림 릴레이   문장 → 그림 → 문장 … 옆 사람에게 넘기며 이어 가고, 끝나면 앨범으로 같이 보기
 */

export type GameMode = "classic" | "fake" | "lie" | "relay";

export interface ModeInfo {
  id: GameMode;
  name: string;
  emoji: string;
  /** 한 줄 설명 (방 만들기 · 로비) */
  short: string;
  /** 하는 법 (대기실) */
  how: string[];
  /** 최소 인원 */
  min: number;
}

export const MODES: Record<GameMode, ModeInfo> = {
  classic: {
    id: "classic",
    name: "그림 맞히기",
    emoji: "🎨",
    short: "한 명이 그리고 나머지가 맞혀요",
    how: [
      "차례가 오면 제시어 3개 중 하나를 골라 그려요",
      "나머지는 채팅으로 정답을 마구 입력! 빨리 맞힐수록 점수 UP",
      "가끔 깜짝 챌린지(한붓그리기 · 눈 가리고 · 검정 한 색)가 걸리면 점수 ×1.5",
    ],
    min: 2,
  },
  fake: {
    id: "fake",
    name: "가짜 화가",
    emoji: "🕵️",
    short: "한 명만 제시어를 몰라요. 한 획씩 그리고 가짜를 찾아요",
    how: [
      "모두 같은 제시어를 받는데, 가짜 화가 한 명은 주제만 알아요",
      "한 도화지에 돌아가며 딱 한 획씩, 두 바퀴 그려요",
      "투표로 가짜를 찾아요! 들켜도 가짜가 제시어를 맞히면 가짜 승리",
    ],
    min: 3,
  },
  lie: {
    id: "lie",
    name: "그림 속 거짓말",
    emoji: "🤥",
    short: "엉뚱한 제시어를 그리고, 가짜 제목으로 속여요",
    how: [
      "각자 엉뚱한 제시어(예: 다이어트 중인 펭귄)를 받아 동시에 그려요",
      "남의 그림엔 그럴듯한 가짜 제목을 써요",
      "진짜 제목을 고르면 점수, 내 가짜에 남이 속아도 점수!",
    ],
    min: 3,
  },
  relay: {
    id: "relay",
    name: "그림 릴레이",
    emoji: "📞",
    short: "문장 → 그림 → 문장… 어떻게 바뀌는지 같이 봐요",
    how: [
      "처음엔 각자 아무 문장이나 써요",
      "옆 사람이 그 문장을 그리고, 다음 사람은 그림만 보고 문장으로 써요",
      "끝나면 앨범을 한 장씩 넘기며 어떻게 변했는지 같이 봐요 (점수 없음)",
    ],
    min: 3,
  },
};
export const MODE_LIST: GameMode[] = ["classic", "fake", "lie", "relay"];

// ───────────── 깜짝 챌린지 (그림 맞히기) ─────────────

export type Challenge = "" | "oneline" | "blind" | "mono";
export const CHALLENGES: Record<
  Exclude<Challenge, "">,
  { name: string; emoji: string; desc: string }
> = {
  oneline: { name: "한붓그리기", emoji: "〰️", desc: "펜을 떼면 끝! 딱 한 획으로 그려요" },
  blind: { name: "눈 가리고", emoji: "🙈", desc: "내 그림이 안 보여요. 감으로 그려요" },
  mono: { name: "검정 한 색", emoji: "🖤", desc: "검정색 펜만 쓸 수 있어요" },
};
/** 챌린지가 걸릴 확률 (첫 차례는 빼고) */
export const CHALLENGE_CHANCE = 0.3;
/** 챌린지 차례 점수 배율 (맞힌 사람 · 그린 사람 모두) */
export const CHALLENGE_BONUS = 1.5;
/** 검정 한 색: 쓸 수 있는 색 (지우개는 흰색) */
export const MONO_COLOR = "#1F1F2A";

// ───────────── 따봉 · 반응 ─────────────

/** 정답 공개 때 · 앨범에서 누르는 따봉 — 한 그림에 한 사람 한 번 */
export const LIKE_EMOJI = "👍";

// ───────────── 시간 (ms) ─────────────

export const MODE_MS = {
  /** 가짜 화가: 한 획 */
  fakeStroke: 25_000,
  fakeVote: 40_000,
  fakeGuess: 30_000,
  fakeResult: 9_000,
  /** 그림 속 거짓말: 그리기는 방 설정 시간 */
  lieWrite: 45_000,
  liePick: 30_000,
  lieShow: 11_000,
  /** 그림 릴레이: 그리기는 방 설정 시간 */
  relayWrite: 50_000,
  relayDesc: 45_000,
  /** 앨범 한 장 */
  relayPage: 6_000,
} as const;
/** 가짜 화가: 몇 바퀴 그리는지 */
export const FAKE_LAPS = 2;
/** 그림 릴레이: 최대 단계 (인원이 많아도 이만큼만) */
export const RELAY_MAX_STEPS = 8;

/** 가짜 화가: 사람마다 정해지는 펜 색 (입장 순서) */
export const FAKE_COLORS = [
  "#E53935",
  "#1E88E5",
  "#43A047",
  "#FB8C00",
  "#8E24AA",
  "#00ACC1",
  "#6D4C41",
  "#EC407A",
];

/** 점수 */
export const MODE_POINTS = {
  /** 가짜 화가 */
  fakeWin: 200,
  artistWin: 100,
  fakeVoteRight: 30,
  /** 그림 속 거짓말 */
  lieTruth: 100,
  lieArtistPer: 50,
  lieFooledPer: 50,
} as const;
