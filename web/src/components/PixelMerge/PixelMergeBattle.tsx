"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "@/firebase";
import { useAuth } from "@/lib/AuthContext";
import { onConnection } from "@/lib/api/socket";
import { H, mulberry, TIERS, W } from "@/lib/pixelmerge/engine";
import type { MergeGame } from "@/lib/pixelmerge/game";
import { playBgm, playSfx } from "@/lib/pixelmerge/sound";
import {
  backToBattleRoom,
  createBattle,
  joinBattle,
  leaveBattle,
  sendAttack,
  sendDead,
  sendSnap,
  serverNow,
  setBattleMode,
  startBattle,
  watchBattle,
  type BattleMode,
  type BattleRoom,
  type Junk,
} from "@/realtime/pixelmergeBattle";

/*
 * 픽셀 머지 친구 대전 (서버: server/src/games/pixelmergeBattle.ts)
 *  방 만들기 → 초대 링크(?room=id) 보내기 → 대기실(모드 · 시작) → 다 같이 같은 순서의 공 → 넘치면 GAME OVER · 관전 → 순위
 *  일반: 각자 자기 병만 / 방해: 높은 단계 합치기 · 연쇄 → 살아 있는 상대 하나에게 도트 공이 우수수
 *  버티기만 하면 안 끝나서 6초 동안 안 떨어뜨리면 저절로 떨어짐 (두 모드 다)
 */

/** 비회원 이름 (다른 온라인 게임과 같은 곳에 저장) */
const NICK_KEY = "chess_nick";
const AUTO_DROP_MS = 6000;
const SNAP_MS = 120;
const fmt = (n: number) => n.toLocaleString("ko-KR");
const MODE_NAME: Record<BattleMode, string> = { normal: "일반 모드", junk: "방해 모드" };
const MODE_DESC: Record<BattleMode, string> = {
  normal: "각자 자기 병만 · 마지막까지 버티면 1등",
  junk: "높은 단계 · 연쇄로 상대 병에 도트 공을 떨어뜨려요",
};
/** 방해 공 수: 제나(6단계)부터 단계마다 하나씩 · 황금 건모 8개 · 연쇄 3번째부터 하나씩 더 */
const attackOf = (nt: number, combo: number) =>
  Math.min(12, (nt > TIERS.length - 1 ? 8 : nt >= 5 ? nt - 4 : 0) + (combo >= 3 ? combo - 2 : 0));

const roomFromUrl = () => {
  try {
    return new URLSearchParams(location.search).get("room");
  } catch {
    return null;
  }
};
const setUrlRoom = (id: string | null) => {
  try {
    const u = new URL(location.href);
    if (id) u.searchParams.set("room", id);
    else u.searchParams.delete("room");
    history.replaceState(history.state, "", u.toString());
  } catch {}
};
export const hasRoomInUrl = () => !!roomFromUrl();
/** 판 모듈 (matter-js 와 같이 화면에서만 받음) — 남의 병 그리기에 씀 */
const gameMod: { m: typeof import("@/lib/pixelmerge/game") | null } = { m: null };

// ───────────────── 연결 · 방 ─────────────────

function useBattle() {
  const { profile } = useAuth();
  const [uid, setUid] = useState<string | null>(null);
  const [typed, setTyped] = useState(() => {
    try {
      return localStorage.getItem(NICK_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const nick = profile?.nick ?? typed;
  const [err, setErr] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<BattleRoom | null>(null);
  const snaps = useRef<Record<string, number[]>>({});
  const junkRef = useRef<(j: Junk) => void>(() => {});
  const joined = useRef<{ id: string; nick: string } | null>(null);

  const setNick = useCallback((v: string) => {
    const n = v.trim().slice(0, 10);
    setTyped(n);
    try {
      localStorage.setItem(NICK_KEY, n);
    } catch {}
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        if (u) setUid(u.uid);
        else
          signInAnonymously(auth).catch(() => setErr("접속에 실패했어요. 잠시 후 다시 해주세요."));
      }),
    []
  );

  useEffect(() => {
    if (!uid || !roomId) return;
    return watchBattle(roomId, {
      room: (r) => {
        setRoom(r);
        if (!r) {
          joined.current = null;
          setRoomId(null);
          setUrlRoom(null);
          setErr("방이 없어졌어요. 새로 만들어 주세요.");
        }
      },
      live: (_round, s) => {
        snaps.current = s;
      },
      junk: (j) => junkRef.current(j),
    });
  }, [uid, roomId]);

  // 끊겼다 붙으면 자리 복구
  useEffect(() => {
    let was = true;
    return onConnection((on) => {
      const j = joined.current;
      if (on && !was && j) joinBattle(j.id, j.nick, true).catch(() => {});
      was = on;
    });
  }, []);
  useEffect(() => {
    const off = () => {
      if (joined.current) leaveBattle(joined.current.id).catch(() => {});
    };
    window.addEventListener("pagehide", off);
    return () => {
      window.removeEventListener("pagehide", off);
      off();
    };
  }, []);

  const join = useCallback(
    async (id: string) => {
      setErr("");
      try {
        await joinBattle(id, nick);
        joined.current = { id, nick };
        snaps.current = {};
        setRoomId(id);
        setUrlRoom(id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "들어가지 못했어요.");
        setUrlRoom(null);
      }
    },
    [nick]
  );
  const create = useCallback(
    async (mode: BattleMode) => {
      setErr("");
      try {
        await join(await createBattle(mode));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "방을 만들지 못했어요.");
      }
    },
    [join]
  );
  const leave = useCallback(() => {
    const id = joined.current?.id ?? roomId;
    joined.current = null;
    setRoom(null);
    setRoomId(null);
    setUrlRoom(null);
    if (id) leaveBattle(id).catch(() => {});
  }, [roomId]);

  return {
    uid,
    nick,
    member: !!profile,
    setNick,
    err,
    setErr,
    roomId,
    room,
    snaps,
    junkRef,
    join,
    create,
    leave,
  };
}
type Battle = ReturnType<typeof useBattle>;

// ───────────────── 화면 ─────────────────

export default function PixelMergeBattle({
  imgs,
  onHome,
}: {
  imgs: HTMLImageElement[];
  onHome: () => void;
}) {
  const b = useBattle();
  const [invite] = useState(roomFromUrl);
  const [mode, setMode] = useState<BattleMode>("junk");
  const playing = b.room?.phase === "playing";

  useEffect(() => {
    playBgm(!!playing);
    return () => playBgm(false);
  }, [playing]);

  // 초대 링크로 왔고 회원이면(이름이 있으면) 바로 입장
  const tried = useRef(false);
  useEffect(() => {
    if (!invite || !b.uid || tried.current || b.roomId || !b.member) return;
    tried.current = true;
    void b.join(invite);
  }, [invite, b.uid, b.member, b.roomId, b]);

  const home = () => {
    playSfx("tap");
    b.leave();
    onHome();
  };

  if (!b.roomId || !b.room) {
    const needName = !b.member;
    const can = !!b.uid && !!b.nick.trim();
    return (
      <div className="pm-bt">
        <div className="pm-bt-top">
          <button type="button" className="pm-btn sq" aria-label="처음으로" onClick={home}>
            ←
          </button>
          <b>친구 대전</b>
        </div>
        {needName && (
          <label className="pm-bt-name">
            <span>내 이름</span>
            <input
              value={b.nick}
              maxLength={10}
              placeholder="친구들한테 보일 이름"
              onChange={(e) => b.setNick(e.target.value)}
            />
          </label>
        )}
        {invite && !b.roomId ? (
          <div className="pm-bt-card">
            <b>친구 방에 초대받았어요</b>
            <button
              type="button"
              className="pm-btn go"
              disabled={!can}
              onClick={() => void b.join(invite)}
            >
              {b.uid ? "들어가기" : "접속하는 중…"}
            </button>
          </div>
        ) : (
          <>
            <div className="pm-modes">
              {(["normal", "junk"] as BattleMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`pm-mode ${m === "junk" ? "daily" : "endless"} ${mode === m ? "on" : ""}`}
                  onClick={() => {
                    playSfx("tap");
                    setMode(m);
                  }}
                >
                  <small>{mode === m ? "● 고름" : "○"}</small>
                  <b>{MODE_NAME[m]}</b>
                  <span>{MODE_DESC[m]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="pm-btn go pm-bt-wide"
              disabled={!can}
              onClick={() => {
                playSfx("tap");
                void b.create(mode);
              }}
            >
              {b.uid ? "방 만들고 친구 부르기" : "접속하는 중…"}
            </button>
          </>
        )}
        {b.err && <p className="pm-bt-err">{b.err}</p>}
        <p className="pm-help">
          최대 6명 · 링크를 받은 친구만 들어와요 · 모두 같은 순서로 공이 나와요 · 6초 안 떨어뜨리면
          저절로 떨어져요
        </p>
      </div>
    );
  }

  const room = b.room;
  if (room.phase === "playing" && room.round)
    return <Arena key={room.round.no} b={b} room={room} imgs={imgs} onLeave={home} />;
  return <Lobby b={b} room={room} imgs={imgs} onLeave={home} />;
}

// ───────────────── 대기실 · 결과 ─────────────────

function Lobby({
  b,
  room,
  imgs,
  onLeave,
}: {
  b: Battle;
  room: BattleRoom;
  imgs: HTMLImageElement[];
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const host = room.hostUid === b.uid;
  const people = Object.entries(room.players).sort((x, y) => x[1].joinedAt - y[1].joinedAt);
  const link = `${location.origin}/games/pixelmerge/?room=${room.id}`;
  const result = room.phase === "result" && room.round ? room.round : null;
  const places = result
    ? Object.entries(result.places).sort((x, y) => x[1].place - y[1].place)
    : [];
  const share = async () => {
    playSfx("tap");
    try {
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent))
        await navigator.share({ text: "픽셀 머지 같이 하자! 🟡", url: link });
      else await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const act = (p: Promise<unknown>) =>
    p.catch((e: unknown) => b.setErr(e instanceof Error ? e.message : "안 됐어요."));

  return (
    <div className="pm-bt">
      <div className="pm-bt-top">
        <button type="button" className="pm-btn sq" aria-label="나가기" onClick={onLeave}>
          ←
        </button>
        <b>친구 대전</b>
        <span className={`pm-bt-badge ${room.mode}`}>{MODE_NAME[room.mode]}</span>
      </div>

      {result && (
        <div className="pm-bt-card pm-bt-result">
          <b>판 #{result.no} 결과</b>
          <ol>
            {places.map(([u, p]) => (
              <li key={u} className={u === b.uid ? "me" : ""}>
                <i>{p.place === 1 ? "👑" : `${p.place}위`}</i>
                <span>{p.nick}</span>
                {}
                <img
                  src={imgs[Math.min(p.maxTier, TIERS.length - 1)].src}
                  alt={TIERS[Math.min(p.maxTier, TIERS.length - 1)].name}
                />
                <em>
                  {fmt(p.score)}점{room.mode === "junk" && p.sent ? ` · 방해 ${p.sent}` : ""}
                </em>
              </li>
            ))}
          </ol>
          {host ? (
            <button
              type="button"
              className="pm-btn go"
              onClick={() => act(backToBattleRoom(room.id))}
            >
              대기실로 (한 판 더)
            </button>
          ) : (
            <small>방장이 대기실로 돌아가면 다음 판</small>
          )}
        </div>
      )}

      {!result && (
        <>
          <div className="pm-bt-card">
            <b>친구 부르기</b>
            <div className="pm-bt-link">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="pm-btn" onClick={share}>
                {copied ? "복사됨!" : "링크 복사"}
              </button>
            </div>
          </div>
          <div className="pm-bt-card">
            <b>
              모드 <small>{host ? "(방장이 골라요)" : ""}</small>
            </b>
            <div className="pm-bt-seg">
              {(["normal", "junk"] as BattleMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={room.mode === m ? "on" : ""}
                  disabled={!host}
                  onClick={() => {
                    playSfx("tap");
                    void act(setBattleMode(room.id, m));
                  }}
                >
                  {MODE_NAME[m]}
                </button>
              ))}
            </div>
            <small>{MODE_DESC[room.mode]}</small>
          </div>
        </>
      )}

      <div className="pm-bt-card">
        <b>
          들어온 사람 {people.length}/{room.max}
        </b>
        <ul className="pm-bt-people">
          {people.map(([u, p]) => (
            <li key={u} className={u === b.uid ? "me" : ""}>
              {u === room.hostUid ? "👑 " : ""}
              {p.nick}
              {u === b.uid ? " (나)" : ""}
            </li>
          ))}
        </ul>
      </div>

      {!result &&
        (host ? (
          <button
            type="button"
            className="pm-btn go pm-bt-wide"
            disabled={people.length < 2}
            onClick={() => {
              playSfx("tap");
              void act(startBattle(room.id));
            }}
          >
            {people.length < 2 ? "친구가 들어오면 시작할 수 있어요" : `시작 (${people.length}명)`}
          </button>
        ) : (
          <p className="pm-help">방장이 시작하면 바로 시작돼요</p>
        ))}
      {b.err && <p className="pm-bt-err">{b.err}</p>}
    </div>
  );
}

// ───────────────── 판 ─────────────────

function Arena({
  b,
  room,
  imgs,
  onLeave,
}: {
  b: Battle;
  room: BattleRoom;
  imgs: HTMLImageElement[];
  onLeave: () => void;
}) {
  const round = room.round!;
  const me = b.uid ?? "";
  const inRound = round.roster.includes(me);
  const others = useMemo(() => round.roster.filter((u) => u !== me), [round.roster, me]);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const miniRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const gameRef = useRef<MergeGame | null>(null);
  const [score, setScore] = useState(0);
  const [next, setNext] = useState(0);
  const [count, setCount] = useState(3);
  const [auto, setAuto] = useState(0);
  const [w, setW] = useState(300);
  const [miniW, setMiniW] = useState(64);
  const [feed, setFeed] = useState<{ id: number; s: string; hit: boolean }[]>([]);
  const [watch, setWatch] = useState<string | null>(null);
  /** 남의 점수 (0.4초마다 스냅샷에서 옮겨 옴 — 화면 글자용) */
  const [scores, setScores] = useState<Record<string, number>>({});
  const myPlace = round.places[me];
  const dead = !inRound || !!myPlace;
  const alive = round.roster.filter((u) => !round.places[u]);
  const nickOf = useCallback(
    (u: string) => room.players[u]?.nick ?? round.places[u]?.nick ?? "?",
    [room.players, round.places]
  );
  useEffect(() => {
    const t = window.setInterval(() => {
      const s = b.snaps.current;
      setScores(Object.fromEntries(Object.entries(s).map(([u, v]) => [u, v[0] ?? 0])));
    }, 400);
    return () => clearInterval(t);
  }, [b.snaps]);
  // 관전 대상: 고른 사람이 죽었으면 살아 있는 사람 중 점수 높은 사람
  const target =
    watch && !round.places[watch]
      ? watch
      : (alive.filter((u) => u !== me).sort((x, y) => (scores[y] ?? 0) - (scores[x] ?? 0))[0] ??
        null);

  // 크기: 위에 미니 병 줄, 아래 내 병 (화면 높이에 맞춤)
  useEffect(() => {
    const fit = () => {
      const availW = Math.min(520, document.querySelector(".pm")?.clientWidth ?? 360);
      const n = Math.max(1, others.length);
      const mw = Math.floor(Math.min(76, (availW - 6 * (n - 1)) / n));
      setMiniW(mw);
      const availH = window.innerHeight - 116 - 120 - mw * (H / W) - 34;
      setW(Math.max(220, Math.min(availW, availH * (W / H))));
    };
    fit();
    window.addEventListener("resize", fit);
    document.documentElement.classList.add("pm-playing");
    return () => {
      window.removeEventListener("resize", fit);
      document.documentElement.classList.remove("pm-playing");
    };
  }, [others.length]);
  useEffect(() => {
    gameRef.current?.fit();
  }, [w]);

  // 내 판: 같은 시드, 시작 시각까지 멈춰 있다가 같이 시작
  useEffect(() => {
    if (!inRound) return;
    let off = false;
    let pending = 0;
    let flushAt = 0;
    void Promise.all([import("matter-js"), import("@/lib/pixelmerge/game")]).then(([M, G]) => {
      if (off || !cvRef.current) return;
      const g = new G.MergeGame(
        (M.default ?? M) as typeof import("matter-js"),
        cvRef.current,
        mulberry(round.seed),
        imgs,
        {
          onScore: setScore,
          onNext: (_c, n) => setNext(n),
          sfx: (name, rate) => playSfx(name, 1, rate ?? 1),
          onMerge: (nt, combo) => {
            if (room.mode !== "junk") return;
            pending += attackOf(nt, combo);
          },
          onOver: (r) => {
            sendSnap(room.id, round.no, g.snapshot());
            void sendDead(room.id, round.no, r.score, r.maxTier);
          },
        }
      );
      g.paused = true;
      gameRef.current = g;
    });
    const tick = window.setInterval(() => {
      const g = gameRef.current;
      const left = round.startAt - serverNow();
      setCount(Math.max(0, Math.ceil(left / 1000)));
      if (!g) return;
      if (g.paused && left <= 0 && !g.dead) {
        g.paused = false;
        g.lastDropAt = performance.now();
      }
      if (g.paused || g.dead) return setAuto(0);
      const idle = performance.now() - g.lastDropAt;
      if (idle > AUTO_DROP_MS) g.drop();
      setAuto(idle > AUTO_DROP_MS - 3000 ? Math.ceil((AUTO_DROP_MS - idle) / 1000) : 0);
      const now = performance.now();
      if (pending > 0 && now > flushAt) {
        const n = Math.min(12, pending);
        pending -= n;
        flushAt = now + 300;
        void sendAttack(room.id, round.no, n);
      }
    }, 100);
    const snap = window.setInterval(() => {
      const g = gameRef.current;
      if (g && !g.dead && !g.paused) sendSnap(room.id, round.no, g.snapshot());
    }, SNAP_MS);
    return () => {
      off = true;
      clearInterval(tick);
      clearInterval(snap);
      gameRef.current?.destroy();
      gameRef.current = null;
    };
    // 판마다 한 번 (Arena 는 판 번호로 새로 그려짐)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 관전만 하는 사람(판 도중에 들어옴)도 카운트다운
  useEffect(() => {
    if (inRound) return;
    const t = window.setInterval(
      () => setCount(Math.max(0, Math.ceil((round.startAt - serverNow()) / 1000))),
      200
    );
    return () => clearInterval(t);
  }, [inRound, round.startAt]);

  // 방해 공 받기 · 소식
  const { junkRef } = b;
  useEffect(() => {
    let id = 0;
    junkRef.current = (j) => {
      if (j.round !== round.no) return;
      const hit = j.to === me;
      if (hit) gameRef.current?.junk(j.n, nickOf(j.from));
      const item = { id: ++id, s: `${nickOf(j.from)} → ${nickOf(j.to)} 방해 공 ×${j.n}`, hit };
      setFeed((f) => [...f.slice(-2), item]);
      setTimeout(() => setFeed((f) => f.filter((x) => x.id !== item.id)), 3500);
    };
    return () => {
      junkRef.current = () => {};
    };
  }, [junkRef, round.no, me, nickOf]);

  // 남의 병 그리기 (미니 · 관전)
  useEffect(() => {
    let raf = 0;
    if (!gameMod.m) void import("@/lib/pixelmerge/game").then((m) => (gameMod.m = m));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const paint = (cv: HTMLCanvasElement | null, s: number[] | undefined, dead: boolean) => {
      if (!cv) return;
      const cw = Math.round(cv.clientWidth * dpr);
      if (cv.width !== cw) {
        cv.width = cw;
        cv.height = Math.round(cw * (H / W));
      }
      const c = cv.getContext("2d");
      if (c && gameMod.m)
        gameMod.m.drawSnapshot(c, s, imgs, cv.width / W, { dead, now: performance.now() });
    };
    const loop = () => {
      const snaps = b.snaps.current;
      for (const u of others) paint(miniRefs.current[u] ?? null, snaps[u], !!round.places[u]);
      if (dead && target) paint(specRef.current, snaps[target], false);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [others, round.places, dead, target, imgs, b.snaps]);

  // 조작
  const aim = (e: PointerEvent) => {
    const g = gameRef.current,
      cv = cvRef.current;
    if (!g || !cv) return;
    const r = cv.getBoundingClientRect();
    g.aimX = ((e.clientX - r.left) / r.width) * W;
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      if (e.key === "ArrowLeft") g.aimX -= 18;
      else if (e.key === "ArrowRight") g.aimX += 18;
      else if (e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        g.drop();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  return (
    <div className="pm-play pm-bt-arena">
      <div className="pm-bt-minis">
        {others.map((u) => {
          const pl = round.places[u];
          return (
            <button
              key={u}
              type="button"
              className={`pm-bt-mini ${pl ? "out" : ""} ${dead && target === u ? "on" : ""}`}
              style={{ width: miniW }}
              onClick={() => !pl && setWatch(u)}
              title={nickOf(u)}
            >
              <span className="n">{nickOf(u)}</span>
              <canvas
                ref={(el) => void (miniRefs.current[u] = el)}
                style={{ width: miniW, height: (miniW * H) / W }}
              />
              <span className="s">{pl ? `${pl.place}위` : fmt(scores[u] ?? 0)}</span>
            </button>
          );
        })}
      </div>
      <div className="pm-hud" style={{ width: w }}>
        <button type="button" className="pm-btn sq" aria-label="나가기" onClick={onLeave}>
          ←
        </button>
        <div className="sc">
          <small>
            {MODE_NAME[room.mode]} · 생존 {alive.length}/{round.roster.length}
          </small>
          <b>{fmt(inRound ? score : 0)}</b>
          <small>
            {auto ? (
              <span className="pm-bt-auto">{auto}초 뒤 자동 드롭</span>
            ) : (
              "6초 안 떨어뜨리면 자동"
            )}
          </small>
        </div>
        <div className="nx">
          <small>다음</small>
          {}
          <img src={imgs[next].src} alt={TIERS[next].name} />
        </div>
      </div>
      <div className="pm-jar" style={{ width: w }}>
        <canvas
          ref={cvRef}
          className="pm-cv"
          style={{ width: w, height: (w * H) / W, visibility: inRound ? "visible" : "hidden" }}
          onPointerMove={aim}
          onPointerDown={(e) => {
            aim(e);
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerUp={(e) => {
            aim(e);
            gameRef.current?.drop();
          }}
        />
        {dead && (
          <canvas
            ref={specRef}
            className="pm-cv pm-bt-spec"
            style={{ width: w, height: (w * H) / W }}
          />
        )}
        {dead && (
          <div className="pm-bt-dead">
            {myPlace && <b>GAME OVER · {myPlace.place}위</b>}
            <span>
              {target ? `관전 중 · ${nickOf(target)} (위에서 바꾸기)` : "끝나길 기다리는 중…"}
            </span>
          </div>
        )}
        {count > 0 && <div className="pm-bt-count">{count}</div>}
        <div className="pm-bt-feed">
          {feed.map((f) => (
            <span key={f.id} className={f.hit ? "hit" : ""}>
              {f.s}
            </span>
          ))}
        </div>
      </div>
      <p className="pm-help">
        좌우로 겨누고 떼면 떨어져요 · 넘치면 GAME OVER 뒤 관전 · 마지막까지 살아남으면 1등
      </p>
    </div>
  );
}
