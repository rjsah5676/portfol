// 니들이 한글을 알아? 판정기(Kiwi) 모델 받기 — server/.kiwi/models/cong/base/ (약 110MB, 레포에는 안 넣음)
//   npm run kiwi:model
// 모델 버전은 설치된 kiwi-nlp 버전과 같아야 함 (다르면 판정기를 올릴 때 wasm 이 죽음)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(dirname(require.resolve("kiwi-nlp")), "..", "package.json"), "utf8"));
const v = pkg.version;
const out = resolve(process.env.KIWI_MODEL_DIR ? join(process.env.KIWI_MODEL_DIR, "..", "..", "..") : ".kiwi");
if (existsSync(join(out, "models", "cong", "base", "cong.mdl")) && !process.argv.includes("--force")) {
  console.log(`[kiwi] 이미 있음: ${out} (다시 받으려면 --force)`);
  process.exit(0);
}
const url = `https://github.com/bab2min/Kiwi/releases/download/v${v}/kiwi_model_v${v}_base.tgz`;
console.log(`[kiwi] 받는 중 ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`[kiwi] 받기 실패 ${res.status}`);
mkdirSync(out, { recursive: true });
const tgz = join(out, "model.tgz");
writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
execFileSync("tar", ["-xzf", "model.tgz"], { cwd: out, stdio: "inherit" });
rmSync(tgz);
console.log(`[kiwi] 준비됨: ${join(out, "models", "cong", "base")}`);
