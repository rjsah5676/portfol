/**
 * 온라인 한 판: 롤백 세션(lib/fight/rollback.ts) + 통신(realtime/fight.ts FightNet) 연결.
 *
 * - 매 프레임 내 입력을 (지금 + 입력 지연) 프레임 몫으로 예약하고, 상대가 아직 확인 안 한 입력을 전부 묶어 보냄
 *   (데이터 채널은 순서·재전송이 없어서, 하나 빠져도 다음 꾸러미에 또 들어 있음)
 * - 상대 입력은 받는 대로 넣고, 예측이 틀렸으면 세션이 되감아서 다시 계산
 * - 한쪽이 계속 앞서 가면 앞선 쪽이 가끔 한 프레임 쉬어서 속도를 맞춤 (안 그러면 앞선 쪽만 계속 멈칫거림)
 */
import { RollbackSession } from "@/lib/fight/rollback";
import { BUILD_ID, type State } from "@/lib/fight/sim";
import type { FightNet, InputLog, Packet } from "@/realtime/fight";

/** 한 꾸러미에 담는 최대 입력 수 */
const MAX_BATCH = 48;

export class OnlineMatch {
  readonly session: RollbackSession;
  private readonly net: FightNet;
  private readonly match: string;
  /** 내 입력 [프레임] (상대가 받았다고 할 때까지 보관) */
  private mine = new Map<number, number>();
  /** 마지막으로 예약한 내 입력 프레임 (멈춰 있는 동안 같은 프레임을 두 번 예약하지 않게) */
  private lastQueued = -1;
  /** 상대가 받았다고 알려 온 내 입력의 마지막 프레임 */
  private peerAck: number;
  /** 상대 입력을 끊김 없이 받은 마지막 프레임 */
  private remoteAck: number;
  private remoteGot = new Set<number>();
  /** 상대가 알려 온 진행 프레임 */
  private remoteFr = 0;
  private waitCount = 0;
  started = performance.now();

  /** 관전용 입력 기록 (내 확정 입력을 올림) */
  private readonly log: InputLog | null;

  constructor(init: State, seat: 0 | 1, net: FightNet, match: string, delay: number, maxRb: number, log: InputLog | null = null) {
    this.log = log;
    this.session = new RollbackSession(init, seat, { inputDelay: delay, maxRollback: maxRb });
    this.net = net;
    this.match = match;
    this.peerAck = delay - 1;
    this.remoteAck = delay - 1;
    net.onPacket = (p) => this.onPacket(p);
  }

  get state() {
    return this.session.state;
  }

  /** 상대가 경기에서 나감 (기권) */
  peerLeft = false;
  /** 상대와 빌드가 다름 (한쪽이 새로고침을 안 해 예전 버전) */
  versionMismatch = false;

  /** 같은 프레임의 상태가 상대와 다름 → 더 진행해도 서로 다른 경기를 보게 됨 */
  get desync() {
    return this.session.desync;
  }
  /** 이번 프레임에 화면·소리로 내보낼 이벤트 (되감기로 새로 생긴 것 포함) */
  get events() {
    return this.session.events;
  }
  private lastIn = 0;

  private onPacket(p: Packet) {
    if (p.k === "bye" && p.m === this.match) {
      this.peerLeft = true;
      return;
    }
    if (p.k !== "in" || p.m !== this.match || p.f === undefined || !p.i) return;
    this.lastIn = performance.now();
    // (v가 없으면 지문을 안 보내는 예전 빌드)
    if (p.v !== BUILD_ID) this.versionMismatch = true;
    if (p.hf !== undefined && p.hh !== undefined) this.session.addRemoteHash(p.hf, p.hh);
    for (let k = 0; k < p.i.length; k++) {
      const f = p.f + k;
      if (f <= this.remoteAck || this.remoteGot.has(f)) continue;
      this.session.addRemoteInput(f, p.i[k]);
      this.remoteGot.add(f);
    }
    while (this.remoteGot.has(this.remoteAck + 1)) {
      this.remoteAck++;
      this.remoteGot.delete(this.remoteAck);
    }
    if (p.a !== undefined && p.a > this.peerAck) {
      this.peerAck = p.a;
      for (const f of this.mine.keys()) if (f <= this.peerAck) this.mine.delete(f);
    }
    if (p.fr !== undefined) this.remoteFr = Math.max(this.remoteFr, p.fr);
  }

  /** 앞서 있으면 가끔 한 프레임 쉼 (상대 진행 + 편도 지연 기준) */
  shouldWait(): boolean {
    const oneWay = this.net.rtt / 2 / (1000 / 60);
    const adv = this.session.frame - (this.remoteFr + oneWay);
    if (adv < 2) {
      this.waitCount = 0;
      return false;
    }
    // 많이 앞서면 더 자주 쉼
    this.waitCount++;
    return this.waitCount % (adv > 5 ? 2 : 5) === 0;
  }

  /** 한 프레임: 내 입력 예약 → 진행 → 보내기. 상대가 너무 늦어 멈췄으면 false */
  tick(input: number): boolean {
    const f = this.session.frame + this.session.delay;
    if (f > this.lastQueued) {
      const q = this.session.addLocalInput(input);
      this.mine.set(q.frame, q.input);
      this.lastQueued = q.frame;
      this.log?.add(q.frame, q.input);
    }
    const ok = this.session.advance();
    this.flush();
    return ok;
  }

  /** 관전 기록 남은 것 올리기 (경기 끝) */
  flushLog() {
    this.log?.flush();
  }

  /** 상대가 아직 못 받은 내 입력을 한 꾸러미로 */
  flush() {
    const from = this.peerAck + 1;
    const to = Math.min(this.lastQueued, from + MAX_BATCH - 1);
    const i: number[] = [];
    for (let f = from; f <= to; f++) i.push(this.mine.get(f) ?? 0);
    const lh = this.session.lastHash;
    this.net.send({ k: "in", m: this.match, f: from, i, a: this.remoteAck, fr: this.session.frame, v: BUILD_ID, hf: lh?.f, hh: lh?.h });
  }

  /** 상대 경기 입력이 끊긴 지 오래됨 (탭을 닫았거나 연결이 끊김) */
  get lostPeer() {
    const since = this.lastIn || this.started;
    return performance.now() - since > (this.lastIn ? 6000 : 15000);
  }

  /** 경기 화면을 떠남 → 상대에게 알림 */
  close(bye: boolean) {
    this.log?.flush();
    if (bye) this.net.send({ k: "bye", m: this.match });
    this.net.onPacket = null;
  }
}
