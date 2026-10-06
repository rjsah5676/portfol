/**
 * 백엔드(Express) 주소.
 * - 브라우저: 빌드할 때의 NEXT_PUBLIC_API_URL. 없으면 로컬 개발 서버, "/" 면 지금 사이트와 같은 주소
 *   (운영에서 프록시가 /api 와 /socket.io 를 백엔드로 넘겨줄 때 — 이미지가 도메인에 묶이지 않음)
 * - Next 서버(Node): API_URL 이 있으면 그걸 먼저 씀 (컨테이너끼리는 http://server:4000 같은 내부 주소)
 */
const DEFAULT_API_URL = "http://localhost:4000";
const onServer = typeof window === "undefined";

const trim = (v: string | undefined) => (v ?? "").trim().replace(/\/+$/, "");

function resolve(): string {
  if (onServer && trim(process.env.API_URL)) return trim(process.env.API_URL);
  const pub = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();
  // "/" = 같은 출처. 서버에서는 상대 주소로 부를 수 없으니 기본 주소로
  if (pub === "/") return onServer ? DEFAULT_API_URL : "";
  return trim(pub) || DEFAULT_API_URL;
}

/** 브라우저에서는 "" 일 수 있음(같은 출처) → `${API_URL}/api/...` 는 그대로 상대 경로가 됨 */
export const API_URL = resolve();
