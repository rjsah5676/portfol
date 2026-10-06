/** 클라이언트에 그대로 전달되는 오류 (code로 종류 구분, message는 화면에 표시될 수 있음) */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public data?: unknown
  ) {
    super(message);
  }
}

export const bad = (message = "잘못된 요청입니다.") => new AppError("BAD_REQUEST", message, 400);
export const unauthenticated = () => new AppError("UNAUTHENTICATED", "로그인이 필요합니다.", 401);
export const forbidden = (message = "권한이 없습니다.") => new AppError("FORBIDDEN", message, 403);
export const notFound = (message = "찾을 수 없습니다.") => new AppError("NOT_FOUND", message, 404);

export interface WireError {
  code: string;
  message: string;
  data?: unknown;
}

/** 어떤 오류든 클라이언트용 형태로 (내부 오류 내용은 숨김) */
export function toWireError(e: unknown): WireError & { status: number } {
  if (e instanceof AppError) return { code: e.code, message: e.message, data: e.data, status: e.status };
  if (e && typeof e === "object" && (e as { name?: string }).name === "ZodError")
    return { code: "BAD_REQUEST", message: "잘못된 요청입니다.", status: 400 };
  return { code: "INTERNAL", message: "서버 오류가 발생했습니다.", status: 500 };
}
