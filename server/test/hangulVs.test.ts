import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { judgeReady } from "../src/hangul/kiwi";
import { sleep, startTestServer, type TestClient, type TestServer } from "./helpers";

/*
 * 니들이 한글을 알아? 대전 「말싸움」 — 방 · 시작 · KO · 투표, 그리고 (판정 모델이 있을 때만) 문장 보내기 · 막기 · 받아치기
 * 판정 모델은 CI 에 없음 → 문장 쪽 테스트는 모델이 있는 개발 PC 에서만 돔 (server 에서 npm run kiwi:model)
 */

let s: TestServer;
beforeAll(async () => {
  s = await startTestServer();
});
afterAll(() => s.close());

let seq = 0;
const user = (name: string) => s.client(`${name}-${++seq}`);

async function duel() {
  const a = await user("a");
  const b = await user("b");
  const id = await a.rpc<string>("hgvs.create", { name: "가" });
  const room = await a.sub("hgvs.room", { id });
  await b.rpc("hgvs.join", { id, name: "나" });
  await b.sub("hgvs.room", { id });
  return { a, b, id, room };
}
const last = async (c: TestClient, id: string) => (await c.sub("hgvs.room", { id })).data;

describe("대전 방", () => {
  it("만들고 · 들어오고 · 셋째는 못 들어옴, 시작은 방장만", async () => {
    const { a, b, id } = await duel();
    const r = await last(a, id);
    expect(r.phase).toBe("waiting");
    expect(r.players.map((p: any) => p.name)).toEqual(["가 (GUEST)", "나 (GUEST)"].map((n) => expect.stringContaining(n.slice(0, 1))));
    await expect((await user("c")).rpc("hgvs.join", { id, name: "다" })).rejects.toMatchObject({ code: "ROOM_FULL" });
    await expect(b.rpc("hgvs.start", { id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await a.rpc("hgvs.start", { id });
    const p = await last(a, id);
    expect(p.phase).toBe("play");
    expect(p.seed).toBeGreaterThan(0);
    expect(p.endAt - p.startAt).toBe(180_000);
  });

  it("먹물 100 이면 KO — 상대가 이김, 판 끝나면 상대 문장에만 표", async () => {
    const { a, b, id, room } = await duel();
    await a.rpc("hgvs.start", { id });
    await b.rpc("hgvs.load", { id, load: 37 });
    await room.wait((e) => e.d?.players?.find((p: any) => p.uid === b.uid)?.load === 37);
    await b.rpc("hgvs.load", { id, load: 120 });
    const ev = await room.wait((e) => e.d?.phase === "ended");
    expect(ev.d).toMatchObject({ winner: a.uid, reason: "ko" });
    await expect(a.rpc("hgvs.vote", { id, msg: "없는문장" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("훈장님 AI 를 앉히면 혼자서도 시작, 대기 중 나가면 방장이 넘어가거나 방이 사라짐", async () => {
    const a = await user("solo");
    const id = await a.rpc<string>("hgvs.create", { name: "혼자" });
    await a.sub("hgvs.room", { id });
    await a.rpc("hgvs.bot", { id, level: 3 });
    let r = await last(a, id);
    expect(r.players[1]).toMatchObject({ bot: 3, name: "훈장님 (어려움)" });
    await a.rpc("hgvs.bot", { id, level: 1 });
    r = await last(a, id);
    expect(r.players).toHaveLength(2);
    expect(r.players[1].bot).toBe(1);
    await a.rpc("hgvs.leave", { id });
    await sleep(50);
    expect(await last(await user("peek"), id)).toBeNull();
  });

  it("훈장님이 앉아 있어도 초대받은 친구가 오면 자리를 비켜 줌", async () => {
    const a = await user("h");
    const id = await a.rpc<string>("hgvs.create", { name: "방장" });
    await a.sub("hgvs.room", { id });
    await a.rpc("hgvs.bot", { id, level: 2 });
    const b = await user("f");
    await b.rpc("hgvs.join", { id, name: "친구" });
    const r = await last(a, id);
    expect(r.players.map((p: any) => p.uid)).toEqual([a.uid, b.uid]);
  });

  it("판 중에 사람 상대가 나가면 잠시 기다려 줌, 훈장님 판은 나가면 바로 짐", async () => {
    const a = await user("x");
    const id = await a.rpc<string>("hgvs.create", { name: "엑스" });
    await a.sub("hgvs.room", { id });
    await a.rpc("hgvs.bot", { id, level: 2 });
    await a.rpc("hgvs.start", { id });
    const watch = await (await user("w")).sub("hgvs.room", { id });
    await a.rpc("hgvs.leave", { id });
    const ev = await watch.wait((e) => e.d?.phase === "ended");
    expect(ev.d).toMatchObject({ reason: "left", winner: "bot:hunjang:2" });
  });

  it("판이 아닐 땐 문장을 못 냄 · 이모트는 정해진 것만", async () => {
    const { a, id, room } = await duel();
    await expect(a.rpc("hgvs.sentence", { id, text: "밥먹자.", mode: "send" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.rpc("hgvs.emote", { id, e: "💩" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await a.rpc("hgvs.emote", { id, e: "😂" });
    const ev = await room.wait((e) => e.t === "emote");
    expect(ev.d).toEqual({ uid: a.uid, e: "😂" });
  });
});

describe.skipIf(!judgeReady())("말싸움 (판정 모델 필요)", () => {
  async function started() {
    const d = await duel();
    await d.a.rpc("hgvs.start", { id: d.id });
    await sleep(3_050); // 카운트다운
    return d;
  }

  it("보내기 → 상대에게 날아가는 공격, 같은 말로 받아치면 반사(×1.5), 문장이 아니면 거절", async () => {
    const { a, b, id } = await started();
    await expect(a.rpc("hgvs.sentence", { id, text: "르이오", mode: "send" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const sent = await a.rpc("hgvs.sentence", { id, text: "너바보임.", mode: "send" });
    expect(sent.kind).toBe("send");
    let r = await last(b, id);
    const atk = r.attacks.find((x: any) => x.id === sent.attack);
    expect(atk).toMatchObject({ from: a.uid, to: b.uid, status: "flying" });
    expect(atk.arriveAt - atk.at).toBeGreaterThanOrEqual(1_800);
    const back = await b.rpc("hgvs.sentence", { id, text: "니가바보다.", mode: "send" });
    expect(back.kind).toBe("counter");
    r = await last(b, id);
    expect(r.attacks.find((x: any) => x.id === sent.attack).status).toBe("reflected");
    const re = r.attacks.find((x: any) => x.id === back.attack);
    expect(re).toMatchObject({ from: b.uid, to: a.uid, rally: 1 });
    expect(re.power).toBe(Math.round((atk.power + back.points) * 1.5));
  }, 20_000);

  it("문장은 전부 공격 (이어지지 않으면 그냥 서로 날아감) · 같은 문장 재탕은 힘 ×0.3", async () => {
    const { a, b, id } = await started();
    const first = await a.rpc("hgvs.sentence", { id, text: "밥먹자." });
    const other = await b.rpc("hgvs.sentence", { id, text: "오늘힘들다." });
    expect(other.kind).toBe("send");
    const r = await last(b, id);
    expect(r.attacks.find((x: any) => x.id === first.attack).status).toBe("flying");
    expect(r.attacks.find((x: any) => x.id === other.attack)).toMatchObject({ from: b.uid, to: a.uid });
    await sleep(1_300);
    const again = await a.rpc("hgvs.sentence", { id, text: "밥먹자." });
    expect(again.points).toBe(Math.round(first.points * 0.3));
  }, 20_000);
});
