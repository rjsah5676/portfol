import { api } from "@/lib/api/http";
import { Timestamp } from "@/lib/api/timestamp";

// 관리자 페이지 데이터 탭용 범용 헬퍼. 컬렉션 경로(슬래시 구분)만 받아서 조회·수정·삭제.
// 서버(/api/admin)가 관리자 토큰을 검사하고, 허용된 경로만 처리함.

export const FETCH_LIMIT = 500;

export type DocumentData = Record<string, any>;

export interface AdminDoc {
  id: string;
  data: DocumentData;
}

export async function listDocs(path: string): Promise<AdminDoc[]> {
  const docs = await api<AdminDoc[]>(`/api/admin/docs?path=${encodeURIComponent(path)}`, {
    auth: true,
  });
  return docs.map((d) => ({ id: d.id, data: decode(d.data) as DocumentData }));
}

/** 문서 전체를 교체 (편집기에서 JSON으로 고친 결과) */
export async function replaceDoc(path: string, id: string, data: DocumentData): Promise<void> {
  await api("/api/admin/docs", {
    method: "PUT",
    body: { path, id, data: encode(data) },
    auth: true,
  });
}

export async function removeDoc(path: string, id: string): Promise<void> {
  await removeDocs(path, [id]);
}

/** 여러 문서 삭제 - 한 번에 너무 많이 보내지 않게 나눠서 요청 */
export async function removeDocs(path: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 450) {
    await api("/api/admin/docs/delete", {
      method: "POST",
      body: { path, ids: ids.slice(i, i + 450) },
      auth: true,
    });
  }
}

/** 체스·장기 방은 채팅·접속기록·비밀번호 정보까지 같이 지움 - 방 문서만 지우면 고아 데이터가 남음 */
export async function removeChessRooms(ids: string[], coll = "chess_rooms"): Promise<void> {
  for (let i = 0; i < ids.length; i += 450) {
    await api("/api/admin/rooms/delete", {
      method: "POST",
      body: { coll, ids: ids.slice(i, i + 450) },
      auth: true,
    });
  }
}

// ── 한눈에 보기 · 회원 · 열려 있는 방 (서버: server/src/http/admin.ts) ──

export interface AdminUser {
  uid: string;
  nick: string;
  /** 관리자가 붙여 준 꾸밈 (이모지 등) */
  badge: string | null;
  email: string | null;
  createdAt: number;
  updatedAt: number;
  visits: number;
  lastVisitAt: number | null;
  plays: number;
  /** 직접 올린 프로필 사진 주소 */
  avatar: string | null;
  stats: {
    plays?: Record<string, number>;
    online?: Record<string, { w?: number; l?: number; d?: number }>;
    sketch?: { correct?: number; points?: number; games?: number };
    fight?: { matches?: number };
  };
}

export interface AdminActivity {
  kind: "member" | "guest" | "inquiry" | "rank";
  at: number;
  who: string;
  text: string;
}

export interface AdminOverview {
  visitors: { total: number; today: number; daily: { date: string; count: number }[] };
  members: { total: number; recent: AdminUser[] };
  inquiries: { total: number; unread: number };
  posts: { total: number; retro: number };
  guest: { total: number };
  /** 랭킹 이름 → 기록 수 */
  rankings: Record<string, number>;
  /** 대국 방 컬렉션 → 수 */
  rooms: Record<string, { total: number; playing: number; waiting: number }>;
  live: Record<LiveGame, { rooms: number; players: number }>;
  server: { env: string; startedAt: number; connections: number; node: string; memoryMb: number };
  activity: AdminActivity[];
}

export type LiveGame = "sketch" | "fight";
export interface LiveRoom {
  id: string;
  name: string;
  status: string;
  players: string[];
  createdAt: number;
}

export const getOverview = () => api<AdminOverview>("/api/admin/overview", { auth: true });

export const listUsers = (q = "") =>
  api<{ total: number; items: AdminUser[] }>(
    `/api/admin/users?limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    { auth: true }
  );

export const updateUser = (uid: string, patch: { nick?: string; badge?: string | null }) =>
  api<AdminUser>(`/api/admin/users/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    body: patch,
    auth: true,
  });

export const clearUserAvatar = (uid: string) =>
  api(`/api/admin/users/${encodeURIComponent(uid)}/avatar`, { method: "DELETE", auth: true });

/** records = true 면 그 사람의 랭킹·방명록도 같이 지움 */
export const removeUser = (uid: string, records: boolean) =>
  api<{ removed: boolean }>(
    `/api/admin/users/${encodeURIComponent(uid)}${records ? "?records=1" : ""}`,
    { method: "DELETE", auth: true }
  );

export const getLiveRooms = () =>
  api<Record<LiveGame, LiveRoom[]>>("/api/admin/live", { auth: true });

export const closeLiveRoom = (game: LiveGame, id: string) =>
  api<{ closed: boolean }>("/api/admin/live/close", {
    method: "POST",
    body: { game, id },
    auth: true,
  });

// ── JSON 편집용 직렬화: Timestamp는 {"__timestamp": ISO}로 바꿔서 보여주고 저장 시 되돌림 ──
// (서버와 주고받을 때도 같은 표기를 씀)

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
