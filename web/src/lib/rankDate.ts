/**
 * 랭킹 달성 일자 표시용.
 * 서버가 준 createdAt(ms)을 "26.10.03"으로. 날짜가 없는 기록이면 "".
 * (날짜 필드가 생기기 전의 예전 기록은 데이터를 옮길 때 문서 생성 시각으로 채워 둠)
 */
export function toDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v);
  if (v instanceof Date) return v;
  if (v && typeof (v as { toDate?: unknown }).toDate === "function")
    return (v as { toDate: () => Date }).toDate();
  return null;
}

export function rankDateLabel(d: Date | null | undefined): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getFullYear() % 100)}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}
