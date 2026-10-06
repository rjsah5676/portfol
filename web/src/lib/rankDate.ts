/**
 * 랭킹 달성 일자 표시용.
 * Firestore에서 읽은 createdAt(Timestamp)을 "26.10.03"으로. 예전 기록처럼 날짜가 없으면 "".
 */
export function toDate(v: unknown): Date | null {
  if (v && typeof (v as { toDate?: unknown }).toDate === "function")
    return (v as { toDate: () => Date }).toDate();
  return null;
}

export function rankDateLabel(d: Date | null | undefined): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getFullYear() % 100)}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

const PROJECT = "gunmo-portfolio";
const API_KEY = "AIzaSyC-833NLKJyKbNAuIj07ZqO9lt2GYHD5UM";

/**
 * 날짜 필드(createdAt)가 생기기 전의 예전 기록은 Firestore 문서가 만들어진 시각으로 채움.
 * 웹 SDK는 문서 생성 시각을 안 알려줘서 REST(batchGet)로 해당 문서들의 createTime만 받아옴.
 * (랭킹 컬렉션은 누구나 읽기 가능이라 로그인 없이 됨) 실패하면 날짜 없이 그대로.
 */
export async function fillCreateTimes<T extends { id: string; createdAt: Date | null }>(
  collectionPath: string,
  rows: T[]
): Promise<T[]> {
  const missing = rows.filter((r) => !r.createdAt);
  if (!missing.length) return rows;
  const base = `projects/${PROJECT}/databases/(default)/documents`;
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/${base}:batchGet?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: missing.map((r) => `${base}/${collectionPath}/${r.id}`),
        mask: { fieldPaths: ["name"] },
      }),
    });
    if (!res.ok) return rows;
    const list = (await res.json()) as { found?: { name: string; createTime?: string } }[];
    const created = new Map<string, Date>();
    for (const x of list)
      if (x.found?.createTime)
        created.set(x.found.name.split("/").pop()!, new Date(x.found.createTime));
    return rows.map((r) => (r.createdAt ? r : { ...r, createdAt: created.get(r.id) ?? null }));
  } catch {
    return rows;
  }
}
