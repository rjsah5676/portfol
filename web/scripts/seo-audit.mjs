// 떠 있는 사이트의 모든 페이지를 돌며 SEO 메타를 점검:
//   - <title>, 설명, canonical, og:image 가 있는지
//   - 페이지마다 제목·대표 이미지가 서로 다른지 (중복이면 목록으로 출력)
//   - og:image 주소가 실제로 이미지를 돌려주는지 (--images)
// 사용: node scripts/seo-audit.mjs [사이트 주소=http://localhost:3000] [--images] [--json]
// 페이지 목록은 그 사이트의 /sitemap.xml 에서 읽음.

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
const checkImages = args.includes("--images");
const asJson = args.includes("--json");

const decode = (s) =>
  s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const pick = (html, re) => {
  const m = re.exec(html);
  return m ? decode(m[1]) : "";
};
const meta = (html, attr, name) =>
  pick(html, new RegExp(`<meta[^>]*${attr}="${name}"[^>]*content="([^"]*)"`, "i")) ||
  pick(html, new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${name}"`, "i"));

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

const sitemap = await fetch(`${base}/sitemap.xml`).then((r) => r.text());
// 사이트맵의 주소는 정식 도메인으로 적혀 있으므로 경로만 떼어 지금 점검하는 서버에 붙임
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (m) => new URL(decode(m[1])).pathname
);
if (!paths.length) {
  console.error("사이트맵에 페이지가 없습니다:", `${base}/sitemap.xml`);
  process.exit(1);
}

const pages = await mapLimit(paths, 8, async (path) => {
  const res = await fetch(base + path, { redirect: "manual" });
  const html = res.status === 200 ? await res.text() : "";
  return {
    path,
    status: res.status,
    title: pick(html, /<title>([^<]*)<\/title>/i),
    description: meta(html, "name", "description"),
    canonical: pick(html, /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/i),
    ogTitle: meta(html, "property", "og:title"),
    ogImage: meta(html, "property", "og:image"),
    twitterImage: meta(html, "name", "twitter:image"),
    h1: (html.match(/<h1[\s>]/gi) ?? []).length,
    robots: meta(html, "name", "robots"),
  };
});

const problems = [];
const dup = (key, label) => {
  const groups = new Map();
  for (const p of pages) {
    if (!p[key]) continue;
    groups.set(p[key], [...(groups.get(p[key]) ?? []), p.path]);
  }
  for (const [value, list] of groups)
    if (list.length > 1)
      problems.push(
        `${label} 중복 (${list.length}쪽): "${value.slice(0, 70)}" → ${list.slice(0, 6).join(", ")}${list.length > 6 ? " …" : ""}`
      );
};
for (const p of pages) {
  if (p.status !== 200) problems.push(`응답 ${p.status}: ${p.path}`);
  else {
    if (!p.title) problems.push(`제목 없음: ${p.path}`);
    if (!p.description) problems.push(`설명 없음: ${p.path}`);
    if (!p.canonical) problems.push(`canonical 없음: ${p.path}`);
    else if (new URL(p.canonical).pathname !== p.path)
      problems.push(`canonical 이 다른 주소를 가리킴: ${p.path} → ${p.canonical}`);
    if (!p.ogImage) problems.push(`og:image 없음: ${p.path}`);
    if (p.robots.includes("noindex")) problems.push(`사이트맵에 있는데 noindex: ${p.path}`);
  }
}
dup("title", "제목");
dup("ogImage", "og:image");
dup("description", "설명");

if (checkImages) {
  const urls = [...new Set(pages.map((p) => p.ogImage).filter(Boolean))];
  const results = await mapLimit(urls, 6, async (u) => {
    const url = base + new URL(u).pathname + new URL(u).search;
    const res = await fetch(url).catch(() => null);
    const type = res?.headers.get("content-type") ?? "";
    const bytes = res?.ok ? (await res.arrayBuffer()).byteLength : 0;
    return {
      u,
      ok: !!res?.ok && type.startsWith("image/") && bytes > 1000,
      status: res?.status,
      type,
      bytes,
    };
  });
  for (const r of results)
    if (!r.ok)
      problems.push(`og:image 가 이미지를 돌려주지 않음: ${r.u} (HTTP ${r.status}, ${r.type})`);
  console.log(`og:image ${urls.length}개 확인`);
}

if (asJson) console.log(JSON.stringify(pages, null, 2));
console.log(`페이지 ${pages.length}개 점검`);
if (problems.length) {
  console.log(`문제 ${problems.length}건:`);
  for (const p of problems) console.log(" -", p);
  process.exit(1);
}
console.log("문제 없음");
