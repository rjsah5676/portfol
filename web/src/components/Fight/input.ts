/**
 * 키보드·게임패드·터치 입력 → 프레임당 9비트 (sim.ts IN). 위·점프키 = 점프(공중에서 한 번 더), 아래 = 가드.
 */
import { IN } from "@/lib/fight/sim";

type KeyMap = Record<string, number>;

/** 1P: WASD 이동 + 스페이스 점프, 공격은 J K L I (2인 대전 땐 왼손 쪽 F G H T도) */
const P1: KeyMap = {
  KeyA: IN.L,
  KeyD: IN.R,
  KeyW: IN.U,
  KeyS: IN.D,
  Space: IN.J,
  KeyJ: IN.A,
  KeyK: IN.B,
  KeyL: IN.C,
  KeyI: IN.X,
  KeyF: IN.A,
  KeyG: IN.B,
  KeyH: IN.C,
  KeyT: IN.X,
};
/** AI 대전에선 1P가 방향키 + Z X C V 도 씀 */
const P1_ALT: KeyMap = {
  ArrowLeft: IN.L,
  ArrowRight: IN.R,
  ArrowUp: IN.U,
  ArrowDown: IN.D,
  KeyZ: IN.A,
  KeyX: IN.B,
  KeyC: IN.C,
  KeyV: IN.X,
};
/** 2P: 방향키 + Enter 점프 + , . ; ' (또는 숫자패드 1 2 3 0 + 숫자패드 Enter) — /는 사이트 검색 단축키라 안 씀 */
const P2: KeyMap = {
  ArrowLeft: IN.L,
  ArrowRight: IN.R,
  ArrowUp: IN.U,
  ArrowDown: IN.D,
  Enter: IN.J,
  ShiftRight: IN.J,
  NumpadEnter: IN.J,
  Comma: IN.A,
  Period: IN.B,
  Semicolon: IN.C,
  Quote: IN.X,
  Numpad1: IN.A,
  Numpad2: IN.B,
  Numpad3: IN.C,
  Numpad0: IN.X,
};

export const KEY_GUIDE = {
  p1: "A·D 이동(AA·DD 대시) · W/Space 점프(2단) · S 가드 · J 약 · K 발차기 · J+K 잡기(띄우기) · L 아이덴티티 · I 필살기 · 막은 직후 K 가드반격(띄우기)",
  p1Alt: "방향키(←← →→ 대시 · ↑ 점프 · ↓ 가드) · Z 약 · X 발차기 · C 아이덴티티 · V 필살기",
  p1Two: "A·D 이동(AA·DD 대시) · W/Space 점프 · S 가드 · F 약 · G 발차기 · H 아이덴티티 · T 필살기",
  p2: "←→ 이동(두 번 대시) · ↑/Enter 점프 · ↓ 가드 · , 약 · . 발차기 · ; 아이덴티티 · ' 필살기 (숫자패드 1 2 3 0)",
};

const GAME_KEYS = new Set([...Object.keys(P1), ...Object.keys(P1_ALT), ...Object.keys(P2)]);
/** 대전 중엔 사이트 검색(/) 단축키도 막음 — 2P 손이 근처에 있어서 잘못 눌리기 쉬움 */
const SWALLOW = new Set(["Slash"]);

/** 왼쪽+오른쪽 동시 → 중립, 위+아래 → 위 */
function clean(v: number) {
  if ((v & (IN.L | IN.R)) === (IN.L | IN.R)) v &= ~(IN.L | IN.R);
  if ((v & (IN.U | IN.D)) === (IN.U | IN.D)) v &= ~IN.D;
  return v;
}

function padBits(p: Gamepad | null): number {
  if (!p) return 0;
  const b = (i: number) => !!p.buttons[i]?.pressed;
  const ax = p.axes[0] ?? 0,
    ay = p.axes[1] ?? 0;
  let v = 0;
  if (b(14) || ax < -0.5) v |= IN.L;
  if (b(15) || ax > 0.5) v |= IN.R;
  if (b(12) || ay < -0.6) v |= IN.U;
  if (b(13) || ay > 0.6) v |= IN.D;
  if (b(0)) v |= IN.J; // A / × 점프
  if (b(2)) v |= IN.A; // X / □ 약
  if (b(3)) v |= IN.B; // Y / △ 강
  if (b(1)) v |= IN.C; // B / ○ 아이덴티티
  if (b(5) || b(7)) v |= IN.X; // RB, RT 필살기
  return v;
}

export class FightInput {
  private keys = new Set<string>();
  /** 한 프레임보다 짧게 톡 친 키도 놓치지 않게, 다음 read까지 눌린 걸로 침 */
  private taps = new Set<string>();
  /** 화면 버튼 (1P) */
  touch = 0;
  /** 한 프레임보다 짧게 톡 친 화면 버튼도 놓치지 않게, 다음 read까지 눌린 걸로 침 (프레임이 떨어지는 폰) */
  private touchTap = 0;
  /** true면 2인 대전(키보드 나눠 쓰기) */
  twoPlayer = false;
  /** 대전 중일 때만 키를 가로챔 (메뉴에선 사이트 단축키 등이 그대로 동작) */
  active = false;

  /** 일시정지 메뉴가 열린 동안엔 키를 안 가로챔 (메뉴를 키보드로 고르게) */
  menu = false;

  private down = (e: KeyboardEvent) => {
    if (!this.active || this.menu) return;
    if (SWALLOW.has(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (GAME_KEYS.has(e.code)) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      // 사이트 검색 같은 다른 단축키가 같이 반응하지 않게
      e.stopImmediatePropagation();
      this.keys.add(e.code);
      this.taps.add(e.code);
    }
  };
  private up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private blur = () => {
    this.keys.clear();
    this.taps.clear();
  };
  /** 일시정지 메뉴 열림·닫힘 — 열 때는 누르고 있던 키를 다 뗀 걸로 */
  setMenu(on: boolean) {
    this.menu = on;
    if (on) this.blur();
  }

  attach() {
    window.addEventListener("keydown", this.down, true);
    window.addEventListener("keyup", this.up, true);
    window.addEventListener("blur", this.blur);
  }
  detach() {
    window.removeEventListener("keydown", this.down, true);
    window.removeEventListener("keyup", this.up, true);
    window.removeEventListener("blur", this.blur);
  }

  private fromKeys(map: KeyMap) {
    let v = 0;
    for (const k of this.keys) if (map[k]) v |= map[k];
    for (const k of this.taps) if (map[k]) v |= map[k];
    return v;
  }

  read(player: 0 | 1): number {
    const pads =
      typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const list = Array.from(pads ?? []).filter((p): p is Gamepad => !!p);
    if (player === 0) {
      let v = this.fromKeys(P1) | this.touch | this.touchTap | padBits(list[0] ?? null);
      this.touchTap = 0;
      if (!this.twoPlayer) v |= this.fromKeys(P1_ALT);
      this.consume(this.twoPlayer ? [P1] : [P1, P1_ALT]);
      return clean(v);
    }
    const v = this.fromKeys(P2) | padBits(list[1] ?? null);
    this.consume([P2]);
    return clean(v);
  }

  /** 이번 프레임에 읽은 톡 입력은 지움 */
  private consume(maps: KeyMap[]) {
    for (const k of this.taps) if (maps.some((m) => m[k])) this.taps.delete(k);
  }

  setTouch(v: number) {
    this.touch = v;
    this.touchTap |= v;
  }
  configure(twoPlayer: boolean) {
    this.twoPlayer = twoPlayer;
    this.active = true;
  }
  stop() {
    this.active = false;
    this.keys.clear();
    this.taps.clear();
    this.touch = 0;
    this.touchTap = 0;
  }

  /** 아무 공격 버튼이나 눌렀나 (결과 화면 넘기기 등) */
  anyButton() {
    return (this.read(0) | this.read(1)) & (IN.A | IN.B | IN.C | IN.X | IN.J);
  }
}
