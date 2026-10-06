import type { Config } from "./config";

/**
 * 글이 바뀌었다고 프론트(Next 서버)에 알림 → 프론트가 받아둔 글 목록·글 캐시를 바로 비움.
 * 설정(WEB_REVALIDATE_URL, REVALIDATE_SECRET)이 없으면 아무것도 안 함 — 그래도 프론트 캐시는 60초마다 스스로 갱신됨.
 * 알림이 실패해도 글 저장 자체는 이미 끝난 뒤라 기록만 남김.
 */
export function createWebNotifier(cfg: Pick<Config, "webRevalidateUrl" | "revalidateSecret">, fetchFn: typeof fetch = fetch) {
  const enabled = !!cfg.webRevalidateUrl && !!cfg.revalidateSecret;
  return {
    enabled,
    async postsChanged(): Promise<void> {
      if (!enabled) return;
      try {
        const res = await fetchFn(cfg.webRevalidateUrl, {
          method: "POST",
          headers: { "x-revalidate-secret": cfg.revalidateSecret },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.warn(`[web] 캐시 갱신 알림 실패: HTTP ${res.status}`);
      } catch (e) {
        console.warn("[web] 캐시 갱신 알림 실패:", e instanceof Error ? e.message : e);
      }
    },
  };
}
export type WebNotifier = ReturnType<typeof createWebNotifier>;
