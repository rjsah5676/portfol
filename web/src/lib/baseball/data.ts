/**
 * 선수 · 팀 · 마선수(픽셀파이트 캐릭터) 데이터.
 *
 * 능력치는 0 ~ 1000 (게임빌 프로야구처럼 일반 선수 300~650, 마선수 700~950).
 *   타자: hit(타격 · 타이밍 창) · power(타구 속도) · run(주루) — 수비 능력치는 없음 (수비수는 모두 같은 실력)
 *   투수: control(제구) · velo(직구 최고 구속 km/h) · brk(변화) · stamina(체력 → 던질 수 있는 공 수)
 */
import type { PitchKind } from "./pitch";

export type CharId = "kai" | "igna" | "soyoung" | "lily" | "zena" | "gunmo" | "ivan" | "violet" | "mei";

export interface SpecialChar {
  id: CharId;
  name: string;
  color: string;
  /** 마구 */
  ball: { name: string; hint: string };
  /** 필살타법 */
  swing: { name: string; desc: string };
  bats: "R" | "L";
  throws: "R" | "L";
  bat: { hit: number; power: number; run: number };
  pit: { control: number; velo: number; brk: number; stamina: number; rep: PitchKind[] };
}

/** 픽셀파이트 캐릭터 — 인연 대결에서 마구를 던지고, 인연 보상으로 필살타법을 전수 */
export const CHARS: SpecialChar[] = [
  {
    id: "kai",
    name: "카이",
    color: "#9EC8FF",
    ball: { name: "질풍구", hint: "바람이 걷히는 순간 이미 와 있다 — 그냥 빠른 공" },
    swing: { name: "질풍 스윙", desc: "총알 같은 직선 타구 · 수비가 반응을 못 함" },
    bats: "R",
    throws: "R",
    bat: { hit: 820, power: 760, run: 880 },
    pit: { control: 700, velo: 158, brk: 650, stamina: 380, rep: ["FB", "SL", "CT", "FK"] },
  },
  {
    id: "igna",
    name: "이그나",
    color: "#FF6A2A",
    ball: { name: "업화구", hint: "불꽃 셋 중 연기 꼬리가 진짜 · 멈칫한 뒤 달려듦" },
    swing: { name: "업화 스윙", desc: "불타는 타구 — 처음 잡으려는 수비는 화상으로 놓침" },
    bats: "L",
    throws: "R",
    bat: { hit: 720, power: 900, run: 650 },
    pit: { control: 760, velo: 154, brk: 880, stamina: 360, rep: ["FB", "SL", "CB", "CH"] },
  },
  {
    id: "soyoung",
    name: "소영",
    color: "#FF5FB4",
    ball: { name: "채찍 루프", hint: "한 바퀴 휘감고 튕겨 나옴 — 원이 닫히는 순간을 세기" },
    swing: { name: "채찍 스윙", desc: "어디로 온 공이든 닿음 (볼도 침) · 이상적인 각도" },
    bats: "R",
    throws: "R",
    bat: { hit: 900, power: 640, run: 700 },
    pit: { control: 880, velo: 146, brk: 900, stamina: 330, rep: ["FB", "CB", "CH", "SK"] },
  },
  {
    id: "lily",
    name: "릴리",
    color: "#5EC8FF",
    ball: { name: "버블 볼", hint: "둥실 둥실… 퐁! 터지는 소리 바로 뒤에 휘두르기" },
    swing: { name: "우산 스윙", desc: "타구가 우산처럼 둥실 — 오래 떠서 멀리 감" },
    bats: "L",
    throws: "L",
    bat: { hit: 760, power: 600, run: 820 },
    pit: { control: 820, velo: 138, brk: 860, stamina: 300, rep: ["FB", "CB", "CH", "FK"] },
  },
  {
    id: "zena",
    name: "제나",
    color: "#FFD43B",
    ball: { name: "번개 창", hint: "좌우로 번쩍번쩍 — 아래에서 솟아오를 때 친다" },
    swing: { name: "번개 스윙", desc: "번개가 떨어져 수비 전원 감전 (2초간 느려짐)" },
    bats: "R",
    throws: "L",
    bat: { hit: 800, power: 780, run: 860 },
    pit: { control: 780, velo: 152, brk: 900, stamina: 350, rep: ["FB", "SL", "FK", "CT"] },
  },
  {
    id: "gunmo",
    name: "건모",
    color: "#3B9CFF",
    ball: { name: "디버그 볼", hint: "공이 사라짐 — 위쪽 버퍼링 바가 100%가 되는 순간" },
    swing: { name: "Ctrl+A 스윙", desc: "선택 박스로 수비 전원 일시정지 (1.5초)" },
    bats: "L",
    throws: "R",
    bat: { hit: 780, power: 700, run: 600 },
    pit: { control: 900, velo: 148, brk: 760, stamina: 340, rep: ["FB", "CH", "CT", "SK"] },
  },
  {
    id: "ivan",
    name: "이반",
    color: "#D7263D",
    ball: { name: "철곰 강속구", hint: "손에서 기를 모으다 번쩍 — 190km 직구, 빛나는 순간 바로" },
    swing: { name: "철곰 스윙", desc: "제대로 맞으면 무조건 담장 너머" },
    bats: "R",
    throws: "R",
    bat: { hit: 640, power: 980, run: 480 },
    pit: { control: 640, velo: 165, brk: 600, stamina: 420, rep: ["FB", "SL", "FK", "SK"] },
  },
  {
    id: "violet",
    name: "바이올렛",
    color: "#B58CFF",
    ball: { name: "후프 통과구", hint: "빙글 도는 후프를 통과하면 반대쪽으로 꺾여 들어와요 — 들어오던 쪽 말고 반대편" },
    swing: { name: "피루엣 스윙", desc: "한 바퀴 돌며 박자를 다시 맞춤 — 타이밍 오차가 절반 · 라이너" },
    bats: "L",
    throws: "L",
    bat: { hit: 820, power: 600, run: 900 },
    pit: { control: 820, velo: 141, brk: 900, stamina: 300, rep: ["FB", "CB", "CH", "SL"] },
  },
  {
    id: "mei",
    name: "메이",
    color: "#2FD6A0",
    ball: { name: "만두 분신구", hint: "만두 셋이 빙글빙글 — 하나로 합쳐지며 김이 퐁! 피어오른 직후" },
    swing: { name: "태극 스윙", desc: "S자로 휘는 라이너 — 수비 사이 빈틈으로 쏙" },
    bats: "L",
    throws: "R",
    bat: { hit: 860, power: 640, run: 820 },
    pit: { control: 860, velo: 140, brk: 880, stamina: 330, rep: ["FB", "CB", "CH", "SL"] },
  },
];

export const charById = (id: CharId) => CHARS.find((c) => c.id === id)!;

/** 야구 전용 그림이 생긴 캐릭터 (public/baseball/char/<id>.webp · <id>-face.webp) — 나머지는 격투게임 그림 재사용 */
const BB_ART = new Set<string>(["kai", "igna", "soyoung", "lily", "zena", "ivan", "mei", "violet"]);
/** 야구 전용 컷인 띠 (public/baseball/char/<id>-cutin.webp, 1200×500) */
const BB_CUTIN = new Set<string>(["violet"]);
export const artUrl = (id: string) => (BB_ART.has(id) ? `/baseball/char/${id}.webp` : `/fight/art/${id}.webp`);
export const faceUrl = (id: string) => (BB_ART.has(id) ? `/baseball/char/${id}-face.webp` : `/fight/art/${id}-face.webp`);
export const cutinUrl = (id: CharId) => (BB_CUTIN.has(id) ? `/baseball/char/${id}-cutin.webp` : `/fight/cutin/${id}.webp`);

export interface Batter {
  name: string;
  num: number;
  pos: string;
  bats: "R" | "L";
  hit: number;
  power: number;
  run: number;
  special?: CharId;
  /** 육성 선수가 픽셀파이트 캐릭터에게 배운 필살타법 (겉모습은 그대로, 필살만) */
  learned?: CharId;
  /** 상황 특수능력 (육성): 득점권 타격 · 파워, 2스트라이크 타격 */
  sit?: { rispHit?: number; rispPow?: number; twoK?: number; late?: number };
  /** 육성 선수 외형 (헤어 · 얼굴 · 피부 · 배트 · 유니폼) */
  look?: { hair: number; face: number; skin: number; bat: number; uni: number };
  /** 육성 선수: 다 같이 낮은 능력치에서 시작하니 경기에선 편차를 줄여 씀 (playStat) */
  grow?: boolean;
  /** 이번 시즌 기록 (육성 선수는 진짜 기록 — 없으면 seasonOf 가 능력치로 만들어 냄) */
  season?: SeasonLine;
  /** 경기 능력치를 올려 주는 특수능력 (육성) — 타석에 들어설 때 보여 줌. add 는 이미 hit · power · run 에 들어가 있음 */
  boosts?: Boost[];
}

export interface Boost {
  name: string;
  add?: { hit?: number; power?: number; run?: number };
  sit?: { rispHit?: number; rispPow?: number; twoK?: number; late?: number };
}

export interface SeasonLine {
  avg: number;
  hr: number;
  rbi: number;
  /** 타수 · 안타 (있으면 경기 중 오늘 기록을 더해 타율을 다시 냄) */
  ab?: number;
  h?: number;
}
/**
 * 타석 화면 「시즌 기록」: 육성 선수는 진짜 시즌 기록, 그 밖의 선수(구단 카드 · 상대 팀)는 아직 시즌 기록을 안 쌓아서
 * 능력치 + 이름으로 늘 같은 값을 만들어 보여 줌 (타격 → 타율, 파워 → 홈런, 둘 다 → 타점)
 */
export function seasonOf(b: Batter): SeasonLine {
  if (b.season) return b.season;
  let h = 7;
  for (const ch of b.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const j = (k: number) => (((h >>> k) & 1023) / 1023 - 0.5) * 2;
  const avg = Math.max(0.18, Math.min(0.39, 0.205 + (b.hit / 1000) * 0.13 + j(0) * 0.018));
  const hr = Math.max(0, Math.round(Math.pow(b.power / 1000, 2) * 42 + j(10) * 3));
  const rbi = Math.max(hr, Math.round(hr * 2.3 + avg * 140 + j(20) * 8));
  const ab = 220 + Math.round((j(5) + 1) * 110);
  return { avg, hr, rbi, ab, h: Math.round(avg * ab) };
}

/**
 * 경기에 쓰는 타자 능력치. 육성 선수도 능력치 그대로 (덤 없음) — 대신 육성 상대 투수가 연차마다 세짐 (careerGame PITCH_LV).
 * 예전: 220 + 0.65 × 능력치 (150 → 318 · 400 → 480 · 999 → 869) — 상대 투수가 처음부터 560 이라 덤을 크게 줬었는데, 400 만 돼도 컨택존이 꽉 찼음
 * GROW 는 시뮬(baseball-career-sim GROW=...)로 덤을 다시 시험할 때만: v → base + k × v (base 0 · k 1 = 그대로)
 */
export const GROW = { base: 0, k: 1 };
export const playStat = (b: { grow?: boolean }, v: number) => (b.grow ? Math.round(GROW.base + v * GROW.k) : v);

/** 필살타법을 쓸 수 있으면 그 캐릭터 (마타자 · 배운 선수) */
export const swingOf = (b: Batter): CharId | undefined => b.special ?? b.learned;

export interface Pitcher {
  name: string;
  num: number;
  role: "SP" | "RP" | "CL";
  throws: "R" | "L";
  control: number;
  velo: number;
  brk: number;
  stamina: number;
  rep: PitchKind[];
  special?: CharId;
}

export interface Team {
  id: string;
  name: string;
  short: string;
  color: string;
  dark: string;
  batters: Batter[];
  pitchers: Pitcher[];
}

export const FAMILY = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍"];
export const GIVEN = [
  "도윤", "서준", "하준", "민재", "지호", "준우", "현우", "건우", "우진", "시우", "태윤", "승민",
  "재원", "동현", "성훈", "영호", "진혁", "상철", "대호", "병규", "용택", "광수", "치국", "민철",
];

const POS = ["CF", "2B", "RF", "1B", "3B", "LF", "C", "SS", "DH"];

export interface TeamDef {
  id: string;
  name: string;
  short: string;
  color: string;
  dark: string;
  /** 팀 성향: 타격 · 투수 보정 */
  bat: number;
  pit: number;
}

export const TEAM_DEFS: TeamDef[] = [
  { id: "px", name: "픽셀 파이터즈", short: "PXF", color: "#FF8A3D", dark: "#5a2a0c", bat: 0, pit: 0 },
  { id: "gl", name: "글리치 몬스터즈", short: "GLM", color: "#B26BFF", dark: "#2f1650", bat: 20, pit: -10 },
  { id: "bg", name: "버그 바이퍼스", short: "BGV", color: "#3DDC84", dark: "#0f3f25", bat: -10, pit: 25 },
  { id: "lg", name: "렉 드래곤즈", short: "LAG", color: "#FF4D6D", dark: "#4a0f1c", bat: 10, pit: 10 },
];

/** 구단 (구단 관리 · 온라인 대전) — 첫 방문에 하나 골라 내 구단으로. 엠블럼은 그림 없이 CSS 도형 + 이니셜 */
export interface ClubDef extends TeamDef {
  /** 엠블럼 도형 · 이니셜 */
  shape: "circle" | "shield" | "diamond" | "hex" | "square";
  mono: string;
  /** 한 줄 소개 */
  flavor: string;
}

export const CLUB_DEFS: ClubDef[] = [
  { id: "c_meteor", name: "한강 메테오스", short: "HMT", color: "#4C8DFF", dark: "#10234d", bat: 0, pit: 0, shape: "circle", mono: "HM", flavor: "한강 위로 떨어지는 유성처럼 — 한 방에 끝낸다" },
  { id: "c_kraken", name: "남해 크라켄즈", short: "NKR", color: "#E8455A", dark: "#4a0f1a", bat: 0, pit: 0, shape: "shield", mono: "NK", flavor: "깊은 바다에서 올라온 끈질긴 촉수 야구" },
  { id: "c_mammoth", name: "백두 매머드즈", short: "BDM", color: "#8AB4D8", dark: "#1d3347", bat: 0, pit: 0, shape: "hex", mono: "BM", flavor: "눈보라도 못 막는 육중한 중심 타선" },
  { id: "c_comet", name: "은하 코메츠", short: "EHC", color: "#9B7BFF", dark: "#25184d", bat: 0, pit: 0, shape: "diamond", mono: "EC", flavor: "꼬리가 긴 변화구 — 별똥별 마운드" },
  { id: "c_robot", name: "강철 로보츠", short: "GCR", color: "#B8C2D6", dark: "#2a2f3a", bat: 0, pit: 0, shape: "square", mono: "GR", flavor: "오차 0mm, 기계처럼 정확한 수비" },
  { id: "c_phoenix", name: "노을 피닉스", short: "NUP", color: "#FF7A2F", dark: "#4d1d08", bat: 0, pit: 0, shape: "shield", mono: "NP", flavor: "지고 있어도 9회에 다시 타오른다" },
  { id: "c_hwarang", name: "서라벌 화랑즈", short: "SHR", color: "#E0B13A", dark: "#45340a", bat: 0, pit: 0, shape: "circle", mono: "SH", flavor: "천 년 고도의 품격 — 예의 바른 강속구" },
  { id: "c_wind", name: "제주 윈드러너즈", short: "JWR", color: "#33D6C0", dark: "#0b3d37", bat: 0, pit: 0, shape: "diamond", mono: "JW", flavor: "바람을 타고 달린다 — 리그 최고의 발" },
  { id: "c_wolf", name: "달빛 울프팩", short: "DWP", color: "#6B7BFF", dark: "#161a4a", bat: 0, pit: 0, shape: "hex", mono: "DW", flavor: "밤 경기만 되면 무리 지어 몰아친다" },
  { id: "c_dokkaebi", name: "도깨비 방망이즈", short: "DKB", color: "#46D97A", dark: "#0f3d22", bat: 0, pit: 0, shape: "square", mono: "DK", flavor: "뚝딱 치면 안타 나와라 — 장난꾸러기 타선" },
];
export const clubDefById = (id: string) => CLUB_DEFS.find((d) => d.id === id) ?? CLUB_DEFS[0];

/** 이름 · 능력치가 들어간 팀 만들기 (시드가 같으면 같은 팀) */
export function makeTeam(def: TeamDef, rng: () => number, sp?: { bat: CharId; pit: CharId }): Team {
  const used = new Set<string>();
  const name = () => {
    for (;;) {
      const n = FAMILY[Math.floor(rng() * FAMILY.length)] + GIVEN[Math.floor(rng() * GIVEN.length)];
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
  };
  const st = (base: number, spread: number) => Math.round(base + (rng() - 0.5) * 2 * spread);
  const nums = new Set<number>();
  const num = () => {
    for (;;) {
      const n = 1 + Math.floor(rng() * 70);
      if (!nums.has(n)) {
        nums.add(n);
        return n;
      }
    }
  };
  // 타순 성향: 1·2번 타격 · 발, 3~5번 힘, 하위 타순 약함
  const shape = [
    { hit: 560, power: 380, run: 640 },
    { hit: 540, power: 420, run: 560 },
    { hit: 580, power: 560, run: 460 },
    { hit: 540, power: 640, run: 380 },
    { hit: 520, power: 580, run: 420 },
    { hit: 500, power: 480, run: 480 },
    { hit: 460, power: 420, run: 420 },
    { hit: 450, power: 380, run: 520 },
    { hit: 440, power: 360, run: 460 },
  ];
  const batters: Batter[] = shape.map((s, i) => ({
    name: name(),
    num: num(),
    pos: POS[i],
    bats: rng() < 0.35 ? "L" : "R",
    hit: st(s.hit + def.bat, 50),
    power: st(s.power + def.bat, 60),
    run: st(s.run, 60),
  }));
  // 마타자는 4번 (sp 를 줄 때만 — 지금 경기엔 마선수 없음, 캐릭터는 인연 대결에서만)
  if (sp) {
    const sb = charById(sp.bat);
    batters[3] = { name: sb.name, num: num(), pos: "마", bats: sb.bats, ...sb.bat, special: sb.id };
  }
  const reps: Pitcher["rep"][] = [
    ["FB", "SL", "CB", "CH"],
    ["FB", "SK", "SL", "FK"],
    ["FB", "CT", "CB", "CH"],
    ["FB", "SL", "FK"],
  ];
  const pitchers: Pitcher[] = [
    {
      name: name(), num: num(), role: "SP", throws: rng() < 0.3 ? "L" : "R",
      control: st(560 + def.pit, 50), velo: st(146, 3), brk: st(560 + def.pit, 60), stamina: st(720, 60),
      rep: reps[Math.floor(rng() * reps.length)],
    },
    {
      name: name(), num: num(), role: "RP", throws: rng() < 0.4 ? "L" : "R",
      control: st(520 + def.pit, 50), velo: st(148, 3), brk: st(520 + def.pit, 60), stamina: st(380, 40),
      rep: reps[Math.floor(rng() * reps.length)],
    },
    {
      name: name(), num: num(), role: "RP", throws: rng() < 0.4 ? "L" : "R",
      control: st(500 + def.pit, 50), velo: st(145, 3), brk: st(540 + def.pit, 60), stamina: st(360, 40),
      rep: reps[Math.floor(rng() * reps.length)],
    },
    sp
      ? { name: charById(sp.pit).name, num: num(), role: "CL", throws: charById(sp.pit).throws, ...charById(sp.pit).pit, special: sp.pit }
      : {
          name: name(), num: num(), role: "CL", throws: rng() < 0.3 ? "L" : "R",
          control: st(560 + def.pit, 50), velo: st(151, 3), brk: st(600 + def.pit, 60), stamina: st(300, 30),
          rep: reps[Math.floor(rng() * reps.length)],
        },
  ];
  return { id: def.id, name: def.name, short: def.short, color: def.color, dark: def.dark, batters, pitchers };
}

/** 배팅볼 투수 (홈런더비) */
export const BP_PITCHER: Pitcher = {
  name: "배팅볼 아저씨", num: 99, role: "SP", throws: "R",
  control: 800, velo: 128, brk: 300, stamina: 999, rep: ["FB"],
};
