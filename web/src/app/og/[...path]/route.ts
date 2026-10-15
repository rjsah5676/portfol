import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_NAME } from "@/lib/seo";
import { SHOT_KEYS, shotFile } from "@/lib/og/shots";
import { renderCard } from "@/lib/og/card";

// 링크 공유 미리보기 이미지: /og/<페이지 경로>.png
//   /og/games/fight.jpg → 실제 게임 화면 사진 (lib/og/shots.ts 에 있는 페이지만, web/assets/og/shots)
//   /og/index.png → 홈,  /og/games/chess.png → /games/chess/,  /og/study/<글 id>.png → 그 글
// 그 페이지를 이 서버에서 직접 읽어 제목·설명을 뽑아 그림 → 실제로 있는 페이지의 이미지만 만들어지고,
// 글 제목을 고치면 이미지도 따라 바뀜. 없는 페이지면 404.
export const dynamic = "force-dynamic";

const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 400;
/** 만든 이미지를 잠깐 들고 있음 (같은 링크가 여러 번 공유될 때 매번 그리지 않게) */
const cache = new Map<string, { at: number; png: ArrayBuffer }>();

const decode = (s: string) =>
  s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const metaOf = (html: string, attr: string, name: string) => {
  const m =
    new RegExp(`<meta[^>]*${attr}="${name}"[^>]*content="([^"]*)"`, "i").exec(html) ??
    new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${name}"`, "i").exec(html);
  return m ? decode(m[1]) : "";
};

/** 이 서버 자신의 주소로 페이지를 읽음 (프록시 뒤에 있어도 바깥 도메인을 거치지 않게) */
async function readPage(pagePath: string, req: Request): Promise<string | null> {
  const origins = [`http://127.0.0.1:${process.env.PORT ?? 3000}`, new URL(req.url).origin];
  for (const origin of origins) {
    try {
      const res = await fetch(origin + pagePath, {
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 200) return await res.text();
      if (res.status === 404) return null;
    } catch {
      // 다음 주소로
    }
  }
  return null;
}

const png = (data: ArrayBuffer | Uint8Array<ArrayBuffer>, type = "image/png") =>
  new Response(data, {
    headers: {
      "Content-Type": type,
      // 미리보기를 가져가는 쪽(메신저·SNS)과 CDN이 하루 정도 들고 있어도 됨
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const last = path[path.length - 1] ?? "";
  if (last.endsWith(".jpg")) {
    const key = [...path.slice(0, -1), last.slice(0, -4)].join("/");
    if (!SHOT_KEYS.has(key)) return new Response(null, { status: 404 });
    try {
      const buf = await readFile(join(process.cwd(), "assets/og/shots", shotFile(key)));
      return png(new Uint8Array(buf), "image/jpeg");
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  if (!last.endsWith(".png")) return new Response(null, { status: 404 });
  const segments = [...path.slice(0, -1), last.slice(0, -4)];
  if (segments.length > 6 || !segments.every((s) => SEGMENT.test(s)))
    return new Response(null, { status: 404 });
  const pagePath =
    segments.length === 1 && segments[0] === "index" ? "/" : `/${segments.join("/")}/`;

  const hit = cache.get(pagePath);
  if (hit && Date.now() - hit.at < TTL_MS) return png(hit.png);

  const html = await readPage(pagePath, req);
  if (html === null) return new Response(null, { status: 404 });
  // "제목 | 사이트 이름" 에서 사이트 이름은 떼고 그림 (이미지 아래쪽에 따로 들어감)
  const fullTitle =
    metaOf(html, "property", "og:title") ||
    decode(/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "");
  const title =
    pagePath === "/" ? SITE_NAME : fullTitle.replace(new RegExp(`\\s*\\|\\s*${SITE_NAME}.*$`), "");
  const description =
    pagePath === "/"
      ? "풀스택 개발자 이건모의 포트폴리오 · 공부 기록 · 직접 만든 게임과 도구"
      : metaOf(html, "name", "description");

  try {
    const data = await renderCard({ title, description, path: pagePath });
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(pagePath, { at: Date.now(), png: data });
    return png(data);
  } catch (e) {
    console.error("[og] 이미지 생성 실패", pagePath, e);
    return new Response(null, { status: 500 });
  }
}
