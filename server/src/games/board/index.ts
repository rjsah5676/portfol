import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Doc } from "../../db";
import type { Deps } from "../../deps";
import { AppError, bad, forbidden } from "../../errors";
import { isClientId, newId } from "../../ids";
import { KeyedMutex } from "../../mutex";
import type { Ctx } from "../../realtime/gateway";
import { liveList } from "../../realtime/liveList";
import {
  ABANDON_AFTER_MS,
  ADD_TIME_MS,
  CHAT_LIMIT,
  CHAT_MAX,
  MAX_SPECTATORS,
  OFFLINE_AFTER_MS,
  colorOf,
  isPauseExpired,
  liveClock,
  other,
  toWire,
  turnOf,
  undoPlies,
  winFor,
  type Color,
  type GameRules,
  type RoomDoc,
} from "./core";
import { GAMES, type GameKey } from "./rules";

/*
 * 체스·장기·오목 온라인 대국 방.
 *
 * 기존에는 브라우저가 Firestore 트랜잭션으로 직접 하던 일(착석, 수 두기, 시계, 무르기, 무승부 …)을
 * 서버가 같은 규칙으로 처리함. 수는 서버가 게임 엔진으로 검증하고, 시각은 전부 서버 시계 기준.
 *
 * 구독 채널
 *   board.lobby     { g }            방 목록 (최근 갱신 40개)
 *   board.room      { g, id }        방 상태 (없으면 null)
 *   board.presence  { g, id }        접속 상태 (uid → { name, lastSeen })
 *   board.chat      { g, id }        채팅
 * 요청은 전부 board.<동작> (아래 register 참고), 인자에 g = "chess" | "janggi" | "omok"
 */

interface PrivateDoc {
  /** 초대 링크용 키 (참가자만 읽을 수 있음) */
  invite: string;
  /** 비밀번호 해시 (아무에게도 안 보냄) */
  pw?: string;
  /** 비밀번호·초대키를 맞힌 사람 */
  access: string[];
}
interface ChatDoc {
  room: string;
  uid: string;
  name: string;
  text: string;
  createdAt: Date;
}
interface PresenceDoc {
  room: string;
  uid: string;
  name: string;
  lastSeen: Date;
}

const gameKey = z.enum(["chess", "janggi", "omok"]);
const roomRef = z.object({ g: gameKey, id: z.string().min(1).max(64) });
const nick = z.string().max(20);

/** 비밀번호는 방 id와 섞은 SHA-256 해시로만 저장·비교 (기존 방식 그대로) */
const hashPassword = (roomId: string, pw: string) => createHash("sha256").update(`${roomId}:${pw}`).digest("hex");
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const randomKey = () => newId(24);

const noRoom = () => new AppError("NO_ROOM", "방이 존재하지 않습니다.", 404);

export function registerBoardGames({ db, gateway }: Deps) {
  const mutex = new KeyedMutex();
  const privates = db.col<PrivateDoc>("board_private");
  const chats = db.col<ChatDoc>("board_chat");
  const presences = db.col<PresenceDoc>("board_presence");

  const games = Object.fromEntries(
    (Object.keys(GAMES) as GameKey[]).map((g) => [g, makeGame(g, GAMES[g] as GameRules)])
  ) as Record<GameKey, ReturnType<typeof makeGame>>;

  function makeGame(g: GameKey, rules: GameRules) {
    const rooms = db.col<Omit<RoomDoc, "_id">>(rules.collection);
    const path = (id: string) => `${rules.collection}/${id}`;
    const roomKey = (id: string) => `board:${g}:${id}`;
    const presenceKey = (id: string) => `board:${g}:${id}:presence`;
    const chatKey = (id: string) => `board:${g}:${id}:chat`;

    const lobby = liveList(
      gateway,
      `board:${g}:lobby`,
      async () => (await rooms.find({}).sort({ updatedAt: -1 }).limit(40).toArray()).map((r) => toWire(r as RoomDoc)),
      50
    );

    const getRoom = async (id: string) => (await rooms.findOne({ _id: id })) as RoomDoc | null;

    /**
     * 방 하나를 읽고 → fn이 바꿀 내용을 돌려주면 → 저장하고 구독자에게 알림.
     * 같은 방에 대한 요청은 순서대로 하나씩만 실행됨. fn이 null/undefined면 아무것도 안 바꿈.
     */
    function mutate(
      id: string,
      fn: (room: RoomDoc, now: Date) => Partial<RoomDoc> | null | void | Promise<Partial<RoomDoc> | null | void>
    ): Promise<RoomDoc> {
      return mutex.run(path(id), async () => {
        const room = await getRoom(id);
        if (!room) throw noRoom();
        const patch = await fn(room, new Date());
        if (!patch) return room;
        const next: RoomDoc = { ...room, ...patch, v: (room.v ?? 0) + 1 };
        const { _id: _omit, ...set } = { ...patch, v: next.v } as Partial<RoomDoc>;
        await rooms.updateOne({ _id: id }, { $set: set });
        gateway.emit(roomKey(id), "room", toWire(next));
        lobby.publish();
        return next;
      });
    }

    const lastSeenOf = async (id: string, uid: string): Promise<number | null> => {
      const p = await presences.findOne({ _id: `${path(id)}/${uid}` });
      return p ? p.lastSeen.getTime() : null;
    };

    async function presenceMap(id: string) {
      const list = await presences.find({ room: path(id) }).toArray();
      const out: Record<string, { name: string; lastSeen: number }> = {};
      for (const p of list) out[p.uid] = { name: p.name, lastSeen: p.lastSeen.getTime() };
      return out;
    }
    const publishPresence = async (id: string) => {
      if (gateway.subscribers(presenceKey(id)).length) gateway.emit(presenceKey(id), "presence", await presenceMap(id));
    };
    const removePresence = async (id: string, uid: string) => {
      await presences.deleteOne({ _id: `${path(id)}/${uid}` });
      await publishPresence(id);
    };

    async function hasAccess(room: RoomDoc, uid: string): Promise<boolean> {
      if (!room.locked || colorOf(room, uid) || room.spectators[uid] !== undefined) return true;
      const p = await privates.findOne({ _id: path(room._id) });
      return !!p?.access.includes(uid);
    }
    const requireEnter = async (room: RoomDoc, uid: string) => {
      if (!(await hasAccess(room, uid))) throw forbidden("비밀번호가 필요한 방입니다.");
    };

    /** 2시간 넘게 멈춘 대국 종료 (무승부) */
    const expirePaused = (id: string) =>
      mutate(id, (room, now) => {
        if (!isPauseExpired(room, now.getTime())) return;
        return { status: "ended", result: "1/2-1/2", reason: "paused", updatedAt: now };
      });

    /** 내가 대국자로 앉아있는 대기/진행중 방 (방 중복 생성·참여 방지용) */
    async function findMyActiveRoom(uid: string): Promise<RoomDoc | null> {
      const list = (await rooms.find({ $or: [{ whiteUid: uid }, { blackUid: uid }] }).toArray()) as RoomDoc[];
      const now = Date.now();
      const active = list
        .filter((r) => {
          if (isPauseExpired(r, now)) {
            expirePaused(r._id).catch(() => {});
            return false;
          }
          return r.status === "waiting" || r.status === "playing";
        })
        .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
      return active[0] ?? null;
    }
    const activeRoomError = (room: RoomDoc) =>
      new AppError("ACTIVE_ROOM", "이미 진행중인 게임이 있습니다.", 409, toWire(room));

    /** 방장만, 대국 중일 때만 */
    const hostMutate = (
      id: string,
      uid: string,
      fn: (room: RoomDoc, now: Date) => Partial<RoomDoc> | null | void
    ) =>
      mutate(id, (room, now) => {
        if (room.hostUid !== uid) throw bad("방장만 할 수 있습니다.");
        if (room.status !== "playing") throw bad("대국 중이 아닙니다.");
        return fn(room, now);
      });

    // 비밀번호 대입 방지: 한 사람이 한 방에 1분에 10번까지
    const unlockTries = new Map<string, { at: number; n: number }>();
    function countUnlockTry(key: string) {
      const now = Date.now();
      const t = unlockTries.get(key);
      if (!t || now - t.at > 60_000) unlockTries.set(key, { at: now, n: 1 });
      else if (++t.n > 10) throw new AppError("RATE_LIMITED", "잠시 후 다시 시도해주세요.", 429);
      if (unlockTries.size > 5000) unlockTries.clear();
    }

    return {
      rules,
      lobby,
      roomKey,
      presenceKey,
      chatKey,
      getRoom,
      presenceMap,

      findMyActiveRoom,

      async createRoom(
        uid: string,
        input: {
          name: string;
          nick: string;
          color: Color | "r";
          timeMin: number;
          incSec: number;
          password: string;
          variant: string;
        }
      ): Promise<string> {
        const active = await findMyActiveRoom(uid);
        if (active) throw activeRoomError(active);
        const name = input.name.trim().slice(0, 20);
        if (!name) throw bad("방 이름을 입력해주세요.");
        const myColor: Color = input.color === "r" ? (Math.random() < 0.5 ? "w" : "b") : input.color;
        const ms = input.timeMin * 60_000;
        const id = newId();
        const password = input.password.trim();
        const locked = password !== "";
        const now = new Date();
        const doc: RoomDoc = {
          _id: id,
          v: 1,
          name,
          hostUid: uid,
          whiteUid: myColor === "w" ? uid : "",
          whiteName: myColor === "w" ? input.nick : "",
          blackUid: myColor === "b" ? uid : "",
          blackName: myColor === "b" ? input.nick : "",
          timeMin: input.timeMin,
          incSec: input.incSec,
          status: "waiting",
          moves: [],
          variant: input.variant,
          fen: rules.initialFen(input.variant),
          whiteMs: ms,
          blackMs: ms,
          turnStartedAt: null,
          pausedAt: null,
          result: "",
          reason: "",
          undoReq: null,
          drawOffer: "",
          rematch: "",
          spectators: {},
          locked,
          createdAt: now,
          updatedAt: now,
        };
        // 초대키는 참가자만 받을 수 있고(초대 링크용), 비밀번호 해시는 서버 밖으로 안 나감
        await privates.insertOne({
          _id: path(id),
          invite: randomKey(),
          ...(locked ? { pw: hashPassword(id, password) } : {}),
          access: locked ? [uid] : [],
        });
        await rooms.insertOne(doc as Doc<Omit<RoomDoc, "_id">>);
        lobby.publish();
        return id;
      },

      async hasRoomAccess(uid: string, id: string): Promise<boolean> {
        const room = await getRoom(id);
        if (!room) return false;
        return hasAccess(room, uid);
      },

      /** 비밀번호나 초대키로 입장 권한 얻기 */
      async unlockRoom(uid: string, id: string, cred: { password?: string; invite?: string }) {
        const room = await getRoom(id);
        if (!room) throw noRoom();
        if (!room.locked) return;
        countUnlockTry(`${path(id)}/${uid}`);
        const p = await privates.findOne({ _id: path(id) });
        const ok =
          !!p &&
          (cred.invite !== undefined
            ? safeEqual(cred.invite, p.invite)
            : !!p.pw && safeEqual(hashPassword(id, cred.password ?? ""), p.pw));
        if (!ok) throw new AppError("WRONG_PASSWORD", "비밀번호가 맞지 않습니다.", 403);
        await privates.updateOne({ _id: path(id) }, { $addToSet: { access: uid } });
      },

      /** 초대 링크에 넣을 키 (참가자만, 아니면 "") */
      async inviteKey(uid: string, id: string): Promise<string> {
        const room = await getRoom(id);
        if (!room || (!colorOf(room, uid) && room.spectators[uid] === undefined)) return "";
        return (await privates.findOne({ _id: path(id) }))?.invite ?? "";
      },

      async joinAsPlayer(uid: string, id: string, name: string) {
        const active = await findMyActiveRoom(uid);
        if (active && active._id !== id) throw activeRoomError(active);
        await mutate(id, async (room, now) => {
          if (colorOf(room, uid)) return;
          if (room.status !== "waiting") throw bad("이미 대국이 시작된 방입니다.");
          const seat: Color | null = !room.whiteUid ? "w" : !room.blackUid ? "b" : null;
          if (!seat) throw bad("빈 자리가 없습니다.");
          await requireEnter(room, uid);
          const spectators = { ...room.spectators };
          delete spectators[uid];
          return {
            ...(seat === "w" ? { whiteUid: uid, whiteName: name } : { blackUid: uid, blackName: name }),
            spectators,
            updatedAt: now,
          };
        });
      },

      /** 방장만 시작 가능. 두 자리가 다 찼을 때 백(선) 시계부터 돌아감 */
      startGame: (uid: string, id: string) =>
        mutate(id, (room, now) => {
          if (room.hostUid !== uid) throw bad("방장만 시작할 수 있습니다.");
          if (room.status !== "waiting") return;
          if (!room.whiteUid || !room.blackUid) throw bad("상대가 아직 입장하지 않았습니다.");
          return { status: "playing", turnStartedAt: now, updatedAt: now };
        }),

      joinAsSpectator: (uid: string, id: string, name: string) =>
        mutate(id, async (room) => {
          if (colorOf(room, uid) || room.spectators[uid] !== undefined) return;
          await requireEnter(room, uid);
          const spectators = { ...room.spectators };
          // 창만 닫고 사라진 관전자는 자리 비워줌
          const now = Date.now();
          for (const u of Object.keys(spectators)) {
            const ts = await lastSeenOf(id, u);
            if (ts === null || now - ts > OFFLINE_AFTER_MS * 1.5) delete spectators[u];
          }
          if (Object.keys(spectators).length >= MAX_SPECTATORS)
            throw bad("관전 인원이 가득 찼습니다. (최대 2명)");
          spectators[uid] = name;
          return { spectators };
        }),

      /** 대국 중인 플레이어는 나가도 자리가 유지됨 (다시 들어오면 이어서 진행) */
      async leaveRoom(uid: string, id: string) {
        let left = false;
        await mutate(id, (room, now) => {
          const color = colorOf(room, uid);
          if (!color) {
            left = true;
            if (room.spectators[uid] === undefined) return;
            const spectators = { ...room.spectators };
            delete spectators[uid];
            return { spectators };
          }
          if (room.status !== "waiting") return;
          left = true;
          // 방장이 나가면 방 닫힘, 참가자가 나가면 자리만 비움
          return room.hostUid === uid
            ? { status: "closed", updatedAt: now }
            : {
                ...(color === "w" ? { whiteUid: "", whiteName: "" } : { blackUid: "", blackName: "" }),
                updatedAt: now,
              };
        });
        if (left) await removePresence(id, uid);
      },

      makeMove: (uid: string, id: string, move: string) =>
        mutate(id, (room, now) => {
          const me = colorOf(room, uid);
          if (room.status !== "playing" || !me) throw bad("대국 중이 아닙니다.");
          if (room.pausedAt) throw bad("일시정지 중입니다.");
          if (turnOf(room) !== me) throw bad("내 차례가 아닙니다.");

          const game = rules.replay(room.moves, room.variant);
          const timed = room.timeMin > 0;
          const clock = liveClock(room, now.getTime());

          if (timed && clock[me] <= 0) {
            return {
              status: "ended",
              result: rules.timeoutResult(game, me),
              reason: "timeout",
              whiteMs: clock.w,
              blackMs: clock.b,
              updatedAt: now,
            };
          }

          try {
            rules.play(game, move);
          } catch (e) {
            // 엔진이 알려준 이유를 그대로 전달 (화면에서 막기 때문에 평소엔 볼 일 없음)
            throw new AppError("ILLEGAL_MOVE", e instanceof Error ? e.message : "둘 수 없는 수입니다.");
          }
          if (timed) clock[me] += room.incSec * 1000;
          const end = rules.endState(game);

          return {
            moves: [...room.moves, move],
            fen: rules.fenOf(game),
            whiteMs: clock.w,
            blackMs: clock.b,
            turnStartedAt: now,
            undoReq: null,
            drawOffer: "",
            updatedAt: now,
            ...(end ? { status: "ended" as const, ...end } : {}),
          };
        }),

      /** 수를 두는 쪽의 시간이 0이 된 걸 본 대국자가 호출 */
      claimTimeout: (uid: string, id: string) =>
        mutate(id, (room, now) => {
          if (!colorOf(room, uid)) return;
          if (room.status !== "playing" || room.timeMin <= 0 || room.pausedAt) return;
          const clock = liveClock(room, now.getTime());
          const t = turnOf(room);
          if (clock[t] > 0) return;
          return {
            status: "ended",
            result: rules.timeoutResult(rules.replay(room.moves, room.variant), t),
            reason: "timeout",
            whiteMs: clock.w,
            blackMs: clock.b,
            updatedAt: now,
          };
        }),

      claimAbandon: (uid: string, id: string) =>
        mutate(id, async (room, now) => {
          const me = colorOf(room, uid);
          if (room.status !== "playing" || !me) return;
          if (room.pausedAt) throw bad("일시정지 중에는 승리 선언을 할 수 없습니다.");
          const oppUid = me === "w" ? room.blackUid : room.whiteUid;
          const ts = await lastSeenOf(id, oppUid);
          if (ts !== null && now.getTime() - ts < ABANDON_AFTER_MS) throw bad("상대가 아직 접속 중입니다.");
          const clock = liveClock(room, now.getTime());
          return {
            status: "ended",
            result: winFor(me),
            reason: "abandon",
            whiteMs: clock.w,
            blackMs: clock.b,
            updatedAt: now,
          };
        }),

      resign: (uid: string, id: string) =>
        mutate(id, (room, now) => {
          const me = colorOf(room, uid);
          if (room.status !== "playing" || !me) return;
          const clock = liveClock(room, now.getTime());
          return {
            status: "ended",
            result: winFor(other(me)),
            reason: "resign",
            whiteMs: clock.w,
            blackMs: clock.b,
            updatedAt: now,
          };
        }),

      offerDraw: (uid: string, id: string) =>
        mutate(id, (room) => {
          if (!colorOf(room, uid) || room.status !== "playing") return;
          return { drawOffer: uid };
        }),

      respondDraw: (uid: string, id: string, accept: boolean) =>
        mutate(id, (room, now) => {
          if (!colorOf(room, uid)) return;
          if (room.status !== "playing" || !room.drawOffer || room.drawOffer === uid) return;
          if (!accept) return { drawOffer: "" };
          const clock = liveClock(room, now.getTime());
          return {
            status: "ended",
            result: "1/2-1/2",
            reason: "agreement",
            drawOffer: "",
            whiteMs: clock.w,
            blackMs: clock.b,
            updatedAt: now,
          };
        }),

      /**
       * 끝난 방에서 같은 상대와 바로 한 판 더.
       * 한쪽이 누르면 신청, 다른 쪽도 누르면 흑백(선후)을 바꿔 바로 새 대국 시작.
       */
      requestRematch: (uid: string, id: string) =>
        mutate(id, (room, now) => {
          const me = colorOf(room, uid);
          if (room.status !== "ended" || !me) return;
          if (!room.whiteUid || !room.blackUid) throw bad("상대가 나갔습니다.");
          if (!room.rematch || room.rematch === uid) return { rematch: uid, updatedAt: now };
          const ms = room.timeMin * 60_000;
          return {
            whiteUid: room.blackUid,
            whiteName: room.blackName,
            blackUid: room.whiteUid,
            blackName: room.whiteName,
            status: "playing",
            moves: [],
            fen: rules.initialFen(room.variant),
            whiteMs: ms,
            blackMs: ms,
            turnStartedAt: now,
            pausedAt: null,
            result: "",
            reason: "",
            undoReq: null,
            drawOffer: "",
            rematch: "",
            updatedAt: now,
          };
        }),

      /** 다시 하기 신청 취소 / 거절 */
      cancelRematch: (uid: string, id: string) =>
        mutate(id, (room) => {
          if (!colorOf(room, uid) || !room.rematch) return;
          return { rematch: "" };
        }),

      requestUndo: (uid: string, id: string) =>
        mutate(id, (room) => {
          const me = colorOf(room, uid);
          if (!me || room.status !== "playing" || undoPlies(room, me) === 0) return;
          return { undoReq: { uid, ply: room.moves.length } };
        }),

      cancelUndo: (uid: string, id: string) =>
        mutate(id, (room) => {
          if (!colorOf(room, uid) || !room.undoReq) return;
          return { undoReq: null };
        }),

      respondUndo: (uid: string, id: string, accept: boolean) =>
        mutate(id, (room, now) => {
          if (!colorOf(room, uid)) return;
          const req = room.undoReq;
          if (room.status !== "playing" || !req || req.uid === uid) return;
          if (room.pausedAt) throw bad("일시정지 중입니다.");
          const reqColor = colorOf(room, req.uid);
          if (!accept || !reqColor || req.ply !== room.moves.length) return { undoReq: null };
          const plies = undoPlies(room, reqColor);
          if (plies === 0) return { undoReq: null };
          // 지금까지 흐른 시간은 현재 차례인 쪽에서 정산하고 되돌림
          const clock = liveClock(room, now.getTime());
          const moves = room.moves.slice(0, room.moves.length - plies);
          return {
            moves,
            fen: rules.fenOf(rules.replay(moves, room.variant)),
            whiteMs: clock.w,
            blackMs: clock.b,
            turnStartedAt: now,
            undoReq: null,
            drawOffer: "",
            updatedAt: now,
          };
        }),

      pauseGame: (uid: string, id: string) =>
        hostMutate(id, uid, (room, now) => {
          if (room.pausedAt) return;
          const clock = liveClock(room, now.getTime()); // 지금까지 흐른 시간 정산 후 멈춤
          return {
            whiteMs: clock.w,
            blackMs: clock.b,
            pausedAt: now,
            undoReq: null,
            drawOffer: "",
            updatedAt: now,
          };
        }),

      resumeGame: (uid: string, id: string) =>
        hostMutate(id, uid, (room, now) => {
          if (!room.pausedAt) return;
          if (isPauseExpired(room, now.getTime()))
            throw bad("일시정지가 2시간을 넘어 대국이 종료되었습니다.");
          // 재개 시점부터 다시 계산
          return { pausedAt: null, turnStartedAt: now, updatedAt: now };
        }),

      /** 방장이 자신 또는 상대 시계에 시간 추가 */
      addTime: (uid: string, id: string, color: Color) =>
        hostMutate(id, uid, (room, now) => {
          if (room.timeMin <= 0) throw bad("무제한 대국입니다.");
          const clock = liveClock(room, now.getTime());
          clock[color] += ADD_TIME_MS;
          return {
            whiteMs: clock.w,
            blackMs: clock.b,
            // 진행중이면 정산한 시점부터 다시 흐르게
            ...(room.pausedAt ? {} : { turnStartedAt: now }),
            updatedAt: now,
          };
        }),

      async expirePausedGame(uid: string, id: string) {
        const room = await getRoom(id);
        if (!room) throw noRoom();
        if (!colorOf(room, uid)) return;
        await expirePaused(id);
      },

      /** 하트비트. bumpRoom이면(대기방 방장) 로비에서 "살아있는 방"으로 보이게 방도 갱신 */
      async beat(uid: string, id: string, name: string, bumpRoom: boolean) {
        const room = await getRoom(id);
        if (!room) throw noRoom();
        const player = !!colorOf(room, uid);
        if (!player && room.spectators[uid] === undefined) return;
        await presences.updateOne(
          { _id: `${path(id)}/${uid}` },
          { $set: { room: path(id), uid, name, lastSeen: new Date() } },
          { upsert: true }
        );
        await publishPresence(id);
        if (bumpRoom && player) await mutate(id, (_r, now) => ({ updatedAt: now }));
      },

      async chatList(id: string) {
        const list = await chats.find({ room: path(id) }).sort({ createdAt: -1 }).limit(CHAT_LIMIT).toArray();
        return list.reverse().map(chatWire);
      },

      async sendChat(uid: string, id: string, name: string, text: string, clientId: unknown) {
        const t = text.trim().slice(0, CHAT_MAX);
        if (!t) return;
        const room = await getRoom(id);
        if (!room) throw noRoom();
        // 이 방의 대국자·관전자만
        if (!colorOf(room, uid) && room.spectators[uid] === undefined) throw forbidden();
        const doc: Doc<ChatDoc> = {
          _id: isClientId(clientId) ? clientId : newId(),
          room: path(id),
          uid,
          name: name.slice(0, 20),
          text: t,
          createdAt: new Date(),
        };
        try {
          await chats.insertOne(doc);
        } catch (e) {
          // 같은 id로 다시 보낸 경우(재전송)는 조용히 넘어감
          if ((e as { code?: number }).code === 11000) return;
          throw e;
        }
        gateway.emit(chatKey(id), "add", chatWire(doc));
      },

      /** 관리자 페이지에서 방을 지웠을 때 */
      roomsDeleted(ids: string[]) {
        for (const id of ids) gateway.emit(roomKey(id), "room", null);
        lobby.publish();
      },
    };
  }

  const chatWire = (d: Doc<ChatDoc>) => ({
    id: d._id,
    uid: d.uid,
    name: d.name,
    text: d.text,
    at: d.createdAt.getTime(),
  });

  // ───────────── 구독 채널 ─────────────

  const lobbyParams = z.object({ g: gameKey });
  gateway.channel("board.lobby", {
    key: (_ctx, p) => games[lobbyParams.parse(p).g].lobby.key,
    snapshot: (_ctx, _key, p) => games[lobbyParams.parse(p).g].lobby.load(),
  });
  gateway.channel("board.room", {
    key: (_ctx, p) => {
      const { g, id } = roomRef.parse(p);
      return games[g].roomKey(id);
    },
    snapshot: async (_ctx, _key, p) => {
      const { g, id } = roomRef.parse(p);
      const room = await games[g].getRoom(id);
      return room ? toWire(room) : null;
    },
  });
  gateway.channel("board.presence", {
    key: (_ctx, p) => {
      const { g, id } = roomRef.parse(p);
      return games[g].presenceKey(id);
    },
    snapshot: (_ctx, _key, p) => {
      const { g, id } = roomRef.parse(p);
      return games[g].presenceMap(id);
    },
  });
  gateway.channel("board.chat", {
    key: (_ctx, p) => {
      const { g, id } = roomRef.parse(p);
      return games[g].chatKey(id);
    },
    snapshot: (_ctx, _key, p) => {
      const { g, id } = roomRef.parse(p);
      return games[g].chatList(id);
    },
  });

  // ───────────── 요청 ─────────────

  /** 방 하나에 대한 요청: 인자를 검증하고 (게임, uid, 방 id, 나머지)로 넘김 */
  function roomRpc<S extends z.ZodRawShape>(
    name: string,
    extra: S,
    fn: (game: ReturnType<typeof makeGame>, uid: string, id: string, args: z.infer<z.ZodObject<S>>) => unknown
  ) {
    const schema = roomRef.extend(extra);
    gateway.rpc(`board.${name}`, async (ctx: Ctx, raw) => {
      const args = schema.parse(raw) as { g: GameKey; id: string } & z.infer<z.ZodObject<S>>;
      await fn(games[args.g], ctx.uid, args.id, args);
      return null;
    });
  }

  gateway.rpc("board.findMyActiveRoom", async (ctx, raw) => {
    const { g } = lobbyParams.parse(raw);
    const room = await games[g].findMyActiveRoom(ctx.uid);
    return room ? toWire(room) : null;
  });

  const createSchema = z.object({
    g: gameKey,
    name: z.string().max(60),
    nick,
    color: z.enum(["w", "b", "r"]),
    timeMin: z.number().int().min(0).max(600),
    incSec: z.number().int().min(0).max(600),
    password: z.string().max(100).default(""),
    variant: z.string().max(40).default(""),
  });
  gateway.rpc("board.createRoom", (ctx, raw) => {
    const { g, ...input } = createSchema.parse(raw);
    return games[g].createRoom(ctx.uid, input);
  });

  gateway.rpc("board.hasRoomAccess", (ctx, raw) => {
    const { g, id } = roomRef.parse(raw);
    return games[g].hasRoomAccess(ctx.uid, id);
  });
  gateway.rpc("board.inviteKey", (ctx, raw) => {
    const { g, id } = roomRef.parse(raw);
    return games[g].inviteKey(ctx.uid, id);
  });

  roomRpc("unlockRoom", { password: z.string().max(100).optional(), invite: z.string().max(100).optional() }, (game, uid, id, a) =>
    game.unlockRoom(uid, id, { password: a.password, invite: a.invite })
  );
  roomRpc("joinAsPlayer", { nick }, (game, uid, id, a) => game.joinAsPlayer(uid, id, a.nick));
  roomRpc("joinAsSpectator", { nick }, (game, uid, id, a) => game.joinAsSpectator(uid, id, a.nick));
  roomRpc("startGame", {}, (game, uid, id) => game.startGame(uid, id));
  roomRpc("leaveRoom", {}, (game, uid, id) => game.leaveRoom(uid, id));
  roomRpc("makeMove", { move: z.string().min(1).max(12) }, (game, uid, id, a) => game.makeMove(uid, id, a.move));
  roomRpc("claimTimeout", {}, (game, uid, id) => game.claimTimeout(uid, id));
  roomRpc("claimAbandon", {}, (game, uid, id) => game.claimAbandon(uid, id));
  roomRpc("resign", {}, (game, uid, id) => game.resign(uid, id));
  roomRpc("offerDraw", {}, (game, uid, id) => game.offerDraw(uid, id));
  roomRpc("respondDraw", { accept: z.boolean() }, (game, uid, id, a) => game.respondDraw(uid, id, a.accept));
  roomRpc("requestRematch", {}, (game, uid, id) => game.requestRematch(uid, id));
  roomRpc("cancelRematch", {}, (game, uid, id) => game.cancelRematch(uid, id));
  roomRpc("requestUndo", {}, (game, uid, id) => game.requestUndo(uid, id));
  roomRpc("cancelUndo", {}, (game, uid, id) => game.cancelUndo(uid, id));
  roomRpc("respondUndo", { accept: z.boolean() }, (game, uid, id, a) => game.respondUndo(uid, id, a.accept));
  roomRpc("pauseGame", {}, (game, uid, id) => game.pauseGame(uid, id));
  roomRpc("resumeGame", {}, (game, uid, id) => game.resumeGame(uid, id));
  roomRpc("addTime", { color: z.enum(["w", "b"]) }, (game, uid, id, a) => game.addTime(uid, id, a.color));
  roomRpc("expirePausedGame", {}, (game, uid, id) => game.expirePausedGame(uid, id));
  roomRpc("beat", { name: nick, bumpRoom: z.boolean().default(false) }, (game, uid, id, a) =>
    game.beat(uid, id, a.name, a.bumpRoom)
  );
  roomRpc("sendChat", { name: z.string().max(40), text: z.string().max(1000), cid: z.unknown().optional() }, (game, uid, id, a) =>
    game.sendChat(uid, id, a.name, a.text, a.cid)
  );

  return {
    /** 관리자가 방을 지웠을 때 (컬렉션 이름 기준) */
    roomsDeleted(coll: string, ids: string[]) {
      const g = (Object.keys(GAMES) as GameKey[]).find((k) => GAMES[k].collection === coll);
      if (g) games[g].roomsDeleted(ids);
    },
  };
}
