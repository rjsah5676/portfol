import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

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

    // 두 바퀴 = 6획. 지금 차례가 아닌 사람은 못 그림, 한 획에 다른 묶음은 거절
    for (let k = 0; k < 6; k++) {
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

describe("그림 속 거짓말", () => {
  it("각자 그림 → 가짜 제목(진짜와 같으면 거절) → 고르기(내 것 못 고름) → 공개 · 점수", async () => {
    const { id, host, all } = await roomOf(3, { mode: "lie" });
    await host.rpc("sketch.startGame", { id });
    let room = await peek(id);
    expect(room.state.phase).toBe("l-draw");
    const prompts = new Map<string, string>();
    for (const c of all) prompts.set(c.uid!, (await c.sub("sketch.secret", { id })).data.prompt);
    expect(new Set(prompts.values()).size).toBe(3);
    // 그린 사람만 자기 그림을 봄
    await expect(all[1].sub("sketch.sheet", { id, key: `l:${all[0].uid}` })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const c of all) await c.rpc("sketch.submitSheet", { id, step: room.state.step, strokes: [stroke("a", true)] });
    room = await peek(id);
    expect(room.state.phase).toBe("l-write");
    const artist = byUid(all, room.state.m.artist);
    const others = all.filter((c) => c !== artist);
    // 이제 다들 그 그림을 볼 수 있음
    expect((await others[0].sub("sketch.sheet", { id, key: `l:${artist.uid}` })).data).toHaveLength(1);
    await expect(others[0].rpc("sketch.submitText", { id, step: room.state.step, text: prompts.get(artist.uid!)! })).rejects.toMatchObject({ code: "TOO_CLOSE" });
    await others[0].rpc("sketch.submitText", { id, step: room.state.step, text: "춤추는 감자" });
    await others[1].rpc("sketch.submitText", { id, step: room.state.step, text: "졸린 햄버거" });
    room = await peek(id);
    expect(room.state.phase).toBe("l-pick");
    const opts = room.state.m.options as { id: string; text: string }[];
    expect(opts.map((o) => o.text).sort()).toEqual(["졸린 햄버거", "춤추는 감자", prompts.get(artist.uid!)!].sort());
    const potato = opts.find((o) => o.text === "춤추는 감자")!;
    const truth = opts.find((o) => o.text === prompts.get(artist.uid!))!;
    await expect(others[0].rpc("sketch.pick", { id, step: room.state.step, option: potato.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await others[0].rpc("sketch.pick", { id, step: room.state.step, option: truth.id });
    await others[1].rpc("sketch.pick", { id, step: room.state.step, option: potato.id });
    room = await peek(id);
    expect(room.state.phase).toBe("l-show");
    expect(room.state.m.prompt).toBe(prompts.get(artist.uid!));
    // 진짜 고름 +100, 그린 사람 +50, 내 가짜에 속은 사람 1명 → +50
    expect(room.scores[others[0].uid!].score).toBe(150);
    expect(room.scores[others[1].uid!].score).toBe(0);
    expect(room.scores[artist.uid!].score).toBe(50);
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
});
