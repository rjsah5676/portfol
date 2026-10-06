import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  Timestamp,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../firebase";

// 관리자 페이지 데이터 탭용 범용 헬퍼. 컬렉션 경로(슬래시 구분)만 받아서 조회·수정·삭제.
// 규칙(firestore.rules)에서 isAdmin()에 update/delete가 열려 있는 컬렉션만 실제로 동작함.

export const FETCH_LIMIT = 500;

export interface AdminDoc {
  id: string;
  data: DocumentData;
}

const segs = (path: string) => path.split("/").filter(Boolean) as [string, ...string[]];

export async function listDocs(path: string): Promise<AdminDoc[]> {
  const snap = await getDocs(query(collection(db, ...segs(path)), limit(FETCH_LIMIT)));
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/** 문서 전체를 교체 (편집기에서 JSON으로 고친 결과) */
export async function replaceDoc(path: string, id: string, data: DocumentData): Promise<void> {
  await setDoc(doc(db, ...segs(path), id), data);
}

export async function removeDoc(path: string, id: string): Promise<void> {
  await deleteDoc(doc(db, ...segs(path), id));
}

/** 여러 문서 삭제 - 배치 한도(500) 단위로 나눠서 커밋 */
export async function removeDocs(path: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db);
    ids.slice(i, i + 450).forEach((id) => batch.delete(doc(db, ...segs(path), id)));
    await batch.commit();
  }
}

/** 체스·장기 방은 하위 컬렉션(chat, presence, private, access)까지 같이 지움 - 방 문서만 지우면 고아 데이터가 남음 */
export async function removeChessRooms(ids: string[], coll = "chess_rooms"): Promise<void> {
  for (const id of ids) {
    for (const sub of ["chat", "presence", "private", "access"]) {
      const snap = await getDocs(collection(db, coll, id, sub));
      if (snap.size)
        await removeDocs(
          `${coll}/${id}/${sub}`,
          snap.docs.map((d) => d.id)
        );
    }
    await removeDoc(coll, id);
  }
}

// ── JSON 편집용 직렬화: Timestamp는 {"__timestamp": ISO}로 바꿔서 보여주고 저장 시 되돌림 ──

const TS_KEY = "__timestamp";

function encode(v: unknown): unknown {
  if (v instanceof Timestamp) return { [TS_KEY]: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === TS_KEY) {
      const d = new Date(String(o[TS_KEY]));
      if (Number.isNaN(d.getTime())) throw new Error(`날짜 형식 오류: ${o[TS_KEY]}`);
      return Timestamp.fromDate(d);
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

export const toEditableJson = (data: DocumentData) => JSON.stringify(encode(data), null, 2);

export function fromEditableJson(text: string): DocumentData {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("최상위는 객체({ ... })여야 합니다.");
  }
  return decode(parsed) as DocumentData;
}

/** 표 셀 표시용 */
export function formatCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Timestamp) {
    const d = v.toDate();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  if (typeof v === "boolean") return v ? "✓" : "";
  if (typeof v === "object") return JSON.stringify(encode(v));
  return String(v);
}

/** 정렬용 값 */
export function sortValue(v: unknown): number | string {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v === undefined || v === null ? "" : String(v);
}
