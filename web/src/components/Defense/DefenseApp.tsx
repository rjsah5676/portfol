"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import NickForm from "@/components/Account/NickForm";
import { useAuth } from "@/lib/AuthContext";
import { BALANCE_VER, LAST_WAVE } from "@/lib/defense/balance";
import { BOSSES } from "@/lib/defense/enemies";
import { UNIT } from "@/lib/defense/units";
import {
  beginRoom,
  createRoom,
  finishRun,
  getDefenseRank,
  joinRoom,
  leaveRoom,
  myRoom,
  reportOver,
  sendCmds,
  sendHash,
  setReady,
  startRun,
  watchLobby,
  watchRoom,
  type DefenseRankRow,
  type MpLobbyRoom,
  type MpRoom,
  type MpStanding,
} from "@/realtime/defense";
import Codex from "./Codex";
import { Controller } from "./controller";
import GameView from "./GameView";
import Stage from "./Stage";
import { playBgm } from "./audio";
import {
  Btn,
  FactionIcon,
  FsButton,
  Icon,
  Modal,
  SoundButton,
  TITLE,
  UnitIcon,
  fmtTime,
} from "./ui";
import PatchNotes, { LATEST } from "./PatchNotes";
import { BOSS_ART, UNIT_ART } from "@/lib/defense/assets";
import { FACTION_COLOR, FACTION_NAME, FACTIONS } from "@/lib/defense/units";

/*
 * PIXEL GLITCH DEFENSE(픽셀 글리치 디펜스) 몸통 — 무대(Stage) 안에서 메뉴 → 솔로 / 멀티(로비 → 방 → 판) / 도감 / 랭킹 이 바뀜.
 *  솔로: 회원이면 서버에서 시드를 받아 랭킹 판, 아니면 연습 판(기록 안 남음)
 *  멀티: 회원만. 방장이 시작하면 각자 자기 보드를 막는 생존 경쟁 (남 돕기는 나중에)
 */

type Screen =
  | { k: "menu" }
  | { k: "solo"; ctrl: Controller; ranked: boolean; key: number }
  | { k: "lobby" }
  | { k: "room"; id: string }
  | { k: "codex" }
  | { k: "rank" };

export default function DefenseApp() {
  const [screen, setScreen] = useState<Screen>({ k: "menu" });
  const { loading, account, profile, login, admin } = useAuth();
  const member = !!profile;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState(false);

  const startSolo = async () => {
    setBusy(true);
    setNote("");
    let seed = (Math.random() * 2 ** 31) >>> 0,
      run: string | null = null;
    if (member) {
      try {
        const r = await startRun();
        seed = r.seed;
        run = r.run;
      } catch (e) {
        setNote(`랭킹 서버에 닿지 않아 연습 판으로 시작해요 (${(e as Error).message})`);
      }
    }
    setBusy(false);
    setScreen({
      k: "solo",
      ctrl: new Controller(seed, 1, 0, { kind: "solo", run }),
      ranked: !!run,
      key: Date.now(),
    });
  };

  // 메뉴 · 로비 · 방 화면은 메뉴 배경음 (판 안에서는 GameView 가 웨이브에 맞춰 바꿈)
  const inGame = screen.k === "solo";
  useEffect(() => {
    if (!inGame) playBgm("menu");
  }, [inGame, screen.k]);
  useEffect(() => () => playBgm(null), []);

  let body: ReactNode;
  if (screen.k === "solo") {
    const { ctrl } = screen;
    body = (
      <GameView
        key={screen.key}
        ctrl={ctrl}
        admin={admin}
        onExit={() => setScreen({ k: "menu" })}
        onRetry={() => void startSolo()}
        finish={async () => {
          const run = ctrl.mode.kind === "solo" ? ctrl.mode.run : null;
          if (!run)
            return (
              <span className="text-white/55">
                연습 판이라 기록되지 않아요
                {member ? "" : " · 로그인하고 별명을 정하면 랭킹에 올라가요"}
              </span>
            );
          if (ctrl.unranked || ctrl.speed > 3)
            return <span className="text-white/55">개발자 도구를 써서 기록하지 않았어요</span>;
          const r = await finishRun(run, ctrl.log);
          return (
            <span>
              랭킹 <b className="text-[#ffd84a]">{r.rank}위</b>
              {r.best ? (
                <b className="ml-2 text-[#7ef3ff]">최고 기록 갱신!</b>
              ) : (
                <span className="ml-2 text-white/50">(최고 기록은 그대로)</span>
              )}
            </span>
          );
        }}
      />
    );
  } else if (screen.k === "lobby")
    body = (
      <Lobby
        onBack={() => setScreen({ k: "menu" })}
        onEnter={(id) => setScreen({ k: "room", id })}
      />
    );
  else if (screen.k === "room")
    body = (
      <Room
        id={screen.id}
        admin={admin}
        myUid={account?.uid ?? ""}
        onLeave={() => setScreen({ k: "lobby" })}
      />
    );
  else
    body = (
      <Menu
        loading={loading}
        member={member}
        account={!!account}
        nick={profile?.nick ?? null}
        busy={busy}
        note={note}
        onLogin={() => void login().catch(() => setNote("로그인하지 못했어요."))}
        onSolo={() => void startSolo()}
        onMulti={() => setScreen({ k: "lobby" })}
        onCodex={() => setScreen({ k: "codex" })}
        onRank={() => setScreen({ k: "rank" })}
        onRejoin={(id) => setScreen({ k: "room", id })}
        onNotes={() => setNotes(true)}
      />
    );

  return (
    <Stage>
      {body}
      {screen.k === "codex" && (
        <Modal title="도감" onClose={() => setScreen({ k: "menu" })} wide accent="#c08cff">
          <Codex />
        </Modal>
      )}
      {screen.k === "rank" && (
        <Modal
          title={`랭킹 · 밸런스 ${BALANCE_VER}`}
          onClose={() => setScreen({ k: "menu" })}
          accent="#ffd23f"
        >
          <RankList />
        </Modal>
      )}
      {notes && screen.k === "menu" && <PatchNotes onClose={() => setNotes(false)} />}
    </Stage>
  );
}

/* ───────────── 메뉴 ───────────── */

function Menu(p: {
  loading: boolean;
  member: boolean;
  account: boolean;
  nick: string | null;
  busy: boolean;
  note: string;
  onLogin(): void;
  onSolo(): void;
  onMulti(): void;
  onCodex(): void;
  onRank(): void;
  onRejoin(id: string): void;
  onNotes(): void;
}) {
  // 새로고침했는데 멀티 판이 진행 중이면 돌아가기 버튼
  const [mine, setMine] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (p.member) myRoom().then(setMine, () => {});
  }, [p.member]);
  // 메뉴에 세워 둘 대표 유닛 (그림이 있을 때만)
  const heroes = ["k_commander", "m_titan", "a_archmage"].filter((id) => UNIT_ART[id]);
  return (
    <div className="px-stars absolute inset-0 overflow-hidden">
      <div className="dfn-scan absolute inset-0 opacity-60" />
      <div className="dfn-vignette absolute inset-0" />
      {/* 아래 도트 땅 */}
      <div className="absolute inset-x-0 bottom-0 h-[86px] bg-[repeating-linear-gradient(90deg,#2b2348_0_32px,#2f274f_32px_64px)] shadow-[inset_0_4px_0_0_#3d3468,inset_0_8px_0_0_#0a0816]" />
      {/* 대표 유닛 */}
      {heroes.length > 0 && (
        <div className="absolute right-[40px] bottom-[60px] flex items-end gap-1">
          {heroes.map((id, i) => (
            <img
              key={id}
              src={UNIT_ART[id].src}
              alt=""
              className="dfn-float"
              style={{
                width: 150,
                height: 150,
                animationDelay: `${i * 0.4}s`,
                imageRendering: "auto",
              }}
            />
          ))}
        </div>
      )}
      {/* 오염된 파이터들 */}
      <div className="absolute top-[18px] right-[24px] flex gap-1">
        {BOSSES.map((b, i) =>
          BOSS_ART[b.fighter] ? (
            <img
              key={b.wave}
              src={BOSS_ART[b.fighter].src}
              alt=""
              title={`W${b.wave} ${b.name}`}
              className="dfn-glitch h-[72px] w-[72px] object-contain"
              style={{ animationDelay: `${i * 0.5}s` }}
            />
          ) : (
            <img
              key={b.wave}
              src={`/fight/art/${b.fighter}-face.webp`}
              alt=""
              title={b.name}
              className="dfn-glitch h-12 w-12 object-cover grayscale-[35%]"
              style={{ boxShadow: `0 0 0 2px ${b.color}, 0 0 0 4px #0a0816` }}
            />
          )
        )}
      </div>
      <div className="absolute top-[60px] left-[64px]">
        <p className="text-[13px] font-bold tracking-[0.4em] text-[var(--pink)]">
          PIXEL FIGHT 외전
        </p>
        <h1 className={`${TITLE} dfn-title mt-3 text-[60px] leading-[1.02]`}>
          PIXEL LUCKY
          <br />
          DEFENSE
        </h1>
        <p className="mt-4 max-w-[500px] text-[14px] leading-relaxed text-[var(--mute)]">
          픽셀 세계가 버그에 먹히고 있어요.{" "}
          {FACTIONS.map((f, i) => (
            <span key={f}>
              <b style={{ color: FACTION_COLOR[f] }}>
                <FactionIcon f={f} size={12} className="mr-0.5" />
                {FACTION_NAME[f]}
              </b>
              {i < 2 ? " · " : ""}
            </span>
          ))}
          의 수호자를 소환 · 합성해서 오염된 파이터들을 {LAST_WAVE}웨이브까지 막아 주세요.
        </p>
        <span className="mt-3 inline-block bg-[var(--gold)] px-2 py-1 text-[11px] font-bold text-[#1a1000]">
          ALPHA · 밸런스 {BALANCE_VER}
        </span>
      </div>
      <div className="absolute top-[318px] left-[64px] flex w-[330px] flex-col gap-3">
        <Btn
          tone="main"
          arrow
          className="h-[58px] text-[20px] font-bold"
          onClick={p.onSolo}
          disabled={p.busy}
        >
          <span className="px-shadow">{p.busy ? "준비 중…" : "혼자 하기"}</span>
          <span className="block text-[11px] font-normal opacity-85">
            {p.member ? "랭킹 기록 판" : "연습 판 (회원은 랭킹 기록)"}
          </span>
        </Btn>
        <div className="grid grid-cols-3 gap-2.5">
          <Btn
            tone="cyan"
            className="h-[42px] text-[14px] font-bold"
            onClick={p.onMulti}
            disabled={!p.member}
            title={p.member ? "" : "회원만"}
          >
            함께 하기
          </Btn>
          <Btn className="h-[42px] text-[14px]" onClick={p.onRank}>
            <Icon n="star" size={12} /> 랭킹
          </Btn>
          <Btn className="h-[42px] text-[14px]" onClick={p.onCodex}>
            <Icon n="book" size={12} /> 도감
          </Btn>
        </div>
        <div className="mt-1 text-[12px] text-[var(--mute)]">
          {p.loading ? (
            <span className="dfn-blink">로그인 확인 중…</span>
          ) : p.member ? (
            <>
              <b className="text-[var(--text)]">{p.nick}</b> 님으로 기록돼요
            </>
          ) : p.account ? (
            <NickForm submitLabel="별명 정하기" />
          ) : (
            <button
              type="button"
              onClick={p.onLogin}
              className="underline underline-offset-4 hover:text-white"
            >
              로그인하면 랭킹 · 멀티를 할 수 있어요
            </button>
          )}
        </div>
        {p.note && <p className="text-[12px] text-[#ffb347]">{p.note}</p>}
        {mine && (
          <Btn
            tone="gold"
            arrow
            className="dfn-pulse h-[40px] text-[13px] font-bold"
            onClick={() =>
              void joinRoom(mine.id).then(
                () => p.onRejoin(mine.id),
                () => setMine(null)
              )
            }
          >
            진행 중인 멀티 판으로 돌아가기
          </Btn>
        )}
      </div>
      <div className="absolute bottom-[22px] left-[64px] flex items-center gap-2">
        <SoundButton />
        <FsButton />
        <Btn className="h-[34px] px-3 text-[13px]" onClick={p.onNotes}>
          <Icon n="note" size={14} /> 패치노트
          <span className="ml-1.5 text-[11px] text-[var(--gold)]">{LATEST}</span>
        </Btn>
      </div>
    </div>
  );
}

/* ───────────── 랭킹 ───────────── */

export function RankList({ limit = 50 }: { limit?: number }) {
  const [rows, setRows] = useState<DefenseRankRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    getDefenseRank(limit).then(
      (r) => setRows(r.rows),
      (e: Error) => setErr(e.message)
    );
  }, [limit]);
  if (err) return <p className="text-[13px] text-[#ff9ab0]">{err}</p>;
  if (!rows) return <p className="dfn-blink text-[13px] text-[var(--mute)]">불러오는 중…</p>;
  if (!rows.length)
    return (
      <p className="text-[13px] text-[var(--mute)]">
        아직 기록이 없어요 — 첫 기록의 주인공이 돼 보세요
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div
          key={r.nick + i}
          className="px-inset flex items-center gap-2 px-2.5 py-1.5 text-[13px]"
          style={
            i < 3
              ? ({ "--b": ["#ffd23f", "#d6d9e6", "#e09a5b"][i] } as React.CSSProperties)
              : undefined
          }
        >
          <b
            className={`${TITLE} w-7 text-center ${i < 3 ? "text-[var(--gold)]" : "text-[var(--dim)]"}`}
          >
            {i + 1}
          </b>
          <b className="w-[110px] truncate">{r.nick}</b>
          <span className={`w-[110px] ${r.win ? "text-[var(--cyan)]" : ""}`}>
            {r.win ? `클리어 ${fmtTime(r.sec)}` : `${r.wave}웨이브`}
          </span>
          <span className="w-[70px] text-[var(--mute)]">처치 {r.kills}</span>
          <span className="flex gap-1">
            {r.tops.map((t) => (UNIT[t] ? <UnitIcon key={t} id={t} size={22} /> : null))}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ───────────── 멀티 ───────────── */

function Lobby({ onBack, onEnter }: { onBack(): void; onEnter(id: string): void }) {
  const [rooms, setRooms] = useState<MpLobbyRoom[] | null>(null);
  const [err, setErr] = useState("");
  const [mine, setMine] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => watchLobby(setRooms), []);
  useEffect(() => {
    myRoom().then(setMine, () => {});
  }, []);
  const go = (p: Promise<{ id: string }>) =>
    p.then(
      (r) => onEnter(r.id),
      (e: Error) => setErr(e.message)
    );
  return (
    <div className="px-stars absolute inset-0 p-8">
      <div className="flex items-center gap-3">
        <Btn className="h-10 px-4" onClick={onBack}>
          ◀ 메뉴
        </Btn>
        <h2 className={`${TITLE} px-shadow text-[28px]`}>함께 하기</h2>
        <span className="text-[12px] text-[var(--mute)]">
          최대 4명 · 각자 자기 라인을 막는 생존 경쟁 (남 돕기는 다음 버전)
        </span>
        <Btn
          tone="main"
          arrow
          className="ml-auto h-11 px-6 text-[15px] font-bold"
          onClick={() => go(createRoom())}
        >
          방 만들기
        </Btn>
        <SoundButton />
        <FsButton />
      </div>
      {err && <p className="mt-3 text-[13px] text-[#ff9ab0]">{err}</p>}
      {mine && (
        <Btn
          tone="gold"
          arrow
          className="dfn-pulse mt-5 w-full px-4 py-3 text-left"
          onClick={() => go(joinRoom(mine.id))}
        >
          <b className="text-[15px]">진행 중인 판으로 돌아가기</b>
          <span className="ml-2 text-[12px] opacity-80">
            {mine.name} · 내 보드가 그대로 이어져요
          </span>
        </Btn>
      )}
      <div className="mt-6 grid grid-cols-2 gap-3">
        {rooms === null && <p className="dfn-blink text-[var(--mute)]">불러오는 중…</p>}
        {rooms?.length === 0 && (
          <p className="text-[var(--mute)]">열린 방이 없어요 — 방을 만들어 보세요</p>
        )}
        {rooms?.map((r) => (
          <Btn
            key={r.id}
            tone="cyan"
            arrow
            onClick={() => go(joinRoom(r.id))}
            className="flex items-center px-4 py-3 text-left"
          >
            <b className="flex-1 text-[15px]">{r.name}</b>
            <span className="text-[13px] opacity-80">
              {r.count}/{r.max}
            </span>
          </Btn>
        ))}
      </div>
    </div>
  );
}

function Room({
  id,
  admin,
  myUid,
  onLeave,
}: {
  id: string;
  admin: boolean;
  myUid: string;
  onLeave(): void;
}) {
  const [room, setRoom] = useState<MpRoom | null | undefined>(undefined);
  const [ctrl, setCtrl] = useState<Controller | null>(null);
  const [standings, setStandings] = useState<MpStanding[] | null>(null);
  const [err, setErr] = useState("");
  const ctrlRef = useRef<Controller | null>(null);
  const roomRef = useRef<MpRoom | null>(null);

  useEffect(() => {
    const make = (seed: number, players: string[], uids: string[]) => {
      const seat = Math.max(0, uids.indexOf(myUid));
      const c = new Controller(seed, players.length, seat, {
        kind: "multi",
        room: id,
        send: (cmds) => sendCmds(id, cmds),
      });
      c.onHash = (tick, h) => void sendHash(id, tick, h).catch(() => {});
      ctrlRef.current = c;
      setCtrl(c);
      setStandings(null);
      return c;
    };
    return watchRoom(id, {
      onRoom: (r, game) => {
        roomRef.current = r;
        setRoom(r);
        if (r?.standings) setStandings(r.standings);
        // 판 중에 (다시) 들어옴: 지금까지의 기록으로 따라잡기
        // 연결이 끊겼다 붙음: 못 받은 턴을 기록으로 채움
        if (game && ctrlRef.current) ctrlRef.current.loadLog(game.log, game.turn);
        else if (game && r)
          make(
            game.seed,
            r.players.map((p) => p.nick),
            r.players.map((p) => p.uid)
          ).loadLog(game.log, game.turn);
      },
      onStart: (d) => {
        const r = roomRef.current;
        make(d.seed, d.players, r?.players.map((p) => p.uid) ?? []);
      },
      onTurn: (d) => ctrlRef.current?.onTurn(d.n, d.c),
      onDesync: (d) => {
        console.warn(`[defense] 멀티 어긋남 감지 tick ${d.tick}`);
        if (ctrlRef.current) ctrlRef.current.desync++;
      },
      onResult: (rows) => {
        setStandings(rows);
        ctrlRef.current = null;
        setCtrl(null);
      },
      onError: (m) => setErr(m),
    });
  }, [id, myUid]);

  const leave = () => {
    void leaveRoom(id).catch(() => {});
    onLeave();
  };

  if (ctrl && room) {
    const names = room.players.map((p) => p.nick);
    return (
      <GameView
        ctrl={ctrl}
        names={names}
        admin={admin}
        onExit={() => (ctrl.board.result ? (setCtrl(null), (ctrlRef.current = null)) : leave())}
        finish={async () => {
          const r = ctrl.board.result!;
          await reportOver(id, r.win, r.wave);
          return <span className="text-white/60">모두 끝나면 순위가 나와요</span>;
        }}
      />
    );
  }
  if (room === undefined)
    return (
      <div className="px-stars absolute inset-0 flex items-center justify-center text-[var(--mute)]">
        <span className="dfn-blink">방에 들어가는 중…</span>
      </div>
    );
  if (room === null)
    return (
      <div className="px-stars absolute inset-0 flex flex-col items-center justify-center gap-3">
        <p>방이 없어졌어요</p>
        <Btn className="px-5 py-2" onClick={onLeave}>
          로비로
        </Btn>
      </div>
    );
  const me = room.players.find((p) => p.uid === myUid);
  const host = room.hostUid === myUid;
  const allReady = room.players.every((p) => p.uid === room.hostUid || p.ready);
  return (
    <div className="px-stars absolute inset-0 p-8">
      <div className="flex items-center gap-3">
        <Btn className="h-10 px-4" onClick={leave}>
          ◀ 나가기
        </Btn>
        <h2 className={`${TITLE} px-shadow text-[26px]`}>{room.name}</h2>
        <span className="text-[12px] text-[var(--mute)]">
          {room.phase === "playing" ? "진행 중" : "대기 중"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <SoundButton />
          <FsButton />
        </div>
      </div>
      {err && <p className="mt-2 text-[13px] text-[#ff9ab0]">{err}</p>}
      <div className="mt-6 grid grid-cols-4 gap-4">
        {Array.from({ length: room.max }, (_, i) => room.players[i]).map((p, i) => (
          <div
            key={i}
            className={`flex h-[150px] flex-col items-center justify-center ${p ? "px-box" : "px-inset"}`}
            style={p && p.ready ? ({ "--b": "#6dff8f" } as React.CSSProperties) : undefined}
          >
            {p ? (
              <>
                <span className="mb-2 text-[11px] text-[var(--dim)]">P{i + 1}</span>
                <b className="text-[17px]">{p.nick}</b>
                <span className="mt-1 text-[12px] text-[var(--mute)]">
                  {p.uid === room.hostUid ? (
                    "방장"
                  ) : p.ready ? (
                    <span className="text-[var(--green)]">준비 완료</span>
                  ) : (
                    "준비 중"
                  )}
                </span>
              </>
            ) : (
              <span className="dfn-blink text-[var(--dim)]">빈 자리</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        {host ? (
          <Btn
            tone="main"
            className="h-12 px-8 text-[18px] font-bold"
            disabled={!allReady || room.phase === "playing"}
            onClick={() => void beginRoom(id).catch((e: Error) => setErr(e.message))}
          >
            시작
          </Btn>
        ) : (
          <Btn
            tone={me?.ready ? "ghost" : "cyan"}
            className="h-12 px-8 text-[18px] font-bold"
            onClick={() => void setReady(id, !me?.ready).catch((e: Error) => setErr(e.message))}
          >
            {me?.ready ? "준비 취소" : "준비"}
          </Btn>
        )}
        <p className="self-center text-[12px] text-[var(--mute)]">
          같은 시드로 시작해요 — 운은 같고, 고르는 건 각자. 가장 오래 버틴 사람이 1등.
        </p>
      </div>
      {standings && (
        <Modal title="결과" onClose={() => setStandings(null)} accent="#ffd23f">
          <div className="flex flex-col gap-1.5">
            {standings.map((s, i) => (
              <div
                key={s.nick + i}
                className="px-inset flex items-center gap-3 px-3 py-2 text-[14px]"
              >
                <b
                  className={`${TITLE} w-7 text-[20px] ${i === 0 ? "text-[var(--gold)]" : "text-[var(--dim)]"}`}
                >
                  {i + 1}
                </b>
                <b className="w-[120px] truncate">{s.nick}</b>
                <span className={s.win ? "text-[var(--cyan)]" : ""}>
                  {s.win ? `클리어 ${fmtTime(s.sec)}` : `${s.wave}웨이브`}
                </span>
                <span className="text-[var(--mute)]">처치 {s.kills}</span>
                <span className="ml-auto flex gap-1">
                  {s.tops.map((t) => (UNIT[t] ? <UnitIcon key={t} id={t} size={24} /> : null))}
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
