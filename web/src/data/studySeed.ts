// 개인 공부·프로젝트 회고 일괄 등록용 글 모음 — /study/import (관리자 전용)에서 DB에 등록할 때 사용.
// content는 Quill 2 형식으로 정규화된 HTML이라 등록 후 에디터에서 그대로 수정 가능.
// 지금 목록은 2026-11-04 에 추가한 글만 (studyNew.ts · retroNew.ts) — 예전 초기 글(이미 등록됨)은 git 기록에 있음.
// 예전 글을 다시 넣지 않는 이유: 같은 제목이면 에디터에서 고친 내용을 이 파일 내용으로 덮어쓰고, 지운 글은 다시 생기기 때문.

import { STUDY_NEW } from "./studyNew";
import { RETRO_NEW } from "./retroNew";

export interface StudySeedPost {
  title: string;
  category: string;
  /** 에디터와 같은 "YYYY-M-D H:M" 형식 (KST) */
  date: string;
  /** 없으면 개인 공부 */
  section?: "study" | "retro";
  /** 제목을 바꾼 글: 이전 제목으로 기존 문서를 찾아 같은 문서(URL)를 갱신 */
  replaces?: string;
  content: string;
}

export const STUDY_SEED: StudySeedPost[] = [...STUDY_NEW, ...RETRO_NEW];
