/**
 * 격투게임 캐릭터 성능 (프레임 데이터). 그림과는 완전히 분리 — 그림은 public/fight/<id>.json.
 *
 * 단위: 1px = 256 (SUB). 속도는 프레임당 SUB, 시간은 프레임(1/60초).
 * 판정 박스는 캐릭터 발 가운데 기준, 오른쪽을 볼 때 값:
 *   x = 앞쪽으로 얼마나 떨어진 곳부터(px), y = 땅에서 박스 윗변까지 높이(px), w·h = 크기(px)
 */

export const SUB = 256;

/**
 * 기술 id: L 약 · H 발차기 · J 공중 약 · K 공중 발차기 · S 아이덴티티(캐릭터마다 다름) · X 필살기
 *          T 잡기(약+발차기, 가드 불가) · G 가드 반격(가드 중 발차기, 게이지 25)
 */
export type MoveId = "L" | "H" | "J" | "K" | "S" | "X" | "T" | "G";
type BaseMoveId = Exclude<MoveId, "T" | "G">;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjDef {
  /** 프레임당 SUB */
  speed: number;
  /** 발에서 탄 가운데까지 높이(px) */
  y: number;
  w: number;
  h: number;
  /** 사라질 때까지 프레임 */
  life: number;
  /** 여러 번 맞는 탄: 맞히는 수와 간격(프레임) */
  hits?: number;
  every?: number;
  /** 공중에서 쏴도 내리꽂지 않고 수평으로 */
  flat?: boolean;
}

export interface MoveDef {
  startup: number;
  active: number;
  recovery: number;
  dmg: number;
  /** 막았을 때 깎이는 양 */
  chip: number;
  hitstun: number;
  blockstun: number;
  /** 맞은 쪽이 밀려나는 속도 (프레임당 SUB) */
  push: number;
  hitstop: number;
  /** 맞히면 차는 게이지 */
  meter: number;
  box: Box;
  /** 맞히거나 막혔을 때 이어 쓸 수 있는 기술 */
  cancel?: MoveId[];
  /** 다운시킴 */
  kd?: boolean;
  /** 시작 동안 앞으로 나가는 속도 */
  step?: number;
  /** 판정 동안 경직 면역 (맞아도 피해만 받고 하던 동작을 계속 — 카이 질풍권 돌진) */
  armor?: boolean;
  /** 공중 기술: 시작할 때 앞으로 치고 나가는 속도 (SUB/프레임) */
  lunge?: number;
  /** 돌진기: 판정이 나오는 순간 앞으로 튀어 나감 (공중이면 airVh로 아래로 내리꽂음) */
  rush?: {
    vx: number;
    airVh: number;
    /** 공중에서의 가로 속도 (없으면 vx) */
    airVx?: number;
    /** 공중에서 쓰고 착지하면 이 반경(px)에 충격파 */
    landBurst?: number;
    /** 착지 충격파 피해 (없으면 기술 피해 그대로) */
    landDmg?: number;
    /** 공중에서 쓰면 판정 동안 이 속도보다 빨리 안 떨어짐 (공중에서 버티며 때림) */
    airFall?: number;
  };
  /** 여러 번 맞는 기술: 판정 동안 이 프레임마다 다시 맞음 (마지막 타만 다운) */
  multi?: number;
  /**
   * 막혔을 때 프레임 이득 (+면 때린 쪽이 먼저 움직임, -면 막은 쪽이 먼저 → 반격 가능).
   * 없으면 기술 종류별 기본값(ON_BLOCK). blockstun은 이 값으로 자동 계산.
   */
  onBlock?: number;
  /** 맞으면 상대를 내 쪽으로 끌어당김 */
  pull?: boolean;
  /** 소환기: 상대 발밑 발판에 기둥을 세움 (delay 뒤 life 동안, every 프레임마다 타격) */
  summon?: {
    w: number;
    h: number;
    delay: number;
    life: number;
    every: number;
    /** 타마다 상대 발밑으로 다시 떨어짐 (추적) */
    track?: boolean;
    /** 상대 발밑 대신 내 앞 이 거리(px)에 세움 (넓은 범위기) */
    front?: number;
    /** 기둥이 사그라진 자리에 불 장판 (life 프레임) — 밟고 있으면 every 프레임마다 dmg + 화상 */
    floor?: { life: number; w: number; every: number; dmg: number; burn: number };
  };
  /** 맞히면 상대를 감전시키는 프레임 수 (느려지고, 같은 캐릭터의 공격에 더 아픔) */
  shock?: number;
  /** 맞으면 화상 (프레임) — 15프레임마다 체력 -2 */
  burn?: number;
  /** 맞으면 위로 띄움 (후속타) */
  launch?: boolean;
  /** launch로 띄우는 속도 (없으면 기본 — 낮을수록 짧은 공중 콤보) */
  launchVh?: number;
  /** 약 4단 마무리로 쓰일 때 상대를 위로 띄움 (어퍼컷) → 점프 캔슬해 공중 콤보 */
  launcher?: boolean;
  /** 공중에서 쓰면 이 값들로 바뀜 (같은 키, 다른 기술 — 예: 소영 공중 지도편달 = 아래로 내려치기) */
  air?: Partial<MoveDef>;
  /** 공중에서 시작할 때 떨어지던 걸 잠깐 멈춤 (위로 이 속도) */
  hover?: number;
  /** 공중의 상대를 맞히면 아래로 내리꽂음 (땅에 닿으면 짧게 튀어 오르고 경직 유지) */
  spike?: boolean;
  /** 끌어당기며 띄우기 (공중 기술: 때린 쪽 높이까지 띄우고 앞으로 끌어옴 → 공중 콤보) */
  pullUp?: boolean;
  /** 맞히면 상대를 ⏸ 일시정지 (경직 = hitstun, 머리 위에 표시) */
  pause?: boolean;
  /** 맞히면 상대와 자리를 바꾸고 💫 혼란: hitstun 동안 그 자리에 떠 있다가 넘어짐 (아래가 낭떠러지면 안 넘어짐) */
  swap?: boolean;
  /** 맞히면 상대를 물방울에 가둠 (프레임 수) — 둥실 떠서 못 움직이고, 버튼 연타로 빨리 빠져나옴, 맞으면 터짐 */
  trap?: number;
  proj?: ProjDef;
}

export interface CharDef {
  id: string;
  name: string;
  title: string;
  desc: string;
  hp: number;
  /** 걷기 속도 (SUB/프레임) */
  walk: number;
  /** 점프 가로 속도·공중 최고 가로 속도 */
  jumpVx: number;
  /** 대시 속도 (←← / →→) */
  dash: number;
  /** 아이덴티티 재사용 대기 (프레임) */
  cd: number;
  /** 공중에서 점프를 누르고 있으면 천천히 떨어짐 (최대 낙하 속도) */
  glide?: number;
  /** 선택 화면 대사 */
  quote: string;
  /** 경기에서 이겼을 때 도발 대사 */
  winQuote: string;
  /** 설정화 영문 부제 */
  tagline: string;
  /** 난이도 (1 쉬움 ~ 3 어려움) — 선택 화면 표시 */
  difficulty: 1 | 2 | 3;
  /** 캐릭터 선택 화면 육각형 (1~5): 공격력 · 리치 · 기동력 · 제어력(묶기·상태 이상) · 콤보 · 체력 */
  stats: { atk: number; reach: number; move: number; control: number; combo: number; hp: number };
  /** 피격 박스 */
  hurt: Box;
  /** 밀어내기 폭(px) */
  width: number;
  /** 탄·이펙트 색 */
  color: string;
  /** 아이덴티티(L)·필살기(I) 이름과 설명 (선택 화면·HUD) */
  idName: string;
  idDesc: string;
  ultName: string;
  ultDesc: string;
  /** 점프 중 아이덴티티(L)가 땅에서와 다를 때 설명 */
  airDesc: string;
  /** airDesc 앞에 붙는 이름 (없으면 "점프 중 L") */
  airLabel?: string;
  moves: Record<MoveId, MoveDef>;
}

export const JUMP_VY = -2650; // 약 10.4px/f → 최고 높이 약 134px (2단 점프로 약 240px)
export const GRAVITY = 102; // 0.4px/f²

type CharSrc = Omit<CharDef, "moves"> & { moves: Record<BaseMoveId, MoveDef> };

const RAW: CharSrc[] = [
  {
    id: "kai",
    name: "카이",
    title: "맨손 격투 · 바람",
    desc: "빠른 주먹·발차기로 붙어서 몰아치는 맨손 격투가",
    hp: 1250, // 질풍권 띄우기 추가로 1350→1250
    walk: 1240,
    jumpVx: 1050,
    dash: 2700,
    cd: 240, // 질풍권 경직 면역·기절로 140→240
    hurt: { x: -9, y: 58, w: 18, h: 58 },
    width: 18,
    color: "#E6ECF5",
    quote: "덤벼. 주먹 하나면 충분해.",
    winQuote: "그게 다야? 다음엔 좀 더 버텨 봐.",
    tagline: "RELENTLESS FIGHTER",
    difficulty: 2,
    stats: { atk: 3, reach: 2, move: 5, control: 2, combo: 5, hp: 4 },
    idName: "질풍권",
    idDesc: "바람을 두르고 돌진하며 2연타 — 돌진하는 동안 경직 면역, 맞으면 기절",
    ultName: "천풍난무",
    ultDesc: "회오리를 두르고 돌진하며 6연타, 마지막 타에 날려 버림",
    airDesc: "아래로 급강하해 바닥을 쾅 — 양옆 넓게 충격파로 띄움",
    moves: {
      L: {
        // 약 (J): 제일 빠르고 짧은 경직 — J·J로 이어 치고 발차기·아이덴티티·필살기로 캔슬
        startup: 3,
        active: 3,
        recovery: 5,
        dmg: 40, // 44→40 (카이가 기본기로 너무 셈)
        chip: 0,
        hitstun: 14,
        blockstun: 9,
        push: 560,
        hitstop: 5,
        meter: 5,
        box: { x: 4, y: 46, w: 44, h: 18 },
        cancel: ["H", "S", "X"],
        launcher: true, // 4단째 어퍼컷: 상대를 띄움 → 점프 캔슬 공중 콤보
      },
      H: {
        // 발차기 (K): 세지만 느리고 헛치면 빈틈 큼 — 연타보다 약 뒤에 이어 쓰는 기술
        startup: 11,
        active: 4,
        recovery: 19,
        dmg: 92, // 102→92
        chip: 0,
        hitstun: 20,
        blockstun: 14,
        push: 1100,
        hitstop: 9,
        meter: 9,
        box: { x: 2, y: 62, w: 58, h: 30 },
        cancel: ["S", "X"],
        step: 260,
      },
      J: {
        startup: 4,
        active: 8,
        recovery: 6,
        dmg: 60,
        chip: 0,
        hitstun: 16,
        blockstun: 10,
        push: 600,
        hitstop: 6,
        meter: 5,
        box: { x: 0, y: 40, w: 50, h: 26 },
      },
      K: {
        startup: 6,
        active: 8,
        recovery: 10,
        dmg: 90,
        chip: 0,
        hitstun: 20,
        blockstun: 12,
        push: 1300,
        hitstop: 8,
        meter: 8,
        box: { x: 0, y: 44, w: 62, h: 22 },
        lunge: 2300,
      },
      S: {
        // 아이덴티티 「질풍권」: 바람을 두르고 앞으로 돌진하며 2연타 (공중에선 비스듬히 내리꽂는 발차기)
        startup: 9,
        active: 11,
        recovery: 22,
        dmg: 44, // 경직 면역·기절이 붙어서 56→44
        chip: 6,
        // 맞으면 기절 0.85초 (60→51, 카이가 너무 셈)
        hitstun: 51,
        blockstun: 10,
        push: 700,
        hitstop: 7,
        meter: 7,
        box: { x: 0, y: 48, w: 46, h: 32 },
        // 공중: 거의 수직으로 급강하 → 바닥을 쾅 찍어 양옆 넓게 충격파로 띄움 (공중 K는 앞으로 길게 차는 기술)
        // (airVh: 최고 낙하 속도 2600에 잘리므로 그 값으로 — 전엔 -3400이라 적혀 있었지만 실제론 2600)
        rush: { vx: 2500, airVh: -2600, airVx: 900, landBurst: 76, landDmg: 50 },
        // 돌진 중 2번 때림, 돌진하는 동안 경직 면역
        multi: 6,
        armor: true,
        air: { armor: false },
      },
      X: {
        // 필살기 「천풍난무」: 회오리를 두르고 돌진하며 6연타, 마지막에 날려 버림
        startup: 6,
        active: 36,
        recovery: 22,
        dmg: 42,
        chip: 8,
        hitstun: 18,
        blockstun: 12,
        push: 220,
        hitstop: 2,
        meter: 0,
        box: { x: -30, y: 86, w: 92, h: 86 },
        kd: true,
        multi: 6,
        // 공중에서 쓰면 그 높이에서 천천히 떨어지며 6연타 (전엔 금방 땅으로 내려옴)
        rush: { vx: 1500, airVh: 0, airFall: 700 },
      },
    },
  },
  {
    id: "igna",
    name: "이그나",
    title: "불꽃 술사",
    desc: "불꽃 탄과 긴 불꽃 베기로 거리를 두고 태우는 술사",
    hp: 1220,
    walk: 1160,
    jumpVx: 980,
    dash: 2500,
    cd: 66,
    hurt: { x: -9, y: 60, w: 18, h: 60 },
    width: 18,
    color: "#FF6A2A",
    quote: "다 태워 줄게. 가까이 오지 마!",
    winQuote: "후후, 잘 탔네~ 불장난은 나랑만 하는 거야!",
    tagline: "BLAZING SOUL",
    difficulty: 1,
    stats: { atk: 4, reach: 4, move: 3, control: 3, combo: 3, hp: 3 },
    idName: "화염구",
    idDesc: "빠르게 날아가는 불꽃 탄. 맞으면 화상 — 한동안 체력이 조금씩 닳고, 그동안 이그나의 공격이 10% 더 아픔",
    ultName: "업화주",
    ultDesc: "상대 발밑에서 큰 불기둥이 솟아 4연타 — 오래 화상, 꺼진 자리엔 2초 동안 불 장판",
    airDesc: "화염구를 앞쪽 아래로 비스듬히 쏨 — 아래 발판의 상대를 노림",
    moves: {
      L: {
        startup: 4,
        active: 3,
        recovery: 6,
        dmg: 42,
        chip: 0,
        hitstun: 14,
        blockstun: 9,
        push: 660,
        hitstop: 5,
        meter: 5,
        box: { x: 4, y: 40, w: 48, h: 24 },
        cancel: ["H", "S", "X"],
      },
      H: {
        startup: 12, // 10.05: 10→12 (발차기 견제가 너무 셈)
        active: 5,
        recovery: 20,
        dmg: 86,
        chip: 8,
        hitstun: 21,
        blockstun: 15,
        push: 1150,
        hitstop: 10,
        meter: 10,
        box: { x: 0, y: 68, w: 64, h: 60 },
        onBlock: -8, // 막혔을 때 이득 2프레임 줄임 (10.05)
        cancel: ["S", "X"],
        step: 160,
      },
      J: {
        startup: 5,
        active: 9,
        recovery: 7,
        dmg: 56,
        chip: 0,
        hitstun: 16,
        blockstun: 10,
        push: 620,
        hitstop: 6,
        meter: 5,
        box: { x: -24, y: 56, w: 80, h: 50 },
      },
      K: {
        startup: 8,
        active: 8,
        recovery: 12,
        dmg: 95,
        chip: 6,
        hitstun: 20,
        blockstun: 12,
        push: 1200,
        hitstop: 8,
        meter: 8,
        box: { x: -10, y: 48, w: 76, h: 56 },
        lunge: 1600,
      },
      S: {
        // 아이덴티티 「화염구」: 빠른 불꽃 탄 (공중에선 앞쪽 아래로 내리꽂음)
        startup: 8,
        active: 1,
        recovery: 15,
        dmg: 85,
        chip: 16,
        hitstun: 17,
        blockstun: 13,
        push: 800,
        hitstop: 7,
        meter: 7,
        box: { x: 0, y: 0, w: 0, h: 0 },
        proj: { speed: 1750, y: 36, w: 30, h: 24, life: 95 },
        burn: 150, // 화상 120→150
      },
      X: {
        // 필살기 「업화주」: 상대 발밑에서 불기둥이 솟아 4연타 — 어디 있든 쫓아감
        startup: 10,
        active: 1,
        recovery: 30,
        dmg: 88,
        chip: 12,
        hitstun: 24,
        blockstun: 14,
        push: 300,
        hitstop: 5,
        meter: 0,
        box: { x: 0, y: 0, w: 0, h: 0 },
        kd: true,
        summon: {
          w: 66,
          h: 165,
          delay: 20,
          life: 40,
          every: 10,
          // 불기둥이 꺼진 자리에 2초 동안 불 장판: 밟고 있으면 0.25초마다 8 피해 + 화상
          floor: { life: 120, w: 110, every: 15, dmg: 8, burn: 90 },
        },
        burn: 220, // 화상 180→220
      },
    },
  },
  {
    // 거리형(리치): 채찍이 길어 멀리서 맞히기 쉬운 대신 한 대가 약하고, 헛치면 빈틈이 큼
    id: "soyoung",
    name: "소영",
    title: "선생님 · 채찍",
    desc: "긴 채찍으로 거리를 지배하는 엄한 선생님. 붙으면 약함",
    hp: 1210,
    walk: 1020,
    jumpVx: 900,
    dash: 2300,
    cd: 100,
    hurt: { x: -9, y: 60, w: 18, h: 60 },
    width: 18,
    color: "#FF5FB4",
    quote: "수업 끝. 이제… 제대로 할 시간이야.",
    winQuote: "오늘 수업은 여기까지. 복습해 와.",
    tagline: "STRICT BUT KIND",
    difficulty: 3,
    stats: { atk: 3, reach: 5, move: 2, control: 4, combo: 3, hp: 3 },
    idName: "지도편달",
    idDesc: "아주 긴 채찍으로 낚아채 바로 앞까지 끌어당김 — 맞히면 약 콤보·잡기가 확정으로 이어짐",
    ultName: "보충수업",
    ultDesc: "채찍을 휘몰아 앞뒤를 모두 6번 후려침",
    airDesc: "공중에 멈춰 바로 아래부터 앞쪽 사선 아래까지 채찍을 휩쓸어 내리침 — 맞으면 내 높이까지 띄워 끌어와서 공중 콤보",
    moves: {
      L: {
        // 약: 리치는 길지만 한 대가 약하고 조금 느림
        startup: 6,
        active: 3,
        recovery: 10,
        dmg: 26,
        chip: 0,
        hitstun: 13,
        blockstun: 8,
        push: 800,
        hitstop: 4,
        meter: 5,
        box: { x: 8, y: 46, w: 92, h: 14 }, // 채찍 끝까지 (그림에 맞춤)
        cancel: ["H", "S", "X"],
      },
      H: {
        startup: 12,
        active: 4,
        recovery: 20,
        dmg: 90, // 80→90
        chip: 0,
        hitstun: 19,
        blockstun: 13,
        push: 1350,
        hitstop: 8,
        meter: 9,
        box: { x: 10, y: 52, w: 115, h: 26 },
        cancel: ["S", "X"],
      },
      J: {
        // 공중 채찍: 앞쪽 아래로 길게 휘둘러 공중에서도 리치로 견제 (뛰어드는 상대·아래 발판 상대)
        startup: 6,
        active: 9,
        recovery: 8,
        dmg: 58,
        chip: 0,
        hitstun: 18,
        blockstun: 10,
        push: 1000,
        hitstop: 6,
        meter: 6,
        box: { x: 0, y: 60, w: 96, h: 56 },
      },
      K: {
        startup: 8,
        active: 8,
        recovery: 12,
        dmg: 78,
        chip: 0,
        hitstun: 18,
        blockstun: 12,
        push: 1200,
        hitstop: 7,
        meter: 7,
        box: { x: 0, y: 40, w: 80, h: 40 },
      },
      S: {
        // 아이덴티티 「지도편달」: 아주 긴 채찍으로 끌어당김
        startup: 12,
        active: 4,
        recovery: 24,
        dmg: 55, // 45→55
        chip: 6,
        hitstun: 34,
        blockstun: 12,
        push: 1300,
        hitstop: 8,
        meter: 7,
        box: { x: 20, y: 50, w: 170, h: 18 },
        pull: true,
        // 끌어당긴 뒤 약·잡기·필살기로 바로 이어짐 (확정) — 잡기로 띄워 공중 콤보도 가능
        cancel: ["L", "T", "X"],
        // 공중에서 쓰면 「지도편달·하」: 공중에 잠깐 멈춰 바로 아래부터 앞쪽 사선 아래까지 채찍을 휩쓸어 내리침
        // (발밑~앞 약 130px, 아래 약 75px) — 맞으면 내 높이까지 띄우며 앞으로 끌어옴 → 바로 공중 콤보
        air: {
          startup: 9,
          active: 6,
          recovery: 14,
          dmg: 52,
          hitstun: 34,
          push: 0,
          hitstop: 9,
          box: { x: -24, y: 4, w: 155, h: 82 }, // 그림: 바로 아래 약 75px · 앞쪽 사선 끝 약 130px
          pull: true,
          pullUp: true,
          cancel: undefined,
          hover: 380,
        },
      },
      X: {
        // 필살기 「보충수업」: 앞뒤 넓게 6연타
        startup: 8,
        active: 36,
        recovery: 24,
        dmg: 40,
        chip: 8,
        hitstun: 18,
        blockstun: 12,
        push: 200,
        hitstop: 2,
        meter: 0,
        box: { x: -80, y: 80, w: 170, h: 80 },
        kd: true,
        multi: 6,
      },
    },
  },
  {
    // 기동형(함정): 작고 가볍고 공중에서 오래 떠 있어 맞히기 어려운 대신 체력이 낮고 한 대가 약함
    id: "lily",
    name: "릴리",
    title: "유치원생 · 우산과 물",
    desc: "우산으로 둥실 떠다니며 물방울을 띄우는 꼬마. 작아서 잘 안 맞음",
    hp: 1170,
    walk: 1120,
    jumpVx: 1050,
    dash: 2500,
    cd: 92,
    glide: 520,
    hurt: { x: -8, y: 50, w: 16, h: 50 },
    width: 16,
    color: "#5EC8FF",
    quote: "비… 많이 오네~ 우산 같이 쓸까?!",
    winQuote: "헤헤~ 내가 이겼다! 우산 빌려줄까?",
    tagline: "KINDERGARTEN GIRL",
    difficulty: 2,
    stats: { atk: 2, reach: 3, move: 3, control: 5, combo: 3, hp: 2 },
    idName: "비눗방울",
    idDesc: "느리고 오래 가는 큰 비눗방울로 길목을 막음 — 맞으면 갇혀서 둥실 떠오름 (때리면 터짐, 연타로 탈출, 갇힌 상대는 방울로 다시 못 가둠)",
    ultName: "장마 파도",
    ultDesc: "바닥을 휩쓰는 큰 파도가 지나가며 5번 때림",
    airDesc: "점프를 누르고 있으면 우산으로 천천히 활강",
    airLabel: "점프 홀딩",
    moves: {
      L: {
        startup: 4,
        active: 3,
        recovery: 6,
        dmg: 37,
        chip: 0,
        hitstun: 13,
        blockstun: 8,
        push: 640,
        hitstop: 4,
        meter: 5,
        box: { x: 4, y: 44, w: 40, h: 22 },
        cancel: ["H", "S", "X"],
      },
      H: {
        startup: 8,
        active: 5,
        recovery: 16,
        dmg: 86,
        chip: 0,
        hitstun: 19,
        blockstun: 13,
        push: 1050,
        hitstop: 8,
        meter: 9,
        box: { x: 0, y: 62, w: 56, h: 52 },
        cancel: ["S", "X"],
      },
      J: {
        startup: 4,
        active: 9,
        recovery: 6,
        dmg: 48,
        chip: 0,
        hitstun: 15,
        blockstun: 10,
        push: 560,
        hitstop: 5,
        meter: 5,
        box: { x: -10, y: 50, w: 58, h: 44 },
      },
      K: {
        startup: 6,
        active: 8,
        recovery: 10,
        dmg: 82,
        chip: 0,
        hitstun: 18,
        blockstun: 12,
        push: 1100,
        hitstop: 7,
        meter: 7,
        box: { x: -6, y: 44, w: 60, h: 44 },
        lunge: 1500,
      },
      S: {
        // 아이덴티티 「비눗방울」: 느리고 오래 가는 함정 탄
        startup: 10,
        active: 1,
        recovery: 14,
        dmg: 55,
        chip: 10,
        hitstun: 34,
        blockstun: 14,
        push: 500,
        hitstop: 8,
        meter: 7,
        box: { x: 0, y: 0, w: 0, h: 0 },
        proj: { speed: 520, y: 40, w: 34, h: 34, life: 230, flat: true },
        // 갇힌 상대를 다른 방울이 맞히면 터지기만 하고 다시 가두지 않음 (방울로 계속 가두기 막음)
        trap: 55,
      },
      X: {
        // 필살기 「장마 파도」: 바닥을 따라가는 큰 파도 5연타
        startup: 10,
        active: 1,
        recovery: 28,
        dmg: 52,
        chip: 10,
        hitstun: 20,
        blockstun: 12,
        push: 600,
        hitstop: 3,
        meter: 0,
        box: { x: 0, y: 0, w: 0, h: 0 },
        kd: true,
        proj: { speed: 900, y: 34, w: 80, h: 70, life: 120, hits: 5, every: 8, flat: true },
      },
    },
  },
  {
    // 중거리 창술: 리치는 카이·이그나보다 길고 소영보다 짧음. 아이덴티티로 띄워 놓고 이어 치는 콤보형
    id: "zena",
    name: "제나",
    title: "창술 · 번개",
    desc: "번개 두른 창으로 중거리를 지배하는 장난꾸러기",
    hp: 1140,
    walk: 1120,
    jumpVx: 1000,
    dash: 2600,
    cd: 130,
    hurt: { x: -9, y: 58, w: 18, h: 58 },
    width: 18,
    color: "#FFD43B",
    quote: "찌릿찌릿~ 감전 조심하라구!",
    winQuote: "찌릿했지? 다음엔 피뢰침 챙겨 와~",
    tagline: "THUNDER LANCER",
    difficulty: 2,
    stats: { atk: 5, reach: 4, move: 3, control: 3, combo: 3, hp: 2 },
    idName: "뇌창",
    idDesc: "번개 창을 아주 빠르게 던짐. 맞으면 감전 — 잠깐 몸이 굳고, 한동안 느려지며 제나의 공격에 더 아프게 맞음",
    ultName: "천뢰강림",
    ultDesc: "상대 발밑에 번개가 3번 내리꽂힘 — 감전 중인 상대는 도망쳐도 따라감",
    airDesc: "뇌창을 앞쪽 아래로 비스듬히 던짐 — 아래 발판의 상대를 노림",
    moves: {
      L: {
        startup: 5,
        active: 3,
        recovery: 9,
        dmg: 38,
        chip: 0,
        hitstun: 13,
        blockstun: 8,
        push: 640,
        hitstop: 4,
        meter: 5,
        box: { x: 6, y: 46, w: 64, h: 16 }, // 창끝까지 (그림에 맞춤)
        cancel: ["H", "S", "X"],
      },
      H: {
        startup: 11,
        active: 4,
        recovery: 23,
        dmg: 66,
        chip: 0,
        hitstun: 19,
        blockstun: 13,
        push: 1150,
        hitstop: 8,
        meter: 9,
        box: { x: 4, y: 56, w: 80, h: 26 },
        cancel: ["S", "X"],
      },
      J: {
        startup: 5,
        active: 8,
        recovery: 7,
        dmg: 52,
        chip: 0,
        hitstun: 15,
        blockstun: 10,
        push: 700,
        hitstop: 5,
        meter: 5,
        box: { x: -10, y: 50, w: 92, h: 36 },
      },
      K: {
        startup: 7,
        active: 8,
        recovery: 11,
        dmg: 80,
        chip: 0,
        hitstun: 18,
        blockstun: 12,
        push: 1150,
        hitstop: 7,
        meter: 7,
        box: { x: 0, y: 44, w: 85, h: 30 },
        lunge: 1400,
      },
      S: {
        // 아이덴티티 「뇌창」: 아주 빠른 창 던지기, 맞으면 오래 감전
        startup: 11,
        active: 1,
        recovery: 16,
        dmg: 70,
        chip: 12,
        hitstun: 38,
        blockstun: 14,
        push: 500,
        hitstop: 9,
        meter: 7,
        box: { x: 0, y: 0, w: 0, h: 0 },
        proj: { speed: 2600, y: 38, w: 40, h: 14, life: 70 },
        shock: 110,
      },
      X: {
        // 필살기 「천뢰강림」: 상대 발밑에 번개 창 3연타
        startup: 10,
        active: 1,
        recovery: 28,
        dmg: 70,
        chip: 14,
        hitstun: 26,
        blockstun: 14,
        push: 400,
        hitstop: 6,
        meter: 0,
        box: { x: 0, y: 0, w: 0, h: 0 },
        kd: true,
        summon: { w: 48, h: 160, delay: 16, life: 36, every: 12, track: true },
        shock: 90,
      },
    },
  },
  {
    id: "gunmo",
    name: "건모",
    title: "디버거 · 코딩",
    desc: "넓은 선택 박스로 묶고 크게 콤보를 넣는 개발자. 헛치면 빈틈이 커요",
    hp: 1250,
    walk: 1120,
    jumpVx: 1000,
    dash: 2550,
    cd: 180,
    hurt: { x: -8, y: 58, w: 16, h: 58 },
    width: 17,
    color: "#3B9CFF",
    quote: "집가고싶다..",
    winQuote: "ㅇㅋ 끝. 이제 집간다",
    tagline: "FULLSTACK DEBUGGER",
    difficulty: 3,
    stats: { atk: 2, reach: 3, move: 2, control: 5, combo: 5, hp: 4 },
    idName: "Ctrl+A",
    idDesc: "넓은 파란 선택 박스를 펼쳐, 맞은 상대를 ⏸ 일시정지 (1초 동안 꼼짝 못 함)",
    ultName: "금요일 배포",
    ultDesc: "앞쪽 넓게 에러 블록이 빗발쳐 5연타, 마지막 타에 넘어뜨림",
    airLabel: "공중 L Alt+Tab",
    airDesc: "앞에 큰 창을 띄워 맞히면 상대와 자리를 바꾸고 💫 혼란 — 건모는 잠깐 공중에 멈춰 바로 이어 침",
    moves: {
      L: {
        // 약 (J): 허공 타자 연타, 4단째 엔터키 올려치기 (띄우기)
        startup: 3,
        active: 3,
        recovery: 6,
        dmg: 40,
        chip: 0,
        hitstun: 14,
        blockstun: 9,
        push: 560,
        hitstop: 5,
        meter: 5,
        box: { x: 4, y: 46, w: 42, h: 18 },
        cancel: ["H", "S", "X"],
        launcher: true,
      },
      H: {
        // 발차기 (K): 키보드 가로 휘두르기 → 내려찍기
        startup: 10,
        active: 4,
        recovery: 19,
        dmg: 96,
        chip: 0,
        hitstun: 20,
        blockstun: 14,
        push: 1150,
        hitstop: 9,
        meter: 9,
        box: { x: 4, y: 60, w: 62, h: 34 },
        cancel: ["S", "X"],
        step: 200,
      },
      J: {
        // 공중 약: 노트북 펼쳐 치기
        startup: 5,
        active: 7,
        recovery: 7,
        dmg: 58,
        chip: 0,
        hitstun: 16,
        blockstun: 10,
        push: 600,
        hitstop: 6,
        meter: 5,
        box: { x: 2, y: 44, w: 52, h: 28 },
      },
      K: {
        // 공중 발차기: 키보드 앞쪽 아래로 내려찍기
        startup: 7,
        active: 7,
        recovery: 11,
        dmg: 88,
        chip: 0,
        hitstun: 20,
        blockstun: 12,
        push: 1200,
        hitstop: 8,
        meter: 8,
        box: { x: 0, y: 34, w: 58, h: 36 },
        lunge: 1800,
      },
      S: {
        // 아이덴티티 「Ctrl+A」: 넓은 선택 박스 — 피해는 작고, 맞으면 ⏸ 일시정지(긴 경직) → 약·잡기·필살기로 확정 콤보
        startup: 9,
        active: 4,
        recovery: 22,
        dmg: 22,
        chip: 0,
        hitstun: 60, // ⏸ 일시정지 1초 (끌어오기는 소영과 겹쳐서 빼고 50→60)
        blockstun: 10,
        push: 200,
        hitstop: 8,
        meter: 6,
        // 넓게: 앞 120px · 위로는 점프한 상대까지 (예전엔 92px까지라 뛰는 상대를 못 잡음)
        box: { x: 0, y: 160, w: 120, h: 168 },
        onBlock: -12,
        pause: true,
        cancel: ["L", "T", "X"],
        // 공중 「Alt+Tab」: 앞에 창 — 맞으면 자리 바꾸고 💫 혼란(둥실 멈춤) → 넘어뜨림
        // 맞히면 둘 다 공중에 잠깐 떠 있어서(혼란 동안 때린 쪽도 천천히 떨어짐) 공중 약·발차기로 이어 침
        air: {
          startup: 6,
          active: 6,
          recovery: 12,
          dmg: 10,
          hitstun: 46,
          push: 0,
          hitstop: 10,
          // 발 위 64px ~ 발 아래 56px (전엔 아래 96px까지라 너무 넓었음 — 10.06 아래쪽 줄임)
          box: { x: -4, y: 64, w: 90, h: 120 },
          pause: false,
          swap: true,
          cancel: undefined,
          hover: 300,
        },
      },
      X: {
        // 필살기 「금요일 배포」: 내 앞 넓은 범위에 에러 블록이 빗발침 (5연타, 마지막 타 다운)
        startup: 10,
        active: 1,
        recovery: 30,
        dmg: 34,
        chip: 6,
        hitstun: 20,
        blockstun: 14,
        push: 300,
        hitstop: 4,
        meter: 0,
        box: { x: 0, y: 0, w: 0, h: 0 },
        kd: true,
        summon: { w: 180, h: 160, delay: 18, life: 40, every: 8, front: 110 },
      },
    },
  },
];

/**
 * 막혔을 때 기본 프레임 이득 — 격투게임 공식:
 *   약은 거의 0(막혀도 안전, 계속 압박), 발차기는 조금 손해, 아이덴티티는 크게 손해(막히면 반격당함),
 *   필살기는 막히면 확정 반격. 약 4단·발차기 2단의 마지막 동작은 sim.ts에서 빈틈이 더 붙음.
 */
const ON_BLOCK: Record<MoveId, number> = { L: -1, H: -4, J: 0, K: -2, S: -8, X: -16, T: 0, G: -10 };

/** 잡기(띄우기): 가드 불가, 사거리 짧음. 잡히는 순간 약+발차기로 풀 수 있고, 못 풀면 위로 띄워져 공중 콤보 시작 */
const THROW: MoveDef = {
  startup: 5,
  active: 3,
  recovery: 14,
  dmg: 60,
  chip: 0,
  hitstun: 30,
  blockstun: 0,
  push: 0,
  hitstop: 10,
  meter: 8,
  box: { x: 0, y: 56, w: 38, h: 44 },
};
/** 가드 반격: 막은 직후 발차기 → 게이지 25를 써서 상대를 위로 띄움 (시작 동안 무적, 점프 캔슬 → 공중 콤보) */
const GUARD_COUNTER: MoveDef = {
  startup: 4,
  active: 4,
  recovery: 20,
  dmg: 40,
  chip: 0,
  hitstun: 22,
  blockstun: 10,
  push: 300,
  hitstop: 8,
  meter: 0,
  box: { x: -6, y: 64, w: 62, h: 64 },
};
export const GUARD_COUNTER_COST = 25;
/**
 * 기본기(약·발차기·공중 약·공중 발차기)도 막으면 피해의 이만큼(%)은 깎임 — 가드에 비용을 둠.
 * (잡기를 풀면 피해가 안 들어가게 되면서, 깎임이 없으면 ↓만 누르고 잡기만 푸는 쪽이 거의 안 죽음. 저스트 가드면 안 깎임)
 */
const NORMAL_CHIP = 15;

function normalize(c: CharSrc): CharDef {
  const moves = { ...c.moves, T: { ...THROW }, G: { ...GUARD_COUNTER } } as Record<MoveId, MoveDef>;
  for (const id of ["L", "H", "J", "K"] as const) {
    const m = (moves[id] = { ...moves[id] });
    m.chip = Math.max(m.chip, Math.round((m.dmg * NORMAL_CHIP) / 100));
  }
  for (const id of Object.keys(moves) as MoveId[]) {
    const m = moves[id];
    if (m.proj || m.summon || id === "T") continue;
    const adv = m.onBlock ?? ON_BLOCK[id];
    // 첫 판정 프레임에 막혔다고 보고: 막은 쪽 경직 = 때린 쪽 남은 동작 + 이득
    m.blockstun = Math.max(2, m.active - 1 + m.recovery + adv);
  }
  return { ...c, moves };
}

export const CHARS: CharDef[] = RAW.map(normalize);

export const charIndex = (id: string) =>
  Math.max(
    0,
    CHARS.findIndex((c) => c.id === id)
  );
