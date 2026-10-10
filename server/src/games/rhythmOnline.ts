import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { AppError, bad, forbidden } from "../errors";
import type { LiveRoom } from "../http/admin";
import { RHYTHM_SONG_INFO } from "../http/rhythmCharts";
import { newId } from "../ids";
import { GUEST_MARK } from "../users";
import { RESTORED, RESTORE_GRACE_MS, type LiveGame } from "../live";
import type { Ctx } from "../realtime/gateway";

/*
 * 리듬게임(BEAT DASH) 온라인 — 같은 곡을 여럿이 동시에 치고 점수를 겨룸
 *
 * 방장이 곡(내장곡 또는 "내 음악")을 고르고, 각자 난이도를 고른 뒤 모두 준비하면 방장이 시작.
 *  lobby ─start→ loading (각자 음원·채보 받기) ─다 받으면→ playing (startAt 에 모두 같이 시작) ─다 끝나면→ result
 *
 * 성능이 먼저: 서버가 하는 일은 방 상태 관리와 점수 모아 뿌리기뿐.
 *  - 플레이 중 진행(점수·콤보·정확도·HP)은 각자 0.5초마다 보내고, 서버는 모아서 0.5초마다 한 번만 뿌림
 *  - 상대 화면과 완벽히 맞출 필요 없음 (점수판 용도) — 늦게 온 값은 그냥 덮어씀
 *
 * 내 음악: 방장 브라우저에서 분석한 채보 + 음원 파일을 HTTP 로 올려 두고 참가자들이 받아 감.
 *  같은 채보를 모두가 받아서 치므로(각자 분석하지 않음) 브라우저마다 채보가 달라질 일이 없음.
 *  파일은 서버 임시 폴더에 방이 있는 동안만 두고, 곡을 바꾸거나 방이 없어지면 지움.
 *
 * 구독 채널
 *   rhythm.lobby          방 목록
 *   rhythm.room  { id }   방 상태 ("room") + 플레이 중 점수판 ("live") + 대기실 채팅 ("chat")
 *
 * HTTP (내 음악 파일)
 *   POST /api/rhythm-online/:id/:ver/audio?k=올리기키   음원 (방장)
 *   POST /api/rhythm-online/:id/:ver/chart?k=올리기키   채보 JSON (방장)
 *   GET  /api/rhythm-online/:id/:ver/audio?k=받기키     음원 (방 참가자 — 받기키는 rhythm.fileKey 로)
 *   GET  /api/rhythm-online/:id/:ver/chart?k=받기키     채보
 */

export type Phase = "lobby" | "loading" | "playing" | "result";

const DIFFS = ["easy", "normal", "hard", "expert", "nightmare", "explus"] as const;
type Diff = (typeof DIFFS)[number];

interface Player {
  nick: string;
  joinedAt: number;
  ready: boolean;
  diff: Diff;
}

/** 방장이 고른 곡 */
interface Song {
  kind: "builtin" | "custom";
  /** 내장곡 id, 내 음악은 올린 버전 id (곡을 바꿀 때마다 새로) */
  id: string;
  title: string;
  duration: number;
  /** 고를 수 있는 난이도 (내 음악은 채보가 올라온 뒤에 채워짐) */
  diffs: Diff[];
  /** 내 음악: 음원·채보가 다 올라왔는지 (내장곡은 늘 true) */
  ready: boolean;
  /** 내 음악: 표시용 정보 (방장 브라우저가 분석한 값) */
  info?: { bpm: number; bpmLabel: number; beatOffset: number; color: string; artist?: string };
  /** 내 음악: 음원 크기(byte)·종류 — 받는 쪽 진행 표시용 */
  bytes?: number;
  /** 내 음악: 난이도별 레벨 (채보가 올라오면) — 받기 전에도 난이도 고를 때 보이게 */
  levels?: Partial<Record<Diff, number>>;
}

/** 플레이 중 진행: [점수, 콤보, 정확도(0~100), HP(0~100), 죽음 1/0, 끝 1/0, PERFECT, GREAT, GOOD, MISS 수] */
type LiveRow = [number, number, number, number, number, number, number, number, number, number];

interface ResultRow {
  nick: string;
  diff: Diff;
  score: number;
  acc: number;
  rank: string;
  maxCombo: number;
  failed: boolean;
  fc: boolean;
  ap: boolean;
  counts: { perfect: number; great: number; good: number; miss: number };
}

interface Round {
  no: number;
  /** 이번 판에 치는 사람 (시작할 때 방에 있던 사람) */
  roster: string[];
  loaded: string[];
  /** 모두 같이 음악이 시작하는 서버 시각 (loading 중엔 0) */
  startAt: number;
  results: Record<string, ResultRow>;
}

interface Meta {
  name: string;
  hostUid: string;
  max: number;
  createdAt: number;
}

interface Room {
  id: string;
  meta: Meta;
  players: Record<string, Player>;
  phase: Phase;
  song: Song | null;
  round: Round | null;
  // ── 여기부터 방 상태로 나가지 않는 것 ──
  live: Record<string, LiveRow>;
  liveDirty: boolean;
  /** 대기실 채팅 (최근 CHAT_KEEP 개) */
  chat: ChatMsg[];
  /** 내 음악 파일: 올리기 키(방장만 앎) · 받기 키(참가자만 받아 감) · 올라온 것 */
  upload: { ver: string; upKey: string; downKey: string; audioType: string; audio: boolean; chart: string | null } | null;
  owners: Map<string, string>;
  emptySince: number;
  timer: NodeJS.Timeout | null;
}

export interface ChatMsg {
  id: string;
  uid: string;
  nick: string;
  text: string;
  ts: number;
}

const MAX_ROOMS = 200;
const CHAT_KEEP = 50;
/** 한 사람이 이 간격(ms) 안에 다시 보내면 무시 (도배 막기) */
const CHAT_GAP_MS = 400;
/** 다 받을 때까지 기다리는 최대 시간 (못 받은 사람은 이번 판에서 빠짐) */
const LOAD_TIMEOUT_MS = 60_000;
/** 다 받은 뒤 시작까지 — 각자 카운트다운(최대 약 7초)을 다 보여 줄 만큼 */
const START_DELAY_MS = 8_000;
/** 곡 길이 + 이만큼 지나도 안 끝낸 사람은 기다리지 않음 */
const END_GRACE_MS = 15_000;
/** 점수판 뿌리는 간격 */
const LIVE_EVERY_MS = 500;
const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const MAX_CHART_BYTES = 4 * 1024 * 1024;
const MAX_SONG_SEC = 12 * 60;

const roomId = z.string().min(1).max(40);
const idOnly = z.object({ id: roomId });
const nickSchema = z.string().min(1).max(10);
const diffSchema = z.enum(DIFFS);

/** 들어온 순서 */
const ordered = (room: Room) =>
  Object.entries(room.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt || a[0].localeCompare(b[0]));
/** 방장이 나가 있으면 가장 먼저 들어와 있는 사람 */
const leaderOf = (room: Room) => (room.players[room.meta.hostUid] ? room.meta.hostUid : (ordered(room)[0]?.[0] ?? ""));

const FILE_DIR = join(tmpdir(), "rhythm-online");
const audioPath = (room: Room, ver: string) => join(FILE_DIR, `${room.id}-${ver}.bin`);

/** 채보 JSON 확인: { 난이도: { level, units, notes: [[t, lane, end?], ...] } } */
const chartSchema = z.partialRecord(
  diffSchema,
  z.object({
    level: z.number().int().min(0).max(30),
    units: z.number().int().min(1).max(40_000),
    notes: z.array(z.array(z.number().finite()).min(2).max(3)).min(1).max(20_000),
  })
);

export function registerRhythmOnline({ gateway }: Deps) {
  const rooms = new Map<string, Room>();
  let draining = false;
  const LOBBY = "rhythm:lobby";
  const roomKey = (id: string) => `rhythm:room:${id}`;

  // ───────────── 내보내기 ─────────────

  const roomWire = (r: Room) => ({
    id: r.id,
    meta: r.meta,
    players: r.players,
    phase: r.phase,
    song: r.song,
    round: r.round,
  });
  // 아무도 없는 방(마지막 사람이 끊겨 잠깐 기다리는 중)은 목록에 안 보임
  const lobbyWire = () =>
    [...rooms.values()]
      .filter((r) => Object.keys(r.players).length > 0)
      .map((r) => ({
        id: r.id,
        name: r.meta.name,
        max: r.meta.max,
        count: Object.keys(r.players).length,
        phase: r.phase,
        song: r.song?.title ?? "",
        createdAt: r.meta.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

  let lobbyDirty = false;
  function changed(room: Room) {
    gateway.emit(roomKey(room.id), "room", roomWire(room));
    if (lobbyDirty) return;
    lobbyDirty = true;
    queueMicrotask(() => {
      lobbyDirty = false;
      gateway.emit(LOBBY, "list", lobbyWire());
    });
  }

  // 플레이 중인 방의 점수판: 바뀐 게 있을 때만, 방마다 0.5초에 한 번
  const liveTick = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.phase !== "playing" || !room.liveDirty || !room.round) continue;
      room.liveDirty = false;
      gateway.emit(roomKey(room.id), "live", { round: room.round.no, rows: room.live });
    }
  }, LIVE_EVERY_MS);
  liveTick.unref();

  function clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }
  function later(room: Room, ms: number, fn: () => void) {
    clearTimer(room);
    room.timer = setTimeout(() => {
      room.timer = null;
      if (rooms.get(room.id) === room) fn();
    }, ms);
    room.timer.unref();
  }

  /** 내 음악 파일 지우기 */
  function dropUpload(room: Room) {
    const up = room.upload;
    room.upload = null;
    if (up) void rm(audioPath(room, up.ver), { force: true }).catch(() => {});
  }

  function removeRoom(room: Room) {
    clearTimer(room);
    dropUpload(room);
    rooms.delete(room.id);
    gateway.emit(roomKey(room.id), "room", null);
    gateway.emit(LOBBY, "list", lobbyWire());
  }

  /** 판이 끝났는지 확인: 이번 판 사람이 모두 끝냈거나(죽음 포함) 나갔으면 결과로 */
  function checkRoundEnd(room: Room) {
    const r = room.round;
    if (!r || room.phase !== "playing") return;
    const waiting = r.roster.filter((uid) => room.players[uid] && !r.results[uid]);
    if (!waiting.length) endRound(room);
  }
  function endRound(room: Room) {
    clearTimer(room);
    room.phase = "result";
    for (const p of Object.values(room.players)) p.ready = false;
    // 마지막 점수판도 한 번 (결과 화면이 늦게 뜨는 사람이 마지막 값을 보게)
    if (room.round) gateway.emit(roomKey(room.id), "live", { round: room.round.no, rows: room.live });
    room.liveDirty = false;
    changed(room);
  }
  /** loading → playing: 받은 사람만 이번 판에 남기고 시작 시각을 정함 */
  function begin(room: Room) {
    const r = room.round;
    if (!r || room.phase !== "loading") return;
    r.roster = r.roster.filter((uid) => room.players[uid] && r.loaded.includes(uid));
    if (!r.roster.length) {
      room.phase = "lobby";
      room.round = null;
      clearTimer(room);
      changed(room);
      return;
    }
    room.phase = "playing";
    r.startAt = Date.now() + START_DELAY_MS;
    room.live = Object.fromEntries(r.roster.map((uid) => [uid, [0, 0, 100, 100, 0, 0, 0, 0, 0, 0] as LiveRow]));
    room.liveDirty = false;
    later(room, START_DELAY_MS + (room.song?.duration ?? 0) * 1000 + END_GRACE_MS, () => endRound(room));
    changed(room);
  }

  /** 자리에서 빼기 (나가기·끊김). 방장이었으면 먼저 들어온 사람이 이어받음 */
  function removePlayer(room: Room, uid: string) {
    if (!room.players[uid]) return;
    delete room.players[uid];
    room.owners.delete(uid);
    const leader = leaderOf(room);
    if (leader && leader !== room.meta.hostUid) room.meta.hostUid = leader;
    if (!Object.keys(room.players).length) room.emptySince = Date.now();
    if (room.phase === "loading" && room.round && room.round.roster.every((u) => !room.players[u] || room.round!.loaded.includes(u)))
      begin(room);
    else if (room.phase === "playing") checkRoundEnd(room);
    changed(room);
  }

  // ───────────── 권한 ─────────────

  const getRoom = (id: string): Room => {
    const room = rooms.get(id);
    if (!room) throw new AppError("NO_ROOM", "방이 없습니다.", 404);
    return room;
  };
  function asPlayer(ctx: Ctx, id: string) {
    const room = getRoom(id);
    const uid = ctx.uid;
    if (!room.players[uid]) throw forbidden();
    return { room, uid };
  }
  function asHost(ctx: Ctx, id: string) {
    const { room, uid } = asPlayer(ctx, id);
    if (leaderOf(room) !== uid) throw forbidden("방장만 할 수 있어요.");
    return { room, uid };
  }
  /** 곡·준비를 바꿀 수 있는 때 (대기 · 결과 화면) */
  function idle(room: Room) {
    if (room.phase === "loading" || room.phase === "playing") throw new AppError("BUSY", "게임 중에는 바꿀 수 없어요.", 409);
  }

  // ───────────── 구독 ─────────────

  gateway.channel("rhythm.lobby", { key: () => LOBBY, snapshot: () => lobbyWire() });
  gateway.channel("rhythm.room", {
    key(ctx, p) {
      void ctx.uid; // 로그인(익명 포함)한 사람만
      return roomKey(idOnly.parse(p).id);
    },
    snapshot(ctx, _key, p) {
      const room = rooms.get(idOnly.parse(p).id);
      if (!room) return null;
      const uid = ctx.user?.uid;
      if (uid && room.owners.get(uid) === RESTORED) room.owners.set(uid, ctx.socket.id);
      return { ...roomWire(room), live: room.phase === "playing" ? room.live : null, chat: room.chat };
    },
  });

  // ───────────── 방 만들기 · 입장 · 퇴장 ─────────────

  const createSchema = z.object({ nick: nickSchema, name: z.string().max(60), max: z.number().int() });
  gateway.rpc("rhythm.create", (ctx, raw) => {
    const uid = ctx.uid;
    const o = createSchema.parse(raw);
    if (rooms.size >= MAX_ROOMS) throw bad("방이 너무 많아요. 잠시 후 다시 시도해주세요.");
    const id = newId();
    const now = Date.now();
    const room: Room = {
      id,
      meta: {
        name: o.name.trim().slice(0, 20) || `${ctx.name(o.nick).replaceAll(GUEST_MARK, "")}의 방`,
        hostUid: uid,
        max: Math.min(8, Math.max(2, o.max)),
        createdAt: now,
      },
      players: {},
      phase: "lobby",
      song: null,
      round: null,
      live: {},
      liveDirty: false,
      upload: null,
      chat: [],
      owners: new Map(),
      emptySince: now,
      timer: null,
    };
    rooms.set(id, room);
    changed(room);
    return id;
  });

  const joinSchema = z.object({ id: roomId, nick: nickSchema, joinedAt: z.number().finite().optional(), rejoin: z.boolean().default(false) });
  gateway.rpc("rhythm.join", (ctx, raw) => {
    const { id, nick: typed, joinedAt, rejoin } = joinSchema.parse(raw);
    const uid = ctx.uid;
    const nick = ctx.name(typed);
    const room = getRoom(id);
    if (!room.players[uid] && !rejoin && Object.keys(room.players).length >= room.meta.max)
      throw new AppError("ROOM_FULL", "방이 가득 찼어요.", 409);
    const now = Date.now();
    const prev = room.players[uid];
    room.players[uid] = {
      nick,
      joinedAt: prev?.joinedAt ?? Math.max(room.meta.createdAt, Math.min(now, joinedAt ?? now)),
      ready: prev?.ready ?? false,
      diff: prev?.diff ?? defaultDiff(room),
    };
    room.owners.set(uid, ctx.socket.id);
    const leader = leaderOf(room);
    if (leader && leader !== room.meta.hostUid) room.meta.hostUid = leader;
    changed(room);
    return { joinedAt: room.players[uid].joinedAt };
  });

  gateway.rpc("rhythm.leave", (ctx, raw) => {
    const { id } = idOnly.parse(raw);
    const uid = ctx.uid;
    const room = rooms.get(id);
    if (!room || !room.players[uid]) return null;
    removePlayer(room, uid);
    // 마지막 사람이 직접 나가면 바로 정리 (끊김은 다시 붙을 수 있게 sweep 이 1분 기다림)
    if (!Object.keys(room.players).length) removeRoom(room);
    return null;
  });

  gateway.onDisconnect((ctx) => {
    const uid = ctx.user?.uid;
    if (!uid) return;
    for (const room of rooms.values()) if (room.owners.get(uid) === ctx.socket.id) removePlayer(room, uid);
  });

  // ───────────── 곡 · 난이도 · 준비 ─────────────

  /** 새로 들어온 사람의 난이도: 방장 난이도 (곡에 없으면 그 곡의 가운데쯤) */
  function defaultDiff(room: Room): Diff {
    const host = room.players[room.meta.hostUid]?.diff ?? "normal";
    const diffs = room.song?.diffs ?? [];
    if (!diffs.length || diffs.includes(host)) return host;
    return diffs[Math.min(1, diffs.length - 1)];
  }
  /** 곡이 바뀌면: 준비 풀고, 각자 난이도가 그 곡에 없으면 가까운 것으로 */
  /** 곡이 바뀌면: 준비 풀고, 난이도는 모두 방장이 고른 것으로 (난이도는 방장이 정함) */
  function songChanged(room: Room, hostDiff?: Diff) {
    const diff = hostDiff ?? room.players[leaderOf(room)]?.diff ?? "normal";
    for (const p of Object.values(room.players)) {
      p.ready = false;
      p.diff = diff;
      fitDiff(room, p);
    }
  }
  function fitDiff(room: Room, p: Player) {
    const diffs = room.song?.diffs ?? [];
    if (!diffs.length || diffs.includes(p.diff)) return;
    // 없는 난이도면 그보다 낮은 것 중 가장 높은 것
    const want = DIFFS.indexOf(p.diff);
    const lower = diffs.filter((d) => DIFFS.indexOf(d) <= want);
    p.diff = lower.length ? lower[lower.length - 1] : diffs[0];
  }

  const builtinSchema = z.object({ id: roomId, song: z.string().min(1).max(40), diff: diffSchema, title: z.string().min(1).max(60) });
  gateway.rpc("rhythm.setSong", (ctx, raw) => {
    const { id, song, diff, title } = builtinSchema.parse(raw);
    const { room } = asHost(ctx, id);
    idle(room);
    const info = RHYTHM_SONG_INFO.get(song);
    if (!info) throw bad("없는 곡입니다.");
    dropUpload(room);
    room.song = {
      kind: "builtin",
      id: song,
      title: title.slice(0, 60),
      duration: info.duration,
      diffs: DIFFS.filter((d) => info.diffs.includes(d)),
      ready: true,
    };
    room.phase = "lobby";
    songChanged(room, diff);
    changed(room);
    return null;
  });

  // 숫자·제목은 거르지 않고 범위로 맞춤 (긴 파일 이름 · 특이한 BPM 때문에 "잘못된 요청"이 나던 것)
  const fit = (lo: number, hi: number) => z.number().finite().transform((v) => Math.max(lo, Math.min(hi, v)));
  const customSchema = z.object({
    id: roomId,
    title: z.string().max(500).transform((t) => t.trim().slice(0, 80) || "내 음악"),
    diff: diffSchema,
    duration: z.number().finite(),
    bytes: z.number().int().min(1),
    audioType: z.string().max(200),
    info: z.object({
      bpm: fit(20, 600),
      bpmLabel: fit(20, 900),
      beatOffset: fit(-10, 60),
      color: z.string().catch("#F472B6").transform((c) => (/^#[0-9A-Fa-f]{6}$/.test(c) ? c : "#F472B6")),
    }),
  });
  /** 내 음악을 고름 → 올리기 키를 돌려줌 (파일은 HTTP 로 올림. 다 올라오면 song.ready) */
  gateway.rpc("rhythm.setCustom", (ctx, raw) => {
    const o = customSchema.parse(raw);
    const { room } = asHost(ctx, o.id);
    if (o.duration < 10) throw bad("10초보다 짧은 곡은 같이 칠 수 없어요.");
    if (o.duration > MAX_SONG_SEC) throw bad("12분이 넘는 곡은 같이 칠 수 없어요.");
    if (o.bytes > MAX_AUDIO_BYTES) throw bad("음원 파일이 너무 커요 (60MB까지).");
    idle(room);
    dropUpload(room);
    const ver = newId(10);
    room.upload = {
      ver,
      upKey: newId(24),
      downKey: newId(24),
      audioType: /^(audio|video)\/[\w.+-]+$/.test(o.audioType) ? o.audioType : "application/octet-stream",
      audio: false,
      chart: null,
    };
    room.song = {
      kind: "custom",
      id: ver,
      title: o.title,
      duration: o.duration,
      diffs: [],
      ready: false,
      info: o.info,
      bytes: o.bytes,
    };
    room.phase = "lobby";
    songChanged(room, o.diff);
    changed(room);
    return { ver, key: room.upload.upKey };
  });

  /** 내 음악 파일 받기 키 — 방 참가자만 */
  gateway.rpc("rhythm.fileKey", (ctx, raw) => {
    const { room } = asPlayer(ctx, idOnly.parse(raw).id);
    const up = room.upload;
    if (!up || room.song?.id !== up.ver) return null;
    return { ver: up.ver, key: up.downKey };
  });

  /** 난이도 (방장이 정하고 모두 같은 난이도) — 바꾸면 다들 다시 준비 */
  gateway.rpc("rhythm.diff", (ctx, raw) => {
    const { id, diff } = z.object({ id: roomId, diff: diffSchema }).parse(raw);
    const { room, uid } = asHost(ctx, id);
    idle(room);
    if (room.song?.diffs.length && !room.song.diffs.includes(diff)) throw bad("이 곡에 없는 난이도예요.");
    if (room.players[uid].diff === diff) return null;
    for (const p of Object.values(room.players)) {
      p.diff = diff;
      p.ready = false;
    }
    changed(room);
    return null;
  });

  gateway.rpc("rhythm.ready", (ctx, raw) => {
    const { id, ready } = z.object({ id: roomId, ready: z.boolean() }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    idle(room);
    const p = room.players[uid];
    if (p.ready !== ready) {
      p.ready = ready;
      changed(room);
    }
    return null;
  });

  gateway.rpc("rhythm.start", (ctx, raw) => {
    const { room, uid } = asHost(ctx, idOnly.parse(raw).id);
    idle(room);
    if (draining) throw new AppError("RESTARTING", "서버를 곧 다시 시작해요. 잠시 후 다시 해주세요.", 503);
    if (!room.song) throw bad("곡을 먼저 골라주세요.");
    if (!room.song.ready) throw bad("곡 파일을 아직 올리는 중이에요.");
    const notReady = Object.entries(room.players).filter(([u, p]) => u !== uid && !p.ready);
    if (notReady.length) throw new AppError("NOT_READY", "아직 준비 안 한 사람이 있어요.", 409);
    room.phase = "loading";
    room.round = {
      no: (room.round?.no ?? 0) + 1,
      roster: ordered(room).map(([u]) => u),
      loaded: [],
      startAt: 0,
      results: {},
    };
    room.live = {};
    later(room, LOAD_TIMEOUT_MS, () => begin(room));
    changed(room);
    return null;
  });

  /** 음원·채보를 다 받았음 (loading) */
  gateway.rpc("rhythm.loaded", (ctx, raw) => {
    const { id, round } = z.object({ id: roomId, round: z.number().int() }).parse(raw);
    const { room, uid } = asPlayer(ctx, id);
    const r = room.round;
    if (room.phase !== "loading" || !r || r.no !== round || !r.roster.includes(uid)) return null;
    if (!r.loaded.includes(uid)) r.loaded.push(uid);
    if (r.roster.every((u) => !room.players[u] || r.loaded.includes(u))) begin(room);
    else changed(room);
    return null;
  });

  /** 플레이 중 진행 (0.5초마다) — 응답 없이 빨리 */
  const progSchema = z.object({
    id: roomId,
    round: z.number().int(),
    // 판정 수 4개는 미니 화면(다른 사람 플레이)의 판정 표시용 — 예전 클라이언트는 6개만 보냄
    r: z.array(z.number()).min(6).max(10),
  });
  gateway.rpc("rhythm.prog", (ctx, raw) => {
    const { id, round, r: row } = progSchema.parse(raw);
    const room = rooms.get(id);
    const uid = ctx.uid;
    if (!room || room.phase !== "playing" || room.round?.no !== round || !room.live[uid]) return null;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
    room.live[uid] = [
      Math.round(clamp(row[0], 0, 1_000_000)),
      Math.round(clamp(row[1], 0, 100_000)),
      Math.round(clamp(row[2], 0, 100) * 100) / 100,
      Math.round(clamp(row[3], 0, 100)),
      row[4] ? 1 : 0,
      row[5] ? 1 : 0,
      ...[6, 7, 8, 9].map((i) => Math.round(clamp(row[i] ?? 0, 0, 40_000))),
    ] as LiveRow;
    room.liveDirty = true;
    return null;
  });

  const resultSchema = z.object({
    id: roomId,
    round: z.number().int(),
    score: z.number().int().min(0).max(1_000_000),
    acc: z.number().min(0).max(100),
    rank: z.string().max(4),
    maxCombo: z.number().int().min(0).max(100_000),
    failed: z.boolean(),
    fc: z.boolean(),
    ap: z.boolean(),
    counts: z.object({
      perfect: z.number().int().min(0),
      great: z.number().int().min(0),
      good: z.number().int().min(0),
      miss: z.number().int().min(0),
    }),
  });
  /** 내 판이 끝남 (끝까지 쳤거나 죽음) */
  gateway.rpc("rhythm.done", (ctx, raw) => {
    const { id, round, ...res } = resultSchema.parse(raw);
    const room = rooms.get(id);
    const uid = ctx.uid;
    const r = room?.round;
    if (!room || !r || r.no !== round || !r.roster.includes(uid) || r.results[uid]) return null;
    if (room.phase !== "playing") return null;
    const p = room.players[uid];
    r.results[uid] = { nick: p?.nick ?? "?", diff: p?.diff ?? "normal", ...res };
    const lv = room.live[uid];
    if (lv) {
      const c = res.counts;
      room.live[uid] = [res.score, lv[1], res.acc, res.failed ? 0 : lv[3], res.failed ? 1 : 0, 1, c.perfect, c.great, c.good, c.miss];
    }
    room.liveDirty = true;
    changed(room);
    checkRoundEnd(room);
    return null;
  });

  /** 결과 화면 → 대기실 (방장) */
  gateway.rpc("rhythm.back", (ctx, raw) => {
    const { room } = asHost(ctx, idOnly.parse(raw).id);
    if (room.phase !== "result") return null;
    room.phase = "lobby";
    changed(room);
    return null;
  });

  /** 대기실 채팅 (플레이 중에도 받기는 하지만 화면엔 대기실·결과에서만 보임) */
  const lastChat = new Map<string, number>();
  gateway.rpc("rhythm.chat", (ctx, raw) => {
    const o = z.object({ id: roomId, text: z.string().min(1).max(200) }).parse(raw);
    const { room, uid } = asPlayer(ctx, o.id);
    const text = o.text.replace(/\s+/g, " ").trim().slice(0, 100);
    if (!text) return null;
    const now = Date.now();
    if (now - (lastChat.get(uid) ?? 0) < CHAT_GAP_MS) return null;
    lastChat.set(uid, now);
    if (lastChat.size > 5000) lastChat.clear();
    const msg: ChatMsg = { id: newId(), uid, nick: room.players[uid].nick, text, ts: now };
    room.chat.push(msg);
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    gateway.emit(roomKey(room.id), "chat", msg);
    return null;
  });

  // ───────────── 내 음악 파일 (HTTP) ─────────────

  const router: Router = express.Router();
  const part = z.enum(["audio", "chart"]);
  router.post(
    "/:id/:ver/:part",
    express.raw({ type: () => true, limit: MAX_AUDIO_BYTES }),
    (req, res, next) => {
      void (async () => {
        const room = getRoom(String(req.params.id));
        const which = part.parse(req.params.part);
        const up = room.upload;
        if (!up || up.ver !== req.params.ver || req.query.k !== up.upKey) throw forbidden();
        const body = req.body as Buffer;
        if (!Buffer.isBuffer(body) || !body.length) throw bad();
        if (which === "chart") {
          if (body.length > MAX_CHART_BYTES) throw bad("채보가 너무 커요.");
          const parsed = chartSchema.parse(JSON.parse(body.toString("utf8")));
          if (!Object.keys(parsed).length) throw bad();
          up.chart = body.toString("utf8");
          if (room.song?.id === up.ver) {
            room.song.diffs = DIFFS.filter((d) => d in parsed);
            room.song.levels = Object.fromEntries(room.song.diffs.map((d) => [d, parsed[d]!.level]));
          }
        } else {
          await mkdir(FILE_DIR, { recursive: true });
          await writeFile(audioPath(room, up.ver), body);
          up.audio = true;
        }
        // 그 사이 곡이 바뀌었으면 버림
        if (room.upload !== up) {
          await rm(audioPath(room, up.ver), { force: true });
          throw new AppError("STALE", "곡이 바뀌었어요.", 409);
        }
        if (up.audio && up.chart && room.song?.id === up.ver && !room.song.ready) {
          room.song.ready = true;
          for (const p of Object.values(room.players)) fitDiff(room, p);
          changed(room);
        } else if (which === "chart") changed(room);
        res.json({ ok: true });
      })().catch(next);
    }
  );
  router.get("/:id/:ver/:part", (req, res, next) => {
    void (async () => {
      const room = getRoom(String(req.params.id));
      const which = part.parse(req.params.part);
      const up = room.upload;
      if (!up || up.ver !== req.params.ver || req.query.k !== up.downKey) throw forbidden();
      res.set({ "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" });
      if (which === "chart") {
        if (!up.chart) throw new AppError("NOT_READY", "아직 올라오지 않았어요.", 409);
        res.type("application/json").send(up.chart);
        return;
      }
      if (!up.audio) throw new AppError("NOT_READY", "아직 올라오지 않았어요.", 409);
      const file = audioPath(room, up.ver);
      const st = await stat(file);
      res.set({ "Content-Type": up.audioType, "Content-Length": String(st.size) });
      createReadStream(file).on("error", next).pipe(res);
    })().catch(next);
  });

  // ───────────── 정리 ─────────────

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const room of [...rooms.values()])
      if (!Object.keys(room.players).length && now - room.emptySince >= 60_000) removeRoom(room);
  }, 30_000);
  sweep.unref();

  // ───────────── 배포 때 이어받기 (live.ts) ─────────────
  // 진행 중인 판은 이어 칠 수 없으니(음악이 끊김) 끝나길 기다리고, 방(사람·곡 선택)만 저장.
  // 내 음악 파일은 서버 임시 폴더에 있어 새 서버로 못 가져가므로 곡 선택을 비움
  const live: LiveGame = {
    busy: () => [...rooms.values()].some((r) => r.phase === "loading" || r.phase === "playing"),
    drain() {
      draining = true;
    },
    snapshot: () =>
      [...rooms.values()].map((r) => ({
        id: r.id,
        meta: r.meta,
        players: r.players,
        song: r.song?.kind === "builtin" ? r.song : null,
        emptySince: r.emptySince,
      })),
    restore(data) {
      for (const r of data as { id: string; meta: Meta; players: Record<string, Player>; song: Song | null; emptySince: number }[]) {
        rooms.set(r.id, {
          id: r.id,
          meta: r.meta,
          players: Object.fromEntries(Object.entries(r.players).map(([u, p]) => [u, { ...p, ready: false }])),
          phase: "lobby",
          song: r.song,
          round: null,
          live: {},
          liveDirty: false,
          upload: null,
          chat: [],
          owners: new Map(Object.keys(r.players).map((uid) => [uid, RESTORED])),
          emptySince: r.emptySince,
          timer: null,
        });
      }
      setTimeout(() => {
        for (const room of [...rooms.values()])
          for (const [uid, owner] of [...room.owners]) if (owner === RESTORED) removePlayer(room, uid);
      }, RESTORE_GRACE_MS).unref();
    },
  };

  return {
    live,
    router,
    close() {
      clearInterval(liveTick);
      clearInterval(sweep);
      for (const room of rooms.values()) {
        clearTimer(room);
        dropUpload(room);
      }
    },
    adminList(): LiveRoom[] {
      return [...rooms.values()].map((r) => ({
        id: r.id,
        name: r.meta.name,
        status: r.phase,
        players: Object.values(r.players).map((p) => p.nick),
        createdAt: r.meta.createdAt,
      }));
    },
    adminClose(id: string): boolean {
      const room = rooms.get(id);
      if (room) removeRoom(room);
      return !!room;
    },
  };
}
