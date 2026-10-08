import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";
const ROOT="/home/claude/p2/web"; const require=createRequire(path.join(ROOT,"package.json")); const ts=require("typescript");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"ct-"));
for (const n of ["analyze","autochart","chart","patterns","stars"]) {
  let out=ts.transpileModule(fs.readFileSync(path.join(ROOT,"src/lib/rhythm",`${n}.ts`),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  fs.writeFileSync(path.join(tmp,`${n}.mjs`),out.replace(/from "\.\/(\w+)"/g,'from "./$1.mjs"'));
}
const { analyzeAudio, SR } = await import(pathToFileURL(path.join(tmp,"analyze.mjs")).href);
const truth = JSON.parse(fs.readFileSync("/tmp/claude-0/s/truth.json","utf8"));
for (const f of ["click.wav","click.mp3"]) {
  const raw=execFileSync("ffmpeg",["-v","error","-i","/tmp/claude-0/s/"+f,"-ac","1","-ar",String(SR),"-f","f32le","-"],{maxBuffer:1<<30});
  const pcm=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4);
  globalThis.OfflineAudioContext=class{createBufferSource(){return{connect(){},start(){}}}get destination(){return{}}async startRendering(){return{getChannelData:()=>pcm}}};
  const a=await analyzeAudio({duration:pcm.length/SR},()=>{},{});
  // 타격(스냅 전 원시 시각은 없음 — grid 스냅 전 refine 시각이 onsets.t에 들어갔다가 스냅됨; 비교는 비트로)
  const ds=[];
  for (const t of truth){
    let best=1e9;
    for (const o of a.onsets){ if (Math.abs(o.t-t)<Math.abs(best)) best=o.t-t; }
    if (Math.abs(best)<0.1) ds.push(best*1000);
  }
  ds.sort((x,y)=>x-y);
  const med=ds[ds.length>>1];
  const bs=[];
  for (const t of truth){ let b=1e9; for(const bt of a.beats){ if(Math.abs(bt-t)<Math.abs(b)) b=bt-t; } if(Math.abs(b)<0.12) bs.push(b*1000); }
  bs.sort((x,y)=>x-y);
  console.log(f, "onset−truth median", med?.toFixed(1), "ms  beat−truth", bs[bs.length>>1]?.toFixed(1), "ms  n", ds.length);
}
fs.rmSync(tmp,{recursive:true,force:true});
