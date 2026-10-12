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
  reportOver,
  sendCmds,
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
import { Btn, Modal, TITLE, UnitIcon, fmtTime } from "./ui";

/*
 * 글리치 디펜스 몸통 — 무대(Stage) 안에서 메뉴 → 솔로 / 멀티(로비 → 방 → 판) / 도감 / 랭킹 이 바뀜.
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
      />
    );

  return (
    <Stage>
      {body}
      {screen.k === "codex" && (
        <Modal title="도감" onClose={() => setScreen({ k: "menu" })} wide>
          <Codex />
        </Modal>
      )}
      {screen.k === "rank" && (
        <Modal title={`랭킹 (밸런스 ${BALANCE_VER})`} onClose={() => setScreen({ k: "menu" })}>
          <RankList />
        </Modal>
      )}
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
}) {
  return (
    <div className="dfn-menu absolute inset-0 overflow-hidden bg-[#070a14] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,92,214,0.18),transparent_55%),radial-gradient(ellipse_at_80%_80%,rgba(126,243,255,0.14),transparent_55%)]" />
      <div className="dfn-scan absolute inset-0" />
      {/* 오염된 파이터들 */}
      <div className="absolute right-8 bottom-6 flex gap-2 opacity-80">
        {BOSSES.map((b) => (
          <img
            key={b.wave}
            src={`/fight/art/${b.fighter}-face.webp`}
            alt=""
            className="dfn-glitch h-14 w-14 rounded-full border-2 object-cover grayscale-[40%]"
            style={{ borderColor: b.color }}
          />
        ))}
      </div>
      <div className="absolute top-[70px] left-[70px]">
        <p className="text-[15px] font-bold tracking-[0.35em] text-[#ff5cd6]">PIXEL FIGHT 외전</p>
        <h1
          className={`${TITLE} dfn-title mt-1 text-[78px] leading-[0.95]`}
          data-text="GLITCH DEFENSE"
        >
          GLITCH DEFENSE
        </h1>
        <p className="mt-3 max-w-[520px] text-[16px] leading-relaxed text-white/70">
          픽셀 세계가 버그에 먹히고 있어요. 기사단 · 기계공방 · 마도회의 수호자를 소환하고 합성해서,
          글리치와 오염된 파이터들을 {LAST_WAVE}웨이브까지 막아 주세요.
        </p>
        <span className="mt-2 inline-block rounded bg-[#ffd84a]/15 px-2 py-0.5 text-[12px] font-bold text-[#ffd84a]">
          ALPHA · 그림 없이 자리표시 · 밸런스 {BALANCE_VER}
        </span>
      </div>
      <div className="absolute top-[330px] left-[70px] flex w-[340px] flex-col gap-2.5">
        <Btn
          tone="main"
          className="h-[60px] text-[22px] font-bold"
          onClick={p.onSolo}
          disabled={p.busy}
        >
          {p.busy ? "준비 중…" : "혼자 하기"}
          <span className="block text-[12px] font-normal opacity-80">
            {p.member ? "랭킹 기록 판" : "연습 판 (회원은 랭킹 기록)"}
          </span>
        </Btn>
        <div className="grid grid-cols-3 gap-2">
          <Btn
            tone="cyan"
            className="h-[46px] text-[15px] font-bold"
            onClick={p.onMulti}
            disabled={!p.member}
            title={p.member ? "" : "회원만"}
          >
            함께 하기
          </Btn>
          <Btn className="h-[46px] text-[15px]" onClick={p.onRank}>
            랭킹
          </Btn>
          <Btn className="h-[46px] text-[15px]" onClick={p.onCodex}>
            도감
          </Btn>
        </div>
        <div className="mt-1 text-[13px] text-white/55">
          {p.loading ? (
            "로그인 확인 중…"
          ) : p.member ? (
            <>
              <b className="text-white/85">{p.nick}</b> 님으로 기록돼요
            </>
          ) : p.account ? (
            <NickForm submitLabel="별명 정하기" />
          ) : (
            <button
              type="button"
              onClick={p.onLogin}
              className="underline underline-offset-2 hover:text-white"
            >
              로그인하면 랭킹 · 멀티를 할 수 있어요
            </button>
          )}
        </div>
        {p.note && <p className="text-[13px] text-[#ffb347]">{p.note}</p>}
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
  if (err) return <p className="text-[14px] text-[#ff9aa8]">{err}</p>;
  if (!rows) return <p className="text-[14px] text-white/50">불러오는 중…</p>;
  if (!rows.length)
    return (
      <p className="text-[14px] text-white/50">아직 기록이 없어요 — 첫 기록의 주인공이 돼 보세요</p>
    );
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <div
          key={r.nick + i}
          className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[14px]"
        >
          <b className={`${TITLE} w-7 text-center ${i < 3 ? "text-[#ffd84a]" : "text-white/50"}`}>
            {i + 1}
          </b>
          <b className="w-[110px] truncate">{r.nick}</b>
          <span className={`w-[110px] ${r.win ? "text-[#7ef3ff]" : ""}`}>
            {r.win ? `클리어 ${fmtTime(r.sec)}` : `${r.wave}웨이브`}
          </span>
          <span className="w-[70px] text-white/50">처치 {r.kills}</span>
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
  useEffect(() => watchLobby(setRooms), []);
  const go = (p: Promise<{ id: string }>) =>
    p.then(
      (r) => onEnter(r.id),
      (e: Error) => setErr(e.message)
    );
  return (
    <div className="absolute inset-0 bg-[#070a14] p-8 text-white">
      <div className="flex items-center gap-3">
        <Btn className="h-10 px-4" onClick={onBack}>
          ← 메뉴
        </Btn>
        <h2 className={`${TITLE} text-[30px]`}>함께 하기</h2>
        <span className="text-[14px] text-white/50">
          최대 4명 · 각자 자기 라인을 막는 생존 경쟁 (남 돕기는 다음 버전)
        </span>
        <Btn
          tone="main"
          className="ml-auto h-11 px-6 text-[16px] font-bold"
          onClick={() => go(createRoom())}
        >
          방 만들기
        </Btn>
      </div>
      {err && <p className="mt-3 text-[14px] text-[#ff9aa8]">{err}</p>}
      <div className="mt-5 grid grid-cols-2 gap-2">
        {rooms === null && <p className="text-white/50">불러오는 중…</p>}
        {rooms?.length === 0 && (
          <p className="text-white/50">열린 방이 없어요 — 방을 만들어 보세요</p>
        )}
        {rooms?.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => go(joinRoom(r.id))}
            className="flex items-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left hover:border-[#7ef3ff]/50"
          >
            <b className="flex-1 text-[16px]">{r.name}</b>
            <span className="text-[14px] text-white/60">
              {r.count}/{r.max}
            </span>
          </button>
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
      <div className="absolute inset-0 flex items-center justify-center bg-[#070a14] text-white/60">
        방에 들어가는 중…
      </div>
    );
  if (room === null)
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#070a14] text-white">
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
    <div className="absolute inset-0 bg-[#070a14] p-8 text-white">
      <div className="flex items-center gap-3">
        <Btn className="h-10 px-4" onClick={leave}>
          ← 나가기
        </Btn>
        <h2 className={`${TITLE} text-[28px]`}>{room.name}</h2>
        <span className="text-[14px] text-white/50">
          {room.phase === "playing" ? "진행 중" : "대기 중"}
        </span>
      </div>
      {err && <p className="mt-2 text-[14px] text-[#ff9aa8]">{err}</p>}
      <div className="mt-6 grid grid-cols-4 gap-3">
        {Array.from({ length: room.max }, (_, i) => room.players[i]).map((p, i) => (
          <div
            key={i}
            className={`flex h-[150px] flex-col items-center justify-center rounded-2xl border ${p ? "border-white/15 bg-white/[0.05]" : "border-dashed border-white/10"}`}
          >
            {p ? (
              <>
                <b className="text-[18px]">{p.nick}</b>
                <span className="mt-1 text-[13px] text-white/50">
                  {p.uid === room.hostUid ? (
                    "방장"
                  ) : p.ready ? (
                    <span className="text-[#7dff8a]">준비 완료</span>
                  ) : (
                    "준비 중"
                  )}
                </span>
              </>
            ) : (
              <span className="text-white/30">빈 자리</span>
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
        <p className="self-center text-[13px] text-white/45">
          같은 시드로 시작해요 — 운은 같고, 고르는 건 각자. 가장 오래 버틴 사람이 1등.
        </p>
      </div>
      {standings && (
        <Modal title="결과" onClose={() => setStandings(null)}>
          <div className="flex flex-col gap-1.5">
            {standings.map((s, i) => (
              <div
                key={s.nick + i}
                className="flex items-center gap-3 rounded-lg bg-white/[0.05] px-3 py-2 text-[15px]"
              >
                <b
                  className={`${TITLE} w-7 text-[20px] ${i === 0 ? "text-[#ffd84a]" : "text-white/50"}`}
                >
                  {i + 1}
                </b>
                <b className="w-[120px] truncate">{s.nick}</b>
                <span className={s.win ? "text-[#7ef3ff]" : ""}>
                  {s.win ? `클리어 ${fmtTime(s.sec)}` : `${s.wave}웨이브`}
                </span>
                <span className="text-white/50">처치 {s.kills}</span>
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
