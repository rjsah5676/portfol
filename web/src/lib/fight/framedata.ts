/**
 * 연습 모드 프레임 데이터 (철권 연습 모드처럼) — 내가 낸 기술의 발생 · 지속 · 회복, 맞힘/막힘/헛침, 프레임 이득,
 * 피해 · 콤보를 매 프레임 판 상태와 이벤트로 잼. 화면은 components/Fight/FrameData.tsx.
 *
 * 프레임 이득 = (상대가 다시 움직일 수 있게 된 프레임) − (내가 다시 움직일 수 있게 된 프레임). +면 내가 먼저 움직임.
 * 히트스톱 · 슈퍼 멈춤은 둘 다 똑같이 멈추니까 그대로 셈.
 */
import { CHARS } from "./chars";
import { hitRect, moveData, type Fighter, type State } from "./sim";

export type Outcome = "hit" | "counter" | "block" | "just" | "whiff" | "throw";

export interface MoveRec {
  /** 기술 이름 */
  name: string;
  startup: number;
  active: number;
  /** 회복 (헛쳤을 때 판정이 끝난 뒤 다시 움직이기까지, 캔슬하면 정의값) */
  recovery: number;
  /** 전체 (헛쳤을 때) */
  total: number;
  outcome: Outcome | null;
  /** 프레임 이득 (null = 아직 재는 중 / 콤보로 이어짐 · 다운이면 따로) */
  adv: number | null;
  /** 이어짐: 상대가 풀리기 전에 다음 기술이 나감 / 다운 */
  note: "" | "combo" | "chain" | "down" | "launch";
  dmg: number;
}

export interface FrameView {
  last: MoveRec | null;
  history: MoveRec[];
  combo: { hits: number; dmg: number };
  lastCombo: { hits: number; dmg: number };
  best: number;
}

const FREE_A = new Set(["idle", "walk", "jump", "dash", "block"]);
const FREE_D = new Set(["idle", "walk", "jump", "dash", "atk", "block"]);

export function moveName(f: Fighter): string {
  const c = CHARS[f.ch];
  switch (f.mv) {
    case "L":
      return `약 ${f.chain || 1}`;
    case "H":
      return `발차기 ${f.chain || 1}`;
    case "J":
      return "공중 약";
    case "K":
      return f.dk ? "내려찍기" : "공중 발차기";
    case "S":
      return f.aerial ? `${c.airLabel ? c.airLabel.replace(/^점프 중 /, "") : "공중 L"}` : c.idName;
    case "X":
      return c.ultName;
    case "T":
      return f.lg ? "돌진 잡기" : "잡기";
    case "G":
      return "가드 반격";
    default:
      return f.mv;
  }
}

export class FrameMeter {
  history: MoveRec[] = [];
  private cur: MoveRec | null = null;
  /** 지금 재는 기술이 시작한 프레임 · 이 기술의 판정 시작 */
  private startF = 0;
  private gotStart = false;
  private prevMv = "";
  private prevT = 0;
  private prevSt = "";
  /** 이득 재기: 결과가 난 프레임부터 */
  private measuring = false;
  private tA = -1;
  private tD = -1;
  private since = 0;
  private dirty = true;
  combo = { hits: 0, dmg: 0 };
  lastCombo = { hits: 0, dmg: 0 };
  best = 0;
  private prevHp = 0;

  /** step() 다음에 부름. 화면 다시 그릴 일이 생기면 true */
  update(s: State): boolean {
    const a = s.p[0],
      d = s.p[1];
    // ── 새 기술 시작 ──
    const started = a.st === "atk" && (this.prevSt !== "atk" || a.mv !== this.prevMv || a.t < this.prevT);
    if (started) {
      // 앞 기술이 결과를 기다리는 중에 다음 기술이 나감 = 캔슬 · 연결
      if (this.cur && this.measuring) {
        if (d.st === "hit") this.cur.note = this.cur.note === "launch" ? "launch" : "combo";
        else if (d.st === "block") this.cur.note = "chain";
        this.measuring = false;
      }
      const m = moveData(a);
      const rec: MoveRec = {
        name: moveName(a),
        startup: m ? m.startup : 0,
        active: m ? m.active : 0,
        recovery: m ? m.recovery : 0,
        total: m ? m.startup + m.active + m.recovery : 0,
        outcome: null,
        adv: null,
        note: "",
        dmg: 0,
      };
      if (this.cur && !this.cur.outcome && !this.measuring) this.cur.outcome = "whiff";
      this.cur = rec;
      this.history.unshift(rec);
      if (this.history.length > 6) this.history.pop();
      this.startF = s.f;
      this.gotStart = false;
      this.measuring = false;
      this.dirty = true;
    }
    // 실제 발생: 판정이 처음 나온 프레임 (모으기 기술은 모은 만큼 늦게) · 탄은 쏜 프레임
    if (this.cur && a.st === "atk" && !this.gotStart && (hitRect(a) || s.ev.some((e) => e.k === "proj" && e.p === 0))) {
      this.gotStart = true;
      if (a.t !== this.cur.startup) ((this.cur.total += a.t - this.cur.startup), (this.cur.startup = a.t), (this.dirty = true));
    }
    // 헛친 기술의 실제 전체 프레임 (캔슬 없이 끝까지)
    if (this.cur && !this.cur.outcome && this.prevSt === "atk" && a.st !== "atk") {
      this.cur.outcome = "whiff";
      this.cur.total = s.f - this.startF;
      this.cur.recovery = Math.max(0, this.cur.total - this.cur.startup - this.cur.active);
      this.dirty = true;
    }
    // ── 결과 ──
    if (this.cur) {
      for (const e of s.ev) {
        if (e.p !== 0) continue;
        let o: Outcome | null = null;
        if (e.k === "hit") o = s.ev.some((x) => x.k === "counter" && x.p === 0) ? "counter" : "hit";
        else if (e.k === "block") o = "block";
        else if (e.k === "just") o = "just";
        else if (e.k === "throw") o = "throw";
        if (!o) continue;
        if (e.k === "hit") this.cur.dmg += e.v;
        // 여러 번 맞는 기술은 마지막 타부터 다시 잼 (철권처럼) — 결과는 히트가 가드보다 우선
        if (!this.cur.outcome || this.cur.outcome === "whiff" || o === "hit" || o === "counter" || o === "throw" || this.cur.outcome === "block" || this.cur.outcome === "just") this.cur.outcome = o;
        this.measuring = true;
        this.cur.adv = null;
        this.tA = this.tD = -1;
        this.since = 0;
        this.dirty = true;
      }
    }
    // ── 이득 재기 ──
    if (this.measuring && this.cur) {
      this.since++;
      if (d.st === "down" || d.st === "rise") ((this.cur.note = "down"), (this.measuring = false), (this.dirty = true));
      else {
        if (d.float && this.cur.note !== "launch") ((this.cur.note = "launch"), (this.dirty = true));
        if (this.tA < 0 && FREE_A.has(a.st)) this.tA = this.since;
        if (this.tD < 0 && FREE_D.has(d.st) && d.grabbed === 0) this.tD = this.since;
        if (this.tA >= 0 && this.tD >= 0) {
          this.cur.adv = this.tD - this.tA;
          this.measuring = false;
          this.dirty = true;
        } else if (this.since > 240) ((this.measuring = false), (this.cur.note = d.float ? "launch" : this.cur.note));
      }
    }
    // ── 콤보 ──
    const hpLoss = this.prevHp > d.hp ? this.prevHp - d.hp : 0;
    if (d.combo > 0) {
      this.combo.hits = Math.max(this.combo.hits, d.combo);
      this.combo.dmg += hpLoss;
      if (hpLoss) this.dirty = true;
    } else if (this.combo.hits > 0) {
      this.lastCombo = { ...this.combo };
      this.best = Math.max(this.best, this.combo.dmg);
      this.combo = { hits: 0, dmg: 0 };
      this.dirty = true;
    }
    this.prevHp = d.hp;
    this.prevMv = a.mv;
    this.prevT = a.t;
    this.prevSt = a.st;
    const ch = this.dirty;
    this.dirty = false;
    return ch;
  }

  /** 체력을 채운 뒤 (연습 모드는 매 프레임 채움) 기준 체력 다시 */
  syncHp(s: State) {
    this.prevHp = s.p[1].hp;
  }

  view(): FrameView {
    return {
      last: this.history[0] ? { ...this.history[0] } : null,
      history: this.history.map((h) => ({ ...h })),
      combo: { ...this.combo },
      lastCombo: { ...this.lastCombo },
      best: this.best,
    };
  }
}
