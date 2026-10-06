/** 서버가 돌려준 오류 (code로 종류를 구분) */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface WireError {
  code?: string;
  message?: string;
  data?: unknown;
}

export const toApiError = (e: WireError | null | undefined, status = 0) =>
  new ApiError(e?.code ?? "UNKNOWN", e?.message ?? "요청에 실패했습니다.", status, e?.data);
