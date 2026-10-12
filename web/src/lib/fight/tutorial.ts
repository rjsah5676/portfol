/**
 * 튜토리얼 — 카이로 이 게임의 기본을 한 단계씩 (이동 → 공격 → 공중 → 방어 → 필살기 → 실전).
 * 시뮬레이션(sim.ts) 위에서 돌아감: 단계마다 연습 상대(2P)의 움직임 · 시작 자리 · 성공 조건이 정해져 있고,
 * 성공 조건은 그 프레임의 이벤트(s.ev)와 상태만 보고 셈. 체력 무한 · 시간 멈춤은 FightGame 이 맞춤.
 * 화면(글 · 진행)은 components/Fight/Tutorial.tsx. 글 속의 J · K · L · I 등은 화면에서 키 모양으로 바뀜.
 */
import { CHARS, SUB } from "./chars";
import { IN, METER_MAX, isAir, newMatch, type Ev, type State } from "./sim";

export const TUT_CHAR = CHARS.findIndex((c) => c.id === "kai");
/** 연습 상대 (크고 느려서 보기 쉬움) */
export const TUT_FOE = CHARS.findIndex((c) => c.id === "ivan");
/** 노을 옥상: 떨어질 곳 없는 넓은 바닥 + 발판 */
export const TUT_MAP = 0;
const FLOOR = 186 * SUB;

/** 연습 상대 움직임 */
type Dummy =
  | "idle" // 가만히
  | "attack" // 다가와서 약 한 번씩 (막기 연습)
  | "grab"; // 다가와서 잡기 (잡기 풀기 연습)

interface Ctx {
  /** 이 단계에서 지난 프레임 수 */
  t: number;
  n: number;
  minX: number;
  maxX: number;
  stage: number;
  /** 지금 콤보: 시작 기술 · 기술별 히트 · 피해 */
  start: string;
  hits: Record<string, number>;
  dmg: number;
  /** 공중 L 을 쓴 뒤 남은 프레임 (충격파는 착지할 때 맞으니까) */
  airS: number;
  cd: number;
  /** 연습 상대가 잡기 시작한 뒤 (풀기 성공 판정용) */
  grabbed: boolean;
}

export interface TutStep {
  /** 묶음 (위 진행 표시) */
  ch: string;
  title: string;
  /** 설명 — 줄마다 한 문단 */
  text: string[];
  /** 몇 번 해야 하나 (기본 1) */
  need?: number;
  /** 설명만 (J · Space · Enter 로 넘김, 판은 멈춤) */
  info?: boolean;
  dummy?: Dummy;
  /** 시작 거리(px) — 있으면 단계 시작할 때 두 사람을 그 거리로 다시 세움 */
  dist?: number;
  /** 내 게이지를 가득 채워 둠 */
  meter?: boolean;
  /** 매 프레임: 이번에 늘어난 성공 수 */
  check?: (s: State, ev: Ev[], c: Ctx) => number;
}

const hitBy = (ev: Ev[], m?: string) => ev.filter((e) => e.k === "hit" && e.p === 0 && (!m || e.m === m));

export const TUT_STEPS: TutStep[] = [
  {
    ch: "시작",
    title: "튜토리얼",
    info: true,
    text: [
      "카이로 이 게임의 기본을 하나씩 배워요. 이동 → 공격 → 공중 콤보 → 방어 → 필살기 순서예요.",
      "튜토리얼에선 체력이 줄지 않아요. 어려우면 오른쪽 위 「건너뛰기」(N), 멈추려면 Esc.",
    ],
  },
  // ── 이동 ──
  {
    ch: "이동",
    title: "걷기",
    text: ["A · D 로 좌우로 걸어요. 오른쪽으로 한 번, 왼쪽으로 한 번 크게 움직여 보세요."],
    dummy: "idle",
    dist: 380,
    check: (s, _ev, c) => {
      const x = s.p[0].x / SUB;
      if (c.t === 1) ((c.minX = x), (c.maxX = x));
      c.minX = Math.min(c.minX, x);
      c.maxX = Math.max(c.maxX, x);
      return c.maxX - c.minX > 160 && c.stage === 0 ? ((c.stage = 1), 1) : 0;
    },
  },
  {
    ch: "이동",
    title: "대시",
    text: ["같은 방향키를 빠르게 두 번 — D D 또는 A A — 누르면 대시로 확 달려가요.", "대시를 2번 해 보세요."],
    need: 2,
    dummy: "idle",
    check: (_s, ev) => ev.filter((e) => e.k === "dash" && e.p === 0 && e.v === 0).length,
  },
  {
    ch: "이동",
    title: "점프 · 2단 점프",
    text: ["W 또는 Space 로 점프, 공중에서 한 번 더 누르면 2단 점프예요.", "2단 점프를 해 보세요."],
    dummy: "idle",
    check: (_s, ev) => ev.filter((e) => e.k === "jump" && e.p === 0 && e.v >= 2).length,
  },
  {
    ch: "이동",
    title: "발판",
    text: [
      "발판은 아래에서 점프로 뚫고 올라가고, 끝으로 걸어가면 내려와요.",
      "위쪽 발판에 올라갔다가 다시 바닥으로 내려와 보세요.",
    ],
    dummy: "idle",
    check: (s, _ev, c) => {
      const f = s.p[0];
      const ground = !isAir(s, f);
      if (c.stage === 0 && ground && f.h > FLOOR + 40 * SUB) c.stage = 1;
      if (c.stage === 1 && ground && f.h <= FLOOR) return (c.stage = 2), 1;
      return 0;
    },
  },
  {
    ch: "이동",
    title: "낭떠러지",
    info: true,
    text: [
      "맵에 따라 발판 밖은 낭떠러지예요. 떨어지면 잠깐 뒤 화면 위에서 다시 내려와요.",
      "다시 내려온 뒤 땅에서 잠깐 버티기 전에 또 떨어지면 그땐 체력이 깎여요. 상대를 밖으로 밀어내는 것도 작전이에요.",
    ],
  },
  // ── 공격 ──
  {
    ch: "공격",
    title: "약 4단",
    text: [
      "J 를 이어 누르면 약 공격이 4단까지 나가요. 마지막 타가 세게 밀쳐 내요.",
      "연습 상대에게 다가가 J J J J 로 4타를 다 맞혀 보세요.",
    ],
    dummy: "idle",
    dist: 70,
    check: (_s, ev, c) => (hitBy(ev, "L").length && c.hits.L >= 4 ? ((c.hits.L = -99), 1) : 0),
  },
  {
    ch: "공격",
    title: "발차기 2단",
    text: ["K 는 발차기 — 느리지만 세고 멀리 닿아요. 2단까지 나가요.", "K K 를 둘 다 맞혀 보세요."],
    dummy: "idle",
    dist: 80,
    check: (_s, ev, c) => (hitBy(ev, "H").length && c.hits.H >= 2 ? ((c.hits.H = -99), 1) : 0),
  },
  {
    ch: "공격",
    title: "아이덴티티 · 캔슬",
    text: [
      "L 은 캐릭터마다 다른 아이덴티티 기술 — 카이는 「질풍권」, 바람을 두르고 돌진해요. 쓰고 나면 아래 아이콘이 다시 찰 때까지 못 써요.",
      "약이 맞는 중에 L 을 누르면 동작을 끊고 바로 나가요(캔슬). J J → L 로 이어 맞혀 보세요.",
    ],
    dummy: "idle",
    dist: 70,
    check: (_s, ev, c) => (hitBy(ev, "S").length && c.start === "L" && c.hits.L >= 2 ? ((c.start = ""), 1) : 0),
  },
  {
    ch: "공격",
    title: "기절 콤보",
    text: [
      "질풍권이 맞으면 상대가 잠깐 기절해요(머리 위 표시). 그 사이에 약 4단이 그대로 들어가요.",
      "붙어서 L → J J J 로 이어 보세요. 질풍권이 끝나자마자 살짝 다가가며 J 를 누르면 4타까지도 들어가요.",
    ],
    dummy: "idle",
    dist: 80,
    check: (_s, ev, c) => (hitBy(ev, "L").length && c.start === "S" && c.hits.L >= 3 ? ((c.start = ""), 1) : 0),
  },
  // ── 공중 ──
  {
    ch: "공중",
    title: "잡기",
    text: [
      "J + K 를 동시에 누르면 잡기 — 가드를 뚫고 상대를 위로 띄워요. 사거리가 짧으니 붙어서.",
      "잡기를 2번 성공해 보세요.",
    ],
    need: 2,
    dummy: "idle",
    dist: 44,
    check: (_s, ev) => ev.filter((e) => e.k === "throw" && e.p === 0).length,
  },
  {
    ch: "공중",
    title: "돌진 잡기",
    text: [
      "대시하는 중이나 대시 직후에 J + K 를 누르면 돌진 잡기 — 미끄러지듯 길게 파고들어 잡아요. 게이지 25를 써요.",
      "멀리서 D D 로 대시 → J + K 로 잡아 보세요. 막고만 있는 상대를 깨는 수단이지만 헛치면 빈틈이 커요.",
    ],
    dummy: "idle",
    dist: 220,
    meter: true,
    check: (s, ev) => ev.filter((e) => e.k === "throw" && e.p === 0 && s.p[0].lg === 1).length,
  },
  {
    ch: "공중",
    title: "공중 콤보",
    text: [
      "띄운 상대는 바로 점프해서 따라 올라가 공중에서 J · K 로 이어 쳐요 (맞히는 동안 나도 천천히 내려와요).",
      "J + K → 점프 → 공중 J J K — 잡기 뒤 공중 공격 3타를 맞혀 보세요.",
    ],
    dummy: "idle",
    dist: 44,
    check: (_s, ev, c) =>
      ev.some((e) => e.k === "hit" && e.p === 0 && (e.m === "J" || e.m === "K")) && c.start === "T" && (c.hits.J ?? 0) + (c.hits.K ?? 0) >= 3
        ? ((c.start = ""), 1)
        : 0,
  },
  {
    ch: "공중",
    title: "내려찍기",
    text: [
      "공중에서 S + K (↓ + K) 는 내려찍기 — 상대를 바닥에 꽂아 튕긴 뒤 넘어뜨려요. 공중 콤보 마무리로 좋아요.",
      "J + K → 점프 → 공중 J → S + K 로 내려찍어 보세요.",
    ],
    dummy: "idle",
    dist: 44,
    check: (_s, ev) => ev.filter((e) => e.k === "slam" && e.p === 0 && e.v === 0).length,
  },
  {
    ch: "공중",
    title: "급강하",
    text: [
      "점프 중에 L 을 누르면 카이는 바닥까지 급강하해 쾅 — 양옆으로 퍼지는 충격파가 상대를 띄워요.",
      "상대 근처에서 점프 → L 로 충격파를 맞혀 보세요.",
    ],
    dummy: "idle",
    dist: 110,
    check: (s, ev, c) => {
      const f = s.p[0];
      if (f.st === "atk" && f.mv === "S" && f.aerial) c.airS = 40;
      else if (c.airS > 0) c.airS--;
      return c.airS > 0 && hitBy(ev, "S").length ? ((c.airS = 0), 1) : 0;
    },
  },
  // ── 방어 ──
  {
    ch: "방어",
    title: "가드",
    text: [
      "S (↓) 를 누르고 있으면 가드 — 상대 공격을 막아요. 막아도 조금 깎이고, 잡기는 못 막아요.",
      "연습 상대가 이제 때리러 와요. 3번 막아 보세요.",
    ],
    need: 3,
    dummy: "attack",
    dist: 200,
    check: (_s, ev) => ev.filter((e) => (e.k === "block" || e.k === "just") && e.p === 1).length,
  },
  {
    ch: "방어",
    title: "저스트 가드",
    text: [
      "맞기 직전에 S 를 새로 눌러 막으면 저스트 가드 — 경직이 절반, 깎임 없음, 게이지까지 차요.",
      "S 를 누르고 있지 말고, 상대 주먹이 나오는 순간에 눌러 보세요.",
    ],
    dummy: "attack",
    dist: 200,
    check: (_s, ev) => ev.filter((e) => e.k === "just" && e.p === 1).length,
  },
  {
    ch: "방어",
    title: "가드 반격",
    text: [
      "막는 중이나 막은 직후에 K 를 누르면 가드 반격 — 게이지 25를 쓰고 상대를 띄워요. 그대로 점프해서 공중 콤보로.",
      "공격을 막고 → K 로 반격해 보세요.",
    ],
    dummy: "attack",
    dist: 200,
    meter: true,
    check: (_s, ev) => hitBy(ev, "G").length,
  },
  {
    ch: "방어",
    title: "잡기 풀기",
    text: [
      "잡히는 순간 J + K 를 누르면 풀려서 피해를 안 받아요.",
      "연습 상대가 잡으러 와요. 잡히면 바로 J + K — 2번 풀어 보세요.",
    ],
    need: 2,
    dummy: "grab",
    dist: 200,
    check: (_s, ev) => ev.filter((e) => e.k === "tech" && e.p === 0).length,
  },
  // ── 필살기 ──
  {
    ch: "필살기",
    title: "게이지 · 상태 이상",
    info: true,
    text: [
      "아래 게이지는 때리거나 맞으면 차요. MAX가 되면 I 로 필살기를 쓸 수 있어요 (가드 반격 · 돌진 잡기는 25씩 써요).",
      "L · I 에 맞으면 캐릭터마다 다른 상태 이상(기절 · 화상 · 감전 · 일시정지 …)이 걸려요. 한 콤보에 한 번, 풀린 뒤 2초 동안은 다시 안 걸려요(IMMUNE).",
    ],
  },
  {
    ch: "필살기",
    title: "필살기",
    text: [
      "게이지를 가득 채워 뒀어요. I 를 누르면 카이의 필살기 「천풍난무」 — 회오리를 두르고 돌진하며 6연타.",
      "약이 맞는 중에 써도 캔슬돼요. J J J → I 로 맞혀 보세요.",
    ],
    dummy: "idle",
    dist: 70,
    meter: true,
    check: (_s, ev) => (hitBy(ev, "X").length ? 1 : 0),
  },
  // ── 실전 ──
  {
    ch: "실전",
    title: "한 콤보 250",
    text: [
      "배운 걸 섞어서 한 콤보에 피해 250을 넣어 보세요. 게이지는 계속 가득 차 있어요.",
      "예: J + K → 점프 → 공중 J J K → S + K, 또는 L → J J J → I",
    ],
    dummy: "idle",
    dist: 70,
    meter: true,
    check: (_s, _ev, c) => (c.dmg >= 250 && c.stage === 0 ? ((c.stage = 1), 1) : 0),
  },
  {
    ch: "끝",
    title: "튜토리얼 완료!",
    info: true,
    text: [
      "기본은 다 배웠어요. 캐릭터마다 아이덴티티 · 필살기 · 콤보가 달라요 — 메인 화면 「기술 가이드」에 다 있어요.",
      "이제 AI 대전으로 실력을 확인해 보거나, 연습 모드에서 다른 캐릭터 콤보를 연습해 보세요.",
    ],
  },
];

/** 튜토리얼 진행 — FightGame 루프가 프레임마다 input() → step() → update() */
export class Tutorial {
  i = 0;
  n = 0;
  /** 성공 연출 남은 프레임 (끝나면 다음 단계) */
  clear = 0;
  /** 다음 단계로 넘어갈 때 자리를 다시 세워야 함 */
  private pendingSetup = true;
  private c: Ctx = Tutorial.ctx();
  private seen = 0;

  private static ctx(): Ctx {
    return { t: 0, n: 0, minX: 0, maxX: 0, stage: 0, start: "", hits: {}, dmg: 0, airS: 0, cd: 40, grabbed: false };
  }

  get step(): TutStep {
    return TUT_STEPS[this.i];
  }
  get done() {
    return this.i >= TUT_STEPS.length - 1;
  }
  /** 설명 카드가 떠 있는 동안 판을 멈춤 */
  get blocking() {
    return !!this.step.info;
  }

  next() {
    if (this.i >= TUT_STEPS.length - 1) return;
    this.i++;
    this.n = 0;
    this.clear = 0;
    this.c = Tutorial.ctx();
    this.pendingSetup = true;
  }

  /** 단계 시작 자리 · 게이지 (판 상태를 직접 고침) */
  private setup(s: State) {
    const st = this.step;
    if (st.dist !== undefined) {
      const fresh = newMatch([s.p[0].ch, s.p[1].ch], s.map);
      const cx = 576 - 60;
      s.p[0] = fresh.p[0];
      s.p[1] = fresh.p[1];
      s.p[0].x = (cx - (st.dist >> 1)) * SUB;
      s.p[1].x = (cx + (st.dist >> 1)) * SUB;
      s.p[0].face = 1;
      s.p[1].face = -1;
      s.proj = [];
    }
    s.p[0].meter = st.meter ? METER_MAX : 0;
  }

  /** 연습 상대 입력 */
  input(s: State): number {
    const st = this.step;
    const me = s.p[0],
      d = s.p[1];
    if (this.clear > 0 || !st.dummy || st.dummy === "idle") return 0;
    const dx = (me.x - d.x) / SUB;
    const dist = Math.abs(dx);
    const toward = dx > 0 ? IN.R : IN.L;
    if (this.c.cd > 0) this.c.cd--;
    if (d.st !== "idle" && d.st !== "walk") return 0;
    if (me.st === "hit" || me.st === "down" || isAir(s, me) || isAir(s, d)) return 0;
    if (st.dummy === "attack") {
      if (dist > 58) return toward;
      if (this.c.cd === 0) {
        this.c.cd = 75;
        return IN.A;
      }
      return 0;
    }
    // grab
    if (dist > 40) return toward;
    if (this.c.cd === 0) {
      this.c.cd = 90;
      return IN.A | IN.B;
    }
    return 0;
  }

  /** step() 다음에: 성공 판정 · 진행. 화면 다시 그릴 일이 생기면 true */
  update(s: State): boolean {
    const st = this.step;
    let changed = false;
    if (this.pendingSetup) {
      this.pendingSetup = false;
      if (!st.info) this.setup(s);
      changed = true;
    }
    if (st.meter) s.p[0].meter = METER_MAX;
    if (st.info) return changed;
    if (this.clear > 0) {
      if (--this.clear === 0) {
        this.next();
        return true;
      }
      return changed;
    }
    const c = this.c;
    c.t++;
    // 콤보 기록: 시작 기술 · 기술별 히트 · 피해 (상대가 경직에서 풀리면 처음부터)
    const d = s.p[1];
    for (const e of s.ev) {
      if ((e.k === "hit" || e.k === "throw") && e.p === 0) {
        const m = e.k === "throw" ? "T" : (e.m ?? "");
        if (d.combo <= 1 && e.k === "hit" && !c.start) ((c.hits = {}), (c.dmg = 0), (c.start = m));
        if (e.k === "throw") ((c.hits = {}), (c.dmg = 0), (c.start = "T"));
        c.hits[m] = (c.hits[m] ?? 0) + 1;
        if (e.k === "hit") c.dmg += e.v;
      }
    }
    if (d.combo === 0 && d.st !== "hit" && d.st !== "down" && !(d.grabbed > 0)) ((c.start = ""), (c.hits = {}), (c.dmg = 0));
    const add = st.check ? st.check(s, s.ev, c) : 0;
    if (add > 0) {
      this.n = Math.min(st.need ?? 1, this.n + add);
      changed = true;
      if (this.n >= (st.need ?? 1)) this.clear = 60;
    }
    if (this.seen !== this.i) ((this.seen = this.i), (changed = true));
    return changed;
  }

  /** 건너뛰기 */
  skip() {
    this.next();
  }

  /** 지금 단계 처음부터 (다시하기) */
  retry() {
    this.n = 0;
    this.clear = 0;
    this.c = Tutorial.ctx();
    this.pendingSetup = true;
  }

  /** 화면에 보여 줄 것 */
  view() {
    return { i: this.i, n: this.n, clear: this.clear > 0 };
  }
}
