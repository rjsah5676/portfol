/**
 * 야구 클라우드 세이브 — 로그인 계정마다 서버에 저장 하나 (/api/baseball/save).
 * 게임은 지금처럼 localStorage 에 쓰고, 여기서 SYNC_KEYS 를 통째로 묶어 서버와 맞춤:
 *   - 시작할 때 서버 것을 받아서: 같으면 그대로 · 이 기기가 비었으면 서버 것 · 이 기기가 마지막 동기화 뒤 안 바뀌었으면 서버 것
 *     · 서버가 마지막 동기화 뒤 안 바뀌었으면 이 기기 것을 올림 · 둘 다 바뀌었으면(또는 처음 만난 계정) 사람이 고름
 *   - 그 뒤엔 몇 초마다 바뀐 게 있으면 올림 (rev 로 다른 기기와 겹치는지 확인 — 겹치면 위 판단을 다시)
 * 게스트(로그인 안 함 · 익명)는 아무것도 안 함 — 이 브라우저에만.
 */
import { api } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";
import { ovrOf, type Career } from "@/lib/baseball/career";

/** 서버로 올리는 저장 (배속 · 진행 방식 같은 기기 설정은 뺌) */
export const SYNC_KEYS = ["pxb:v1", "pxb:career:v3", "pxb:hof:v1", "pxb:bondxp:v1", "pxb:club:v1", "pxb:seen:v1"] as const;
type Snap = Record<string, string>;
export interface Remote {
  rev: number;
  at: number;
  data: Snap;
}
/** 계정마다 마지막으로 맞춘 서버 rev · 그때 내용 지문 */
interface Meta {
  rev: number;
  fp: string;
}
const metaKey = (uid: string) => `pxb-cloud:${uid}`;

function snapshot(): Snap {
  const s: Snap = {};
  for (const k of SYNC_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) s[k] = v;
  }
  return s;
}
/** 내용 지문 (cyrb53) — 키 순서와 상관없이 */
function fp(s: Snap): string {
  const str = JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]));
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** 이 기기 저장이 어느 계정 것인지 (로그인해서 한 번이라도 맞춘 계정) */
const OWNER = "pxb-cloud:owner";
function getOwner() {
  try {
    return localStorage.getItem(OWNER);
  } catch {
    return null;
  }
}
function setOwner(uid: string) {
  try {
    localStorage.setItem(OWNER, uid);
  } catch {}
}
const isEmpty = (s: Snap) => !s["pxb:career:v3"] && !s["pxb:club:v1"] && !s["pxb:hof:v1"];

/** 고르기 화면에 띄울 요약 한 줄씩 */
export function summarize(s: Snap): string[] {
  const out: string[] = [];
  try {
    const c = s["pxb:career:v3"] ? (JSON.parse(s["pxb:career:v3"]) as Career) : null;
    if (c) out.push(`육성: ${c.name} ${c.season}년차 · 종합 ${ovrOf(c)}`);
  } catch {}
  try {
    const h = s["pxb:hof:v1"] ? (JSON.parse(s["pxb:hof:v1"]) as unknown[]) : [];
    if (h.length) out.push(`명예의 전당 ${h.length}명`);
  } catch {}
  try {
    const cl = s["pxb:club:v1"] ? (JSON.parse(s["pxb:club:v1"]) as { cards?: unknown[]; record?: { w: number; l: number } }) : null;
    if (cl) out.push(`구단: 카드 ${cl.cards?.length ?? 0}장 · ${cl.record?.w ?? 0}승 ${cl.record?.l ?? 0}패`);
  } catch {}
  try {
    const sv = s["pxb:v1"] ? (JSON.parse(s["pxb:v1"]) as { pt?: number }) : null;
    if (sv?.pt) out.push(`코인 ${sv.pt.toLocaleString()}`);
  } catch {}
  return out.length ? out : ["저장된 진행 없음"];
}

export interface Conflict {
  local: string[];
  remote: string[];
  remoteAt: number;
}

export class CloudSync {
  private meta: Meta | null;
  private ready = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastPut = 0;
  private stopped = false;
  private hiding = false;
  private onHide = () => {
    if (document.visibilityState !== "hidden") return;
    // 폰에서 탭을 넘기거나 닫을 때 마지막 진행이 잘리지 않게 keepalive 로
    this.hiding = true;
    void this.guard(() => this.push()).finally(() => (this.hiding = false));
  };

  constructor(
    private uid: string,
    private on: {
      /** 서버 것을 이 기기에 덮어씀 → 화면을 새로 읽어야 함 */
      applied(): void;
      /** 둘 다 바뀜 → 사람이 고름 */
      conflict(c: Conflict): Promise<"local" | "remote">;
    }
  ) {
    let m: Meta | null = null;
    try {
      m = JSON.parse(localStorage.getItem(metaKey(uid)) ?? "null");
    } catch {}
    this.meta = m && typeof m.rev === "number" && typeof m.fp === "string" ? m : null;
  }

  /** 처음 맞추기 (서버에 못 닿으면 나중에 다시) — 끝나야 화면을 띄움 */
  async start() {
    try {
      await this.resolve();
    } catch {
      // 서버에 못 닿음: 올리지 않고 (덮어쓰기 위험) 잠시 뒤 다시 맞춰 봄
    }
    if (this.stopped) return;
    this.timer = setInterval(() => void this.tick(), 4000);
    document.addEventListener("visibilitychange", this.onHide);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onHide);
  }

  private setMeta(rev: number, f: string) {
    this.meta = { rev, fp: f };
    try {
      localStorage.setItem(metaKey(this.uid), JSON.stringify(this.meta));
    } catch {}
  }

  private async resolve() {
    const { save } = await api<{ save: Remote | null }>("/api/baseball/save", { auth: true, timeoutMs: 8000 });
    if (this.stopped) return;
    let local = snapshot();
    // 같은 브라우저에서 다른 계정으로 로그인: 이 기기 저장은 앞 계정 것 → 새 계정에 올리거나 「이 기기」로 고르게 하지 않음
    const owner = getOwner();
    if (owner && owner !== this.uid && !isEmpty(local)) {
      for (const k of SYNC_KEYS) localStorage.removeItem(k);
      local = snapshot();
      this.on.applied();
    }
    const lf = fp(local);
    setOwner(this.uid);
    if (!save) {
      this.ready = true;
      if (isEmpty(local)) this.setMeta(0, lf);
      else await this.put(local, 0);
      return;
    }
    const rf = fp(save.data);
    const m = this.meta;
    let pick: "local" | "remote" | "same";
    if (rf === lf) pick = "same";
    else if (isEmpty(local)) pick = "remote";
    else if (m && m.fp === lf) pick = "remote"; // 이 기기는 마지막 동기화 뒤 그대로 → 다른 기기에서 한 게 최신
    else if (m && m.rev === save.rev) pick = "local"; // 서버는 그대로 → 이 기기에서 한 걸 올림
    else pick = await this.on.conflict({ local: summarize(local), remote: summarize(save.data), remoteAt: save.at });
    if (this.stopped) return;
    this.ready = true;
    if (pick === "same") this.setMeta(save.rev, lf);
    else if (pick === "remote") this.apply(save);
    else await this.put(snapshot(), save.rev);
  }

  private apply(r: Remote) {
    for (const k of SYNC_KEYS) {
      if (k in r.data) localStorage.setItem(k, r.data[k]);
      else localStorage.removeItem(k);
    }
    this.setMeta(r.rev, fp(r.data));
    this.on.applied();
  }

  private async put(s: Snap, prev: number) {
    const f = fp(s);
    this.lastPut = Date.now();
    try {
      const r = await api<{ rev: number }>("/api/baseball/save", { method: "PUT", auth: true, body: { data: s, prev }, timeoutMs: 15000, keepalive: this.hiding });
      this.setMeta(r.rev, f);
    } catch (e) {
      // 다른 기기가 먼저 올림 → 다시 판단 (둘 다 바뀌었으면 고르기)
      if (e instanceof ApiError && e.code === "SAVE_CONFLICT") await this.resolve();
      else throw e;
    }
  }

  /** 한 번에 하나씩 (주기 · 탭 숨김이 겹치지 않게) */
  private async guard(fn: () => Promise<void>) {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      await fn();
    } catch {
    } finally {
      this.busy = false;
    }
  }

  /** 바뀐 게 있으면 올림 (너무 자주는 말고) */
  private tick() {
    return this.guard(async () => {
      if (!this.ready) await this.resolve();
      else if (Date.now() - this.lastPut > 8000) await this.push();
    });
  }

  private async push() {
    if (!this.ready) return;
    const s = snapshot();
    if (this.meta && fp(s) === this.meta.fp) return;
    await this.put(s, this.meta?.rev ?? 0);
  }
}
