/*
 * 예/아니오 추리 (프로토) — 사건 데이터. 서버 전용: truth · facts · falseBeliefs · rubric · judgeNotes 는 절대 클라이언트로 안 보냄.
 * 사건을 고치면 version 을 올릴 것 (판정 캐시 키에 들어감 → 옛 판정이 남지 않음).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Fact {
  id: string;
  statement: string;
  /** 맞히면 YES → KEY_YES 로 올라감 */
  key?: boolean;
}

/** 흔한 오답 가설 (문장 자체가 틀린 가설). 이걸 정면으로 물으면 NO → KEY_NO */
export interface FalseBelief {
  id: string;
  statement: string;
}

export interface RubricItem {
  id: string;
  category: "culprit" | "method" | "motive" | "trick" | "process" | "reveal" | "other";
  /** 화면에 보이는 유형 이름 (내용은 안 드러나게) */
  label: string;
  /** 채점 기준 (서버 전용) */
  requirement: string;
  /**
   * 보너스 항목: 정답(해결) 조건엔 안 들어가고, 제출문에 맞게 적으면 점수만 깎아 줌 (레퍼런스의 "보너스").
   * 정답 기준은 2~8개로 작게, 디테일은 보너스로 — 판이 덜 빡빡하면서 꼼꼼히 판 사람이 이득
   */
  bonus?: boolean;
}

export interface Clue {
  id: string;
  /** 차감되는 질문이 이 개수에 닿으면 공개 */
  unlockAt: number;
  body: string;
  /** 단서의 역할: 질문거리(사실) / 판을 뒤집는 조각(reveal, 단서 없인 못 푸는 항목을 열어 줌) / 사실상 해답 요약(마지막 구제용) */
  role?: "fact" | "reveal" | "rescue";
  /** 그림 단서. web/public 기준 경로 (예: /mystery/attendance/c1.png). body 는 그림 설명·캡션 */
  image?: string;
}

/** 기대 판정 셋 — 검수 스크립트가 돌리고, example 인 것은 판정 프롬프트에 예시로도 들어감 */
export interface ExpectedJudgement {
  q: string;
  /** 허용 판정. Y = YES·KEY_YES, N = NO·KEY_NO 묶음 */
  ok: ("Y" | "N" | "UNKNOWN" | "UNRELATED" | "SPLIT" | "INVALID")[];
  /** 판정 프롬프트에 예시로 넣을 것 (2개 권장 — 헷갈리기 쉬운 것) */
  example?: boolean;
}

/** 채점 테스트 — 검수 스크립트용 */
export interface ExpectedGrade {
  answer: string;
  /** 정답 항목 중 통과해야 할 개수 (정확히) */
  passed?: number;
  /** 또는 최대 */
  passedMax?: number;
}

export interface MysteryCase {
  id: string;
  version: number;
  title: string;
  level: "쉬움" | "보통" | "어려움";
  prompt: string;
  questionLimit: number;
  submitLimit: number;
  truth: string;
  facts: Fact[];
  falseBeliefs: FalseBelief[];
  rubric: RubricItem[];
  clues: Clue[];
  judgeNotes: string;
  /** 검수용 (서버는 안 씀, example 만 프롬프트에) */
  expected?: { ask: ExpectedJudgement[]; grade?: ExpectedGrade[] };
  /** 외부 작품 모티브면 카드에 고지 (예: "영화 〈…〉 모티브 일부, 실제 줄거리와 무관") */
  credit?: string;
  /** 표지 삽화 (web/public 기준 경로). 문제문과 같이 보이며 그림 자체가 단서 — 이상한 점·보너스 소품을 심는다 */
  cover?: string;
  /** cases/candidates 에서 읽은 후보 (로더가 붙임, 파일엔 안 씀) */
  candidate?: boolean;
}

/** 정답(해결) 조건에 들어가는 항목만 */
export const requiredRubric = (c: MysteryCase) => c.rubric.filter((r) => !r.bonus);
export const bonusRubric = (c: MysteryCase) => c.rubric.filter((r) => r.bonus);
/*
 * 사건 파일. cases/live/*.json = 등록(모두에게 보임), cases/candidates/*.json = 후보(개발 모드 · 관리자에게만 보임).
 * 서버 뜰 때 한 번 읽음. 폴더는 모듈 위치에서 위로 올라가며 찾음 (src/… 과 dist/index.js 둘 다 됨), MYSTERY_CASES_DIR 로 지정 가능.
 * 사건을 더하는 법: cases/README.md
 */
function findCasesDir(): string | null {
  if (process.env.MYSTERY_CASES_DIR) return process.env.MYSTERY_CASES_DIR;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, "cases");
    if (existsSync(path.join(p, "live"))) return p;
    dir = path.dirname(dir);
  }
  return null;
}

function loadDir(dir: string | null, candidate: boolean): MysteryCase[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const c = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as MysteryCase;
      if (c.id !== path.basename(f, ".json")) throw new Error(`사건 파일 이름과 id 가 다름: ${f} ↔ ${c.id}`);
      return candidate ? { ...c, candidate: true } : c;
    });
}

const casesDir = findCasesDir();
if (!casesDir) console.warn("[mystery] cases/live 폴더를 못 찾음 — 사건 0개 (MYSTERY_CASES_DIR 로 지정 가능)");
/** 등록 사건 (파일 이름순) */
export const CASES: MysteryCase[] = loadDir(casesDir && path.join(casesDir, "live"), false);
/** 후보 사건 — 플레이는 되지만 목록엔 개발 모드 · 관리자에게만 */
export const CANDIDATES: MysteryCase[] = loadDir(casesDir && path.join(casesDir, "candidates"), true);

export const caseById = (id: string, includeCandidates = true) =>
  CASES.find((c) => c.id === id) ?? (includeCandidates ? CANDIDATES.find((c) => c.id === id) : undefined) ?? null;
