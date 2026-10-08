import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module"; import { pathToFileURL } from "node:url";
const ROOT="/home/claude/p2/web"; const require=createRequire(path.join(ROOT,"package.json")); const ts=require("typescript");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"pr-"));
for (const n of ["analyze","autochart","chart","patterns","stars"]) {
  let out=ts.transpileModule(fs.readFileSync(path.join(ROOT,"src/lib/rhythm",`${n}.ts`),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  fs.writeFileSync(path.join(tmp,`${n}.mjs`),out.replace(/from "\.\/(\w+)"/g,'from "./$1.mjs"'));
}
const { analyzeAudio, SR } = await import(pathToFileURL(path.join(tmp,"analyze.mjs")).href);
const charts=JSON.parse(fs.readFileSync("/home/claude/osz2/charts_new.json","utf8"));
const bySet={};
for (const c of charts){ const id=c.set.split(" ")[0]; (bySet[id]??=[]).push(c); }
const ids=process.argv.slice(2);
for (const id of ids){
  const raw=execFileSync("ffmpeg",["-v","error","-i",`/home/claude/osz2/audio/osu_audio/${id}.mp3`,"-ac","1","-ar",String(SR),"-f","f32le","-"],{maxBuffer:1<<30});
  const pcm=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4);
  globalThis.OfflineAudioContext=class{createBufferSource(){return{connect(){},start(){}}}get destination(){return{}}async startRendering(){return{getChannelData:()=>pcm}}};
  const a=await analyzeAudio({duration:pcm.length/SR},()=>{},{});
  const top=bySet[id].reduce((x,y)=>x.notes.length>y.notes.length?x:y);
  const ref=[...new Set(top.notes.map(n=>n[0]/1000))].sort((x,y)=>x-y);
  const med=(arr)=>{const s=[...arr].sort((x,y)=>x-y);return s.length?s[s.length>>1]:NaN};
  const near=(ts,t)=>{let b=1e9;let lo=0,hi=ts.length-1;while(lo<hi){const m=(lo+hi)>>1;ts[m]<t?lo=m+1:hi=m;}for(const j of [lo-1,lo,lo+1]) if(j>=0&&j<ts.length&&Math.abs(ts[j]-t)<Math.abs(b)) b=ts[j]-t; return b;};
  // osu 줄 기준: 가장 가까운 (1) 스냅된 onset (2) 격자 칸 과의 차이
  const on=a.onsets.map(o=>o.t);
  const d1=ref.map(t=>near(on,t)).filter(d=>Math.abs(d)<0.05).map(d=>d*1000);
  const d2=ref.map(t=>near(a.grid,t)).filter(d=>Math.abs(d)<0.05).map(d=>d*1000);
  console.log(id, "osu줄→스냅onset", med(d1).toFixed(1), "ms / osu줄→격자칸", med(d2).toFixed(1), "ms  (양수=우리가 늦음... 아니, ours−osu)");
}
fs.rmSync(tmp,{recursive:true,force:true});
