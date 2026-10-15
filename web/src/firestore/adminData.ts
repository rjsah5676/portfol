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

/** 격투 경기 기록(fight_replays)을 입력까지 전부 받아 JSON 파일로 저장 */
export async function exportFightReplays(): Promise<number> {
  const all: unknown[] = [];
  let after: string | null = null;
  for (let i = 0; i < 500; i++) {
    const q: string = after ? `?after=${encodeURIComponent(after)}` : "";
    const r: { list: unknown[]; next: string | null } = await api(`/api/admin/fight/replays${q}`, { auth: true });
    all.push(...r.list);
    after = r.next;
    if (!after) break;
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ at: Date.now(), replays: all })], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `fight-replays-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return all.length;
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
  /** 포커 칩 */
  money: number;
  /** 포인트 */
  points: number;
  /** 이용 정지 (지난 것도 옴 — until 로 판단) */
  ban?: MemberBan;
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
  /** 오늘 유입 (유입 분석) — top: [유입처, 수] 많은 순 3개, "" = 직접 접속 */
  traffic: { entries: number; uniques: number; hits: number; top: [string, number][] };
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

export type LiveGame = "sketch" | "fight" | "poker" | "rhythm" | "defense" | "marble";
export interface LiveRoom {
  id: string;
  name: string;
  status: string;
  players: string[];
  createdAt: number;
}

export const getOverview = () => api<AdminOverview>("/api/admin/overview", { auth: true });

// ── 유입 분석 (서버: server/src/traffic.ts) ──

export type TrafficSource = "campaign" | "search" | "ai" | "social" | "referral" | "legacy" | "internal" | "direct";
export type TrafficDim =
  | "source"
  | "cloud"
  | "site"
  | "term"
  | "campaign"
  | "landing"
  | "page"
  | "device"
  | "os"
  | "browser"
  | "inapp"
  | "width"
  | "country"
  | "region"
  | "lang";

export interface TrafficReport {
  from: string;
  to: string;
  days: { date: string; hits: number; entries: number; uniques: number; members: number }[];
  /** uniques 는 날짜별 순방문자의 합 */
  total: { hits: number; entries: number; uniques: number; members: number; returning: number; bounces: number };
  /** 항목별 [값, 수] 많은 순 (page 는 페이지 본 수, 나머지는 유입 수) */
  dims: Record<TrafficDim, [string, number][]>;
  /** 요일(0=일) × 시(0~23) 유입 수, 한국 시간 */
  heat: number[][];
  /** 클라우드(AWS·GCP 등) IP 유입 수 · 대역 목록 상태 */
  cloud: { entries: number; loaded: boolean; updatedAt: number | null; counts: Record<string, number>; errors: string[] };
  recent: {
    at: number;
    source: TrafficSource;
    site: string;
    term: string;
    campaign: string;
    ref: string;
    path: string;
    pages: number;
    device: string;
    os: string;
    browser: string;
    inapp: string;
    screen: string;
    country: string;
    region: string;
    city: string;
    /** 원본 IP (30일 지나면 빈 값) */
    ip: string;
    member: boolean;
    /** 회원 별명 (지금 이름, 지워진 회원은 "") */
    nick: string;
    returning: boolean;
    /** 클라우드 업체 ("" = 아님) */
    cloud: string;
  }[];
}

/** human: 클라우드(AWS·GCP 등) IP 유입 빼기 */
export const getTraffic = (from: string, to: string, human = false) =>
  api<TrafficReport>(`/api/admin/traffic?from=${from}&to=${to}${human ? "&human=1" : ""}`, { auth: true });

export type MemberSort = "new" | "visit" | "points" | "visits" | "banned";
export const listUsers = (q = "", sort: MemberSort = "new", skip = 0) =>
  api<{ total: number; items: AdminUser[] }>(
    `/api/admin/users?limit=100&skip=${skip}&sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    { auth: true }
  );

/* ── 회원 더 보기 (server/src/http/adminMembers.ts) ── */
export interface MemberBan {
  until: number | null;
  reason: string;
  at: number;
}
export interface MemberDetail {
  items: string[];
  shop: { id: string; game: string; name: string; price: number }[];
  achs: number;
  fight: { r: number; n: number; w: number; l: number; peak: number } | null;
  defense: { wave: number; win: boolean; glitch: number; ver: string } | null;
  ban: MemberBan | null;
}
export const getMemberDetail = (uid: string) =>
  api<MemberDetail>(`/api/admin/members/${encodeURIComponent(uid)}`, { auth: true });
export const setMemberItem = (uid: string, item: string, give: boolean) =>
  api<{ items: string[] }>(`/api/admin/members/${encodeURIComponent(uid)}/items`, {
    method: "POST",
    auth: true,
    body: { item, give },
  });
/** days: null = 기한 없음, 0 = 풀기 */
export const setMemberBan = (uid: string, days: number | null, reason: string) =>
  api<{ ban: MemberBan | null }>(`/api/admin/members/${encodeURIComponent(uid)}/ban`, {
    method: "PUT",
    auth: true,
    body: { days, reason },
  });

/* ── GP 경제 (server/src/http/adminEconomy.ts) ── */
export interface Economy {
  total: number;
  members: number;
  withPoints: number;
  top: { uid: string; nick: string; points: number }[];
  days: number;
  reasons: { reason: string; in: number; out: number; n: number }[];
  daily: { date: string; in: number; out: number }[];
  truncated: boolean;
}
export interface EconomyRow {
  uid: string;
  nick: string;
  at: number;
  delta: number;
  reason: string;
  ref?: string;
  bal?: number;
}
export const getEconomy = (days: number) => api<Economy>(`/api/admin/economy?days=${days}`, { auth: true });
export const getEconomyLog = (o: { reason?: string; q?: string; skip?: number }) =>
  api<{ rows: EconomyRow[]; more: boolean }>(
    `/api/admin/economy/log?skip=${o.skip ?? 0}${o.reason ? `&reason=${encodeURIComponent(o.reason)}` : ""}${o.q ? `&q=${encodeURIComponent(o.q)}` : ""}`,
    { auth: true }
  );

/* ── 사이트 공지 (server/src/http/notice.ts) ── */
export interface SiteNotice {
  id: string;
  text: string;
  link?: string;
  tone: "info" | "event" | "warn";
  until: number | null;
  at: number;
}
export const getAdminNotice = () => api<{ notice: SiteNotice | null }>("/api/admin/notice", { auth: true });
export const putNotice = (n: { text: string; link?: string; tone: SiteNotice["tone"]; until: number | null }) =>
  api<{ notice: SiteNotice }>("/api/admin/notice", { method: "PUT", auth: true, body: n });
export const removeNotice = () => api("/api/admin/notice", { method: "DELETE", auth: true });

export const updateUser = (uid: string, patch: { nick?: string; badge?: string | null; money?: number; points?: number }) =>
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

/** 포커 설정: 봇 늘리기 (테이블마다 봇 셋 이상 · 2분 넘게 치면 빈자리까지 · 로비 봇 방 6개) */
export const getPokerSettings = () =>
  api<{ botBoost: boolean }>("/api/admin/poker/settings", { auth: true });
export const setPokerSettings = (botBoost: boolean) =>
  api<{ botBoost: boolean }>("/api/admin/poker/settings", {
    method: "PUT",
    body: { botBoost },
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
  // 부동소수 끝자리(121.69999999999999)는 잘라서 보여 줌 — 편집 창에는 원래 값 그대로
  if (typeof v === "number" && !Number.isInteger(v)) return String(Number(v.toFixed(4)));
  // 시각(ms)처럼 보이는 큰 정수는 날짜로
  if (typeof v === "number" && v > 1e12 && v < 1e13) return formatCell(Timestamp.fromMillis(v));
  return String(v);
}

/** 정렬용 값 */
export function sortValue(v: unknown): number | string {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v === undefined || v === null ? "" : String(v);
}

/** 회원의 포인트 최근 내역 (관리자) */
export const getUserPointLog = (uid: string) =>
  api<{ log: import("@/lib/points").PointLogRow[] }>(`/api/admin/users/${encodeURIComponent(uid)}/points`, { auth: true }).then((r) => r.log);

/** 디펜스 데이터 (프로필 · 랭킹 · 판 기록) 개수 / 모두 지우기 — GP 는 그대로 */
export const getDefenseStats = () =>
  api<{ profiles: number; ranks: number; runs: number }>("/api/admin/defense/stats", { auth: true });
export const resetDefense = () =>
  api<Record<string, number>>("/api/admin/defense/reset", {
    method: "POST",
    body: { confirm: "디펜스 초기화" },
    auth: true,
  });

export const getMarbleStats = () => api<{ profiles: number; players: number }>("/api/admin/marble/stats", { auth: true });
export const resetMarble = () =>
  api<Record<string, number>>("/api/admin/marble/reset", {
    method: "POST",
    body: { confirm: "마블 초기화" },
    auth: true,
  });
