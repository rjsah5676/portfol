// 개발용: 오늘의 용의자 메뉴 썸네일 (src/img/menu/suspect.jpg, 800x500) — node scripts/suspect-shot.cjs
const path = require("node:path");
const web = path.join(__dirname, "..");
const { chromium } = require(path.join(web, ".love-src/ff/node_modules/playwright-core"));
const sharp = require(path.join(web, "node_modules/sharp"));
(async () => {
  const b = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--mute-audio"],
  });
  const page = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto("http://localhost:3000/games/suspect/");
  await page.waitForSelector(".sp-tier", { timeout: 60000 });
  // 오늘의 보통 사건을 엔진으로 똑같이 만들어 두고, 확정되는 사람만 차례로 지목 (실수 · 힌트 0)
  const E = await import(require("node:url").pathToFileURL(path.join(web, "src/lib/suspect/engine.ts")).href);
  const day = E.kstDay();
  const pz = E.generate(E.dailySeed(day, "normal"), "normal");
  await page.evaluate(() =>
    [...document.querySelectorAll(".sp-tier")].find((x) => x.innerText.includes("보통"))?.click()
  );
  await page.waitForSelector(".sp-board", { timeout: 60000 });
  await page.waitForTimeout(800);
  const x = new Array(pz.truth.length).fill(-1);
  x[pz.start] = 0;
  for (let k = 0; k < 11; k++) {
    const cons = x.map((v, i) => (v >= 0 ? pz.clues[i] : null)).filter(Boolean);
    const f = E.forcedAll(x, cons).sort((a, b) => a.i - b.i)[0];
    if (!f) break;
    x[f.i] = f.v;
    await page.locator(".sp-cell").nth(f.i).click();
    await page.getByRole("button", { name: f.v ? "범인이다" : "무고하다" }).click();
    await page.waitForTimeout(450);
  }
  // 단서 하나를 눌러 노란 표시가 보이게
  await page.evaluate(() => {
    const k = [...document.querySelectorAll(".sp-cell.known")];
    k[k.length - 1]?.click();
  });
  await page.waitForTimeout(700);
  const box = await page.evaluate(() => {
    const s = document.querySelector(".sp-stage").getBoundingClientRect();
    return { cx: s.left + s.width / 2, top: s.top + window.scrollY };
  });
  await page.evaluate((y) => window.scrollTo(0, y), box.top - 110);
  await page.waitForTimeout(500);
  // 메뉴 썸네일 800x500 + 링크 미리보기 1200x630 (lib/og/shots.ts)
  for (const [w, h, out] of [
    [800, 500, "src/img/menu/suspect.jpg"],
    [1200, 630, "assets/og/shots/games__suspect.jpg"],
  ]) {
    const buf = await page.screenshot({
      clip: { x: box.cx - 400, y: 100, width: 800, height: (800 * h) / w },
    });
    await sharp(buf).resize(w, h).jpeg({ quality: 82 }).toFile(path.join(web, out));
  }
  await b.close();
  console.log("ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
