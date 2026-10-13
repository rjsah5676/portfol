/**
 * 바이러스 키우기 화면 검사 — 여러 화면 크기 · 글자 크기에서 모든 탭과 창을 열어 보고
 *   (1) 스크롤이 생기는 곳  (2) 칸 밖으로 잘리는 내용  (3) 배경과 대비가 4.5:1 미만인 글자
 * 를 찾는다. 개발 서버(localhost:3000)가 떠 있어야 하고, 이 PC의 크롬을 원격 디버깅으로 띄워 씀.
 *
 *   node scripts/virus-ui-check.mjs [--full] [크롬 경로]
 *   기본은 빠른 검사 4가지(작은 폰 · 폰 가로 · PC · 작은 폰 글자 크게), --full 은 7가지 크기 × 글자 2가지
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FULL = process.argv.includes("--full");
const CHROME =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://localhost:3000/games/virus/";
const PORT = 9341;
const SIZES = [
  [360, 640, true],
  [375, 667, true],
  [390, 844, true],
  [844, 390, true],
  [667, 375, true],
  [1280, 800, false],
  [1920, 1080, false],
];
// 중반쯤 저장 (상점 · 프로파일러 · 자동 구매가 다 보이게)
// 후반 저장 (상점 · 커널 · 세트 · 챌린지 진행 중 🔒 · 업적 일부까지 다 보이게)
const SAVE = {
  v: 3,
  data: 5000,
  lifetime: 9e12,
  stage: 250,
  best: 401,
  apexBest: 100,
  clears: 2,
  cores: 1,
  kills: 4,
  lv: { atk: 140, spd: 160, crit: 160 },
  bossFail: true,
  root: 257,
  rootSpent: 200,
  shop: {
    rootkit: 1,
    miner: 1,
    poly: 0,
    profiler: 1,
    cron: 1,
    daemon: 1,
    kprof: 1,
    kpatch: 1,
    kescal: 1,
  },
  auto: false,
  formats: 4,
  ach: ["hello", "st11", "st31", "st51", "ks1", "fmt1", "gb", "tb"],
  rec: {
    play: 20000,
    files: 30000,
    chains: 400,
    bosses: 500,
    apexes: 40,
    fails: 120,
    ups: 900,
    rands: 300,
    jackpots: 9,
    maxHit: 3e9,
    bestFinal: 12.4,
    offMax: 4000,
    offData: 1e11,
    evo: 3,
  },
  mods: [5, 12, 0, 8, 3, 0, 2, 0, 0, 4],
  frag: [4, 30, 0, 7, 2, 0, 1, 0, 0, 3],
  byp: [6, 6, 5, 5, 4, 4, 3, 3, 2, 2],
  keys: [3, 9, 0, 1, 0, 0, 0, 0, 0, 0],
  bossIdx: 3,
  runTop: 260,
  repeat: true,
  savedAt: Date.now(),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = mkdtempSync(join(tmpdir(), "virus-ui-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${prof}`,
  "about:blank",
]);
let tabs;
for (let i = 0; i < 50; i++) {
  try {
    tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    if (tabs.find((t) => t.type === "page")) break;
  } catch {}
  await sleep(200);
}
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const waiters = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiters.has(d.id)) waiters.get(d.id)(d);
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    waiters.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expr) => {
  const r = (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result;
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const key = async (k, code, keyCode) => {
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: keyCode });
  await sleep(350);
};
const click = (txt) =>
  ev(
    `(() => { const b = [...document.querySelectorAll('[data-virus-frame] button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(txt)})); b?.click(); return !!b; })()`
  );

/** 넘침 · 잘림 · 대비 검사 (화면 안에서 실행) */
const CHECK = `(() => {
  const frame = document.querySelector('[data-virus-frame]');
  if (!frame) return JSON.stringify({ issues: ['게임 틀이 사라짐 (검사 중 페이지가 새로 불러와짐)'], lows: [] });
  const out = [];
  const name = (el) => (el.dataset.fit || el.className.toString().split(' ').slice(0, 3).join('.'));
  for (const el of frame.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1))
      out.push('스크롤 ' + name(el) + ' ' + el.scrollHeight + '/' + el.clientHeight);
  }
  for (const el of frame.querySelectorAll('[data-fit]')) {
    if (el.dataset.fit === 'title') {
      const r = el.getBoundingClientRect(), f = frame.getBoundingClientRect();
      const logo = frame.querySelector('.vg-logo > *')?.getBoundingClientRect();
      if (r.top < f.top - 1 || r.bottom > f.bottom + 1) out.push('잘림 title (틀 밖)');
      if (logo && r.top < logo.bottom - 1) out.push('겹침 title-로고 ' + Math.round(logo.bottom - r.top) + 'px');
      continue;
    }
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
      out.push('잘림 ' + el.dataset.fit + ' ' + el.scrollHeight + '/' + el.clientHeight + ' w' + el.scrollWidth + '/' + el.clientWidth);
  }
  // 대비: 글자색(투명도 반영)을 가장 가까운 배경 위에 합성해서 계산
  // 색은 oklch 등 무엇이든 캔버스에 칠해 보고 rgba 로 읽음
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const rgba = (s) => { if (cache.has(s)) return cache.get(s); cx.clearRect(0, 0, 1, 1); cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; const v = [d[0], d[1], d[2], d[3] / 255]; cache.set(s, v); return v; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { let bg = [5, 8, 6]; const stack = []; for (let e = el; e && e !== document.body; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; } for (const c of stack.reverse()) bg = bg.map((v, i) => v * (1 - c[3]) + c[i] * c[3]); return bg; };
  const opa = (el) => { let o = 1; for (let e = el; e && e !== document.body; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  let low = 0; const lows = [];
  for (const el of frame.querySelectorAll('span,p,b,div,button,h3,li,kbd')) {
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!txt) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
    if (el.closest('[aria-hidden="true"],.virus-rain,.vf-static,.vb-black,svg')) continue;
    const o = opa(el); if (o < 0.5) continue; // 애니메이션 중 사라지는 글자
    // 창(어두운 막)에 가려진 글자는 빼기
    const top = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2));
    if (top && !el.contains(top) && !top.contains(el)) continue;
    const bg = bgOf(el); const c = rgba(cs.color); const a = c[3] * o;
    if (c[3] === 0) continue; // 일부러 숨긴 글자 (text-transparent)
    if (!/[\p{L}\p{N}]/u.test(txt)) continue; // 이모지 · 기호만 (색이 정해진 그림 글자)
    const fg = c.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize);
    if (px < 11) lows.push('작음 ' + px.toFixed(1) + 'px "' + txt.slice(0, 18) + '"');
    if (ratio < 4.5 && !(px >= 18.5 || (px >= 14 && Number(cs.fontWeight) >= 700))) { low++; if (lows.length < 40) lows.push('대비 ' + ratio.toFixed(2) + ' "' + txt.slice(0, 18) + '"'); }
  }
  return JSON.stringify({ issues: out, lows });
})()`;

await send("Page.enable");
await send("Runtime.enable");
let total = 0;
const T0 = Date.now();
const report = [];
const RUNS = FULL
  ? [false, true].flatMap((big) => SIZES.map((sz) => [...sz, big]))
  : [
      [360, 640, true, false],
      [844, 390, true, false],
      [1280, 800, false, false],
      [360, 640, true, true],
    ];
{
  for (const [w, h, mobile, big] of RUNS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile,
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    await send("Page.navigate", { url: "about:blank" });
    await sleep(200);
    await send("Page.navigate", { url: URL });
    await sleep(1500);
    for (let i = 0; i < 60 && !(await ev("!!document.querySelector('[data-virus-frame]')")); i++)
      await sleep(500);
    const before = await ev("performance.timeOrigin");
    await ev(
      `localStorage.setItem('virus-idle-v3', ${JSON.stringify(JSON.stringify({ ...SAVE, savedAt: Date.now() }))}); localStorage.setItem('virus-idle-settings', ${JSON.stringify(JSON.stringify({ numbers: true, effects: false, bgm: 0.7, sfx: 0, bgmMute: true, big }))}); location.reload(); true`
    );
    // 새로 불러온 페이지(timeOrigin 이 바뀜)에 게임 틀이 뜰 때까지 — 개발 서버가 다시 빌드하는 중일 수도
    for (let i = 0; i < 80; i++) {
      await sleep(500);
      try {
        if (
          (await ev("performance.timeOrigin")) !== before &&
          (await ev("!!document.querySelector('[data-virus-frame]')"))
        )
          break;
      } catch {}
    }
    await sleep(2500);
    const tag = `${w}×${h}${big ? " 글자크게" : ""}`;
    const look = async (where) => {
      // 개발 서버가 다시 빌드하며 페이지를 새로 불러오는 중일 수 있어서 20초까지 기다려 봄
      for (
        let i = 0;
        i < 40 && !(await ev("!!document.querySelector('[data-virus-frame]')").catch(() => false));
        i++
      )
        await sleep(500);
      console.error(`  ${((Date.now() - T0) / 1000).toFixed(0)}초 · ${tag} · ${where}`);
      // 그래도 게임 틀이 없으면 (화면 오류) 더 볼 것 없이 바로 끝냄
      if (!(await ev("!!document.querySelector('[data-virus-frame]')"))) {
        console.log(report.join("\n"));
        console.log(`\n✖ ${tag} · ${where}: 게임 틀이 없음 — 화면 오류로 멈춤`);
        chrome.kill();
        process.exit(2);
      }
      const r = JSON.parse(await ev(CHECK));
      const bad = [...r.issues, ...r.lows];
      total += bad.length;
      report.push(
        `${bad.length ? "✖" : "✓"} ${tag} · ${where}${bad.length ? "\n     " + bad.join("\n     ") : ""}`
      );
    };
    // 데스크톱은 전체화면으로 (폰은 시작할 때 자동 전체화면)
    if (!mobile) {
      await ev(
        "document.querySelector('[data-virus-frame]').requestFullscreen?.().catch(()=>{}); true"
      );
      await sleep(800);
    }
    await key("a", "KeyA", 65);
    await sleep(900);
    await look("시작 메뉴");
    await key("Enter", "Enter", 13);
    await sleep(3200);
    for (const t of [
      "강화",
      "업그레이드",
      "모듈",
      "코드 모듈",
      "우회",
      "우회 기술",
      "상점",
      "루트 상점",
      "변이",
      "☣️ 변이",
    ]) {
      if (!(await click(t))) continue;
      await sleep(500);
      await look(`탭 ${t}`);
    }
    for (const win of ["바이러스 도감", "기록", "게임 방법", "패치노트", "설정", "세이브 백업"]) {
      await key("Escape", "Escape", 27);
      await sleep(300);
      if (!(await click(win))) {
        await key("Escape", "Escape", 27);
        continue;
      }
      await sleep(600);
      await look(`창 ${win}`);
      // 기록 창은 통계 쪽도
      if (win === "기록" && (await click("📊 통계"))) {
        await sleep(400);
        await look("창 기록 · 통계");
      }
      await key("Escape", "Escape", 27);
    }
    await key("Escape", "Escape", 27);
    await look("메뉴 창");
    await key("Escape", "Escape", 27);
  }
}
console.log(report.join("\n"));
console.log(`\n문제 ${total}개`);
ws.close();
chrome.kill();
await sleep(300);
try {
  rmSync(prof, { recursive: true, force: true });
} catch {}
process.exit(total ? 1 : 0);
