import { api } from "./http";

/*
 * 랭킹 기록 등록. 서버는 가짜 기록을 걸러내려고
 *   - 로그인한 사용자(게임은 익명 로그인)의 기록만 받고,
 *   - "게임을 시작할 때 받은 티켓"을 같이 내야 하며, 티켓을 받은 뒤로 그 기록이 나올 만큼 시간이 지났는지 봄
 * (server/src/http/rankings.ts)
 *
 *   beginRun(board)            게임(판)을 시작할 때 — 티켓을 받아 둠
 *   submitRun(board, path, …)  기록을 올릴 때 — 받아 둔 티켓과 함께 보냄 (firestore/* 의 등록 함수가 씀)
 *
 * board = 랭킹 이름 (리듬게임은 "rhythm:곡id_난이도").
 * 티켓은 localStorage 에도 둬서, 새로고침한 뒤 이어 하는 판(AI 대국)도 등록할 수 있음.
 */
/** 랭킹에 적는 이름 길이 (서버 RANK_NAME_MAX 와 같은 값 — 회원 별명 최대 길이) */
export const RANK_NAME_MAX = 10;

const storeKey = (board: string) => `rank-ticket:${board}`;
const pending = new Map<string, Promise<string | null>>();
/** 랭킹별로 몇 번째 판인지 (늦게 도착한 옛 판의 티켓을 구분) */
const runNo = new Map<string, number>();

/** 로그인이 안 돼 있으면 익명으로 로그인 (온라인 대국과 같은 방식) */
async function signIn(): Promise<void> {
  const { auth } = await import("@/firebase");
  await auth.authStateReady();
  if (auth.currentUser) return;
  const { signInAnonymously } = await import("firebase/auth");
  await signInAnonymously(auth);
}

/** 페이지에 들어왔을 때 미리 로그인해 둠 → 첫 판의 티켓을 바로 받을 수 있게 */
export function prepareRuns(): void {
  signIn().catch(() => {});
}

/** 게임(판)을 시작할 때 부름. 실패해도 게임은 그대로 할 수 있음 (그 판의 기록만 못 올림) */
export function beginRun(board: string): void {
  try {
    localStorage.removeItem(storeKey(board));
  } catch {}
  const no = (runNo.get(board) ?? 0) + 1;
  runNo.set(board, no);
  const p = (async () => {
    try {
      await signIn();
      const { ticket } = await api<{ ticket: string }>("/api/rankings/tickets", {
        method: "POST",
        auth: true,
        body: { board },
      });
      // 그 사이 새 판을 시작했으면 옛 티켓은 버림
      if (runNo.get(board) === no) {
        try {
          localStorage.setItem(storeKey(board), ticket);
        } catch {}
      }
      return ticket;
    } catch {
      return null;
    }
  })();
  pending.set(board, p);
}

async function ticketOf(board: string): Promise<string | undefined> {
  const got = await pending.get(board);
  if (got) return got;
  try {
    return localStorage.getItem(storeKey(board)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * 기록 등록. 돌려주는 id 는 랭킹에 올라가 있는 내 기록
 * (한 사람당 가장 좋은 기록 하나만 남으므로, 이번 기록이 더 나쁘면 예전 기록의 id).
 */
export async function submitRun(board: string, path: string, body: object): Promise<string> {
  await signIn();
  // 이름은 어디서 입력받았든(입력 칸·prompt) 여기서 한 번 더 길이를 맞춤
  const typed = (body as { name?: unknown }).name;
  const name = typeof typed === "string" ? typed.trim().slice(0, RANK_NAME_MAX) : undefined;
  const res = await api<{ id: string }>(path, {
    method: "POST",
    auth: true,
    body: { ...body, ...(name !== undefined && { name }), ticket: await ticketOf(board) },
  });
  // 티켓은 한 번만 쓸 수 있음
  pending.delete(board);
  try {
    localStorage.removeItem(storeKey(board));
  } catch {}
  return res.id;
}
