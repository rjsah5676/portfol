# Gunmo's Dev Life

2021년부터 운영 중인 개인 포트폴리오 사이트이자, 새로 익힌 기술을 직접 적용해보는 개발 실험장입니다.

**🔗 https://rjsah5676.github.io**

![Next.js](https://img.shields.io/badge/Next.js_16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React_19-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?logo=tailwindcss&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?logo=firebase&logoColor=black)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?logo=githubactions&logoColor=white)

> 마지막 업데이트: 2026.10.01

<br>

## 메뉴

| 메뉴         | 내용                                                                |
| ------------ | ------------------------------------------------------------------- |
| **project**  | 팀·개인 프로젝트 소개와 상세 페이지, 개인공부 글                    |
| **games**    | 4키 리듬게임 · 온라인 체스 · 멜론 게임 · 지뢰찾기 · 반응속도 테스트 |
| **tools**    | 칼로리 계산기 · 사다리타기 · 룰렛                                   |
| **devtools** | JSON Formatter · DDL → Java · JSON → Java DTO · MyBatis 로그 → SQL  |
| **about**    | 소개                                                                |
| **archive**  | 사이트 변경 이력·프로젝트·실무를 정리한 타임라인                    |
| **방명록**   | 포스트잇 보드 (실시간 반영)                                         |

<br>

## 주요 기능

### 🎹 4키 리듬게임 `/games/rhythm`

- DFJK 4키, 롱노트, 난이도 4단계, 곡·난이도별 랭킹, 모바일 터치
- 곡: AI 자작곡 4곡 + **내 mp3로 플레이** (브라우저 안에서 분석, 서버 업로드 없음)
- **채보 분석기**: 스펙트럴 플럭스로 타격, 자기상관·동적 계획법으로 템포·비트 추적 → 32분음표 격자 스냅 → 난이도별 밀도·곡 세기에 맞춰 노트·롱노트·동시치기 배치
- 판정 PERFECT·GREAT·GOOD(100·66·33%), FAST/SLOW 표시, 결과 평균으로 판정 싱크 보정
- HP·FAILED, 롱노트 콤보, 타격음·노트 스킨 선택, 일시정지 중 속도·싱크·볼륨 조절

### ♟️ 온라인 체스 `/games/chess`

- 방 생성·참여·관전, 초대 링크, 제한 시간·추가 시간, 무르기·무승부 제안·기권, 방 채팅
- 소켓 서버 없이 Firestore `onSnapshot`으로 실시간 동기화, 수 두기는 트랜잭션 처리
- 익명 로그인 uid로 좌석 식별 → 새로고침해도 같은 자리로 복귀

### 🍔 칼로리 계산기 `/tools/calorie`

- 식약처 식품영양성분 DB 2만여 개 검색 (초성 검색 지원)
- 칼로리·탄단지 비율 차트, g·1인분 계산, 식단 합계
- 대표 음식 535개는 음식별 정적 페이지로 생성해 검색엔진 노출

### 🛠️ devtools

- **MyBatis 로그 → SQL**: `Preparing` / `Parameters` 로그를 값이 채워진 실행 가능한 SQL로
- **DDL → Java**: `CREATE TABLE`로 DTO · MyBatis resultMap · Mapper XML 생성
- **JSON → Java DTO**: Lombok · getter/setter · record, `@JsonProperty`
- **JSON Formatter**: 정렬 · 압축 · 키 정렬, 오류 위치 표시

<br>

## 기술 스택

| 구분        | 사용 기술                                                                     |
| ----------- | ----------------------------------------------------------------------------- |
| Frontend    | Next.js 16 (App Router, 정적 export) · React 19 · TypeScript · Tailwind CSS 4 |
| Data / Auth | Firebase Firestore · Firebase Authentication                                  |
| Library     | Web Audio API · Canvas API · chess.js · sql-formatter · React Quill           |
| Infra / CI  | GitHub Actions · GitHub Pages · Firebase Hosting                              |
| Tooling     | ESLint · Prettier                                                             |

<br>

## 구조

```
빌드 · 배포
  GitHub (push · 수동 실행 · 매일 04:00 KST)
    → GitHub Actions: npm ci → next build (Firestore 글 조회 → 정적 HTML 생성)
    → GitHub Pages (대표 도메인) + Firebase Hosting (301 → 대표 도메인)

런타임 (브라우저)
  정적 페이지 ──→ Firestore (방명록 · 랭킹 · 방문자 · 글 · 체스 대국·채팅 · 문의)
              └→ Auth (관리자 로그인 · 체스 익명 로그인)
```

```
src/
├─ app/          페이지 (project · games · tools · devtools · study · archive …)
├─ components/   화면 컴포넌트
├─ lib/          로직 (rhythm: 곡·채보·판정·합성, 변환기, SEO …)
├─ firestore/    Firestore 데이터 접근
└─ data/         프로젝트·아카이브 데이터
scripts/         빌드 보조 스크립트 (영양성분 데이터 생성)
```

<br>

## 실행

```bash
npm ci
npm run dev      # 개발 서버 (http://localhost:3000)
npm run build    # 정적 빌드 → build/
npm run lint
npm run foods    # data/raw/*.csv(식약처 원본) → public/data/foods.json
```

`main`에 push하면 GitHub Actions가 빌드해서 GitHub Pages와 Firebase Hosting에 함께 배포합니다.

<br>

## 연혁

| 시기    | 내용                                                                                      |
| ------- | ----------------------------------------------------------------------------------------- |
| 2021.07 | Create React App으로 개발 시작, GitHub Pages 배포                                         |
| 2021.08 | 멜론 게임 제작                                                                            |
| 2024.12 | 프로젝트 상세 · 소개 · 방명록 · 아카이브 페이지 구성                                      |
| 2025.01 | 사이트 전면 리디자인, 퀵메뉴 · Contact 모달                                               |
| 2025.05 | 개인공부 게시판, 지뢰찾기                                                                 |
| 2026.09 | Next.js · TypeScript 전면 리뉴얼, SEO · 배포 자동화, 온라인 체스 · 도구 · 관리자 대시보드 |
| 2026.10 | 4키 리듬게임, 칼로리 계산기, devtools 변환기 3종                                          |

전체 기록은 [archive](https://rjsah5676.github.io/archive/)에서 볼 수 있습니다.
