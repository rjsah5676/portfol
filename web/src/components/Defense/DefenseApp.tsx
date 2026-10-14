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
  meta,
  leaveRoom,
  myRoom,
  reportOver,
  sendCmds,
  sendHash,
  setReady,
  startRun,
  watchLobby,
  watchRoom,
  type DefenseProfile,
  type DefenseRankRow,
  type FinishOut,
  type RankBoard,
  type MpLobbyRoom,
  type MpRoom,
  type MpStanding,
} from "@/realtime/defense";
import Codex from "./Codex";
import { Controller } from "./controller";
import Hub, { Cur, curTip, type HubTab } from "./Hub";
import { setTheme } from "./render";
import { GLITCH, GRIT_PER, type Loadout } from "@/lib/defense/progress";
import { resetTutorial } from "./Tutorial";
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
  Tip,
  UnitIcon,
  fmtNum,
  fmtTime,
} from "./ui";
import PatchNotes, { LATEST } from "./PatchNotes";
import { BOSS_ART, UNIT_ART } from "@/lib/defense/assets";
import { FACTION_COLOR, FACTION_NAME, FACTIONS } from "@/lib/defense/units";

/*
 * PIXEL GLITCH DEFENSE(픽셀 글리치 디펜스) 몸통 — 무대(Stage) 안에서 메뉴 → 솔로 / 멀티(로비 → 방 → 판) / 도감 / 랭킹 이 바뀜.
 *  솔로: 회원이면 서버에서 시드 · 로드아웃을 받아 시즌 판(영구 성장 적용),
 *        아니면 연습 판(기록 안 남음). 끝나면 서버가 검증한 뒤 보상(픽셀 조각 · 카드 · 코어 · 패스 경험치)
 *  정비소(Hub): 판 밖 성장 — 유닛 강화 · 연구 · 유물 · 상자 · 미션 · 시즌 패스 · GP 상점
 *  멀티: 회원만. 방장이 시작하면 각자 자기 보드를 막는 생존 경쟁 (남 돕기는 나중에)
 */

type Screen =
  | { k: "menu" }
  | { k: "solo"; ctrl: Controller; ranked: boolean; key: number; mode: RankBoard; lo: Loadout | null }
  | { k: "hub"; tab?: HubTab }
  | { k: "shop"; tab?: HubTab }
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
  /** 판 밖 성장 (회원만) */
  const [prof, setProf] = useState<DefenseProfile | null>(null);
  const loadProf = () =>
    meta.profile().then(
      (p) => setProf(p),
      () => {}
    );
  useEffect(() => {
    if (member) void loadProf();
    else setProf(null);
  }, [member]);
  useEffect(() => setTheme(prof?.theme), [prof?.theme]);

  const startSolo = async (mode: RankBoard = "season") => {
    setBusy(true);
    setNote("");
    let seed = (Math.random() * 2 ** 31) >>> 0,
      run: string | null = null,
      lo: Loadout | null = null;
    if (member) {
      try {
        const r = await startRun(mode);
        seed = r.seed;
        run = r.run;
        lo = r.loadout;
      } catch (e) {
        setNote(`랭킹 서버에 닿지 않아 연습 판으로 시작해요 (${(e as Error).message})`);
      }
    }
    setBusy(false);
    setScreen({
      k: "solo",
      ctrl: newCtrl(seed, run, lo),
      ranked: !!run,
      key: Date.now(),
      mode,
      lo,
    });
  };

  /* ── 이어하기: 솔로 판을 2초마다 이 기기에 저장 → 새로고침 · 튕김 뒤 메뉴에서 이어서 ── */
  const saveKey = `pgd-resume:${account?.uid ?? "guest"}`;
  const [resume, setResume] = useState<ResumeSave | null>(null);
  useEffect(() => {
    setResume(readResume(saveKey));
  }, [saveKey, screen.k]);
  useEffect(() => {
    if (screen.k !== "solo") return;
    const { ctrl, mode, lo } = screen;
    const save = () => {
      const b = ctrl.board;
      if (b.result || ctrl.unranked) return clearResume(saveKey);
      if (b.wave < 1) return;
      writeResume(saveKey, {
        v: BALANCE_VER,
        at: Date.now(),
        run: ctrl.mode.kind === "solo" ? ctrl.mode.run : null,
        seed: ctrl.game.seed,
        mode,
        lo,
        tick: ctrl.game.tick,
        wave: b.wave,
        log: ctrl.log,
      });
    };
    const t = setInterval(save, 2000);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [screen, saveKey]);
  const doResume = (r: ResumeSave) => {
    const ctrl = newCtrl(r.seed, r.run, r.lo);
    ctrl.restore(r.log, r.tick);
    setScreen({ k: "solo", ctrl, ranked: !!r.run, key: Date.now(), mode: r.mode, lo: r.lo });
  };
  const newCtrl = (seed: number, run: string | null, lo: Loadout | null) =>
    new Controller(seed, 1, 0, { kind: "solo", run }, [lo]);

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
        onExit={() => (setScreen({ k: "menu" }), void loadProf())}
        onRetry={() => void startSolo(screen.mode)}
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
          void loadProf();
          return <FinishNote r={r} />;
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
  else if (screen.k === "hub" || screen.k === "shop")
    body = prof ? (
      <Hub
        key={screen.k}
        mode={screen.k}
        profile={prof}
        setProfile={setProf}
        tab={screen.tab}
        onBack={() => setScreen({ k: "menu" })}
      />
    ) : (
      <div className="px-stars absolute inset-0 flex items-center justify-center text-[var(--mute)]">
        <span className="dfn-blink">불러오는 중…</span>
      </div>
    );
  else if (screen.k === "room")
    body = (
      <Room
        id={screen.id}
        admin={admin}
        myUid={account?.uid ?? ""}
        onLeave={() => (setScreen({ k: "lobby" }), void loadProf())}
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
        prof={prof}
        resume={resume}
        onResume={() => resume && doResume(resume)}
        onDropResume={() => (clearResume(saveKey), setResume(null))}
        onSolo={() => void startSolo("season")}
        onGlitch={(g) => prof && void meta.setLoad({ ...prof.load, glitch: g }).then(setProf, () => {})}
        onShop={() => setScreen({ k: "shop" })}
        onHub={(tab) => setScreen({ k: "hub", tab })}
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
        <Modal title="랭킹" onClose={() => setScreen({ k: "menu" })} accent="#ffd23f">
          <RankTabs />
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
  prof: DefenseProfile | null;
  resume: ResumeSave | null;
  onResume(): void;
  onDropResume(): void;
  onLogin(): void;
  onSolo(): void;
  onShop(): void;
  /** 오염 단계 바꾸기 (메뉴에서 바로) */
  onGlitch(g: number): void;
  onHub(tab?: HubTab): void;
  onMulti(): void;
  onCodex(): void;
  onRank(): void;
  onRejoin(id: string): void;
  onNotes(): void;
}) {
  const [tut, setTut] = useState(false);
  // 새로고침했는데 멀티 판이 진행 중이면 돌아가기 버튼
  const [mine, setMine] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (p.member) myRoom().then(setMine, () => {});
  }, [p.member]);
  // 메뉴에 세워 둘 대표 유닛 (그림이 있을 때만)
  const heroes = ["k_commander", "m_titan", "a_archmage"].filter((id) => UNIT_ART[id]);
  const pr = p.prof;
  const glitch = pr ? Math.min(pr.load.glitch, pr.glitchOpen) : 0;
  /** 끈기 (서버 gritOf 와 같은 규칙) */
  const grit = pr && glitch === pr.glitchOpen && glitch > pr.glitchWin && pr.grit?.g === glitch ? pr.grit.n : 0;
  // 정비소 알림 점: 받을 미션 · 패스 (안 연 상자는 상점 버튼에)
  const hubDot = pr
    ? [...pr.quests.daily, ...pr.quests.weekly].filter((q) => !q.claimed && q.value >= q.goal).length +
      (pr.passTier - pr.season.free.length)
    : 0;
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
      {/* 재화 */}
      {pr && (
        <div className="px-inset absolute top-[104px] right-[24px] z-30 flex items-center gap-3.5 px-3 py-1.5 text-[13px]">
          <Tip text={curTip("piece")}>
            <Cur k="piece" n={fmtNum(pr.pieces)} />
          </Tip>
          <Tip text={curTip("core")} className="text-[#ffb3ee]">
            <Cur k="core" n={pr.cores} />
          </Tip>
          <Tip text={curTip("gp")} className="text-[var(--green)]" align="right">
            <Cur k="gp" n={fmtNum(pr.gp)} />
          </Tip>
          <span className="text-[12px] text-[var(--mute)]">
            시즌 {pr.season.id} · 패스 {pr.passTier}단계
          </span>
        </div>
      )}
      <div className="absolute top-[40px] left-[64px]">
        <p className="text-[13px] font-bold tracking-[0.4em] text-[var(--pink)]">
          PIXEL FIGHT 외전
        </p>
        <h1 className={`${TITLE} dfn-title mt-2 text-[56px] leading-[1.02]`}>
          PIXEL LUCKY
          <br />
          DEFENSE
        </h1>
        <p className="mt-3 max-w-[500px] text-[13px] leading-relaxed text-[var(--mute)]">
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
        <div className="mt-2 flex items-center gap-1.5">
          <span className="inline-block bg-[var(--gold)] px-2 py-1 text-[12px] font-bold text-[#1a1000]">
            BETA 1.2 · 밸런스 {BALANCE_VER}
          </span>
          {p.resume && (
            <>
              <Btn tone="gold" arrow className="dfn-pulse h-[26px] px-3 text-[12px] font-bold" onClick={p.onResume} title="새로고침 · 튕기기 전에 하던 판을 그 자리부터">
                ▶ 이어하기 — {p.resume.run ? "시즌" : "연습"} {p.resume.wave}웨이브
              </Btn>
              <Btn className="h-[26px] w-[26px] text-[12px]" onClick={p.onDropResume} title="저장된 판 지우기">
                ✕
              </Btn>
            </>
          )}
        </div>
      </div>
      <div className="absolute top-[268px] left-[64px] flex w-[372px] flex-col gap-2.5">

        <div className="flex gap-1.5">
          {p.member && pr && (
            <Btn
              className="h-[58px] w-[34px] shrink-0 px-0 text-[14px]"
              disabled={p.busy || glitch <= 0}
              title="오염 단계 낮추기"
              onClick={() => p.onGlitch(glitch - 1)}
            >
              ◀
            </Btn>
          )}
          <Btn
            tone="main"
            arrow
            className="h-[58px] min-w-0 flex-1 text-[20px] font-bold"
            onClick={p.onSolo}
            disabled={p.busy}
          >
            <span className="px-shadow">{p.busy ? "준비 중…" : p.member ? "시즌 도전" : "혼자 하기"}</span>
            <span className="block text-[12px] font-normal opacity-85">
              {!p.member
                ? "연습 판 (회원은 랭킹 · 성장 · 보상)"
                : pr
                  ? `오염 ${glitch}단계 (보상 ×${GLITCH[glitch].reward}) · 연구 ${pr.load.res.length} · 유물 ${pr.load.relics.length}${grit ? ` · 끈기 +${Math.round(grit * GRIT_PER * 100)}%` : ""}`
                  : "시즌 랭킹 판"}
            </span>
          </Btn>
          {p.member && pr && (
            <Btn
              className="h-[58px] w-[34px] shrink-0 px-0 text-[14px]"
              disabled={p.busy || glitch >= pr.glitchOpen}
              title={glitch >= pr.glitchOpen ? "아직 열리지 않은 단계예요" : `오염 단계 올리기 — ${GLITCH[glitch + 1]?.rule ?? ""}`}
              onClick={() => p.onGlitch(glitch + 1)}
            >
              ▶
            </Btn>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Btn
            tone="gold"
            className="relative h-[50px] px-2 text-left"
            onClick={p.onShop}
            disabled={!p.member || p.busy}
            title={p.member ? "패키지 · 상자 · 초월 소환 · 재화샵 · GP 교환" : "회원만"}
          >
            <b className="block text-[14px]">상점</b>
            <span className="block truncate text-[12px] opacity-85">패키지 · 상자 · 초월 소환</span>
            {!!pr && pr.boxes.card + pr.boxes.relic + (pr.boxes.trans ?? 0) > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] bg-[#ff4d6d] px-1 text-center text-[12px] leading-[16px] text-white shadow-[0_0_0_2px_#0a0816]">
                {pr.boxes.card + pr.boxes.relic + (pr.boxes.trans ?? 0)}
              </span>
            )}
          </Btn>
          <Btn
            tone="cyan"
            className="relative h-[50px] px-2 text-left"
            onClick={() => p.onHub()}
            disabled={!p.member}
            title={p.member ? "" : "회원만"}
          >
            <b className="block text-[14px]">정비소</b>
            <span className="block text-[12px] opacity-85">강화 · 연구 · 유물 · 미션</span>
            {hubDot > 0 && (
              <span className="dfn-pulse absolute top-1 right-1 min-w-[18px] bg-[#ff4d6d] px-1 text-center text-[12px] leading-[18px] text-white shadow-[0_0_0_2px_#0a0816]">
                {hubDot}
              </span>
            )}
          </Btn>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <Btn
            className="h-[38px] text-[13px] font-bold"
            onClick={p.onMulti}
            disabled={!p.member}
            title={p.member ? "" : "회원만"}
          >
            함께 하기
          </Btn>
          <Btn className="h-[38px] text-[13px]" onClick={p.onRank}>
            <Icon n="star" size={12} /> 랭킹
          </Btn>
          <Btn className="h-[38px] text-[13px]" onClick={p.onCodex}>
            <Icon n="book" size={12} /> 도감
          </Btn>
        </div>
        <div className="text-[12px] text-[var(--mute)]">
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
              로그인하면 랭킹 · 성장 · 멀티를 할 수 있어요
            </button>
          )}
        </div>
        {p.note && <p className="text-[12px] text-[#ffb347]">{p.note}</p>}
        {mine && (
          <Btn
            tone="gold"
            arrow
            className="dfn-pulse h-[36px] text-[13px] font-bold"
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
      <div className="absolute bottom-[22px] left-[64px] z-30 flex items-center gap-2">
        <SoundButton up />
        <FsButton />
        <Btn className="h-[34px] px-3 text-[13px]" onClick={p.onNotes}>
          <Icon n="note" size={14} /> 패치노트
          <span className="ml-1.5 text-[12px] text-[var(--gold)]">{LATEST}</span>
        </Btn>
        <Btn
          className="h-[34px] px-3 text-[13px]"
          title="판 안에서 상황마다 나오는 안내 카드를 처음부터 다시 보여 줘요"
          onClick={() => (resetTutorial(), setTut(true))}
        >
          <Icon n="book" size={14} /> {tut ? "튜토리얼 켜짐" : "튜토리얼"}
        </Btn>
      </div>
    </div>
  );
}

/* ───────────── 판 끝 (검증 · 보상) ───────────── */

const waveTxt = (w: number) => (w > LAST_WAVE ? "클리어" : `W${w}`);

function FinishNote({ r }: { r: FinishOut }) {
  const w = r.reward;
  const gb = w?.gbest;
  return (
    <span className="flex flex-col items-center gap-1.5">
      {gb && (
        <span className="text-[13px]">
          오염 {gb.glitch}단계 최고{" "}
          {gb.now > gb.prev && gb.prev > 0 ? (
            <b className="dfn-pop text-[var(--cyan)]">
              {waveTxt(gb.prev)} → {waveTxt(gb.now)} 갱신!
            </b>
          ) : gb.now > gb.prev ? (
            <b className="dfn-pop text-[var(--cyan)]">{waveTxt(gb.now)} (첫 기록)</b>
          ) : (
            <span className="text-white/60">
              {waveTxt(gb.now)} · 이번 {waveTxt(r.result.win ? LAST_WAVE + 1 : r.result.wave)}
              {!r.result.win && gb.now <= LAST_WAVE && ` (${gb.now - r.result.wave}웨이브 차이)`}
            </span>
          )}
        </span>
      )}
      <span>
        시즌 랭킹 <b className="text-[#ffd84a]">{r.rank}위</b>
        {r.best ? (
          <b className="ml-2 text-[#7ef3ff]">최고 기록 갱신!</b>
        ) : (
          <span className="ml-2 text-white/50">(최고 기록은 그대로)</span>
        )}
      </span>
      {w && (
        <span className="dfn-pop flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px]">
          <Cur k="piece" n={`+${w.pieces}`} />
          {w.cores > 0 && <Cur k="core" n={`+${w.cores}`} className="text-[#ffb3ee]" />}
          <Cur k="card" n={`+${Object.values(w.cards).reduce((a, b) => a + b, 0)}`} />
          <span className="text-[var(--cyan)]">+{w.xp} XP</span>
          {w.opened !== null && <b className="text-[var(--pink)]">오염 {w.opened}단계 열림!</b>}
        </span>
      )}
      {w && (w.first || w.firstClear || (w.fresh?.length ?? 0) > 0) && (
        <span className="dfn-pop flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px]">
          {w.first && <span className="text-[var(--gold)]">오늘 첫 판 — 조각 ×2</span>}
          {w.firstClear && (
            <b className="text-[var(--pink)]">
              오염 {w.firstClear.glitch}단계 첫 클리어! 코어 +{w.firstClear.cores} · 유물 상자 +{w.firstClear.relicBox}
            </b>
          )}
          {(w.fresh?.length ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-[var(--cyan)]">
              도감 새로 수집
              {w.fresh!.slice(0, 6).map((id) => (UNIT[id] ? <UnitIcon key={id} id={id} size={20} /> : null))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/* ───────────── 랭킹 ───────────── */

function RankTabs() {
  const [board, setBoard] = useState<RankBoard>("season");
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Btn tone={board === "season" ? "main" : "ghost"} className="h-8 px-3 text-[13px] font-bold" onClick={() => setBoard("season")}>
          시즌
        </Btn>
        <span className="ml-2 text-[12px] text-[var(--mute)]">
          {`영구 성장 적용 · 오염 단계가 높을수록 위 · 밸런스 ${BALANCE_VER}`}
        </span>
      </div>
      <RankList key={board} board={board} />
    </div>
  );
}

export function RankList({ limit = 50, board = "season" }: { limit?: number; board?: RankBoard }) {
  const [rows, setRows] = useState<DefenseRankRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    getDefenseRank(limit, board).then(
      (r) => setRows(r.rows),
      (e: Error) => setErr(e.message)
    );
  }, [limit, board]);
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
          {board === "season" && (
            <span className="w-[54px] text-[12px] text-[var(--pink)]" title="오염 단계">
              오염 {r.glitch}
            </span>
          )}
          <span className={`w-[100px] ${r.win ? "text-[var(--cyan)]" : ""}`}>
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
    const make = (seed: number, players: string[], uids: string[], loadouts?: Loadout[]) => {
      const seat = Math.max(0, uids.indexOf(myUid));
      const c = new Controller(
        seed,
        players.length,
        seat,
        { kind: "multi", room: id, send: (cmds) => sendCmds(id, cmds) },
        loadouts
      );
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
            r.players.map((p) => p.uid),
            game.loadouts
          ).loadLog(game.log, game.turn);
      },
      onStart: (d) => {
        const r = roomRef.current;
        make(d.seed, d.players, r?.players.map((p) => p.uid) ?? [], d.loadouts);
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
          return <span className="text-white/60">모두 끝나면 순위가 나오고, 보상(멀티 ×1.2)이 들어가요</span>;
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
                <span className="mb-2 text-[12px] text-[var(--dim)]">P{i + 1}</span>
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

/* ───────────── 이어하기 저장 (이 기기 localStorage) ───────────── */

interface ResumeSave {
  v: string;
  at: number;
  run: string | null;
  seed: number;
  mode: RankBoard;
  lo: Loadout | null;
  tick: number;
  wave: number;
  log: import("@/lib/defense/replay").LogEntry[];
}
/** 서버의 판(run)은 4시간 동안만 기록할 수 있음 → 그보다 오래된 저장은 버림 */
const RESUME_TTL = 3.5 * 3600_000;
function readResume(key: string): ResumeSave | null {
  try {
    const r = JSON.parse(localStorage.getItem(key) ?? "null") as ResumeSave | null;
    if (!r || r.v !== BALANCE_VER || Date.now() - r.at > RESUME_TTL || !Array.isArray(r.log)) return null;
    return r;
  } catch {
    return null;
  }
}
function writeResume(key: string, r: ResumeSave) {
  try {
    localStorage.setItem(key, JSON.stringify(r));
  } catch {}
}
function clearResume(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

