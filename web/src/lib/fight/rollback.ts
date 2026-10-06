/**
 * 롤백 넷코드 세션 (온라인 대전 3단계용 — 통신 방식과 무관한 핵심 로직만)
 *
 * - 내 입력은 inputDelay 프레임 뒤에 적용되게 예약하고, 그 (프레임, 입력)을 상대에게 보냄
 * - 상대 입력이 아직 안 온 프레임은 "마지막으로 받은 입력이 이어진다"고 예측해서 일단 진행
 * - 나중에 진짜 입력이 왔는데 예측과 다르면, 그 프레임의 저장 상태로 되감아서 지금까지 다시 계산
 * 시뮬레이션이 결정론적(sim.ts)이라 양쪽이 같은 입력을 받으면 결국 같은 상태가 됨 (hash로 확인).
 */
import { clone, hash, step, type Ev, type State } from "./sim";

/** 이 프레임마다 확정된 상태의 해시를 남겨 상대 것과 비교 (어긋남 감지) */
const HASH_EVERY = 60;

export interface RollbackOptions {
  /** 내 입력을 몇 프레임 늦게 적용할지 (지연을 조금 주면 되감기가 줄어듦) */
  inputDelay?: number;
  /** 이보다 오래된 프레임으로는 못 되감음 → 상대가 너무 늦으면 기다려야 함 */
  maxRollback?: number;
}

export class RollbackSession {
  /** 지금까지 진행한 프레임 수 (다음에 계산할 프레임 번호) */
  frame = 0;
  readonly local: 0 | 1;
  readonly delay: number;
  readonly maxRollback: number;
  /** 지금 화면에 보이는 상태 */
  state: State;
  /** 프레임 시작 시점 상태 (되감기용) */
  private saved = new Map<number, State>();
  /** 확정 입력 [플레이어][프레임] */
  private confirmed: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  /** 그 프레임을 계산할 때 실제로 쓴 상대 입력 (예측값일 수 있음) */
  private used = new Map<number, number>();
  /** 상대 입력을 처음부터 끊김 없이 받은 마지막 프레임 */
  private remoteSeq = -1;
  /** 되감기 횟수 (통계) */
  rollbacks = 0;
  /**
   * 이번 advance()에서 화면·소리로 내보낼 이벤트: 새로 계산한 프레임 것 + 되감아 다시 계산하면서 새로 생긴 것.
   * (state.ev는 마지막 프레임 것뿐이라, 되감기로 바뀐 프레임의 타격음·이펙트가 빠졌음)
   */
  events: Ev[] = [];
  /** 프레임별로 이미 내보낸 이벤트 (다시 계산해도 같은 건 두 번 안 냄) */
  private shown = new Map<number, Set<string>>();
  /** 멈춰서(stalled) 못 내보낸 이벤트를 다음 advance까지 들고 감 */
  private carry = false;
  /** 양쪽 입력이 모두 확정된 프레임의 상태 해시 [프레임 → 해시] */
  private hashes = new Map<number, number>();
  private peerHashes = new Map<number, number>();
  private nextHashF = HASH_EVERY;
  /** 내가 남긴 가장 최근 해시 (상대에게 보낼 것) */
  lastHash: { f: number; h: number } | null = null;
  /** 같은 프레임인데 상대와 상태가 다름 (빌드가 다르거나 버그) */
  desync = false;

  constructor(init: State, local: 0 | 1, opt: RollbackOptions = {}) {
    this.state = clone(init);
    this.local = local;
    this.delay = opt.inputDelay ?? 2;
    this.maxRollback = opt.maxRollback ?? 8;
    // 지연 구간의 앞 프레임들은 빈 입력으로 확정
    for (let f = 0; f < this.delay; f++) {
      this.confirmed[0].set(f, 0);
      this.confirmed[1].set(f, 0);
    }
    this.remoteSeq = this.delay - 1;
  }

  private get remote() {
    return (1 - this.local) as 0 | 1;
  }

  /** 이번 프레임의 내 입력 → 상대에게 보낼 {frame, input} */
  addLocalInput(input: number): { frame: number; input: number } {
    const f = this.frame + this.delay;
    this.confirmed[this.local].set(f, input);
    return { frame: f, input };
  }

  /** 상대 입력 도착 */
  addRemoteInput(frame: number, input: number) {
    const m = this.confirmed[this.remote];
    if (m.has(frame)) return;
    m.set(frame, input);
    while (m.has(this.remoteSeq + 1)) this.remoteSeq++;
    // 이미 계산한 프레임인데 예측이 틀렸으면 되감기 표시
    if (frame < this.frame && this.used.get(frame) !== input) {
      this.pendingRollback = Math.min(this.pendingRollback, frame);
    }
  }
  private pendingRollback = Infinity;

  /** 상대가 너무 늦어서 더 진행하면 안 되는가 */
  get stalled() {
    return this.frame - this.remoteSeq > this.maxRollback;
  }

  private predict(f: number): number {
    const m = this.confirmed[this.remote];
    const v = m.get(f);
    if (v !== undefined) return v;
    // 마지막으로 받은 입력이 이어진다고 예측
    for (let k = Math.min(f, this.remoteSeq); k >= 0; k--) {
      const p = m.get(k);
      if (p !== undefined) return p;
    }
    return 0;
  }

  private simulate(f: number) {
    this.saved.set(f, clone(this.state));
    const mine = this.confirmed[this.local].get(f) ?? 0;
    const theirs = this.predict(f);
    this.used.set(f, theirs);
    const inp: [number, number] = this.local === 0 ? [mine, theirs] : [theirs, mine];
    step(this.state, inp);
    let seen = this.shown.get(f);
    if (!seen) this.shown.set(f, (seen = new Set()));
    for (const e of this.state.ev) {
      const key = `${e.k}:${e.p}:${e.m ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.events.push(e);
    }
  }

  /** 상대가 보내 온 해시 */
  addRemoteHash(f: number, h: number) {
    const mine = this.hashes.get(f);
    if (mine !== undefined) {
      if (mine !== h) this.desync = true;
    } else if (f >= this.nextHashF) this.peerHashes.set(f, h);
  }

  /** 프레임 F 시작 상태는 그 앞의 양쪽 입력이 모두 확정이면 더는 안 바뀜 → 해시를 남김 */
  private noteHashes() {
    while (this.nextHashF <= this.frame && this.nextHashF <= this.remoteSeq + 1) {
      const F = this.nextHashF;
      const st = F === this.frame ? this.state : this.saved.get(F);
      this.nextHashF += HASH_EVERY;
      if (!st) continue;
      const h = hash(st);
      this.hashes.set(F, h);
      this.lastHash = { f: F, h };
      const theirs = this.peerHashes.get(F);
      if (theirs !== undefined && theirs !== h) this.desync = true;
      this.peerHashes.delete(F);
      for (const k of this.hashes.keys()) if (k < F - HASH_EVERY * 4) this.hashes.delete(k);
    }
  }

  /** 한 프레임 진행 (필요하면 먼저 되감아서 다시 계산). stalled면 false */
  advance(): boolean {
    if (!this.carry) this.events = [];
    this.carry = false;
    if (this.pendingRollback < this.frame) {
      const from = this.pendingRollback;
      this.pendingRollback = Infinity;
      const snap = this.saved.get(from);
      if (snap) {
        this.rollbacks++;
        this.state = clone(snap);
        for (let f = from; f < this.frame; f++) this.simulate(f);
      }
    }
    if (this.stalled) {
      this.noteHashes();
      this.carry = true;
      return false;
    }
    this.simulate(this.frame);
    this.frame++;
    this.noteHashes();
    // 오래된 저장본 정리 (확정된 구간)
    const keepFrom = Math.min(this.remoteSeq, this.frame - this.maxRollback - 2);
    for (const k of this.saved.keys()) if (k < keepFrom) this.saved.delete(k);
    for (const k of this.used.keys()) if (k < keepFrom) this.used.delete(k);
    for (const k of this.shown.keys()) if (k < keepFrom) this.shown.delete(k);
    return true;
  }
}
