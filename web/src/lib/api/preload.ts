import { api } from "./http";

/**
 * 서버(Next)에서 첫 화면에 넣을 데이터를 미리 읽음 → 검색엔진·첫 화면에 내용이 바로 보임.
 * 백엔드에 못 닿거나 늦으면 undefined 를 돌려주고, 그때는 브라우저가 평소처럼 직접 읽어서 채움.
 * revalidate: 이 초만큼은 받아둔 응답을 다시 씀 (0 = 매번 새로)
 */
export async function preload<T>(path: string, revalidate: number): Promise<T | undefined> {
  try {
    return await api<T>(path, { next: { revalidate }, timeoutMs: 3000 });
  } catch {
    return undefined;
  }
}
