import { ApiError } from "@/lib/api/errors";

/*
 * 사람 확인 (Cloudflare Turnstile) — 서버가 403 CAPTCHA_REQUIRED { siteKey } 를 돌려주면
 * 작은 확인 창을 띄워 토큰을 받고, 같은 요청을 X-Captcha-Token 헤더에 실어 다시 보냄.
 * 대부분은 1초쯤 뒤 저절로 통과하고, 수상하면 체크박스가 나옴. (server/src/captcha.ts)
 *
 *   await withCaptcha((headers) => api("/api/...", { method: "POST", headers, ... }))
 */

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const HEADER = "X-Captcha-Token";

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new ApiError("CAPTCHA_FAILED", "사람 확인을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** 확인 창을 띄우고 토큰을 받음 (취소 · 실패 · 1분 지나면 오류) */
export async function getCaptchaToken(siteKey: string): Promise<string> {
  const ts = await loadTurnstile();
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "사람 확인");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)";
  overlay.innerHTML = `
    <div style="width:min(340px,100%);border-radius:16px;border:1px solid rgba(255,255,255,.12);background:#1C1E24;padding:20px;color:#fff;font-family:'Nanum Gothic',sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.5)">
      <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#8B84FF">verify</div>
      <div style="margin-top:6px;font-size:15px;font-weight:700">사람인지 확인할게요</div>
      <div style="margin-top:4px;font-size:12px;color:rgba(255,255,255,.5)">보통 잠깐이면 저절로 끝나요.</div>
      <div data-box style="margin-top:14px;min-height:65px;display:flex;justify-content:center"></div>
      <button type="button" data-cancel style="margin-top:12px;width:100%;cursor:pointer;border-radius:999px;border:1px solid rgba(255,255,255,.15);background:transparent;padding:8px;color:rgba(255,255,255,.65);font-size:12px">취소</button>
    </div>`;
  // 게임이 전체 화면이면 그 요소 안에 띄워야 보임 (body 에 붙이면 전체 화면 뒤에 가려짐)
  const fs = document.fullscreenElement;
  const host = fs && !/^(CANVAS|VIDEO|IMG|IFRAME)$/.test(fs.tagName) ? fs : document.body;
  host.appendChild(overlay);
  const box = overlay.querySelector<HTMLElement>("[data-box]")!;
  const cancel = overlay.querySelector<HTMLButtonElement>("[data-cancel]")!;

  return new Promise<string>((resolve, reject) => {
    let id = "";
    let done = false;
    const finish = (err: Error | null, token?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        if (id) ts.remove(id);
      } catch {
        // 이미 지워짐
      }
      overlay.remove();
      if (err) reject(err);
      else resolve(token!);
    };
    const fail = (msg: string) => finish(new ApiError("CAPTCHA_FAILED", msg));
    const timer = setTimeout(() => fail("사람 확인 시간이 지났어요. 다시 시도해 주세요."), 60_000);
    cancel.onclick = () => finish(new ApiError("CAPTCHA_CANCELLED", "사람 확인을 취소했어요."));
    id = ts.render(box, {
      sitekey: siteKey,
      theme: "dark",
      language: "ko",
      callback: (token: string) => finish(null, token),
      "error-callback": () => fail("사람 확인에 실패했어요. 다시 시도해 주세요."),
      "expired-callback": () => fail("사람 확인 시간이 지났어요. 다시 시도해 주세요."),
      "timeout-callback": () => fail("사람 확인 시간이 지났어요. 다시 시도해 주세요."),
    });
  });
}

/** 서버가 사람 확인을 요구하면 확인한 뒤 한 번 더 보냄 */
export async function withCaptcha<T>(call: (headers?: Record<string, string>) => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    const siteKey = (e as ApiError)?.code === "CAPTCHA_REQUIRED" ? (e as ApiError).data : null;
    const key = (siteKey as { siteKey?: string } | null)?.siteKey;
    if (!key) throw e;
    const token = await getCaptchaToken(key);
    return call({ [HEADER]: token });
  }
}

/** 사람 확인 쪽 오류(취소 · 실패)면 그 안내 문구, 아니면 null */
export function captchaMessage(e: unknown): string | null {
  return e instanceof ApiError && e.code.startsWith("CAPTCHA_") ? e.message : null;
}
