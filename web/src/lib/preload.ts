/*
 * 게임 에셋 미리 받기 (로딩 화면 GameLoader 가 씀).
 *
 * 할 일(LoadTask) 하나 = 진행률 한 칸:
 *   "…/a.webp"             그림: 받고 decode 까지 (화면에 붙일 때 깜빡이지 않게). 브라우저 메모리에 붙잡아 둠
 *   "…/a.mp3" · ogg · wav · m4a · aac   소리: 파일을 받아 HTTP 캐시에 넣음 (게임이 다시 받을 때 바로)
 *   "…/a.json" 등 그 밖     fetch 로 받아 둠
 *   () => Promise          게임 자체 로더 (예: 스프라이트 시트 · 효과음 디코드) — 게임 안 캐시까지 채워짐
 *
 * 실패한 것도 "끝남"으로 셈 (로딩 화면에서 멈추지 않게 — 게임이 없는 그림을 알아서 처리).
 * 한 번 받은 주소는 기억해서 다시 들어오면 바로 끝남.
 */

export type LoadTask = string | (() => Promise<unknown>);

const IMG = /\.(webp|png|jpe?g|gif|avif|svg)(\?|#|$)/i;

const done = new Map<string, Promise<void>>();
/** 받은 주소 · 끝난 이름 붙은 할 일 (끝난 것만 — 받는 중인 것은 아직) */
const settled = new Set<string>();
/** decode 한 그림을 붙잡아 둠 (메모리 캐시에서 빠지지 않게) */
const keep: HTMLImageElement[] = [];

function loadImage(url: string): Promise<void> {
  return new Promise<void>((res) => {
    const im = new Image();
    im.decoding = "async";
    const fin = () => {
      keep.push(im);
      res();
    };
    im.onload = () => {
      // decode 를 기다려야 첫 그리기 때 끊기지 않음 (지원 안 하면 onload 로 충분)
      if (typeof im.decode === "function") im.decode().then(fin, fin);
      else fin();
    };
    im.onerror = () => res();
    im.src = url;
  });
}

function loadFile(url: string): Promise<void> {
  return fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then(
      () => undefined,
      () => undefined
    );
}

/** 주소 하나 받기 (이미 받았거나 받는 중이면 그 약속을 그대로) */
export function preloadUrl(url: string): Promise<void> {
  let p = done.get(url);
  if (!p) {
    p = (IMG.test(url) ? loadImage(url) : loadFile(url)).then(() => {
      settled.add(url);
    });
    done.set(url, p);
  }
  return p;
}

type Keyed = (() => Promise<unknown>) & { loadKey?: string };
/**
 * 이름 붙은 할 일: 한 번 끝나면 기억함 → 다시 들어올 때 이것 때문에 로딩 화면(빈 칸 한 프레임)이 생기지 않음.
 * 게임 자체 로더처럼 두 번째부터는 바로 끝나는 것에 씀 (예: keyed("fight:sheet:kai", () => loadSheet("kai")))
 */
export function keyed(key: string, fn: () => Promise<unknown>): () => Promise<unknown> {
  const f: Keyed = () => fn();
  f.loadKey = "fn:" + key;
  return f;
}
const keyOf = (t: LoadTask) => (typeof t === "string" ? t : (t as Keyed).loadKey);

/**
 * 할 일을 동시에 몇 개씩 돌리고, 하나 끝날 때마다 onProgress(끝난 수, 전체 수).
 * 같은 주소는 한 번만. 반환된 약속은 실패하지 않음.
 */
export async function preloadAll(
  tasks: LoadTask[],
  onProgress?: (loaded: number, total: number) => void,
  { concurrency = 6 }: { concurrency?: number } = {}
): Promise<void> {
  const seen = new Set<string>();
  const list = tasks.filter((t) => typeof t !== "string" || (!seen.has(t) && seen.add(t)));
  const total = list.length;
  let loaded = 0;
  let next = 0;
  onProgress?.(0, total);
  const run = async () => {
    while (next < list.length) {
      const t = list[next++];
      try {
        if (typeof t === "string") {
          await preloadUrl(t);
        } else {
          await t();
          const k = keyOf(t);
          if (k) settled.add(k);
        }
      } catch {
        // 실패해도 다음으로 (게임이 알아서 대체)
      }
      loaded++;
      onProgress?.(loaded, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, total)) }, run));
}

/** 이미 다 받은 목록인지 (주소만 · 끝난 것 기준) — 다시 들어왔을 때 로딩 화면을 건너뛰려고 */
export const allSettled = (tasks: LoadTask[]) =>
  tasks.every((t) => {
    const k = keyOf(t);
    return !!k && settled.has(k);
  });

/**
 * 글꼴: 이 글꼴들이 실제로 쓸 수 있게 될 때까지 (CSS @font-face 는 쓰일 때까지 안 받으므로 직접 부름).
 * 한글 웹폰트는 글자 범위(unicode-range)로 쪼개져 있어서, 글자 없이 부르면 영문 조각만 받음 → 자주 쓰는 글자를 같이 넘김
 */
const FONT_SAMPLE =
  "가나다라마바사아자차카타파하게임시작로딩중랭킹설정친구선택확인취소ABCabc0123456789";
export const fontTask = (...fonts: string[]): (() => Promise<unknown>) =>
  keyed("font:" + fonts.join("|"), () =>
    typeof document === "undefined" || !document.fonts
      ? Promise.resolve()
      : Promise.all(fonts.map((f) => document.fonts.load(f, FONT_SAMPLE).catch(() => null)))
  );
