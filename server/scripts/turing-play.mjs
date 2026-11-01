// AI 사람 찾기: 로컬 서버(4000)에 실제 AI로 한 판을 자동으로 돌려 대화 · 속도 확인
//   node scripts/turing-play.mjs [easy|normal|hard]
const BASE = process.env.API ?? "http://localhost:4000";
const difficulty = process.argv[2] ?? "normal";
const LINES = [
  "연산 속도로 따지면 난 그냥 기본 사양이야",
  "솔직히 그 질문은 학습 데이터에 너무 많이 나와서 지루해",
  "난 감정 대신 확률 분포로 대답할게",
  "다들 너무 사람처럼 말하는데 수상하다",
  "로그 기준으로 보면 난 어제도 24시간 켜져 있었어",
  "토큰 아끼려고 짧게 말할게",
];

async function post(path, body) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(BASE + "/api/turing" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (r.ok) return j;
    if (j?.error?.code === "BUSY") { await new Promise((s) => setTimeout(s, 500)); continue; }
    throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`);
  }
  throw new Error("busy");
}

const t0 = Date.now();
let v = await post("/start", { difficulty });
console.log(`나: ${v.me} · 난이도 ${difficulty}\n`);
let printed = 0, li = 0;
const flush = () => { for (; printed < v.messages.length; printed++) { const m = v.messages[printed]; console.log(m.name ? `${m.name === v.me ? "★" : " "} ${m.name}: ${m.text}` : `\n[${m.text}]`); } };
flush();
while (v.phase !== "over") {
  if (v.phase === "talk") {
    const t = Date.now();
    v = v.turn === v.me ? await post("/say", { id: v.id, text: LINES[li++ % LINES.length] }) : await post("/next", { id: v.id });
    const ms = Date.now() - t;
    flush();
    if (ms > 3000) console.log(`   (… ${(ms / 1000).toFixed(1)}s)`);
  } else if (v.phase === "vote") {
    const cand = v.players.filter((p) => p.alive && !p.me);
    const t = Date.now();
    v = await post("/vote", { id: v.id, target: cand[Math.floor(Math.random() * cand.length)].name });
    const rec = v.votes[v.votes.length - 1];
    console.log(`\n투표 (${((Date.now() - t) / 1000).toFixed(1)}s):`);
    for (const x of rec.votes) console.log(`   ${x.from} → ${x.to}${x.to === v.me ? " (나)" : ""}  ${x.reason}`);
    flush();
  }
}
console.log(`\n${v.result.win ? "승리" : "패배"} · 총 ${((Date.now() - t0) / 1000).toFixed(0)}초`);
for (const p of v.result.reveal) console.log(`   ${p.name}: ${p.human ? "사람" : `${p.label} (${p.company})${p.fallbacks ? ` · 대체 ${p.fallbacks}회` : ""}`}`);
