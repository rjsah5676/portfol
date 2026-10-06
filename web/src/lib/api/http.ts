import { API_URL } from "./config";
import { ApiError, toApiError } from "./errors";

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** 파일을 그대로 보낼 때 (body 대신). Content-Type 은 파일 형식 */
  blob?: Blob;
  /** 로그인 토큰을 같이 보냄 (관리자 전용 요청) */
  auth?: boolean;
  /**
   * Next 서버에서 부를 때의 캐시 설정 (브라우저에서는 무시됨).
   * revalidate: 이 초만큼은 받아둔 응답을 다시 씀 / tags: 내용이 바뀌면 이 이름으로 캐시를 비움
   */
  next?: { revalidate?: number; tags?: string[] };
  /** 이 시간(ms) 안에 응답이 없으면 포기 */
  timeoutMs?: number;
}

async function bearer(): Promise<Record<string, string>> {
  // 빌드 때(Node)도 이 파일을 읽으므로 Firebase는 필요할 때만 불러옴
  const { auth } = await import("@/firebase");
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 백엔드 REST 호출. 2xx가 아니면 ApiError (서버에 못 닿으면 code = "NETWORK") */
export async function api<T = void>(
  path: string,
  { method = "GET", body, blob, auth = false, next, timeoutMs }: Options = {}
): Promise<T> {
  const headers: Record<string, string> = auth ? await bearer() : {};
  if (blob) headers["Content-Type"] = blob.type;
  else if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: blob ?? (body === undefined ? undefined : JSON.stringify(body)),
      ...(next ? { next } : {}),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (e) {
    throw new ApiError("NETWORK", `서버에 연결할 수 없습니다. (${API_URL || "같은 주소"})`, 0, e);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; data?: unknown };
  } | null;
  if (!res.ok) throw toApiError(json?.error, res.status);
  return json as T;
}
