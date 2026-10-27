/**
 * 타자 프레임 렌더 (헤드리스 크롬 + three.js)
 *   THREE_DIR=<three 패키지 폴더> node scripts/baseball-batter/render.mjs <출력 폴더> [배율 4]
 * 프레임마다 4패스 PNG: <이름>.id.png · .shade.png · .spec.png · .col.png  + meta.json (기준점 · 등번호 · 배트 끝)
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2];
const SS = +(process.argv[3] ?? 4);
const THREE_DIR = process.env.THREE_DIR;
if (!OUT || !THREE_DIR) throw new Error("usage: THREE_DIR=... node render.mjs <out> [ss]");
fs.mkdirSync(OUT, { recursive: true });

// 화면 1px = 몇 단위 → 최종 프레임 (슈퍼샘플 전) 크기
const PPU = +(process.env.PPU ?? 96);
const W = 300, H = 300;

const html = `<!doctype html><html><body style="margin:0;background:transparent">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script>
<script type="module">
import * as THREE from "three";
import { buildBatter, applyPose, mix } from "/bb/model.js";
import { FRAMES, KEYS } from "/bb/poses.js";
const SS = ${SS}, W = ${W} * SS, H = ${H} * SS, PPU = ${PPU} * SS;
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
// 포수 뒤 · 살짝 플레이트 쪽 · 위에서 (직교 — 프레임마다 같은 자리)
const toCam = new THREE.Vector3(0.3, 0, -1).normalize().multiplyScalar(Math.cos(0.35)).add(new THREE.Vector3(0, Math.sin(0.35), 0)).normalize();
const target = new THREE.Vector3(0.1, 0.95, 0.15);
const cam = new THREE.OrthographicCamera(-W / 2 / PPU, W / 2 / PPU, H / 2 / PPU, -H / 2 / PPU, 0.1, 50);
cam.position.copy(target.clone().add(toCam.clone().multiplyScalar(20)));
cam.lookAt(target);
cam.updateMatrixWorld();
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.copy(toCam.clone().multiplyScalar(4).add(new THREE.Vector3(0, 6, 0)).add(new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), toCam).multiplyScalar(-3)));
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const B = buildBatter(scene);
const proj = (v) => { const p = v.clone().project(cam); return [ (p.x * 0.5 + 0.5) * W / SS, (-p.y * 0.5 + 0.5) * H / SS ]; };
window.go = (i, pass) => {
  const [name, a, b, t] = FRAMES[i];
  const k = mix(KEYS[a], KEYS[b], t);
  const r = applyPose(B, k);
  B.setPass(pass);
  renderer.render(scene, cam);
  const meta = { name, dbg: r.dbg, warn: r.warn, clear: r.clear, clear0: r.clear0, origin: proj(new THREE.Vector3(0, 0, 0)), num: proj(r.num), tip: proj(r.tip),
    back: r.back.dot(toCam), numUp: proj(r.num.clone().add(r.backU.clone().multiplyScalar(0.1))) };
  return { url: renderer.domElement.toDataURL("image/png"), meta };
};
window.N = FRAMES.length;
window.ready = true;
</script></body></html>`;

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.route("http://bb.local/**", async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === "/") return route.fulfill({ body: html, contentType: "text/html" });
  const file = u.pathname.startsWith("/three/") ? path.join(THREE_DIR, u.pathname.slice(7)) : path.join(HERE, u.pathname.slice(4));
  route.fulfill({ body: fs.readFileSync(file), contentType: "text/javascript" });
});
await page.goto("http://bb.local/");
await page.waitForFunction("window.ready === true", null, { timeout: 60000 });
const n = await page.evaluate("window.N");
const metas = [];
for (let i = 0; i < n; i++) {
  let meta;
  for (const pass of ["id", "shade", "spec", "col"]) {
    const r = await page.evaluate(([i, pass]) => window.go(i, pass), [i, pass]);
    meta = r.meta;
    fs.writeFileSync(path.join(OUT, `${String(i).padStart(2, "0")}.${pass}.png`), Buffer.from(r.url.split(",")[1], "base64"));
  }
  metas.push(meta);
  console.log(i, meta.name, JSON.stringify(meta.dbg), meta.warn.join(" "), "clear", meta.clear0.toFixed(3), "→", meta.clear.toFixed(3));
}
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ W, H, SS, PPU, frames: metas }, null, 1));
await browser.close();
