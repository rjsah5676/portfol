import { api } from "@/lib/api/http";
import { subscribe } from "@/lib/api/socket";

export const NOTE_COLORS = ["lavender", "yellow", "mint", "pink", "sky"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface GuestEntry {
  docId: string;
  id: number;
  name: string;
  contents: string;
  date: string;
  /** 예전 글에는 없음 → id 기준으로 색 배정 */
  color?: NoteColor;
}

/** 서버가 보내는 목록 (s = 조회 순번, 클수록 최신) */
interface Snapshot {
  s: number;
  list: GuestEntry[];
}

/** 실시간 구독 (다른 사람이 남긴 메모도 바로 붙음) — 최신 300개 */
export function subscribeGuestEntries(
  cb: (entries: GuestEntry[]) => void,
  onError?: (e: Error) => void
) {
  let last = 0;
  const apply = (snap: Snapshot) => {
    // 늦게 도착한 옛 목록은 버림
    if (snap.s < last) return;
    last = snap.s;
    cb(snap.list);
  };
  return subscribe<Snapshot>("guest", null, {
    onSnapshot: apply,
    onEvent: (type, data) => {
      if (type === "list") apply(data as Snapshot);
    },
    onError,
  });
}

export async function addGuestEntry({
  name,
  contents,
  color,
}: Pick<GuestEntry, "name" | "contents" | "color">): Promise<number> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = now.getTime();
  const date = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일  ${now.getHours()}:${pad(now.getMinutes())}`;
  await api("/api/guest", {
    method: "POST",
    body: { name, contents, id, date, color: color ?? "lavender" },
  });
  return id;
}

/** 관리자 전용 (서버에서 관리자 토큰 검사) */
export async function deleteGuestEntry(docId: string): Promise<void> {
  await api(`/api/guest/${encodeURIComponent(docId)}`, { method: "DELETE", auth: true });
}
