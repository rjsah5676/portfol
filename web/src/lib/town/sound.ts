/*
 * TABLE TOWN 소리 — 배경음악(BGM) · 효과음(SFX).
 *  BGM: 제미나이로 만든 곡 (화면마다 하나, 바뀔 때 부드럽게 넘김)
 *  SFX: 일레븐랩스 효과음 (짧은 소리, 겹쳐서 여러 번 울려도 됨)
 * 주소가 null 이면 그 소리는 아직 없어서 조용히 넘어감 — 파일이 들어오면 여기만 채우면 됨.
 * 모든 소리는 로딩 화면에서 그림과 같이 다 받고 시작.
 */

const B = "/town/snd";

export type BgmId = "town" | "room" | "game" | "gacha";
export type SfxId =
  | "click"
  | "open"
  | "close"
  | "tab"
  | "enter"
  | "coin"
  | "chat"
  | "botJoin"
  | "deal"
  | "play"
  | "draw"
  | "attack"
  | "special"
  | "oneCall"
  | "caught"
  | "myTurn"
  | "win"
  | "lose"
  | "crank"
  | "capDrop"
  | "capShake"
  | "crack"
  | "crackGold"
  | "pillar"
  | "reveal"
  | "stamp"
  | "miss";

export const BGM: Record<BgmId, string | null> = {
  town: `${B}/bgm-town.mp3`,
  room: `${B}/bgm-room.mp3`,
  game: `${B}/bgm-game.mp3`,
  gacha: `${B}/bgm-gacha.mp3`,
};

/** 효과음 목록 · 일레븐랩스 요청 문구(영어)는 SFX_PROMPT 에 */
export const SFX: Record<SfxId, string | null> = Object.fromEntries(
  (
    [
      "click",
      "open",
      "close",
      "tab",
      "enter",
      "coin",
      "chat",
      "botJoin",
      "deal",
      "play",
      "draw",
      "attack",
      "special",
      "oneCall",
      "caught",
      "myTurn",
      "win",
      "lose",
      "crank",
      "capDrop",
      "capShake",
      "crack",
      "crackGold",
      "pillar",
      "reveal",
      "stamp",
      "miss",
    ] as SfxId[]
  ).map((k) => [k, `${B}/sfx-${k}.mp3`]),
) as Record<SfxId, string | null>;

/** 관리자 들어보기용 두 번째 후보 (일레븐랩스 결과 2개 중 B) — 게임은 A(SFX)를 씀 */
export const SFX_B: Record<SfxId, string> = Object.fromEntries(Object.keys(SFX).map((k) => [k, `${B}/sfx-${k}-b.mp3`])) as Record<SfxId, string>;

/** 소리마다 크기 (0~1) — 잦은 소리는 작게 */
const SFX_VOL: Partial<Record<SfxId, number>> = { click: 0.45, tab: 0.4, deal: 0.55, play: 0.7, draw: 0.55, chat: 0.5, capShake: 0.6 };

const KEY = "tabletown-sound-v1";
export interface SoundPref {
  bgm: number;
  sfx: number;
  mute: boolean;
}
export function loadSoundPref(): SoundPref {
  const def: SoundPref = { bgm: 0.55, sfx: 0.8, mute: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<SoundPref>) };
  } catch {}
  return def;
}
export function saveSoundPref(p: SoundPref) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

export function allSound(): string[] {
  return [...Object.values(BGM), ...Object.values(SFX)].filter((u): u is string => !!u);
}

/** 소리 엔진: 효과음은 Web Audio(겹쳐 울림, 지연 없음), 배경음악은 audio 태그 두 개로 교차 페이드 */
export function createSound() {
  const pref = loadSoundPref();
  let ctx: AudioContext | null = null;
  let sfxGain: GainNode | null = null;
  const buf = new Map<string, AudioBuffer>();
  const raw = new Map<string, ArrayBuffer>();
  const missing = new Set<string>();
  const bgmEl: HTMLAudioElement[] = [];
  let bgmCur: BgmId | null = null;
  let bgmWant: BgmId | null = null;
  let front = 0;
  let unlocked = false;
  let dead = false; // 화면이 다시 붙을 때 옛 소리 엔진이 살아나 BGM 이 겹치지 않게
  const fades = new Map<HTMLAudioElement, number>();

  const ensureCtx = () => {
    if (ctx || typeof window === "undefined") return ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    sfxGain = ctx.createGain();
    sfxGain.gain.value = pref.mute ? 0 : pref.sfx;
    sfxGain.connect(ctx.destination);
    return ctx;
  };

  /** 로딩 화면에서: 파일을 받아 둠 (없는 파일은 조용히 빠짐) */
  async function preload(url: string) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      raw.set(url, await r.arrayBuffer());
    } catch {
      missing.add(url);
    }
  }
  async function decode(url: string) {
    const c = ensureCtx();
    const ab = raw.get(url);
    if (!c || !ab || buf.has(url)) return buf.get(url);
    try {
      const b = await c.decodeAudioData(ab.slice(0));
      buf.set(url, b);
      return b;
    } catch {
      missing.add(url);
    }
  }

  function sfx(id: SfxId, opt: { rate?: number; vol?: number } = {}) {
    const url = SFX[id];
    if (dead || !url || missing.has(url) || pref.mute || !unlocked) return;
    const c = ensureCtx();
    if (!c || !sfxGain) return;
    const play = (b: AudioBuffer) => {
      const s = c.createBufferSource();
      s.buffer = b;
      s.playbackRate.value = opt.rate ?? 1;
      const g = c.createGain();
      g.gain.value = (opt.vol ?? 1) * (SFX_VOL[id] ?? 0.8);
      s.connect(g).connect(sfxGain!);
      s.start();
    };
    const b = buf.get(url);
    if (b) play(b);
    else void decode(url).then((x) => x && play(x));
  }

  const fade = (el: HTMLAudioElement, to: number, ms: number, done?: () => void) => {
    cancelAnimationFrame(fades.get(el) ?? 0);
    const from = el.volume,
      t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) fades.set(el, requestAnimationFrame(step));
      else done?.();
    };
    fades.set(el, requestAnimationFrame(step));
  };

  /** 화면이 바뀔 때: 같은 곡이면 그대로, 다른 곡이면 1초 동안 교차 페이드 */
  function bgm(id: BgmId | null) {
    bgmWant = id;
    if (dead || !unlocked || id === bgmCur) return;
    const url = id ? BGM[id] : null;
    const old = bgmEl[front];
    if (old) fade(old, 0, 900, () => old.pause());
    bgmCur = id;
    if (!url || missing.has(url) || typeof Audio === "undefined") return;
    front = 1 - front;
    let el = bgmEl[front];
    if (!el) {
      el = new Audio();
      el.loop = true;
      el.preload = "auto";
      bgmEl[front] = el;
    }
    if (!el.src.endsWith(url)) el.src = url;
    el.currentTime = 0;
    el.volume = 0;
    void el.play().then(
      () => (dead || bgmEl[front] !== el ? el.pause() : fade(el, pref.mute ? 0 : pref.bgm, 1100)),
      () => {},
    );
  }

  /** 브라우저는 사용자가 한 번 누르기 전엔 소리를 막음 → 첫 터치에 풀기 */
  function unlock() {
    if (dead || unlocked) return;
    unlocked = true;
    const c = ensureCtx();
    void c?.resume();
    for (const u of Object.values(SFX)) if (u) void decode(u);
    const w = bgmWant;
    bgmCur = null;
    bgm(w);
  }

  function setPref(p: Partial<SoundPref>) {
    Object.assign(pref, p);
    saveSoundPref(pref);
    if (sfxGain) sfxGain.gain.value = pref.mute ? 0 : pref.sfx;
    const el = bgmEl[front];
    if (el && bgmCur) el.volume = pref.mute ? 0 : pref.bgm;
  }

  /** 잠깐 BGM 을 줄였다 되돌리기 (공개 연출 · 승리 팡파르 때) */
  function duck(ms: number, to = 0.25) {
    const el = bgmEl[front];
    if (!el || !bgmCur || pref.mute) return;
    fade(el, pref.bgm * to, 250, () => setTimeout(() => fade(el, pref.mute ? 0 : pref.bgm, 700), ms));
  }

  function stop() {
    dead = true;
    bgmEl.forEach((e) => {
      cancelAnimationFrame(fades.get(e) ?? 0);
      e.pause();
      e.removeAttribute("src");
      e.load();
    });
    void ctx?.close();
  }

  /** 관리자: 소리 하나를 바로 들어보기 (BGM 은 audio 태그로) */
  function preview(url: string) {
    unlock();
    const a = new Audio(url);
    a.volume = 0.9;
    void a.play().catch(() => {});
    return a;
  }

  return { pref, preload, sfx, bgm, unlock, setPref, duck, stop, preview, missing };
}
export type Sound = ReturnType<typeof createSound>;
