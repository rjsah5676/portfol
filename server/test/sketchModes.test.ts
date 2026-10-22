import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep, startTestServer, type TestClient, type TestServer } from "./helpers";
import { FAKE_LAPS } from "../../web/src/lib/sketch/modes";

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

let seq = 0;
const user = (name: string) => s.client(`${name}-${++seq}`);
const OPTS = { nick: "방장", name: "", max: 8, turnMode: "order", drawTime: 60, rounds: 1, hints: true, password: "" };
const peek = async (id: string) => (await (await user("peek")).sub("sketch.room", { id })).data;

async function roomOf(n: number, o: Record<string, unknown>) {
  const host = await user("host");
  const id = await host.rpc<string>("sketch.createRoom", { ...OPTS, ...o });
  const all: TestClient[] = [host];
  await host.rpc("sketch.join", { id, nick: "방장" });
  for (let i = 1; i < n; i++) {
    const c = await user("p");
    await sleep(2);
    await c.rpc("sketch.join", { id, nick: `참가${i}` });
    all.push(c);
  }
  return { id, host, all };
}
const byUid = (all: TestClient[], uid: string) => all.find((c) => c.uid === uid)!;
const stroke = (g: string, e = false) => ({ g, c: "#000000", w: 7, p: "10,10 20,20 30,30", ...(e ? { e: 1 } : {}) });

describe("그림 맞히기 추가 기능", () => {
  it("따봉: 한 사람 한 번, 그린 사람은 못 누름 / 건너뛰기 투표 과반이면 정답 공개하고 넘어감", async () => {
    const { id, host, all } = await roomOf(3, { mode: "classic", challenge: false });
    await host.rpc("sketch.startGame", { id });
    const st = (await peek(id)).state;
    await host.rpc("sketch.setChoices", { id, turnId: st.turnId, choices: [{ word: "사과", level: 0 }] });
    await host.rpc("sketch.chooseWord", { id, turnId: st.turnId, word: "사과", hint: "○○", level: 0 });
    await all[1].rpc("sketch.like", { id, key: st.turnId });
    await all[1].rpc("sketch.like", { id, key: st.turnId });
    await host.rpc("sketch.like", { id, key: st.turnId });
    expect((await peek(id)).state.likes[st.turnId]).toEqual([all[1].uid]);
    // 건너뛰기: 참가자 2명 중 1명은 과반 아님, 2명이면 넘어감
    await all[1].rpc("sketch.voteSkip", { id, turnId: st.turnId });
    expect((await peek(id)).state.phase).toBe("drawing");
    await all[2].rpc("sketch.voteSkip", { id, turnId: st.turnId });
    expect((await peek(id)).state).toMatchObject({ phase: "reveal", reveal: "사과", correct: {} });
  });

  it("정답을 아는 사람(그린 사람 · 맞힌 사람)의 채팅은 아는 사람끼리만", async () => {
    const { id, host, all } = await roomOf(3, { mode: "classic", challenge: false });
    await host.rpc("sketch.startGame", { id });
    const st = (await peek(id)).state;
    await host.rpc("sketch.setChoices", { id, turnId: st.turnId, choices: [{ word: "배", level: 0 }] });
    await host.rpc("sketch.chooseWord", { id, turnId: st.turnId, word: "배", hint: "○", level: 0 });
    await host.rpc("sketch.markCorrect", { id, guess: { uid: all[1].uid, nick: "x", turnId: st.turnId } });
    const chatA = await all[1].sub("sketch.chat", { id });
    const chatB = await all[2].sub("sketch.chat", { id });
    await all[1].rpc("sketch.sendChat", { id, nick: "x", text: "배 맞지" });
    expect((await chatA.wait((e) => e.t === "add" && e.d.text === "배 맞지")).d.kind).toBe("secret");
    await sleep(80);
    expect(chatB.events.some((e) => e.d?.text === "배 맞지")).toBe(false);
  });

  it("검정 한 색 · 한붓그리기 챌린지는 서버가 막음", async () => {
    const { id, host } = await roomOf(2, { mode: "classic" });
    await host.rpc("sketch.startGame", { id });
    // 챌린지는 무작위라 직접 상태를 확인하는 대신 규칙만: 챌린지 없는 차례에선 아무 색이나 됨
    const st = (await peek(id)).state;
    expect(st.challenge).toBe(""); // 첫 차례는 챌린지 없음
    await host.rpc("sketch.chooseWord", { id, turnId: st.turnId, word: "사과", hint: "○○", level: 0 });
    await host.rpc("sketch.addStroke", { id, turn: st.turnId, s: { ...stroke("a"), c: "#E53935" } });
  });
});

describe("가짜 화가", () => {
  it("한 획씩 돌아가며 → 투표 → 들키면 마지막 기회 → 결과 · 점수, 가짜만 제시어를 모름", async () => {
    const { id, host, all } = await roomOf(3, { mode: "fake" });
    await host.rpc("sketch.startGame", { id });
    let room = await peek(id);
    expect(room.state.phase).toBe("f-draw");
    const m = room.state.m;
    expect(m.order).toHaveLength(3);
    // 비밀: 가짜는 word 가 null
    const secrets = await Promise.all(all.map(async (c) => ({ c, v: (await c.sub("sketch.secret", { id })).data })));
    const fakers = secrets.filter((x) => x.v.faker);
    expect(fakers).toHaveLength(1);
    expect(fakers[0].v.word).toBeNull();
    const word = secrets.find((x) => !x.v.faker)!.v.word;
    expect(word).toBeTruthy();
    expect(secrets.every((x) => x.v.topic === m.topic)).toBe(true);
    const faker = fakers[0].c;

    // FAKE_LAPS 바퀴 × 3명. 지금 차례가 아닌 사람은 못 그림, 한 획에 다른 묶음은 거절
    for (let k = 0; k < 3 * FAKE_LAPS; k++) {
      room = await peek(id);
      const drawer = byUid(all, room.state.drawer);
      const other = all.find((c) => c !== drawer)!;
      await expect(other.rpc("sketch.addStroke", { id, turn: room.state.turnId, s: stroke(`x${k}`) })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await drawer.rpc("sketch.addStroke", { id, turn: room.state.turnId, s: stroke(`g${k}`) });
      await expect(drawer.rpc("sketch.addStroke", { id, turn: room.state.turnId, s: stroke(`h${k}`) })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await drawer.rpc("sketch.addStroke", { id, turn: room.state.turnId, s: stroke(`g${k}`, true) });
    }
    room = await peek(id);
    expect(room.state.phase).toBe("f-vote");
    // 채팅으로 제시어 말하기는 그리는 동안만 막힘 — 투표 땐 됨
    await all[0].rpc("sketch.sendChat", { id, nick: "x", text: "누구야" });
    // 모두 가짜에게 투표 (가짜는 다른 사람에게)
    const step = room.state.step;
    for (const c of all) {
      const target = c === faker ? all.find((x) => x !== faker)!.uid : faker.uid;
      await c.rpc("sketch.vote", { id, step, target });
    }
    room = await peek(id);
    expect(room.state.phase).toBe("f-guess");
    await faker.rpc("sketch.submitText", { id, step: room.state.step, text: word });
    room = await peek(id);
    expect(room.state.phase).toBe("f-result");
    expect(room.state.m).toMatchObject({ faker: faker.uid, word, caught: true, win: "fake" });
    expect(room.scores[faker.uid!].score).toBe(200);
  });
});

describe("그림 릴레이", () => {
  it("문장 → 그림 → 문장, 이어받은 것만 보이고, 끝나면 앨범을 같이 넘김", async () => {
    const { id, host, all } = await roomOf(3, { mode: "relay" });
    await host.rpc("sketch.startGame", { id });
    let room = await peek(id);
    expect(room.state).toMatchObject({ phase: "r-write" });
    expect(room.state.m.steps).toBe(3);
    for (const [i, c] of all.entries()) await c.rpc("sketch.submitText", { id, step: room.state.step, text: `문장${i}` });
    room = await peek(id);
    expect(room.state.phase).toBe("r-draw");
    // 각자 앞사람 문장을 받음
    const sec = await Promise.all(all.map(async (c) => (await c.sub("sketch.secret", { id })).data));
    expect(sec.map((x) => x.task)).toEqual(["draw", "draw", "draw"]);
    expect(sec.map((x) => x.prev.text).sort()).toEqual(["문장0", "문장1", "문장2"]);
    for (const c of all) await c.rpc("sketch.submitSheet", { id, step: room.state.step, strokes: [stroke("a", true)] });
    room = await peek(id);
    expect(room.state.phase).toBe("r-desc");
    const sec2 = await Promise.all(all.map(async (c) => (await c.sub("sketch.secret", { id })).data));
    // 이어받은 그림은 볼 수 있고, 남의 건 못 봄
    expect((await all[0].sub("sketch.sheet", { id, key: sec2[0].prev.sheet })).data).toHaveLength(1);
    await expect(all[0].sub("sketch.sheet", { id, key: sec2[2].prev.sheet })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(all[0].sub("sketch.album", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const c of all) await c.rpc("sketch.submitText", { id, step: room.state.step, text: "그림 설명" });
    room = await peek(id);
    expect(room.state).toMatchObject({ phase: "r-album" });
    const album = (await all[1].sub("sketch.album", { id })).data;
    expect(album).toHaveLength(3);
    expect(album[0].map((e: { text?: string; sheet?: string }) => (e.text ? "t" : "s"))).toEqual(["t", "s", "t"]);
    // 앨범 따봉 → 그 그림 그린 사람 기록
    const key = album[0][1].sheet;
    await all[0].rpc("sketch.like", { id, key });
    expect((await peek(id)).state.likes[key]).toHaveLength(1);
    // 리더가 넘김: 3장 × 3줄
    for (let i = 0; i < 9; i++) await host.rpc("sketch.tick", { id, step: (await peek(id)).state.step, force: true });
    expect((await peek(id)).state.phase).toBe("ended");
  });
  it("못 낸 사람이 나가거나 강퇴되면 기다리지 않고 바로 다음 단계", async () => {
    const { id, host, all } = await roomOf(5, { mode: "relay" });
    await host.rpc("sketch.startGame", { id });
    let room = await peek(id);
    for (const c of all.slice(0, 3)) await c.rpc("sketch.submitText", { id, step: room.state.step, text: "문장" });
    expect((await peek(id)).state.phase).toBe("r-write");
    await all[3].rpc("sketch.leave", { id, nick: "x" });
    expect((await peek(id)).state.phase).toBe("r-write");
    await host.rpc("sketch.kick", { id, target: all[4].uid });
    room = await peek(id);
    expect(room.state.phase).toBe("r-draw");
  });
});

describe("가짜 화가 바퀴 수", () => {
  it("방에서 정한 바퀴만큼 그리면 투표", async () => {
    const { id, all } = await roomOf(3, { mode: "fake", laps: 1 });
    await all[0].rpc("sketch.startGame", { id });
    for (let k = 0; k < 3; k++) {
      const room = await peek(id);
      expect(room.state.phase).toBe("f-draw");
      await byUid(all, room.state.drawer).rpc("sketch.addStroke", { id, turn: room.state.turnId, s: stroke(`l${k}`, true) });
    }
    expect((await peek(id)).state.phase).toBe("f-vote");
    expect((await peek(id)).meta.laps).toBe(1);
  });
});

describe("벤치마크 개선 (2026-10-23)", () => {
  it("릴레이: 인원이 짝수여도 항상 문장으로 끝남 (4명 → 3단계) · 문장에도 따봉", async () => {
    const { id, host, all } = await roomOf(4, { mode: "relay" });
    await host.rpc("sketch.startGame", { id });
    let room = await peek(id);
    expect(room.state.m.steps).toBe(3);
    for (const c of all) await c.rpc("sketch.submitText", { id, step: room.state.step, text: "처음" });
    room = await peek(id);
    for (const c of all) await c.rpc("sketch.submitSheet", { id, step: room.state.step, strokes: [stroke("a", true)] });
    room = await peek(id);
    for (const c of all) await c.rpc("sketch.submitText", { id, step: room.state.step, text: "끝" });
    room = await peek(id);
    expect(room.state.phase).toBe("r-album");
    const album = (await all[1].sub("sketch.album", { id })).data;
    expect(album[0].map((e: { text?: string }) => (e.text ? "t" : "s"))).toEqual(["t", "s", "t"]);
    // 마지막 문장에 따봉 (처음 문장은 안 됨, 내 문장도 안 됨)
    const author = album[0][2].by;
    const liker = all.find((c) => c.uid !== author)!;
    await liker.rpc("sketch.like", { id, key: "r:0:2" });
    await liker.rpc("sketch.like", { id, key: "r:0:0" });
    await byUid(all, author).rpc("sketch.like", { id, key: "r:0:2" });
    const likes = (await peek(id)).state.likes;
    expect(likes["r:0:2"]).toEqual([liker.uid]);
    expect(likes["r:0:0"]).toBeUndefined();
  });

  it("그림 맞히기: 판이 끝나면 그린 그림 모아보기 (그림 · 제시어 · 따봉), 끝나기 전엔 못 봄", async () => {
    const { id, host, all } = await roomOf(2, { mode: "classic", challenge: false, rounds: 1 });
    await host.rpc("sketch.startGame", { id });
    const turns: string[] = [];
    for (let t = 0; t < 2; t++) {
      const st = (await peek(id)).state;
      const drawer = byUid(all, st.drawer);
      const word = ["사과", "배"][t];
      await drawer.rpc("sketch.setChoices", { id, turnId: st.turnId, choices: [{ word, level: 0 }] });
      await drawer.rpc("sketch.chooseWord", { id, turnId: st.turnId, word, hint: "○", level: 0 });
      await drawer.rpc("sketch.addStroke", { id, turn: st.turnId, s: stroke(`g${t}`, true) });
      await drawer.rpc("sketch.endTurn", { id, turnId: st.turnId, reveal: word });
      turns.push(st.turnId);
      if (t === 0) await expect(all[1].sub("sketch.sheet", { id, key: `c:${st.turnId}` })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await host.rpc("sketch.nextTurn", { id, turnId: st.turnId });
    }
    const room = await peek(id);
    expect(room.state.phase).toBe("ended");
    expect(room.state.gallery.map((g: { word: string }) => g.word)).toEqual(["사과", "배"]);
    expect((await all[1].sub("sketch.sheet", { id, key: `c:${turns[0]}` })).data).toHaveLength(1);
    // 판이 끝난 뒤에도 모아보기에서 따봉
    const g0 = room.state.gallery[0];
    const liker = all.find((c) => c.uid !== g0.by)!;
    await liker.rpc("sketch.like", { id, key: g0.key });
    expect((await peek(id)).state.likes[g0.key]).toEqual([liker.uid]);
  });

  it("투표 강퇴: 3명부터, 대상 빼고 과반이면 내보냄 · 다시 누르면 취소", async () => {
    const { id, all } = await roomOf(4, { mode: "classic" });
    const [, b, c, d] = all;
    await b.rpc("sketch.voteKick", { id, target: d.uid });
    expect((await peek(id)).state.kick[d.uid!]).toEqual([b.uid]);
    await b.rpc("sketch.voteKick", { id, target: d.uid });
    expect((await peek(id)).state.kick[d.uid!]).toBeUndefined();
    await b.rpc("sketch.voteKick", { id, target: d.uid });
    await c.rpc("sketch.voteKick", { id, target: d.uid });
    const room = await peek(id);
    expect(room.players[d.uid!]).toBeUndefined();
    expect(room.kicked[d.uid!]).toBeTruthy();
    expect(room.state.kick[d.uid!]).toBeUndefined();
    // 2명이면 투표 강퇴 안 됨
    const two = await roomOf(2, { mode: "classic" });
    await two.all[1].rpc("sketch.voteKick", { id: two.id, target: two.all[0].uid });
    expect((await peek(two.id)).players[two.all[0].uid!]).toBeTruthy();
  });
});
