/*
 * DOODLE PARTY 게임 모드 · 깜짝 챌린지 · 시간 (서버 server/src/games/sketch.ts 와 화면이 같이 씀)
 *
 * classic  그림 맞히기   한 명이 그리고 나머지가 채팅으로 맞힘
 * fake     가짜 화가     한 도화지에 돌아가며 한 획씩. 한 명만 제시어를 모름 → 투표로 가짜 찾기
 * relay    그림 릴레이   문장 → 그림 → 문장 … 옆 사람에게 넘기며 이어 가고, 끝나면 앨범으로 같이 보기
 */

export type GameMode = "classic" | "fake" | "relay";

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
      "한 도화지에 돌아가며 딱 한 획씩, 정한 바퀴만큼 그려요 (기본 4바퀴 · 순서는 판마다 섞여요)",
      "투표로 가짜를 찾아요! 들켜도 가짜가 제시어를 맞히면 가짜 승리",
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
      "끝나면 앨범을 한 장씩 넘기며 같이 봐요 — 웃긴 그림 · 문장에 따봉! 베스트 그림 · 드립을 뽑고 이미지로 저장",
    ],
    min: 3,
  },
};
export const MODE_LIST: GameMode[] = ["classic", "fake", "relay"];

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
  /** 그림 릴레이: 그리기는 방 설정 시간 */
  relayWrite: 50_000,
  relayDesc: 45_000,
  /** 앨범 한 장 */
  relayPage: 6_000,
  /** 앨범 한 줄의 마지막 장 (처음 ↔ 끝 비교까지 보고 넘어가게) */
  relayLast: 12_000,
} as const;
/** 가짜 화가: 몇 바퀴 그리는지 */
export const FAKE_LAPS = 4;
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
  /** 출제자: 가짜가 이기면 같이 (원작 「Fake Artist Goes to New York」 규칙) */
  qmWin: 150,
} as const;

// ───────────── 가짜 화가: 출제자 ─────────────

/** 출제자를 쓰려면 이만큼 (출제자 + 그리는 사람 3명) */
export const FAKE_QM_MIN = 4;
/** 출제자가 제시어를 고르는 시간 */
export const FAKE_QM_PICK_MS = 25_000;

// ───────────── 그림 릴레이 변형 (갈틱폰 모드에서) ─────────────

export type RelayVariant = "normal" | "memory" | "speed";
export const RELAY_VARIANTS: Record<RelayVariant, { name: string; emoji: string; desc: string }> = {
  normal: { name: "기본", emoji: "📞", desc: "앞 사람 것을 보면서 이어 가요" },
  memory: {
    name: "기억해서",
    emoji: "🧠",
    desc: "앞 사람 그림 · 문장은 몇 초만 보여요. 기억나는 대로!",
  },
  speed: { name: "스피드", emoji: "⚡", desc: "모든 단계 시간이 짧아요. 손이 빨라야 해요" },
};
export const RELAY_VARIANT_LIST: RelayVariant[] = ["normal", "memory", "speed"];
/** 기억해서: 앞 사람 것을 보여 주는 시간 */
export const MEMORY_PEEK_MS = { text: 4_000, sheet: 6_000 } as const;
/** 스피드: 단계별 시간 */
export const SPEED_MS = { write: 25_000, draw: 35_000, desc: 25_000 } as const;

// ───────────── 그림 맞히기: 연속 정답 ─────────────

/** 연속으로 맞힌 차례 수 → 추가 점수 (2연속 +10, 3연속 +20, 4연속부터 +30) */
export const streakBonus = (streak: number) => Math.min(3, Math.max(0, streak - 1)) * 10;
