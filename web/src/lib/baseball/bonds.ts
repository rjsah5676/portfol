/**
 * 픽셀파이트 인연 — 미연시 장면 · 인연 축복(하데스식 3장 중 1장) · 듀오 축복 · 인연 배틀 · 특별한 날 · 은퇴 에필로그.
 *
 * 관계: 친구(카이 · 이반 · 바이올렛) / 동생 조력자(릴리) / 썸(이그나 · 소영 · 제나 · 메이) — 애인까지는 아니고 설레는 사이.
 * (건모는 인연에 안 나옴)
 * 만남 8번이 한 줄기:
 *   1 첫 만남(고르기) · 2 어울리기 + 축복 · 3 그 사람 고민(고르기) · 4 가벼운 대결(3구) + 축복
 *   5 결정적 장면(고르기, 이해 2 이상이면 특별한 답) · 6 둘만의 시간(관계별) + 축복 · 7 속마음(고르기) · 8 필살 전수 대결(5구 · 3점)
 * 고르기는 올인 러브 「마음 읽기」처럼 — 다정한 답은 호감만, 그 사람다운 답은 이해(+1)까지. 표시는 안 함, 반응 대사로만.
 */
import type { CharId } from "./data";
import { EPILOGUE_KAI, STORY_KAI } from "./bondStory/kai";
import { EPILOGUE_IGNA, STORY_IGNA } from "./bondStory/igna";
import { EPILOGUE_SOYOUNG, STORY_SOYOUNG } from "./bondStory/soyoung";
import { EPILOGUE_LILY, STORY_LILY } from "./bondStory/lily";
import { EPILOGUE_ZENA, STORY_ZENA } from "./bondStory/zena";
import { EPILOGUE_IVAN, STORY_IVAN } from "./bondStory/ivan";
import { EPILOGUE_VIOLET, STORY_VIOLET } from "./bondStory/violet";
import { EPILOGUE_MEI, STORY_MEI } from "./bondStory/mei";

export type Role = "friend" | "sister" | "crush";
/** 인연에 나오는 사람 */
export type BondId = Exclude<CharId, "gunmo">;
export const BOND_IDS: BondId[] = ["kai", "igna", "soyoung", "lily", "zena", "ivan", "violet", "mei"];
export const isBond = (id: CharId): id is BondId => (BOND_IDS as CharId[]).includes(id);
export const ROLE: Record<BondId, Role> = {
  kai: "friend",
  ivan: "friend",
  violet: "friend",
  lily: "sister",
  igna: "crush",
  soyoung: "crush",
  zena: "crush",
  mei: "crush",
};
export const ROLE_NAME: Record<Role, string> = { friend: "친구", sister: "동생", crush: "썸" };
/** 호감 단계 이름 (관계마다) */
export function heartName(role: Role, aff: number) {
  const L =
    role === "crush"
      ? ["처음 본 사이", "아는 사이", "신경 쓰이는 사이", "설레는 사이", "썸"]
      : role === "sister"
        ? ["처음 본 꼬마", "아는 꼬마", "졸졸 따라옴", "단짝 남매", "최고의 오빠"]
        : ["처음 본 사이", "아는 사이", "친구", "절친", "평생 라이벌"];
  return L[aff >= 80 ? 4 : aff >= 55 ? 3 : aff >= 30 ? 2 : aff >= 10 ? 1 : 0];
}

/** 고르기 덤 (슈퍼스타즈처럼 고른 답이 능력치까지) — 능력치 키: hit 타격 · power 파워 · run 주루 · def 수비 */
export interface ChoiceFx {
  stat?: Partial<Record<"hit" | "power" | "run" | "def", number>>;
  sp?: number;
  cond?: number;
  money?: number;
  stamina?: number;
}
export interface Choice {
  text: string;
  /** 호감 */
  aff: number;
  /** 그 사람다운 답이면 true (이해 +1) */
  know?: boolean;
  /** 고른 뒤 그 사람 반응 */
  reply: string;
  /** 고르면 붙는 덤 (버튼에 미리 보임) */
  fx?: ChoiceFx;
  /** 모험: p 확률로 fx, 아니면 bad + badReply (버튼에 성공률 보임) */
  gamble?: { p: number; bad: ChoiceFx; badReply: string };
}
export interface Beat {
  lines: string[];
  choices?: Choice[];
  /** 이해가 이만큼이면 열리는 특별한 답 (결정적 장면) */
  special?: { need: number; choice: Choice };
}

/** 장면 대사: [1 첫 만남, 2 어울리기, 3 고민, 4 가벼운 대결 전, 5 결정적 장면, 6 둘만의 시간, 7 속마음, 8 필살 대결 전] — 캐릭터마다 bondStory/*.ts */
export const STORY: Record<BondId, Beat[]> = {
  kai: STORY_KAI,
  igna: STORY_IGNA,
  soyoung: STORY_SOYOUNG,
  lily: STORY_LILY,
  zena: STORY_ZENA,
  ivan: STORY_IVAN,
  violet: STORY_VIOLET,
  mei: STORY_MEI,
};

/** 비시즌 특별한 날 (가장 가까운 한 명, 호감 40 이상) */
export const SPECIAL_DAY: Record<Role, { title: string; skin: Partial<Record<BondId, string>>; lines: (name: string) => string[] }> = {
  crush: {
    title: "크리스마스",
    skin: { igna: "igna-fw", zena: "zena-idol", soyoung: "soyoung-bunny" },
    lines: (n) => [`눈 내리는 거리, ${n}가 먼저 와서 기다리고 있었다.`, `${n}: "…늦었어. 손 차갑잖아." 장갑 한 짝을 건네받았다.`, "애인은 아니지만, 오늘만큼은 둘이 같은 쪽을 걸었다."],
  },
  sister: {
    title: "릴리 생일 파티",
    skin: { lily: "lily-frog" },
    lines: () => ["개구리 옷을 입은 릴리가 케이크 앞에서 소원을 빈다.", "릴리: \"오빠가 내년에도 홈런 많이 치게 해 주세요!\"", "촛불이 꺼지자 릴리가 제일 큰 조각을 내 접시에 놓았다."],
  },
  friend: {
    title: "송년회",
    skin: { ivan: "ivan-winter", kai: "kai-tkd" },
    lines: (n) => [`포장마차 송년회. ${n}가 잔을 든다.`, `${n}: "내년에도 이기자. 아니, 내년엔 더."`, "올해 가장 시끄러웠던 밤이었다."],
  },
};

/** 은퇴 에필로그 (가장 가까운 사람) */
export const EPILOGUE: Record<BondId, string> = {
  kai: EPILOGUE_KAI,
  igna: EPILOGUE_IGNA,
  soyoung: EPILOGUE_SOYOUNG,
  lily: EPILOGUE_LILY,
  zena: EPILOGUE_ZENA,
  ivan: EPILOGUE_IVAN,
  violet: EPILOGUE_VIOLET,
  mei: EPILOGUE_MEI,
};

/* ─────────────── 인연 축복 (캐릭터마다 4장 · 겹치면 레벨 업) ─────────────── */

/** 캐릭터별 축복 특수능력 id (career.ts SKILLS 에 정의) */
export const BOONS: Record<BondId, string[]> = {
  kai: ["b_kai_wind", "b_kai_dash", "b_kai_read", "b_kai_rest"],
  igna: ["b_igna_swing", "b_igna_forge", "b_igna_spark", "b_igna_heat"],
  soyoung: ["b_soy_fix", "b_soy_class", "b_soy_watch", "b_soy_sticker"],
  lily: ["b_lily_shade", "b_lily_drop", "b_lily_float", "b_lily_candy"],
  zena: ["b_zena_reflex", "b_zena_step", "b_zena_zap", "b_zena_prank"],
  mei: ["b_mei_steam", "b_mei_palm", "b_mei_bun", "b_mei_gap"],
  ivan: ["b_ivan_fist", "b_ivan_body", "b_ivan_drill", "b_ivan_log"],
  violet: ["b_violet_stretch", "b_violet_spin", "b_violet_blind", "b_violet_stage"],
};
/** 듀오 축복: 두 사람 축복을 하나씩 가지고 있으면 그 둘 중 누구를 만나도 3장 중에 섞여 나옴 */
export const DUOS: { a: BondId; b: BondId; id: string }[] = [
  { a: "kai", b: "zena", id: "d_kai_zena" },
  { a: "igna", b: "ivan", id: "d_igna_ivan" },
  { a: "soyoung", b: "violet", id: "d_soy_violet" },
  { a: "lily", b: "mei", id: "d_lily_mei" },
  { a: "kai", b: "igna", id: "d_kai_igna" },
  { a: "zena", b: "soyoung", id: "d_zena_soy" },
  { a: "ivan", b: "mei", id: "d_ivan_mei" },
  { a: "violet", b: "lily", id: "d_violet_lily" },
];
