/*
 * 애니메 차트 소리 — 포커 소리 엔진(lib/poker/sfx.ts: manifest · 음량 설정 · 첫 입력 뒤 재생 · 탭 가림 처리)을 그대로 씀.
 *  전용 파일(sfx-stk-* · bgm-stk-*)이 /poker/sound/manifest.json 에 있으면 그걸, 없으면 포커 소리로 대신.
 *  → 효과음(ElevenLabs) · 배경음악(Gemini) 파일이 들어오면 manifest 에 이름만 올리면 바뀜.
 */
import { hasSound, playBgm, playSfx } from "@/lib/poker/sfx";

type Key = "press" | "tab" | "buy" | "sell" | "next" | "fast" | "order" | "fill" | "win" | "lose" | "big" | "liq" | "coin" | "enter" | "exit" | "shock" | "tick" | "tickLast" | "cash" | "home" | "warn";

/** [전용 이름, 대신 쓸 포커 소리] */
const FILE: Record<Key, [string, string]> = {
  press: ["sfx-stk-press", "sfx-press-ui"],
  tab: ["sfx-stk-tab", "sfx-click"],
  buy: ["sfx-stk-buy", "sfx-chip-big"],
  sell: ["sfx-stk-sell", "sfx-collect"],
  next: ["sfx-stk-candle", "sfx-flip"],
  fast: ["sfx-stk-fast", "sfx-shuffle"],
  order: ["sfx-stk-order", "sfx-check"],
  fill: ["sfx-stk-fill", "sfx-stamp"],
  win: ["jingle-stk-win", "jingle-win"],
  lose: ["jingle-stk-lose", "jingle-lose"],
  big: ["jingle-stk-big", "jingle-bigwin"],
  liq: ["sfx-stk-liq", "sfx-drum"],
  coin: ["sfx-stk-coin", "sfx-coin"],
  enter: ["sfx-stk-enter", "sfx-join"],
  exit: ["sfx-stk-exit", "sfx-exit"],
  shock: ["sfx-stk-shock", "sfx-drum"],
  tick: ["sfx-stk-tick", "sfx-tick"],
  tickLast: ["sfx-stk-tick-last", "sfx-tick-last"],
  cash: ["sfx-stk-cash", "sfx-pot"],
  home: ["sfx-stk-door", "sfx-join"],
  warn: ["sfx-stk-warn", "sfx-press-die"],
};

export function sfx(k: Key, gain = 1) {
  const [own, alt] = FILE[k];
  playSfx(hasSound(own) ? own : alt, gain);
}

/** 화면마다 배경음악. 파일이 아직 없으면 조용 (포커 곡을 빌려 쓰지 않음 — 분위기가 달라서) */
export type Bgm = "village" | "night" | "trade" | "coin" | "battle" | "home";
export function bgm(name: Bgm | null) {
  if (!name) return playBgm(null);
  const own = `bgm-stk-${name}`;
  playBgm(hasSound(own) ? own : null);
}

/** 손익 결과에 맞는 징글 */
export function resultSound(ret: number) {
  if (ret >= 0.3) sfx("big");
  else if (ret > 0) sfx("win");
  else sfx("lose");
}
