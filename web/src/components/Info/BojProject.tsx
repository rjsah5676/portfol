import { LinkPill, Section, StatGrid } from "./ProjectDetailUI";

// 레포(rjsah5676/ACMICPC) 폴더별 풀이 수 — 상위 분류만 표시
const CATEGORIES: { name: string; count: number }[] = [
  { name: "DP", count: 20 },
  { name: "자료구조", count: 10 },
  { name: "그리디", count: 8 },
  { name: "브루트포스", count: 8 },
  { name: "이분 탐색", count: 8 },
  { name: "최단 경로", count: 8 },
  { name: "분할 정복", count: 7 },
  { name: "정수론", count: 6 },
  { name: "BFS", count: 5 },
  { name: "분리 집합", count: 4 },
];

interface Problem {
  id: number;
  title: string;
  idea: string;
}

const GROUPS: { title: string; problems: Problem[] }[] = [
  {
    title: "DP",
    problems: [
      { id: 2098, title: "외판원 순회", idea: "dp[현재 도시][방문 집합] 비트마스크 DP" },
      {
        id: 1006,
        title: "습격자 초라기",
        idea: "2×N 원형 구조를 처음·끝 열 연결 여부로 나눠, 열마다 윗칸/아랫칸/둘 다 채운 3가지 상태로 DP",
      },
      { id: 11049, title: "행렬 곱셈 순서", idea: "구간 [i, j]를 나누는 지점 k를 고르는 구간 DP" },
      { id: 7579, title: "앱", idea: "메모리 대신 비용을 축으로 둔 0/1 배낭 DP" },
      { id: 9252, title: "LCS 2", idea: "LCS 길이 DP 후 테이블을 역추적해 문자열 복원" },
    ],
  },
  {
    title: "이분 탐색 · 매개변수 탐색",
    problems: [
      {
        id: 12015,
        title: "가장 긴 증가하는 부분 수열 2",
        idea: "길이별 최소 끝값 배열을 이분 탐색으로 갱신해 O(N log N)",
      },
      {
        id: 1300,
        title: "K번째 수",
        idea: "값 x에 대해 행마다 min(x / i, N)개를 세는 매개변수 탐색",
      },
      {
        id: 2110,
        title: "공유기 설치",
        idea: "최소 거리를 정해두고 설치 가능 여부를 판정하는 매개변수 탐색",
      },
    ],
  },
  {
    title: "분할 정복 · 정수론",
    problems: [
      {
        id: 11401,
        title: "이항 계수 3",
        idea: "페르마 소정리로 분모의 모듈러 역원을 구하고 분할 정복 거듭제곱",
      },
      {
        id: 11444,
        title: "피보나치 수 6",
        idea: "피보나치 행렬의 분할 정복 거듭제곱으로 O(log N)",
      },
      {
        id: 6549,
        title: "히스토그램에서 가장 큰 직사각형",
        idea: "높이가 증가하는 단조 스택으로 O(N)",
      },
    ],
  },
  {
    title: "자료구조 · 그리디",
    problems: [
      { id: 1655, title: "가운데를 말해요", idea: "최대 힙·최소 힙 두 개로 중앙값을 실시간 유지" },
      { id: 17298, title: "오큰수", idea: "아직 답을 못 찾은 인덱스를 단조 스택으로 관리" },
      {
        id: 1202,
        title: "보석 도둑",
        idea: "가방·보석 정렬 후 담을 수 있는 보석을 우선순위 큐에 넣고 최댓값 선택",
      },
    ],
  },
  {
    title: "그래프",
    problems: [
      {
        id: 1647,
        title: "도시 분할 계획",
        idea: "크루스칼로 MST를 만든 뒤 가장 비싼 간선 하나를 제거",
      },
      { id: 2162, title: "선분 그룹", idea: "CCW로 선분 교차를 판정하고 유니온 파인드로 그룹화" },
      {
        id: 1504,
        title: "특정한 최단 경로",
        idea: "다익스트라로 경유지 순서 두 가지 경로를 각각 계산해 비교",
      },
      {
        id: 16236,
        title: "아기 상어",
        idea: "매 단계 BFS로 가장 가깝고 위·왼쪽 우선인 먹이를 찾는 시뮬레이션",
      },
    ],
  },
  {
    title: "비트마스킹 · 완전 탐색 · 구현",
    problems: [
      {
        id: 14939,
        title: "불 끄기",
        idea: "첫 줄 누름 조합 2¹⁰가지를 고정하면 나머지 줄은 윗줄 상태로 결정",
      },
      {
        id: 1029,
        title: "그림 교환",
        idea: "(현재 사람, 소유 이력 비트마스크, 가격) 상태 공간 탐색",
      },
      { id: 2580, title: "스도쿠", idea: "빈칸마다 행·열·3×3 제약을 확인하는 백트래킹" },
      {
        id: 3190,
        title: "뱀 · 경사로 · 톱니바퀴",
        idea: "삼성 SW 역량테스트 기출 구현·시뮬레이션 (3190, 14890, 14891)",
      },
    ],
  },
];

export default function BojProject() {
  const max = Math.max(...CATEGORIES.map((c) => c.count));

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 font-mono text-sm text-[#8B84FF]">personal · algorithm</div>
      <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">BAEKJOON Online Judge</h1>
      <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-white/60">
        코딩 테스트 대비 알고리즘 풀이 기록 — 유형별로 대표 문제와 핵심 아이디어를 정리
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-xs">
        <span className="rounded-full border border-white/10 px-3 py-1 text-white/50">
          2016.06 –
        </span>
        <LinkPill href="https://github.com/rjsah5676/ACMICPC">GitHub ↗</LinkPill>
        <LinkPill href="https://www.acmicpc.net/user/rjsah5676">백준 프로필 ↗</LinkPill>
      </div>

      <StatGrid
        stats={[
          { value: "109", label: "레포 풀이" },
          { value: "25", label: "분류" },
          { value: "C++", label: "주 언어 (+Java, Python)" },
          { value: "2016", label: "시작" },
        ]}
      />

      <Section num="01" title="유형 분포">
        <div className="flex flex-col gap-2">
          {CATEGORIES.map((c) => (
            <div key={c.name} className="flex items-center gap-3">
              <div className="w-20 flex-shrink-0 text-right font-mono text-xs text-white/50">
                {c.name}
              </div>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-[#6C63FF]"
                  style={{ width: `${(c.count / max) * 100}%` }}
                />
              </div>
              <div className="w-6 font-mono text-xs text-white/40">{c.count}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 font-['Nanum_Gothic',sans-serif] text-xs text-white/40">
          최단 경로 = 다익스트라 + 플로이드 와샬, 자료구조 = 스택 · 큐/덱 · 우선순위 큐 · 맵
        </p>
      </Section>

      <Section num="02" title="대표 문제 요점 정리">
        <div className="flex flex-col gap-8">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="mb-3 font-mono text-sm font-medium text-white">{g.title}</h3>
              <ul className="overflow-hidden rounded-xl border border-white/10">
                {g.problems.map((p, i) => (
                  <li
                    key={p.id}
                    className={`flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4 ${
                      i > 0 ? "border-t border-white/5" : ""
                    }`}
                  >
                    <a
                      href={`https://www.acmicpc.net/problem/${p.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 font-mono text-sm text-white transition-colors hover:text-[#8B84FF] sm:w-60"
                    >
                      <span className="mr-2 text-xs text-[#8B84FF]">{p.id}</span>
                      {p.title}
                    </a>
                    <span className="font-['Nanum_Gothic',sans-serif] text-sm text-white/60">
                      {p.idea}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
