// 포커 소리 파일 목록 만들기: public/poker/sound 안의 mp3/wav/ogg 를 훑어 manifest.json 에 적음
//   node scripts/poker-sound-manifest.mjs
// 이름 = 확장자 뺀 상대 경로 (예: "sfx-deal", "voice/jinwoo/jinwoo-call-big")
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("../public/poker/sound", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1"
);
const out = {};
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(mp3|wav|ogg)$/i.test(f)) {
      const rel = relative(ROOT, p).split(sep).join("/");
      out[rel.replace(/\.(mp3|wav|ogg)$/i, "")] = rel;
    }
  }
};
walk(ROOT);
writeFileSync(join(ROOT, "manifest.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`${Object.keys(out).length}개`);
