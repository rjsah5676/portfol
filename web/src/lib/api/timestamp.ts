/**
 * 서버가 ms 숫자로 보내는 시각을 감싼 값.
 * 화면 코드가 기존(Firestore Timestamp)처럼 .toMillis() / .toDate() 로 쓰던 걸 그대로 두려고 같은 모양으로 만듦.
 */
export class Timestamp {
  constructor(private readonly ms: number) {}

  static fromMillis(ms: number) {
    return new Timestamp(ms);
  }
  static fromDate(d: Date) {
    return new Timestamp(d.getTime());
  }

  toMillis() {
    return this.ms;
  }
  toDate() {
    return new Date(this.ms);
  }
}

/** ms 숫자(또는 null) → Timestamp | null */
export const toTimestamp = (v: unknown): Timestamp | null =>
  typeof v === "number" && Number.isFinite(v) ? new Timestamp(v) : null;

/** ms 숫자(또는 null) → Date | null */
export const toDateOrNull = (v: unknown): Date | null =>
  typeof v === "number" && Number.isFinite(v) ? new Date(v) : null;
