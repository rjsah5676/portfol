"use client";

/**
 * 온라인 대전 화면 (16:9 판 안): 로비(방 목록·방 만들기) → 대기실(캐릭터·준비·맵·채팅) → 둘 다 준비되면 경기.
 * 방 연결(RoomSession)은 FightGame이 들고 있어서, 경기 화면에 갔다 와도 대기실 자리가 그대로.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { CHARS, type CharDef } from "@/lib/fight/chars";
import { MAPS } from "@/lib/fight/maps";
import { loadSheet } from "@/lib/fight/sprites";
import { sfxUi } from "@/lib/fight/sfx";
import { keyText } from "./KeyCap";
import { useChessUser } from "@/components/Chess/useChessUser";
import {
  cleanupEmptyRoom,
  createRoom,
  RoomFullError,
  RoomSession,
  serverNow,
  subscribeLobby,
  watchServerOffset,
  WatchSession,
  type LobbyRoom,
} from "@/realtime/fight";

const KR = "font-['Nanum_Gothic',sans-serif]";
const PX = "[image-rendering:pixelated]";
const MENU_BG = "/fight/bg/title.webp";
const face = (c: CharDef) => `/fight/art/${c.id}-face.webp`;
const art = (c: CharDef) => `/fight/art/${c.id}.webp`;
const SEAT_COL = ["#3B82F6", "#F43F5E"];
const pill = `${KR} cursor-pointer rounded-full bg-black/50 px-[1.4cqw] py-[0.5cqw] text-[1.2cqw] text-white/75 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40`;
const field = `${KR} min-w-0 rounded-[0.6cqw] border border-white/15 bg-black/55 px-[1cqw] py-[0.6cqw] text-[1.3cqw] text-white placeholder:text-white/30 focus:border-[#FDE047]/60 focus:outline-none`;
const bigBtn = `${KR} cursor-pointer whitespace-nowrap rounded-full bg-[#E8344E] px-[2.6cqw] py-[0.7cqw] text-[1.5cqw] font-extrabold text-white shadow-[0_0.3cqw_0_#7A1020] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100`;

export interface MatchCfg {
  match: string;
  seat: 0 | 1;
  chars: [number, number];
  map: number;
  delay: number;
  maxRb: number;
  names: [string, string];
  /** 관전 (seat는 안 씀) */
  spectate?: boolean;
  /** 관전하는 방 id */
  room?: string;
}

export default function Online({
  session,
  setSession,
  initialRoom,
  played,
  onMatch,
  onExit,
  watch,
  setWatch,
}: {
  session: RoomSession | null;
  /** 관전 중인 방 */
  watch: WatchSession | null;
  setWatch: (w: WatchSession | null) => void;
  /** 초대 링크로 들어온 방 */
  initialRoom?: string | null;
  setSession: (s: RoomSession | null) => void;
  /** 이미 치른 매치 id (대기실로 돌아왔을 때 같은 판으로 다시 들어가지 않게) */
  played: Set<string>;
  onMatch: (cfg: MatchCfg) => void;
  onExit: () => void;
}) {
  const { uid, nick, setNick, nickLoaded, error } = useChessUser();
  useEffect(() => watchServerOffset(), []);
  // 초대 링크: 접속·닉네임이 준비되면 그 방으로
  const autoRef = useRef(false);
  useEffect(() => {
    if (!initialRoom || autoRef.current || session || !uid || !nick) return;
    autoRef.current = true;
    setSession(new RoomSession(initialRoom, uid, nick));
  }, [initialRoom, session, uid, nick, setSession]);

  const body = (() => {
    if (error) return <Center>{error}</Center>;
    if (!uid || !nickLoaded) return <Center>접속 중…</Center>;
    if (!nick) return <NickForm onSubmit={setNick} onBack={onExit} />;
    if (session) return <Room key={session.id} s={session} played={played} onMatch={onMatch} onLeave={() => setSession(null)} />;
    if (watch) return <WatchRoom key={watch.id} w={watch} played={played} onMatch={onMatch} onLeave={() => setWatch(null)} />;
    return (
      <Lobby
        uid={uid}
        nick={nick}
        onNick={() => setNick("")}
        onBack={onExit}
        onEnter={(id) => setSession(new RoomSession(id, uid, nick))}
      />
    );
  })();

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-[#0B0D14] select-none [container-type:inline-size]">
      <img src={MENU_BG} alt="" className={`absolute inset-0 h-full w-full object-cover opacity-35 ${PX}`} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#0B0D14_90%)]" />
      {body}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className={`${KR} absolute inset-0 flex items-center justify-center text-[1.6cqw] text-white/60`}>{children}</div>;
}

function Title({ en, ko }: { en: string; ko: string }) {
  return (
    <div className="flex flex-col items-center gap-[0.4cqw]">
      <div className="font-mono text-[2.6cqw] font-black tracking-[0.35em] text-white italic drop-shadow-[0_0.3cqw_0_#000]">{en}</div>
      <div className={`${KR} text-[1.2cqw] text-white/55`}>{ko}</div>
    </div>
  );
}

function NickForm({ onSubmit, onBack }: { onSubmit: (n: string) => void; onBack: () => void }) {
  const [v, setV] = useState("");
  const ok = () => v.trim() && onSubmit(v);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.6cqw]">
      <Title en="ONLINE" ko="온라인 대전에서 쓸 닉네임" />
      <div className="flex gap-[0.8cqw]">
        <input
          autoFocus
          maxLength={10}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && ok()}
          placeholder="닉네임 (10자)"
          className={`${field} w-[24cqw] text-center`}
        />
        <button type="button" onClick={ok} className={bigBtn}>
          확인
        </button>
      </div>
      <button type="button" onClick={onBack} className={pill}>
        ◀ 모드 선택
      </button>
    </div>
  );
}

// ───────────── 로비 ─────────────

function Lobby({
  uid,
  nick,
  onNick,
  onBack,
  onEnter,
}: {
  uid: string;
  nick: string;
  onNick: () => void;
  onBack: () => void;
  onEnter: (id: string) => void;
}) {
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const checked = useRef(new Set<string>());
  useEffect(
    () =>
      subscribeLobby((list) => {
        setRooms(list);
        // 아무도 없는 1분 넘은 방 정리
        for (const r of list) {
          if (checked.current.has(r.id) || serverNow() - r.createdAt < 60_000) continue;
          checked.current.add(r.id);
          cleanupEmptyRoom(r.id);
        }
      }),
    []
  );
  // 키보드: Esc 뒤로
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Escape") {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      onEnter(await createRoom(uid, nick, name));
    } catch (e) {
      console.error(e);
      setErr("방을 만들지 못했어요");
      setBusy(false);
    }
  };
  const open = (rooms ?? []).filter((r) => r.count === 1 && !r.playing);

  return (
    <div className="absolute inset-0 flex flex-col gap-[1.4cqw] px-[3cqw] pt-[2.4cqw] pb-[2cqw]">
      <button type="button" onClick={onBack} className={`${pill} absolute top-[2.4cqw] left-[2cqw]`}>
        ◀ 모드 선택
      </button>
      <div className={`${KR} absolute top-[2.4cqw] right-[2cqw] flex items-center gap-[0.6cqw] text-[1.2cqw] text-white/60`}>
        <span>
          닉네임 <b className="text-white">{nick}</b>
        </span>
        <button type="button" onClick={onNick} className={pill}>
          바꾸기
        </button>
      </div>
      <Title en="ONLINE LOBBY" ko="방을 만들거나 들어가서 1:1 대전" />
      <div className="flex min-h-0 flex-1 gap-[2cqw]">
        {/* 방 목록 */}
        <div className="flex min-h-0 flex-1 flex-col rounded-[1cqw] bg-black/50 p-[1cqw] backdrop-blur-[2px]">
          <div className={`${KR} mb-[0.6cqw] flex items-center justify-between text-[1.2cqw] text-white/50`}>
            <span>열린 방 {rooms ? rooms.length : ""}</span>
            <span className="text-white/35">한 방에 2명</span>
          </div>
          <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-[0.6cqw] overflow-y-auto pr-[0.4cqw]">
            {rooms === null ? (
              <div className={`${KR} py-[4cqw] text-center text-[1.3cqw] text-white/35`}>불러오는 중…</div>
            ) : rooms.length === 0 ? (
              <div className={`${KR} py-[4cqw] text-center text-[1.3cqw] leading-relaxed text-white/40`}>
                열린 방이 없어요.
                <br />방을 만들고 친구에게 초대 링크를 보내 보세요!
              </div>
            ) : (
              rooms.map((r) => {
                const full = r.count >= 2;
                // 관전은 뺌 (따라잡기가 무겁고 끊김이 심해서) — 꽉 찬 방·대전 중인 방은 못 들어감
                const closed = full || r.playing;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={closed}
                    onClick={() => onEnter(r.id)}
                    className="flex w-full cursor-pointer items-center justify-between gap-[1cqw] rounded-[0.6cqw] border border-white/10 bg-white/[0.04] px-[1.2cqw] py-[0.8cqw] text-left transition-colors hover:border-[#FDE047]/60 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="min-w-0">
                      <span className={`${KR} block truncate text-[1.4cqw] font-bold text-white`}>{r.name}</span>
                      <span className={`${KR} text-[1.05cqw] text-white/40`}>
                        방장 {r.host} · {r.playing ? "대전 중" : full ? "꽉 참" : r.count === 0 ? "비어 있음" : "상대 기다리는 중"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-[0.8cqw]">
                      <span className={`font-mono text-[1.5cqw] font-black ${full ? "text-[#F87171]" : "text-[#FDE047]"}`}>
                        {r.count}/2
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        {/* 만들기 */}
        <div className="flex w-[30cqw] flex-col gap-[1cqw] rounded-[1cqw] bg-black/50 p-[1.4cqw] backdrop-blur-[2px]">
          <div className={`${KR} text-[1.5cqw] font-extrabold text-white`}>방 만들기</div>
          <input
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && !busy && create()}
            placeholder={`${nick}의 방`}
            className={field}
          />
          <button type="button" disabled={busy} onClick={create} className={bigBtn}>
            {busy ? "만드는 중…" : "+ 만들기"}
          </button>
          {err && <div className={`${KR} text-[1.1cqw] text-[#F87171]`}>{err}</div>}
          <div className="my-[0.4cqw] h-px bg-white/10" />
          <button
            type="button"
            disabled={open.length === 0}
            onClick={() => open[0] && onEnter(open[0].id)}
            className={`${KR} cursor-pointer rounded-full border-[0.2cqw] border-white/70 bg-black/40 py-[0.6cqw] text-[1.4cqw] font-bold text-white hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-black/40 disabled:hover:text-white`}
          >
            ⚡ 빠른 입장
          </button>
          <div className={`${KR} text-[1.05cqw] leading-relaxed text-white/40`}>
            상대를 기다리는 방에 바로 들어가요. 서로 직접 연결(P2P)해서 싸우고, 연결이 안 되면 서버를 거쳐요(조금 느림).
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────── 관전 대기 ─────────────

/** 관전: 방 상태를 보다가 경기가 시작되면(이미 진행 중이어도) 바로 관전 화면으로 */
function WatchRoom({
  w,
  played,
  onMatch,
  onLeave,
}: {
  w: WatchSession;
  played: Set<string>;
  onMatch: (cfg: MatchCfg) => void;
  onLeave: () => void;
}) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const off = w.on(force);
    return () => void off();
  }, [w]);
  const room = w.room;
  const st = room?.state;
  const ps = w.players;
  useEffect(() => {
    if (!st || st.phase !== "play" || !st.match || played.has(st.match) || !ps[0] || !ps[1]) return;
    loadSheet(CHARS[st.chars[0]].id).catch(() => {});
    loadSheet(CHARS[st.chars[1]].id).catch(() => {});
    onMatch({
      match: st.match,
      seat: 0,
      chars: st.chars,
      map: st.map,
      delay: st.delay,
      maxRb: st.maxRb,
      names: [ps[0].nick, ps[1].nick],
      spectate: true,
      room: w.id,
    });
  }, [st, played, ps, w.id, onMatch]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        onLeave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLeave]);

  if (w.lost)
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.4cqw]">
        <div className={`${KR} text-[2cqw] font-bold text-white`}>{w.lost}</div>
        <button type="button" onClick={onLeave} className={bigBtn}>
          로비로
        </button>
      </div>
    );
  if (!room) return <Center>방 불러오는 중…</Center>;
  const nWatch = Object.keys(room.watchers).length;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2cqw]">
      <button type="button" onClick={onLeave} className={`${pill} absolute top-[2cqw] left-[2cqw]`}>
        ◀ 로비로
      </button>
      <Title en="SPECTATE" ko={`${room.name} · 👁 관전 ${nWatch}명`} />
      <div className="flex items-center gap-[4cqw]">
        {[0, 1].map((sd) => {
          const p = ps[sd];
          const c = p && p.ch >= 0 ? CHARS[p.ch] : null;
          return (
            <div key={sd} className={`flex flex-col items-center gap-[0.6cqw] ${sd === 0 ? "order-1" : "order-3"}`}>
              {c ? (
                <img
                  src={face(c)}
                  alt={c.name}
                  className={`h-[13cqw] w-[16cqw] rounded-[0.8cqw] border-[0.35cqw] object-cover ${PX}`}
                  style={{ borderColor: SEAT_COL[sd], transform: sd === 1 ? "scaleX(-1)" : undefined }}
                />
              ) : (
                <div className="flex h-[13cqw] w-[16cqw] items-center justify-center rounded-[0.8cqw] border-[0.35cqw] border-white/20 font-mono text-[6cqw] font-black text-white/25">
                  ?
                </div>
              )}
              <div className={`${KR} text-[1.5cqw] font-bold text-white`}>{p?.nick ?? "빈자리"}</div>
              <div className={`${KR} text-[1.1cqw]`} style={{ color: p?.ready ? "#4ADE80" : "rgba(255,255,255,0.45)" }}>
                {p ? (p.ready ? "준비 완료" : c ? c.name : "랜덤") : ""}
              </div>
            </div>
          );
        })}
        <div className="order-2 font-mono text-[6cqw] font-black text-[#FDE047] italic drop-shadow-[0_0.4cqw_0_#000]">VS</div>
      </div>
      <div className={`${KR} text-[1.4cqw] text-white/60`}>
        {st?.phase === "play" && st.match && played.has(st.match)
          ? "지금 경기가 끝나길 기다리는 중… 다음 경기가 시작되면 바로 보여 줄게요"
          : "다음 경기를 기다리는 중… 시작되면 바로 관전 화면으로 넘어가요"}
      </div>
    </div>
  );
}

// ───────────── 대기실 ─────────────

function Room({
  s,
  played,
  onMatch,
  onLeave,
}: {
  s: RoomSession;
  played: Set<string>;
  onMatch: (cfg: MatchCfg) => void;
  onLeave: () => void;
}) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [err, setErr] = useState("");
  const [joined, setJoined] = useState(!!s.me);
  const [vs, setVs] = useState<MatchCfg | null>(null);
  const [chatText, setChatText] = useState("");
  const [copied, setCopied] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // 입장 (이미 들어가 있으면 그대로)
  useEffect(() => {
    const off = s.on(force);
    if (!s.room) {
      let ch = 0;
      try {
        const v = JSON.parse(localStorage.getItem("fight:setup") ?? "null") as { c1?: number } | null;
        if (v && typeof v.c1 === "number" && CHARS[v.c1]) ch = v.c1;
      } catch {}
      s.join(ch)
        .then(() => setJoined(true))
        .catch((e) => setErr(e instanceof RoomFullError ? "방이 꽉 찼어요" : "방에 들어가지 못했어요"));
    }
    return () => {
      off();
    };
  }, [s]);
  // 주소에 방 표시 (초대 링크 = 지금 주소)
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("room", s.id);
    window.history.replaceState(null, "", u);
    return () => {
      const v = new URL(window.location.href);
      v.searchParams.delete("room");
      window.history.replaceState(null, "", v);
    };
  }, [s.id]);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.chat.length]);

  const room = s.room;
  const me = s.me;
  const foe = s.foe;
  const net = s.net;
  const st = room?.state;
  const leave = () => {
    s.leave();
    onLeave();
  };

  // 방장: 둘 다 준비 + 연결됨 → 시작
  const bothReady = !!me?.ready && !!foe?.ready && !!net?.alive;
  useEffect(() => {
    if (!bothReady || !s.isHost || st?.phase !== "wait" || vs) return;
    const t = setTimeout(() => s.startMatch(CHARS.length, MAPS.length), 700);
    return () => clearTimeout(t);
  }, [bothReady, s, st?.phase, vs]);

  // 경기 시작 신호 → VS 잠깐 → 경기 화면
  useEffect(() => {
    if (!st || st.phase !== "play" || !st.match || played.has(st.match) || vs || !foe || !me) return;
    const names: [string, string] = s.seat === 0 ? [me.nick, foe.nick] : [foe.nick, me.nick];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 방 상태 변화에 따라 VS 화면
    setVs({ match: st.match, seat: s.seat, chars: st.chars, map: st.map, delay: st.delay, maxRb: st.maxRb, names });
    loadSheet(CHARS[st.chars[0]].id).catch(() => {});
    loadSheet(CHARS[st.chars[1]].id).catch(() => {});
    if (MAPS[st.map]?.bg) new Image().src = MAPS[st.map].bg!;
    s.setReady(false);
  }, [st, played, vs, foe, me, s]);
  useEffect(() => {
    if (!vs) return;
    const t = setTimeout(() => onMatch(vs), 1600);
    return () => clearTimeout(t);
  }, [vs, onMatch]);

  // 키보드: A·D(←→) 캐릭터, J·Space·Enter 준비, Esc 나가기
  const stRef = useRef({ me, vs });
  useEffect(() => {
    stRef.current = { me, vs };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const { me, vs } = stRef.current;
      if (vs) return;
      const k = e.code;
      if (k === "Escape") {
        e.preventDefault();
        leave();
        return;
      }
      if (!me) return;
      const n = CHARS.length;
      const move = (d: number) => !me.ready && (sfxUi("move"), s.setChar((((me.ch + 1 + d) % (n + 1)) + n + 1) % (n + 1) - 1));
      if (k === "KeyA" || k === "ArrowLeft") move(-1);
      else if (k === "KeyD" || k === "ArrowRight") move(1);
      else if (k === "KeyJ" || k === "Space" || k === "Enter") (sfxUi(me.ready ? "back" : "ready"), s.setReady(!me.ready));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 최신 값은 stRef로
  }, [s]);

  if (err || s.lost)
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.4cqw]">
        <div className={`${KR} text-[2cqw] font-bold text-white`}>{err || s.lost}</div>
        <button type="button" onClick={leave} className={bigBtn}>
          로비로
        </button>
      </div>
    );
  if (!joined || !room || !me) return <Center>입장 중…</Center>;

  if (vs) {
    const cs = [CHARS[vs.chars[0]], CHARS[vs.chars[1]]];
    const nm = vs.names;
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-[4cqw] bg-black/40">
        {cs.map((c, i) => (
          <div key={i} className={`flex flex-col items-center gap-[0.8cqw] ${i === 0 ? "order-1" : "order-3"}`}>
            <img
              src={face(c)}
              alt={c.name}
              className={`h-[18cqw] w-[22.5cqw] rounded-[0.8cqw] border-[0.4cqw] object-cover ${PX} [animation:modal-fade_300ms_ease-out]`}
              style={{ borderColor: c.color, transform: i === 1 ? "scaleX(-1)" : undefined }}
            />
            <div className={`${KR} text-[3.2cqw] leading-none font-extrabold`} style={{ color: c.color }}>
              {c.name}
            </div>
            <div className={`${KR} text-[1.5cqw] text-white/80`}>
              {nm[i]}
              {i === s.seat && <span className="ml-[0.5cqw] text-[#FDE047]">(나)</span>}
            </div>
          </div>
        ))}
        <div className="order-2 flex flex-col items-center gap-[0.6cqw]">
          <div className="font-mono text-[9cqw] font-black text-[#FDE047] italic drop-shadow-[0_0.5cqw_0_#000]">VS</div>
          <div className={`${KR} text-[1.3cqw] text-white/70`}>{MAPS[vs.map]?.name}</div>
        </div>
      </div>
    );
  }

  const seats = [0, 1].map((sd) => {
    const u = room.seats[sd];
    return (u && room.players[u]) || null;
  });
  const status = net?.status ?? "connecting";
  const ms = net?.rtt ? `${Math.round(net.rtt)}ms` : "재는 중";
  const badge = !foe
    ? { t: "상대 기다리는 중", c: "text-white/45" }
    : status === "p2p"
      ? { t: `직접 연결 · ${ms}`, c: "text-[#4ADE80]" }
      : status === "relay"
        ? { t: `서버 경유 · ${ms}`, c: "text-[#FDE047]" }
        : { t: "연결 중…", c: "text-white/60" };
  const copy = () => {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  const sendChat = () => {
    if (!chatText.trim()) return;
    s.sendChat(chatText);
    setChatText("");
  };
  const mapOpts = [-1, ...MAPS.map((_, i) => i)];
  const thumb = (i: number) => (i >= 0 ? MAPS[i].bg?.replace(".webp", "-thumb.webp") : undefined);

  return (
    <>
      {/* 위: 나가기 · 방 이름 · 연결 상태 */}
      <div className="absolute inset-x-[2cqw] top-[2cqw] z-20 flex items-center gap-[1cqw]">
        <button type="button" onClick={leave} className={pill}>
          ◀ 나가기
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <div className={`${KR} max-w-full truncate text-[2cqw] font-extrabold text-white drop-shadow-[0_0.2cqw_0_#000]`}>{room.name}</div>
          <div className={`${KR} text-[1.15cqw] ${badge.c}`}>● {badge.t}</div>
        </div>
        <button type="button" onClick={copy} className={pill}>
          {copied ? "복사됨!" : "🔗 초대 링크"}
        </button>
      </div>

      {/* 양쪽 자리 */}
      {[0, 1].map((sd) => {
        const p = seats[sd];
        const col = SEAT_COL[sd];
        const c = p && p.ch >= 0 ? CHARS[p.ch] : null;
        const mine = sd === s.seat;
        return (
          <div key={sd} className="contents">
            {p && c ? (
              <img
                key={c.id}
                src={art(c)}
                alt={c.name}
                className={`absolute top-[16%] ${sd === 0 ? "left-[1cqw] object-left-bottom" : "right-[1cqw] object-right-bottom"} z-0 h-[64%] w-[22cqw] object-contain ${PX} [animation:modal-fade_250ms_ease-out] ${sd === 1 ? "scale-x-[-1]" : ""}`}
                style={{ filter: p.ready ? "drop-shadow(0 0 0.2cqw #fff)" : `drop-shadow(0 0 1cqw ${col})` }}
              />
            ) : (
              <div
                className={`absolute top-[22%] ${sd === 0 ? "left-[4cqw]" : "right-[4cqw]"} z-0 flex h-[50%] w-[16cqw] items-center justify-center font-mono text-[12cqw] font-black text-white/25`}
                style={{ textShadow: p ? `0 0 2cqw ${col}` : undefined }}
              >
                ?
              </div>
            )}
            <div
              className={`absolute top-[8.4cqw] z-10 ${sd === 0 ? "left-[2cqw]" : "right-[2cqw] items-end text-right"} flex w-[20cqw] flex-col gap-[0.3cqw]`}
            >
              <div className={`flex items-center gap-[0.6cqw] ${sd === 1 ? "flex-row-reverse" : ""}`}>
                <span className="rounded-[0.3cqw] px-[0.7cqw] font-mono text-[1.2cqw] font-black text-white" style={{ background: col }}>
                  {sd === 0 ? "1P" : "2P"}
                </span>
                <span className={`${KR} truncate text-[1.5cqw] font-bold text-white drop-shadow-[0_0.2cqw_0_#000]`}>
                  {p ? p.nick : "빈자리"}
                  {mine && <span className="ml-[0.4cqw] text-[1.1cqw] text-[#FDE047]">(나)</span>}
                  {p && room.hostUid === p.uid && <span className="ml-[0.4cqw] text-[1.1cqw]">👑</span>}
                </span>
              </div>
              {p && (
                <div className={`${KR} text-[2.4cqw] leading-none font-extrabold drop-shadow-[0_0.3cqw_0_#000]`} style={{ color: c?.color ?? "#fff" }}>
                  {c ? c.name : "랜덤"}
                </div>
              )}
              {p ? (
                p.ready ? (
                  <span className="font-mono text-[1.6cqw] font-black text-[#FDE047] italic drop-shadow-[0_0.2cqw_0_#000]">READY!</span>
                ) : (
                  <span className={`${KR} text-[1.2cqw] text-white/50`}>고르는 중…</span>
                )
              ) : (
                <span className={`${KR} text-[1.2cqw] text-white/45`}>초대 링크를 보내 보세요</span>
              )}
            </div>
          </div>
        );
      })}

      {/* 가운데: 맵 · 채팅 */}
      <div className="absolute top-[8.6cqw] left-1/2 z-10 flex h-[24cqw] w-[34cqw] -translate-x-1/2 flex-col gap-[0.8cqw]">
        <div className="rounded-[0.8cqw] bg-black/55 p-[0.7cqw] backdrop-blur-[2px]">
          <div className={`${KR} mb-[0.4cqw] text-[1.05cqw] text-white/50`}>맵 {s.isHost ? "(방장이 고름)" : `— 방장이 고름`}</div>
          <div className="flex gap-[0.5cqw]">
            {mapOpts.map((i) => (
              <button
                key={i}
                type="button"
                disabled={!s.isHost}
                onClick={() => s.setPick(i)}
                className={`relative h-[4.4cqw] flex-1 cursor-pointer overflow-hidden rounded-[0.4cqw] border-[0.2cqw] disabled:cursor-default ${
                  st?.pick === i ? "border-[#FDE047]" : "border-white/15 opacity-60"
                }`}
              >
                {thumb(i) ? (
                  <img src={thumb(i)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-black/60 font-mono text-[2cqw] text-white/70">?</span>
                )}
                <span className={`${KR} absolute inset-x-0 bottom-0 bg-black/65 text-[0.95cqw] text-white`}>{i >= 0 ? MAPS[i].name : "랜덤"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col rounded-[0.8cqw] bg-black/55 backdrop-blur-[2px]">
          <div ref={chatRef} className={`thin-scroll min-h-0 flex-1 overflow-y-auto px-[0.9cqw] py-[0.5cqw] ${KR} text-[1.1cqw] leading-relaxed`}>
            {s.chat.length === 0 && <p className="text-white/30">채팅</p>}
            {s.chat.map((m) => (
              <p key={m.id} className="break-all text-white/80">
                <span className={m.uid === s.uid ? "text-[#A9A3FF]" : "text-white/45"}>{m.nick}</span> {m.text}
              </p>
            ))}
          </div>
          <div className="flex gap-[0.5cqw] border-t border-white/10 p-[0.5cqw]">
            <input
              value={chatText}
              maxLength={100}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) sendChat();
                if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
              placeholder="메시지 (Enter)"
              className={`${field} flex-1 py-[0.4cqw] text-[1.1cqw]`}
            />
          </div>
        </div>
      </div>

      {/* 아래: 내 캐릭터 고르기 + 준비 */}
      <div className="absolute bottom-[1cqw] left-1/2 z-10 flex -translate-x-1/2 items-end gap-[1.4cqw] rounded-[1cqw] bg-black/50 px-[1.2cqw] pt-[0.8cqw] pb-[0.7cqw] backdrop-blur-[2px]">
        <div className="flex flex-col items-center gap-[0.4cqw]">
          <div className="flex gap-[0.7cqw]">
            {[-1, ...CHARS.map((_, i) => i)].map((i) => {
              const on = me.ch === i;
              const c = i >= 0 ? CHARS[i] : null;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={me.ready}
                  onClick={() => (sfxUi("move"), s.setChar(i))}
                  className="cursor-pointer disabled:cursor-not-allowed"
                >
                  {c ? (
                    <img
                      src={face(c)}
                      alt={c.name}
                      className={`h-[5cqw] w-[6.2cqw] rounded-[0.4cqw] border-[0.25cqw] object-cover ${PX} ${on ? "" : "grayscale-[60%]"}`}
                      style={{ borderColor: on ? SEAT_COL[s.seat] : "rgba(255,255,255,0.2)" }}
                    />
                  ) : (
                    <span
                      className="flex h-[5cqw] w-[5cqw] items-center justify-center rounded-[0.4cqw] border-[0.25cqw] bg-black/60 font-mono text-[3cqw] font-black text-white/80"
                      style={{ borderColor: on ? SEAT_COL[s.seat] : "rgba(255,255,255,0.2)" }}
                    >
                      ?
                    </span>
                  )}
                  <span className={`${KR} block pt-[0.2cqw] text-center text-[1cqw] text-white/75`}>{c ? c.name : "랜덤"}</span>
                </button>
              );
            })}
          </div>
          <div className={`${KR} text-[1cqw] text-white/40`}>{keyText("A·D(←→) 고르기 · J(Enter) 준비 · Esc 나가기 · 둘 다 준비하면 시작")}</div>
        </div>
        <button type="button" disabled={!foe && !me.ready} onClick={() => (sfxUi(me.ready ? "back" : "ready"), s.setReady(!me.ready))} className={`${bigBtn} mb-[1.6cqw] min-w-[12cqw]`}>
          {me.ready ? "준비 취소" : foe ? "준비" : "상대 대기"}
        </button>
      </div>
      {me.ready && foe?.ready && !net?.alive && (
        <div className={`${KR} absolute inset-x-0 top-[34.5cqw] z-20 text-center text-[1.3cqw] text-[#FDE047]`}>상대와 연결 중…</div>
      )}
    </>
  );
}
