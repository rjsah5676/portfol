import fs from "node:fs"; import { loadLib } from "./lib.mjs";
const { stars } = await loadLib();
const osu = JSON.parse(fs.readFileSync("/home/claude/osz2/charts_new.json","utf8")).filter(c=>c.stars>0);
const by={}; for (const c of osu) (by[c.set.split(" ")[0]]??=[]).push(c);
const [run, lo, hi, diff] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const SR=(n)=>stars.starRating(n)*4;
const noLN=(n)=>n.map(x=>({t:x.t,lane:x.lane}));
const single=(n)=>{const seen=new Set();return n.filter(x=>{const k=Math.round(x.t*1000);if(seen.has(k))return false;seen.add(k);return true;});};
const med=a=>{a=[...a].sort((x,y)=>x-y);return a[a.length>>1]};
const R={o:[],u:[]};
for (const f of fs.readdirSync("out_"+run).filter(f=>f.startsWith("o_"))) {
  const O=JSON.parse(fs.readFileSync("out_"+run+"/"+f)); const ex=O.charts[diff]; if(!ex) continue;
  const c=(by[O.id.slice(2)]||[]).find(c=>c.stars*4>=lo&&c.stars*4<hi); if(!c) continue;
  const on=c.notes.map(n=>({t:n[0]/1000,lane:n[1],...(n.length>2&&n[2]>n[0]?{end:n[2]/1000}:{})}));
  const un=ex.notes.map(n=>({t:n[0],lane:n[1],...(n.length>2?{end:n[2]}:{})}));
  for (const [k,n] of [["o",on],["u",un]]) { const s=single(noLN(n)); const dur=n[n.length-1].t-n[0].t;
    R[k].push({lv:SR(n), lvNoLN:SR(noLN(n)), lvSingle:SR(s), nps:n.length/dur, rps:s.length/dur}); }
}
for (const k of ["o","u"]) console.log(k, Object.keys(R[k][0]).map(m=>m+" "+med(R[k].map(x=>x[m])).toFixed(2)).join("  "), "n", R[k].length);
