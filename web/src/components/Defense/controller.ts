/**
 * 화면 쪽 게임 진행 (React 와 무관) — 시뮬(lib/defense/sim)을 시간에 맞춰 돌리고 명령을 기록/전송.
 *
 *  솔로: 명령은 바로 실행하고 [tick, 0, 명령] 으로 기록 → 끝나면 기록을 서버에 내서 랭킹 검증
 *  멀티: 명령은 서버로만 보냄. 서버가 턴마다 모두의 명령을 뿌리면(onTurn) 그 턴 tick 에 실행 (락스텝).
 *        받은 턴까지만 진행할 수 있음 → 모두의 화면이 같은 시뮬. 늦게 들어오면 기록으로 빨리 따라잡음.
 */
import { TPS } from "@/lib/defense/balance";
import type { Loadout } from "@/lib/defense/progress";
import { HASH_TICKS, TICKS_PER_TURN, type LogEntry } from "@/lib/defense/replay";
import {
  apply,
  hashGame,
  newGame,
  step,
  type Board,
  type Cmd,
  type Ev,
  type Fx,
  type Game,
} from "@/lib/defense/sim";

export type Mode =
  | { kind: "solo"; run: string | null }
  | { kind: "multi"; room: string; send: (c: Cmd[]) => Promise<unknown> };

export class Controller {
  game: Game;
  log: LogEntry[] = [];
  speed = 1;
  paused = false;
  /** 개발자 도구를 썼거나 배속을 넘겼으면 랭킹에 안 올림 */
  unranked = false;
  /** 받은 턴 (멀티) */
  private turns = new Map<number, [number, Cmd][]>();
  private lastTurn = -1;
  private acc = 0;
  /** 이번 프레임에 쌓인 효과 · 알림 (화면이 가져감) */
  fx: Fx[] = [];
  ev: Ev[] = [];
  /** 멀티: 보낸 뒤 아직 안 돌아온 명령 수 */
  inflight = 0;
  /** 매 tick 뒤 (봇 · 개발자 도구) */
  onTick: ((g: Game) => void) | null = null;
  /** 멀티 어긋남 감시: HASH_TICKS 마다 전체 상태 해시 (Room 이 서버로 보냄) */
  onHash: ((tick: number, h: number) => void) | null = null;
  /** 서버가 알려 준 어긋남 수 (화면 표시용) */
  desync = 0;

  constructor(
    seed: number,
    players: number,
    readonly seat: number,
    readonly mode: Mode,
    /** 보드마다 들고 간 영구 성장 (서버가 정해 줌 — 검증 · 멀티가 같은 값으로 돌림) */
    loadouts?: (Loadout | null)[]
  ) {
    this.game = newGame(seed, players, loadouts);
    // 효과 · 알림은 내 보드 것만 모음 (남의 보드는 안 쌓음)
    const me = this.game.boards[seat];
    me.fx = [];
    me.ev = [];
  }

  get board(): Board {
    return this.game.boards[this.seat];
  }

  /** 명령 실행 (솔로) 또는 보내기 (멀티). 못 하는 명령이면 이유 */
  issue(cmd: Cmd): string | null {
    const g = this.game;
    if (this.mode.kind === "solo") {
      const err = apply(g, this.seat, cmd);
      if (!err) this.log.push([g.tick, this.seat, cmd]);
      this.drain();
      return err;
    }
    // 멀티: 복사본에 먼저 해 보고(바로 안내), 되는 것만 보냄
    const b = this.board;
    const copy: Board = { ...structuredClone({ ...b, fx: null, ev: null }), fx: null, ev: null };
    const err = apply(
      { ...g, boards: g.boards.map((x, i) => (i === this.seat ? copy : x)) },
      this.seat,
      cmd
    );
    if (err) return err;
    this.inflight++;
    void this.mode
      .send([cmd])
      .catch(() => {})
      .finally(() => this.inflight--);
    return null;
  }

  /** 멀티: 서버가 뿌린 턴 */
  onTurn(n: number, c: [number, Cmd][]) {
    this.turns.set(n, c);
    if (n > this.lastTurn) this.lastTurn = n;
  }

  /**
   * 멀티: 지금까지의 기록으로 못 받은 턴을 채움 — 처음 (다시) 들어왔을 때, 연결이 끊겼다 붙었을 때.
   * 이미 받은 턴은 그대로 둠.
   */
  loadLog(log: LogEntry[], turn: number) {
    const from = this.lastTurn + 1;
    const fill = new Map<number, [number, Cmd][]>();
    for (const [t, p, cmd] of log) {
      const n = Math.floor(t / TICKS_PER_TURN);
      if (n < from) continue;
      const l = fill.get(n) ?? [];
      l.push([p, cmd]);
      fill.set(n, l);
    }
    for (let n = from; n < turn; n++) if (!this.turns.has(n)) this.turns.set(n, fill.get(n) ?? []);
    if (turn - 1 > this.lastTurn) this.lastTurn = turn - 1;
  }

  /** 멀티에서 따라잡는 중인지 (받은 턴보다 많이 뒤처짐) */
  get behind(): number {
    if (this.mode.kind !== "multi") return 0;
    return Math.max(0, (this.lastTurn + 1) * TICKS_PER_TURN - this.game.tick);
  }

  private tickOnce(): boolean {
    const g = this.game;
    if (g.over) return false;
    if (this.mode.kind === "multi") {
      if (g.tick >= (this.lastTurn + 1) * TICKS_PER_TURN) return false;
      if (g.tick % TICKS_PER_TURN === 0) {
        const n = g.tick / TICKS_PER_TURN;
        for (const [p, cmd] of this.turns.get(n) ?? []) {
          apply(g, p, cmd);
          this.log.push([g.tick, p, cmd]);
        }
        this.turns.delete(n);
      }
    }
    step(g);
    this.onTick?.(g);
    // 따라잡는 중(받은 턴보다 많이 뒤)에는 안 보냄 — 한꺼번에 몰리지 않게, 지금 진행 중인 tick 만 비교
    if (this.onHash && g.tick % HASH_TICKS === 0 && this.behind < HASH_TICKS)
      this.onHash(g.tick, hashGame(g));
    return true;
  }

  // ── 화면에서 부르는 조작 (React 컴포넌트가 컨트롤러 값을 직접 바꾸지 않게) ──
  setPaused(v: boolean) {
    if (this.mode.kind === "solo") this.paused = v;
  }
  togglePause() {
    this.setPaused(!this.paused);
  }
  /** 배속 1 → 2 → 3 → 1 */
  cycleSpeed() {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
  }
  /** 개발자 도구 (쓰면 랭킹 안 올림) */
  dev(fn: (c: this) => void) {
    this.unranked = true;
    fn(this);
  }
  /** 봇 자동 플레이 켜고 끄기 (개발자 도구) */
  setAuto(fn: ((g: Game) => void) | null) {
    if (fn) this.unranked = true;
    this.onTick = fn;
  }

  /** 화면 한 프레임 (dt ms) */
  frame(dt: number) {
    const per = 1000 / TPS;
    if (this.mode.kind === "multi") {
      // 멀티는 일시정지 · 배속 없음. 많이 뒤처졌으면 한 프레임에 여러 tick
      const behind = this.behind;
      const n = behind > 12 ? Math.min(behind, 400) : 0;
      if (n) for (let i = 0; i < n; i++) this.tickOnce();
      else {
        this.acc += Math.min(dt, 250);
        while (this.acc >= per) {
          this.acc -= per;
          if (!this.tickOnce()) {
            this.acc = 0;
            break;
          }
        }
      }
    } else if (!this.paused) {
      this.acc += Math.min(dt, 250) * this.speed;
      let n = 0;
      while (this.acc >= per && n++ < 40) {
        this.acc -= per;
        if (!this.tickOnce()) break;
      }
      if (n >= 40) this.acc = 0;
    }
    this.drain();
  }

  /** 보드에 쌓인 효과 · 알림을 가져옴 (내 보드 것만) */
  private drain() {
    const b = this.board;
    if (b.fx!.length) {
      this.fx.push(...b.fx!);
      b.fx!.length = 0;
    }
    if (b.ev!.length) {
      this.ev.push(...b.ev!);
      b.ev!.length = 0;
    }
  }
}
