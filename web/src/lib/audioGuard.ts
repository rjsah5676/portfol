/*
 * 사이트 공통 소리 지킴이 — 게임 소리가 그 게임 화면 밖으로 새지 않게.
 *   1) 탭을 가리면(다른 탭 · 다른 앱 · 화면 끔) 모든 소리를 멈추고, 돌아오면 이어서
 *   2) 다른 화면으로 옮기면(사이트 안 이동) 앞 게임 소리를 멈추고, 그 게임으로 돌아오면 이어서
 *   3) 게임이 자기 화면 밖에서 소리를 다시 켜려 하면(예: 탭 돌아올 때 BGM 다시 틀기) 막음
 *
 * 게임마다 고치지 않고 브라우저 소리 API(AudioContext · <audio>/<video>)를 한 번 감싸서 처리함 → 새 게임도 자동.
 * 소리 하나하나에 「주인 화면」(/games/xxx, 그 밖은 "/")을 붙이고, 지금 화면이 주인이고 탭이 보일 때만 소리가 남.
 * 사용자가 지금 이 화면에서 누른 직후 켜는 소리는 이 화면 것으로 다시 붙임 (여러 게임이 같이 쓰는 효과음 엔진).
 * 게임이 스스로 멈춘 것(suspend · pause)은 건드리지 않음 — 우리가 멈춘 것만 되돌림.
 */

type Root = string;
const rootOf = (path: string): Root => /^\/games\/[^/?#]+/.exec(path)?.[0] ?? "/";
const here = () => rootOf(location.pathname);
const visible = () => document.visibilityState !== "hidden";
const allowed = (owner: Root) => visible() && owner === here();
/**
 * 사용자가 방금(1초 안) 이 화면에서 눌렀나 — 그때 켜는 소리는 이 화면 것.
 * (브라우저 userActivation 은 링크를 누르고 넘어온 뒤에도 몇 초 남아 있어서, 화면 기준으로 직접 셈)
 */
let lastInput: { t: number; root: Root } | null = null;
const activeNow = () => !!lastInput && lastInput.root === here() && performance.now() - lastInput.t < 1000;

interface CtxInfo {
  owner: Root;
  /** 게임이 바라는 상태 (게임이 부른 suspend/resume 기준) */
  intent: "running" | "suspended";
  /** 우리가 멈춰 둠 */
  held: boolean;
}
interface MediaInfo {
  owner: Root;
  held: boolean;
  /** 나오던 중에 우리가 멈춤 (돌아오면 이어서) — 아니면 막힌 play() (반복 곡만 이어서) */
  mid: boolean;
}

const ctxs = new Map<AudioContext, CtxInfo>();
const media = new WeakMap<HTMLMediaElement, MediaInfo>();
let mediaRefs: WeakRef<HTMLMediaElement>[] = [];

let installed = false;
let origResume: AudioContext["resume"];
let origSuspend: AudioContext["suspend"];
let origPlay: HTMLMediaElement["play"];
let origPause: HTMLMediaElement["pause"];

function ctxInfo(c: AudioContext): CtxInfo {
  let i = ctxs.get(c);
  if (!i) {
    i = { owner: here(), intent: "running", held: false };
    ctxs.set(c, i);
  }
  return i;
}
function mediaInfo(el: HTMLMediaElement): MediaInfo {
  let i = media.get(el);
  if (!i) {
    i = { owner: here(), held: false, mid: false };
    media.set(el, i);
    mediaRefs.push(new WeakRef(el));
    if (mediaRefs.length > 300) mediaRefs = mediaRefs.filter((r) => r.deref());
  }
  return i;
}
/** 지금 이 화면에서 사용자가 누른 직후면 이 화면 소리로 다시 붙임 */
const claim = (i: { owner: Root }) => {
  if (visible() && activeNow()) i.owner = here();
};

function holdCtx(c: AudioContext, i: CtxInfo) {
  if (c.state === "closed" || i.held) return;
  i.held = true;
  if (c.state !== "suspended") void origSuspend.call(c).catch(() => {});
}
function releaseCtx(c: AudioContext, i: CtxInfo) {
  i.held = false;
  if (i.intent === "running" && c.state !== "closed") void origResume.call(c).catch(() => {});
}

/** 지금 화면 · 탭 상태에 맞게 전부 다시 맞춤 */
export function syncAudio() {
  if (!installed) return;
  for (const [c, i] of ctxs) {
    if (c.state === "closed") {
      ctxs.delete(c);
      continue;
    }
    if (!allowed(i.owner)) {
      if (i.intent === "running") holdCtx(c, i);
    } else if (i.held) releaseCtx(c, i);
  }
  const keep: WeakRef<HTMLMediaElement>[] = [];
  for (const r of mediaRefs) {
    const el = r.deref();
    if (!el) continue;
    keep.push(r);
    const i = media.get(el);
    if (!i) continue;
    if (!allowed(i.owner)) {
      if (!el.paused && !el.muted) {
        i.held = true;
        i.mid = true;
        origPause.call(el);
      }
    } else if (i.held) {
      i.held = false;
      const again = el.loop || (i.mid && !el.ended);
      i.mid = false;
      if (again && el.paused && el.src) void origPlay.call(el).catch(() => {});
    }
  }
  mediaRefs = keep;
}

export function installAudioGuard() {
  if (installed || typeof window === "undefined") return;
  const AC = window.AudioContext;
  if (!AC || typeof WeakRef === "undefined") return;
  installed = true;

  origResume = AC.prototype.resume;
  origSuspend = AC.prototype.suspend;
  AC.prototype.resume = function (this: AudioContext) {
    const i = ctxInfo(this);
    claim(i);
    i.intent = "running";
    if (!allowed(i.owner)) {
      i.held = true;
      return Promise.resolve();
    }
    i.held = false;
    return origResume.call(this);
  };
  AC.prototype.suspend = function (this: AudioContext) {
    const i = ctxInfo(this);
    i.intent = "suspended";
    i.held = false;
    return origSuspend.call(this);
  };
  // 새로 만드는 소리 엔진도 등록 (화면 밖 · 가린 탭에서 만들어지면 바로 멈춰 둠)
  const wrap = (Base: typeof AudioContext) =>
    class extends Base {
      constructor(...a: ConstructorParameters<typeof AudioContext>) {
        super(...a);
        const i = ctxInfo(this);
        if (!allowed(i.owner)) holdCtx(this, i);
      }
    };
  window.AudioContext = wrap(AC);
  const W = window as Window & { webkitAudioContext?: typeof AudioContext };
  if (W.webkitAudioContext && W.webkitAudioContext !== AC) W.webkitAudioContext = wrap(W.webkitAudioContext);

  // 우리가 멈춰 둔 엔진에서 사용자가 이 화면에서 소리를 내면(여러 게임이 같이 쓰는 효과음) 이 화면 것으로 깨움
  const SN = window.AudioScheduledSourceNode;
  if (SN) {
    const origStart = SN.prototype.start;
    SN.prototype.start = function (this: AudioScheduledSourceNode, ...a: Parameters<typeof origStart>) {
      const c = this.context as AudioContext;
      const i = ctxs.get(c);
      if (i?.held && visible() && activeNow()) {
        i.owner = here();
        releaseCtx(c, i);
      }
      return origStart.apply(this, a);
    };
  }

  const MP = HTMLMediaElement.prototype;
  origPlay = MP.play;
  origPause = MP.pause;
  MP.play = function (this: HTMLMediaElement) {
    const i = mediaInfo(this);
    claim(i);
    if (!allowed(i.owner)) {
      i.held = true;
      i.mid = false;
      return Promise.resolve();
    }
    i.held = false;
    i.mid = false;
    // 같은 곡을 새 <audio> 로 다시 틀면(화면에 돌아와서 게임이 새로 만든 것) 멈춰 둔 옛것은 이어 틀지 않음 (두 번 겹쳐 나오지 않게)
    const src = this.currentSrc || this.src;
    if (src)
      for (const r of mediaRefs) {
        const el = r.deref();
        if (!el || el === this) continue;
        const o = media.get(el);
        if (o?.held && o.owner === i.owner && (el.currentSrc || el.src) === src) o.held = false;
      }
    return origPlay.call(this);
  };
  MP.pause = function (this: HTMLMediaElement) {
    const i = media.get(this);
    if (i) {
      i.held = false;
      i.mid = false;
    }
    return origPause.call(this);
  };

  const input = () => (lastInput = { t: performance.now(), root: here() });
  for (const ev of ["pointerdown", "keydown", "touchstart"])
    window.addEventListener(ev, input, { capture: true, passive: true });
  // 게임 자체 처리(자기 visibilitychange)가 먼저 돌게 한 박자 늦게
  const later = () => setTimeout(syncAudio, 0);
  document.addEventListener("visibilitychange", later);
  window.addEventListener("pageshow", later);
  window.addEventListener("popstate", later);
}
