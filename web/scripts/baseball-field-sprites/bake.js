// node bake2.js fielder|batter outdir
const { chromium } = require("/home/claude/.npm-global/lib/node_modules/playwright");
const fs = require("fs");
const MODEL = process.argv[2], OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const ACT = {
  fielder: [
    { tag: "ready", clip: "_01a18653", n: 4, loop: true },
    { tag: "idle", clip: "m_idle", n: 4, loop: true },
    { tag: "run", clip: "m_run", n: 8, loop: true },
    { tag: "sprint", clip: "m_sprint", n: 8, loop: true },
    { tag: "fly", clip: "_01a1868f", n: 10, key: ["LeftHand", "high"], pre: 0.65, post: 0.5 },
    { tag: "throw", clip: "_inf_throw", n: 10, key: ["RightHand", "fast"], pre: 0.67, post: 0.45 },
    { tag: "cthrow", clip: "_catch_throw2b", n: 10, key: ["RightHand", "fast"], pre: 0.52, post: 0.45 },
    { tag: "pick", clip: "Male_Run_Forward_Pick_Up_Left", n: 10, key: ["LeftHand", "low"], pre: 0.56, post: 0.4 },
    { tag: "diveL", clip: "_dive_left", n: 10, key: ["LeftHand", "far"], pre: 0.54, post: 0.7 },
    { tag: "diveR", clip: "_dive_right", n: 10, key: ["LeftHand", "far"], pre: 0.54, post: 0.7 },
    { tag: "stretch", clip: "_first_stretch", n: 8, key: ["LeftHand", "front"], pre: 0.52, post: 0.4 },
    { tag: "squat", clip: "_catch_squat", n: 2, loop: true },
    { tag: "cheer", clip: "m_cheer", n: 6, loop: true },
  ],
  batter: [
    { tag: "idle", clip: "m_idle", n: 4, loop: true },
    { tag: "run", clip: "m_run", n: 8, loop: true },
    { tag: "sprint", clip: "m_sprint", n: 8, loop: true },
    { tag: "jog", clip: "m_jog", n: 8, loop: true },
    { tag: "slide", clip: "m_slide", n: 8 },
    { tag: "cheer", clip: "m_cheer", n: 6, loop: true },
  ],
}[MODEL];
(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await page.addInitScript((m) => { window.MODEL = m; window.BLUR = 6; }, MODEL);
  await page.goto("http://127.0.0.1:8790/spr/index.html");
  await page.waitForFunction(() => window.ready, null, { timeout: 180000 });
  const info = await page.evaluate(() => ({ anchor: window.anchor, clips: window.clipNames, durs: window.durs }));
  const meta = { anchor: info.anchor, cell: 256, acts: {} };
  for (const a of ACT) {
    const name = info.clips.find((c) => c === a.clip) ?? info.clips.find((c) => c.startsWith(a.clip));
    if (!name) { console.log("MISSING", a.tag, a.clip); continue; }
    const dur = info.durs[name];
    let t0 = 0, t1 = dur, key = -1;
    if (a.key) {
      const [kt] = await page.evaluate(([c, b, m]) => window.keyTime(c, b, m), [name, a.key[0], a.key[1]]);
      t0 = Math.max(0, kt - a.pre); t1 = Math.min(dur, kt + a.post);
      key = Math.round(((kt - t0) / (t1 - t0)) * a.n);
    }
    const r = await page.evaluate(([j, dirs]) => window.bake([j], dirs), [{ clip: name, n: a.n, t0, t1 }, 8]);
    const { base, mask } = Object.values(r)[0];
    base.forEach((row, d) => row.forEach((u, i) => fs.writeFileSync(`${OUT}/${a.tag}_d${d}_f${i}.png`, Buffer.from(u.split(",")[1], "base64"))));
    mask.forEach((row, d) => row.forEach((u, i) => fs.writeFileSync(`${OUT}/${a.tag}_d${d}_f${i}_m.png`, Buffer.from(u.split(",")[1], "base64"))));
    // 한 장 시간 (클립 초) — 게임은 이 비율로 재생
    meta.acts[a.tag] = { n: a.n, loop: !!a.loop, span: t1 - t0, key };
    console.log("baked", a.tag, name, (t1 - t0).toFixed(2), "key", key);
  }
  fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta));
  await browser.close();
})();
