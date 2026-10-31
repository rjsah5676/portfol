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
  await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((x) => x.innerText.trim() === "보통" && x.classList.contains("sp-btn"))
      ?.click()
  );
  await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((x) => x.innerText.includes("새 연습 사건"))
      ?.click()
  );
  await page.waitForSelector(".sp-board", { timeout: 60000 });
  await page.waitForTimeout(800);
  const btn = (t) =>
    `[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('${t}'))`;
  for (let k = 0; k < 9; k++) {
    await page.evaluate(
      `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));let tg=document.querySelector('.sp-cell.target');if(!tg){${btn("힌트")}.click();await s(150);tg=document.querySelector('.sp-cell.target');if(!tg){${btn("힌트")}.click();await s(150);tg=document.querySelector('.sp-cell.target');}}if(!tg)return;const info=document.querySelector('.sp-info').innerText;tg.click();await s(150);const crim=/[은는] 범인이에요/.test(info);(crim?${btn("범인이다")}:${btn("무고하다")}).click();await s(250);})()`
    );
    await page.waitForTimeout(600);
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
  const buf = await page.screenshot({ clip: { x: box.cx - 400, y: 100, width: 800, height: 500 } });
  await sharp(buf)
    .resize(800, 500)
    .jpeg({ quality: 82 })
    .toFile(process.argv[2] || path.join(web, "src/img/menu/suspect.jpg"));
  await b.close();
  console.log("ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
