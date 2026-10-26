/**
 * 선수 · 팀 · 마선수(픽셀파이트 캐릭터) 데이터.
 *
 * 능력치는 0 ~ 1000 (게임빌 프로야구처럼 일반 선수 300~650, 마선수 700~950).
 *   타자: hit(맞히기 · 타이밍 창) · power(타구 속도) · run(주루) · def(수비 · 송구)
 *   투수: control(제구) · velo(직구 최고 구속 km/h) · brk(변화) · stamina(체력 → 던질 수 있는 공 수)
 */
import type { PitchKind } from "./pitch";

export type CharId = "kai" | "igna" | "soyoung" | "lily" | "zena" | "gunmo" | "ivan" | "forte" | "mei";

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
  bat: { hit: number; power: number; run: number; def: number };
  pit: { control: number; velo: number; brk: number; stamina: number; rep: PitchKind[] };
}

/** 픽셀파이트 8명 — 마투수로 쓰면 마구, 마타자로 쓰면 필살타법 */
export const CHARS: SpecialChar[] = [
  {
    id: "kai",
    name: "카이",
    color: "#9EC8FF",
    ball: { name: "질풍구", hint: "바람이 걷히는 순간 이미 와 있다 — 그냥 빠른 공" },
    swing: { name: "질풍 스윙", desc: "총알 같은 직선 타구 · 수비가 반응을 못 함" },
    bats: "R",
    throws: "R",
    bat: { hit: 820, power: 760, run: 880, def: 780 },
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
    bat: { hit: 720, power: 900, run: 650, def: 620 },
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
    bat: { hit: 900, power: 640, run: 700, def: 820 },
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
    bat: { hit: 760, power: 600, run: 820, def: 700 },
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
    bat: { hit: 800, power: 780, run: 860, def: 760 },
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
    bat: { hit: 780, power: 700, run: 600, def: 650 },
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
    bat: { hit: 640, power: 980, run: 480, def: 600 },
    pit: { control: 640, velo: 165, brk: 600, stamina: 420, rep: ["FB", "SL", "FK", "SK"] },
  },
  {
    id: "forte",
    name: "포르테",
    color: "#F7A8C8",
    ball: { name: "되감기 볼", hint: "오다가 째깍째깍 되감김 — 두 번째로 올 때가 진짜" },
    swing: { name: "되감기 스윙", desc: "헛치거나 아웃이면 시간을 되감아 그 공을 다시 침 (1번)" },
    bats: "L",
    throws: "L",
    bat: { hit: 840, power: 620, run: 800, def: 720 },
    pit: { control: 840, velo: 142, brk: 820, stamina: 320, rep: ["FB", "CB", "CH", "SL"] },
  },
  {
    id: "mei",
    name: "메이",
    color: "#2FD6A0",
    ball: { name: "만두 분신구", hint: "만두 셋이 빙글빙글 — 하나로 합쳐지며 김이 퐁! 피어오른 직후" },
    swing: { name: "태극 스윙", desc: "S자로 휘는 라이너 — 수비 사이 빈틈으로 쏙" },
    bats: "L",
    throws: "R",
    bat: { hit: 860, power: 640, run: 820, def: 840 },
    pit: { control: 860, velo: 140, brk: 880, stamina: 330, rep: ["FB", "CB", "CH", "SL"] },
  },
];

export const charById = (id: CharId) => CHARS.find((c) => c.id === id)!;

/** 격투게임 그림 재사용 (에셋 없이 시작하는 M1 — 컷인 · 얼굴만) */
export const faceUrl = (id: CharId) => `/fight/art/${id}-face.webp`;
export const cutinUrl = (id: CharId) => `/fight/cutin/${id}.webp`;

export interface Batter {
  name: string;
  num: number;
  pos: string;
  bats: "R" | "L";
  hit: number;
  power: number;
  run: number;
  def: number;
  special?: CharId;
  /** 육성 선수가 픽셀파이트 캐릭터에게 배운 필살타법 (겉모습은 그대로, 필살만) */
  learned?: CharId;
  /** 상황 특수능력 (육성): 득점권 맞히기 · 파워, 2스트라이크 맞히기 */
  sit?: { rispHit?: number; rispPow?: number; twoK?: number; late?: number };
  /** 육성 선수 외형 (헤어 · 얼굴 · 피부 · 배트 · 유니폼) */
  look?: { hair: number; face: number; skin: number; bat: number; uni: number };
}

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

const FAMILY = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍"];
const GIVEN = [
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

/** 이름 · 능력치가 들어간 팀 만들기 (시드가 같으면 같은 팀) */
export function makeTeam(def: TeamDef, rng: () => number, sp: { bat: CharId; pit: CharId }): Team {
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
  // 타순 성향: 1·2번 맞히기 · 발, 3~5번 힘, 하위 타순 약함
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
    def: st(520, 80),
  }));
  // 마타자는 4번
  const sb = charById(sp.bat);
  batters[3] = { name: sb.name, num: num(), pos: "마", bats: sb.bats, ...sb.bat, special: sb.id };
  const sk = charById(sp.pit);
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
    { name: sk.name, num: num(), role: "CL", throws: sk.throws, ...sk.pit, special: sk.id },
  ];
  return { id: def.id, name: def.name, short: def.short, color: def.color, dark: def.dark, batters, pitchers };
}

/** 배팅볼 투수 (홈런더비) */
export const BP_PITCHER: Pitcher = {
  name: "배팅볼 아저씨", num: 99, role: "SP", throws: "R",
  control: 800, velo: 128, brk: 300, stamina: 999, rep: ["FB"],
};
