"use client";

/*
 * 육성 모드 화면 — 선수 만들기 · 시내 지도(관리 턴) · 이벤트 · 특수능력 고르기 · 경기(직접 · 하이라이트 · 자동) · 시즌 결산 · 은퇴 · 명예의 전당.
 * 규칙 · 숫자는 lib/baseball/career.ts, 저장은 careerStore.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DIFF_NAME, type Diff } from "@/lib/baseball/ai";
import {
  ACTIVE_MAX, ACTIVE_PER_DAY, ACTIVE_PER_GAME, BOND_MAX, CLINIC_PRICE, MIN_COST, COND_NAME, CONSUMABLES, CONSUMABLE_IDS, DECK_SIZE, GAMES, GAME_GRADES, GEAR, GEAR_IDS, GEAR_TIER, GP_BOOSTS, GP_IDS,
  INJURY_NAME, LEARNED_VAL, MAX_SEASONS, OFF_TURNS, PLACES, PLACE_IDS, RETIRE_FROM, SPOT_EVENTS, STAT_KEYS, STAT_NAME, TAG_COLOR, TAG_NAME, TRAINS,
  TRAIN_KEYS, TYPES, act, advance, age, autoBattle, avg, buy, buyGear, canPlay, careerBatter, choose, choosePick, consumeItem, decideRetire, endSeason, finishBattle, trainersOf,
  costOf, fmtAvg, gameNo, gearNext, gradeOf, newCareer, ops, ovrOf, retireCard, skill, spLv, spUses, spotsOf, statGrade, stepOf, tagCount, talentName,
  trainLv, trainMul, trainRisk, whenText, whyNot,
  type Action, type BatType, type Career, type ConsumableId, type Delta, type GearId, type HofEntry, type PlaceId, type SeasonSummary,
  type SkillId, type Spot, type StatKey, type Tag, type TurnOut,
} from "@/lib/baseball/career";
import { slotName, slotOf } from "@/lib/baseball/careerGame";
import { TEAM_DEFS, charById, faceUrl, type CharId } from "@/lib/baseball/data";
import { SPECIAL_DAY, ROLE, type BondId } from "@/lib/baseball/bonds";
import { makeRng } from "@/lib/baseball/rng";
import { BattleModal, BondCard, BondsModal, BoonPickModal, DeckStep, Hint, VnScene, artUrl, recommendDeck } from "./CareerBonds";
import { BAT_IDLE, BATS, BATTER_RIG, HELMETS, PITCHER_RIG, PIT_IDLE, baseSkin } from "@/lib/baseball/figures";
import { DEFAULT_LOOK, LOOK_KEYS, LOOK_LABEL, LOOK_OPTS, SKINS, lookColors, lookSkin, type Look } from "@/lib/baseball/look";
import { drawRig, pose } from "@/lib/baseball/rig";
import {
  SPEEDS, addHof, affStart, autoGame, bondLevel, loadBondXp, loadCareer, loadHof, loadMode, loadSpeed, saveCareer, saveMode, saveSpeed, setupOf, takeBattle, takeReport, type GameReport, type PlayMode,
} from "./careerStore";
import type { MatchCfg } from "./match";
import { sfx } from "./sfx";
import { ACCENT, Btn, MenuBg, Modal, font } from "./ui";

type View = "home" | "create" | "hub" | "hof";

const STAT_COLOR: Record<StatKey, string> = { hit: "#7dff9a", power: "#ff7a5c", run: "#7ad7ff", def: "#ffd23f" };
const TONE_COLOR: Record<TurnOut["tone"], string> = { great: "#ffd23f", ok: "#ffffff", fail: "#9aa3c7", injury: "#ff5a5a", event: "#7ad7ff", awaken: "#ff7ae0" };
const NAMES = ["김픽셀", "이도트", "박비트", "최렌더", "정버퍼", "강루프", "조캐시", "윤커밋", "장스택", "한패치", "오클릭", "서해시"];
const MODE_NAME: Record<PlayMode, string> = { direct: "직접 출전", highlight: "하이라이트", auto: "자동 진행" };
const MODE_DESC: Record<PlayMode, string> = {
  direct: "내 타석 전부 직접 · 경기당 2분쯤",
  highlight: "찬스 · 돌발미션 · 7회부터 접전 타석만 직접 · 경기당 1분 안쪽",
  auto: "결과만 (봇 실력) · 바로",
};

const clone = (c: Career): Career => JSON.parse(JSON.stringify(c));

export default function CareerMode({ onExit, onPlay }: { onExit: () => void; onPlay: (cfg: MatchCfg) => void }) {
  const [view, setView] = useState<View>("home");
  const [c, setC] = useState<Career | null>(null);
  const [hof, setHof] = useState<HofEntry[]>([]);
  const [queue, setQueue] = useState<TurnOut[]>([]);
  const [reports, setReports] = useState<GameReport[]>([]);
  const [season, setSeason] = useState<SeasonSummary | null>(null);
  const [modal, setModal] = useState<null | "shop" | "records" | "bonds" | "newConfirm" | "epilogue" | { place: PlaceId }>(null);
  /** 큐 맨 앞 결과의 미연시 장면을 봤나 */
  const [vnSeen, setVnSeen] = useState(false);
  const [toast, setToast] = useState("");
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<PlayMode>("highlight");

  useEffect(() => {
    let cur = loadCareer();
    let rep = takeReport();
    if (cur?.inGame) {
      rep = autoGame(cur, "경기 중에 나가서 나머지는 자동으로 진행됐어요");
      cur = loadCareer();
    }
    if (cur?.phase === "retired") addHof(cur);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장값 불러오기
    setC(cur);
    setHof(loadHof());
    setSpeed(loadSpeed());
    setMode(loadMode());
    const bt = takeBattle();
    if (bt) {
      setQueue([bt, ...(bt.extra ? [bt.extra] : [])]);
      setView("hub");
    }
    if (rep) {
      setReports([rep]);
      setView("hub");
      (rep.sum.dnp ? sfx.ui : rep.pas.some((p) => p.kind === "HR" && !p.auto) ? sfx.homerun : () => sfx.cheer(0.6))();
    }
  }, []);

  const commit = (next: Career) => {
    saveCareer(next);
    setC(next);
  };
  const flash = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((v) => (v === t ? "" : v)), 1600);
  };

  const doAct = (a: Action) => {
    if (!c) return;
    const why = whyNot(c, a);
    if (why) return flash(why);
    const n = clone(c);
    const out = act(n, a);
    commit(n);
    setModal(null);
    const q = [out, ...(out.extra && !out.extra.stub ? [out.extra] : [])].filter((o) => !o.stub || o.vn);
    setQueue(q);
    setVnSeen(false);
    if (q[0]) playTone(q[0].tone);
  };
  const doAdvance = () => {
    if (!c || stepOf(c) !== "turn") return;
    const n = clone(c);
    advance(n);
    commit(n);
    sfx.ui();
  };
  const doChoose = (i: number) => {
    if (!c) return;
    const n = clone(c);
    const out = choose(n, i);
    commit(n);
    setQueue([out]);
    setVnSeen(false);
    playTone(out.tone);
  };
  /** 인연 대결: 직접 (경기 화면) / 자동 */
  const battleDirect = () => {
    if (!c?.battle) return;
    const bt = c.battle;
    const ch = charById(bt.char);
    onPlay({
      mode: "derby",
      diff: c.diff,
      innings: 1,
      userHome: true,
      myBat: "kai",
      myPit: "lily",
      speed,
      bond: { char: bt.char, pitches: bt.pitches, need: bt.need, magic: bt.magic, batter: careerBatter(c), title: `${ch.name}와 ${bt.kind === "final" ? "필살 전수 대결" : "대결"}` },
    });
  };
  const battleAuto = () => {
    if (!c?.battle) return;
    const n = clone(c);
    const out = finishBattle(n, autoBattle(n, makeRng((n.seed * 31 + n.turn * 7 + n.battle!.tries) >>> 0)), true);
    commit(n);
    setQueue([out, ...(out.extra ? [out.extra] : [])]);
    setVnSeen(false);
    playTone(out.tone);
  };
  const doPick = (i: number) => {
    if (!c) return;
    const n = clone(c);
    const out = choosePick(n, i);
    commit(n);
    setQueue([out]);
    playTone(out.tone);
  };
  const doRetire = (yes: boolean) => {
    if (!c) return;
    const n = clone(c);
    decideRetire(n, yes);
    if (yes) addHof(n);
    commit(n);
    sfx.cheer(0.8);
  };
  const doSeasonEnd = () => {
    if (!c) return;
    const n = clone(c);
    const s = endSeason(n);
    if (s.retire) addHof(n);
    commit(n);
    setSeason(s);
    sfx.cheer(0.8);
  };
  const changeSpeed = (v: number) => {
    setSpeed(v);
    saveSpeed(v);
  };
  const changeMode = (m: PlayMode) => {
    setMode(m);
    saveMode(m);
  };

  const playGame = () => {
    if (!c) return;
    if (mode === "auto") return autoWeek(false);
    const n = clone(c);
    n.inGame = true;
    commit(n);
    onPlay({ mode: "career", diff: c.diff, innings: 9, userHome: true, myBat: "kai", myPit: "lily", career: setupOf(n), highlight: mode === "highlight", speed });
  };
  /** 자동: 이번 경기만 / 이번 주 남은 경기 전부 (부상 결장 포함) */
  const autoWeek = (all: boolean) => {
    if (!c) return;
    const n = clone(c);
    const reps: GameReport[] = [];
    const week = n.week;
    do {
      n.inGame = true;
      reps.push(autoGame(n));
    } while (all && stepOf(n) === "game" && n.week === week && n.phase === "season");
    setC(n);
    setReports(reps);
    (reps.some((r) => r.pas.some((p) => p.kind === "HR")) ? sfx.homerun : () => sfx.cheer(0.5))();
  };

  const step = c ? stepOf(c) : null;
  const overlayBusy = queue.length > 0 || reports.length > 0 || !!season;

  return (
    <MenuBg>
      {view === "home" && (
        <Home
          c={c}
          onBack={onExit}
          onContinue={() => setView("hub")}
          onNew={() => {
            setHof(loadHof());
            if (c && c.phase !== "retired") setModal("newConfirm");
            else setView("create");
          }}
          onHof={() => {
            setHof(loadHof());
            setView("hof");
          }}
        />
      )}
      {view === "create" && (
        <Create
          onBack={() => setView("home")}
          hof={hof}
          onStart={(o) => {
            commit(newCareer({ ...o, affStart: affStart() }));
            setView("hub");
            sfx.cheer(0.7);
          }}
        />
      )}
      {view === "hof" && <Hof list={hof} onBack={() => setView("home")} />}
      {view === "hub" &&
        c &&
        (c.phase === "retired" && !season ? (
          <Retire
            c={c}
            onHome={() => setView("home")}
            onNew={() => {
              setHof(loadHof());
              setView("create");
            }}
            onEpilogue={() => setModal("epilogue")}
            onHof={() => {
              setHof(loadHof());
              setView("hof");
            }}
          />
        ) : (
          <Hub
            c={c}
            speed={speed}
            mode={mode}
            onSpeed={changeSpeed}
            onMode={changeMode}
            onBack={() => setView("home")}
            onPlace={(place) => (place === "mall" ? setModal("shop") : setModal({ place }))}
            onAdvance={doAdvance}
            onShop={() => setModal("shop")}
            onRecords={() => setModal("records")}
            onBonds={() => setModal("bonds")}
            quiet={overlayBusy || !!modal}
            onPlay={playGame}
            onAutoWeek={() => autoWeek(true)}
            onSitOut={() => autoWeek(false)}
            onSeasonEnd={doSeasonEnd}
          />
        ))}

      {/* 결과 팝업들 (턴 결과 → 경기 → 시즌 → 이벤트 고르기 → 특수능력 고르기 → 은퇴 물어보기) */}
      {queue.length > 0 &&
        (queue[0].vn && !vnSeen ? (
          <VnScene
            key={c?.turn + queue[0].title}
            char={queue[0].vn.char}
            skin={queue[0].vn.skin}
            lines={queue[0].vn.lines}
            title={queue[0].title}
            result={queue[0].stub || queue[0].lines.length > 2 ? undefined : queue[0]}
            onDone={() => {
              if (queue[0].stub || queue[0].lines.length > 2) setVnSeen(true);
              else {
                setQueue((q) => q.slice(1));
                setVnSeen(false);
              }
            }}
          />
        ) : queue[0].stub ? null : (
          <TurnModal
            out={queue[0]}
            onNext={() => {
              setQueue((q) => q.slice(1));
              setVnSeen(false);
            }}
          />
        ))}
      {!queue.length && reports.length > 0 && <ReportModal r={reports[0]} more={reports.length - 1} onClose={() => setReports((r) => r.slice(1))} />}
      {!queue.length && !reports.length && season && c && <SeasonModal s={season} c={c} onClose={() => setSeason(null)} />}
      {!overlayBusy && view === "hub" && c && step === "pending" &&
        (c.pending?.scene && c.pending.char ? (
          <VnScene key={`${c.turn}-${c.pending.char}`} char={c.pending.char} lines={c.pending.scene.lines} title={c.pending.title} choices={c.pending.choices} onChoose={doChoose} />
        ) : (
          <ChoiceModal c={c} onPick={doChoose} />
        ))}
      {!overlayBusy && view === "hub" && c && step === "pick" && (c.pick?.boon ? <BoonPickModal c={c} onPick={doPick} /> : <PickModal c={c} onPick={doPick} />)}
      {!overlayBusy && view === "hub" && c && step === "battle" && <BattleModal c={c} onDirect={battleDirect} onAuto={battleAuto} />}
      {!overlayBusy && view === "hub" && c && step === "retireAsk" && <RetireAskModal c={c} onAnswer={doRetire} />}

      {modal && typeof modal === "object" && c && <PlaceModal c={c} place={modal.place} onClose={() => setModal(null)} onAct={doAct} />}
      {modal === "shop" && c && (
        <ShopModal
          c={c}
          onClose={() => setModal(null)}
          onBuyGear={(id) => {
            const n = clone(c);
            const msg = buyGear(n, id);
            commit(n);
            flash(msg);
          }}
          onBuy={(id) => {
            const n = clone(c);
            const msg = buy(n, id);
            commit(n);
            flash(msg);
          }}
          onUse={(id) => {
            const n = clone(c);
            const msg = consumeItem(n, id);
            commit(n);
            flash(msg);
          }}
        />
      )}
      {modal === "records" && c && <RecordsModal c={c} onClose={() => setModal(null)} />}
      {modal === "bonds" && c && <BondsModal c={c} onClose={() => setModal(null)} />}
      {modal === "epilogue" && c && retireCard(c).partner && (
        <VnScene char={retireCard(c).partner!} lines={[retireCard(c).epilogue!]} title="에필로그" onDone={() => setModal(null)} />
      )}
      {modal === "newConfirm" && (
        <Modal>
          <div className={`${font.title} mb-2 text-2xl`}>새로 시작할까요?</div>
          <p className="text-[14px] text-white/70">키우던 선수({c?.name})는 사라져요. 명예의 전당엔 은퇴한 선수만 남아요.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Btn
              className="px-5 py-2"
              color="#ff7a7a"
              onClick={() => {
                saveCareer(null);
                setC(null);
                setModal(null);
                setView("create");
              }}
            >
              새로 시작
            </Btn>
            <Btn className="px-5 py-2" color="#8b93b8" onClick={() => setModal(null)}>
              취소
            </Btn>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="pointer-events-none absolute top-[70px] left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/85 px-5 py-2 text-[14px] font-bold text-white">
          {toast}
        </div>
      )}
    </MenuBg>
  );
}

function playTone(t: TurnOut["tone"]) {
  if (t === "great") sfx.missionOk();
  else if (t === "injury") sfx.groan();
  else if (t === "fail") sfx.missionNg();
  else if (t === "awaken") sfx.cutin();
  else sfx.ui();
}

/* ─────────────── 시작 화면 ─────────────── */

function Home({ c, onBack, onContinue, onNew, onHof }: { c: Career | null; onBack: () => void; onContinue: () => void; onNew: () => void; onHof: () => void }) {
  const live = c && c.phase !== "retired";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <div className="text-center">
        <div className={`${font.title} text-[52px] leading-none`} style={{ color: ACCENT, textShadow: "0 5px 0 #000" }}>
          육성 모드
        </div>
        <div className="mt-2 text-[14px] text-white/65">
          선수 한 명을 최대 {MAX_SEASONS}년 · 한 해 {GAMES}경기 · 훈련 · 시내 외출 · 특수능력 고르기 · 픽셀파이트 캐릭터에게 필살타법 전수
        </div>
        <div className="mt-1 text-[12px] text-white/45">타자편 프로토 · 이 브라우저에 저장돼요 · 매 턴 자동 저장</div>
      </div>
      {live && (
        <button
          type="button"
          onClick={() => {
            sfx.ui();
            onContinue();
          }}
          className="flex w-[440px] cursor-pointer items-center gap-4 rounded-2xl border-2 border-[#FF8A3D] bg-[#FF8A3D]/15 px-5 py-3 text-left hover:bg-[#FF8A3D]/25"
        >
          <div className={`${font.title} text-[40px] leading-none`} style={{ color: gradeOf(ovrOf(c!)).color }}>
            {ovrOf(c!)}
          </div>
          <div className="flex-1">
            <div className={`${font.title} text-[22px]`}>이어하기 — {c!.name}</div>
            <div className="text-[13px] text-white/65">
              {TYPES[c!.type].name} · {whenText(c!)}
            </div>
          </div>
          <span className="text-2xl">▶</span>
        </button>
      )}
      {c && !live && (
        <Btn className="w-[440px] py-2.5 text-[15px]" color="#ffd23f" onClick={onContinue}>
          은퇴한 {c.name} 결과 다시 보기 · 종합 {ovrOf(c)} ({gradeOf(ovrOf(c)).g})
        </Btn>
      )}
      <div className="flex gap-3">
        <Btn className={`${font.title} w-[210px] py-3.5 text-xl`} color={live ? "#7ad7ff" : ACCENT} onClick={onNew}>
          새 선수 만들기
        </Btn>
        <Btn className={`${font.title} w-[210px] py-3.5 text-xl`} color="#ffd23f" onClick={onHof}>
          명예의 전당
        </Btn>
      </div>
      <Btn className="w-[140px] py-2 text-sm" color="#8b93b8" onClick={onBack}>
        ← 메뉴
      </Btn>
    </div>
  );
}

/* ─────────────── 선수 만들기 ─────────────── */

function Create({ hof, onBack, onStart }: { hof: HofEntry[]; onBack: () => void; onStart: (o: Parameters<typeof newCareer>[0]) => void }) {
  const [stepNo, setStepNo] = useState<1 | 2>(1);
  const [deck, setDeck] = useState<BondId[]>([]);
  const [legacy, setLegacy] = useState<{ id: string; skill?: SkillId } | null>(null);
  const [levels] = useState(() => {
    const x = loadBondXp();
    const out: Partial<Record<CharId, number>> = {};
    for (const k of Object.keys(x) as CharId[]) out[k] = bondLevel(x[k] ?? 0);
    return out;
  });
  const [name, setName] = useState(() => NAMES[Math.floor(Math.random() * NAMES.length)]);
  const [num, setNum] = useState(() => 10 + Math.floor(Math.random() * 60));
  const [bats, setBats] = useState<"R" | "L">("R");
  const [type, setType] = useState<BatType>("contact");
  const [diff, setDiff] = useState<Diff>(1);
  const [look, setLook] = useState<Look>(() => ({ ...DEFAULT_LOOK, hair: Math.floor(Math.random() * 3), face: Math.floor(Math.random() * 3) }));
  const [tab, setTab] = useState<"look" | "base">("look");
  const t = TYPES[type];
  const start = () => {
    const lg = legacy ? hof.find((h) => h.id === legacy.id) : undefined;
    onStart({ name, num, bats, type, diff, look, deck: deck.length === DECK_SIZE ? deck : recommendDeck(type), legacy: lg ? { name: lg.name, skill: legacy?.skill, stats: lg.stats } : undefined });
  };
  const head = (
    <div className="flex items-center justify-between">
      <span className={`${font.title} text-[28px]`} style={{ color: ACCENT }}>
        새 선수 만들기 <span className="ml-2 text-[15px] text-white/50">{stepNo === 1 ? "1 선수 → 2 인연 덱" : "1 선수 → "}<b className={stepNo === 2 ? "text-white" : ""}>{stepNo === 2 ? "2 인연 덱" : ""}</b></span>
      </span>
      <Btn className="px-4 py-1.5 text-sm" color="#8b93b8" onClick={stepNo === 2 ? () => setStepNo(1) : onBack}>
        ← 뒤로
      </Btn>
    </div>
  );
  if (stepNo === 2)
    return (
      <div className="flex h-full flex-col gap-2.5 px-7 py-4">
        {head}
        <DeckStep type={type} deck={deck} setDeck={setDeck} levels={levels} hof={hof} legacy={legacy} setLegacy={setLegacy} />
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-2.5">
          <div className="text-[12.5px] leading-relaxed text-white/60">
            {deck.length < DECK_SIZE ? `${DECK_SIZE - deck.length}명 더 고르거나 그냥 시작하면 추천 덱으로 가요.` : `덱: ${deck.map((d) => charById(d).name).join(" · ")}`}
            <br />
            은퇴하면 덱 사람들 호감이 「인연 레벨」로 쌓여서 다음 선수는 처음부터 더 친하게 시작해요.
          </div>
          <Btn className={`${font.title} ml-4 shrink-0 px-8 py-3 text-2xl`} disabled={!name} onClick={start}>
            입단!
          </Btn>
        </div>
      </div>
    );
  const lookTab = (
    <div className="flex flex-1 flex-col gap-2">
      {LOOK_KEYS.map((k) => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-[56px] text-[13px] font-bold text-white/70">{LOOK_LABEL[k]}</span>
          {LOOK_OPTS[k].map((nm, i) => (
            <Btn key={nm} active={look[k] === i} className="flex w-[118px] items-center justify-center gap-1.5 py-1.5 text-[13px]" onClick={() => setLook({ ...look, [k]: i })}>
              {k === "skin" && <span className="inline-block h-[14px] w-[14px] rounded-full border border-black/40" style={{ background: SKINS[i].c }} />}
              {nm}
            </Btn>
          ))}
          <span className="flex w-[90px] items-center justify-center rounded-xl border-2 border-dashed border-white/15 py-1.5 text-[11.5px] text-white/35" title="스킨 (나중에)">
            🔒 스킨
          </span>
        </div>
      ))}
      <div className="text-[11.5px] text-white/45">외형은 능력치에 영향 없어요 · 유니폼은 우리 팀 전체가 같이 입어요</div>
    </div>
  );
  return (
    <div className="flex h-full flex-col gap-2.5 px-7 py-4">
      {head}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex w-[210px] shrink-0 flex-col items-center rounded-2xl border border-white/10 bg-gradient-to-b from-[#2a6b3a]/30 to-black/30 p-2">
          <Figure look={look} num={num} name={name} bats={bats} front w={170} h={200} />
          <div className="mt-1 flex items-end gap-2">
            <Figure look={look} num={num} name={name} bats={bats} w={80} h={100} />
            <div className="pb-2 text-[11px] text-white/50">
              타석 뒷모습
              <br />#{num} {name}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex gap-1.5">
            <Btn active={tab === "look"} className="px-4 py-1 text-[13px]" onClick={() => setTab("look")}>
              외형
            </Btn>
            <Btn active={tab === "base"} className="px-4 py-1 text-[13px]" onClick={() => setTab("base")}>
              기본 · 타입
            </Btn>
          </div>
          {tab === "look" ? lookTab : (
      <div className="flex gap-5">
        <div className="flex flex-col gap-2.5">
          <Field label="이름">
            <input
              value={name}
              maxLength={6}
              onChange={(e) => setName(e.target.value.replace(/\s/g, ""))}
              className="w-[120px] rounded-lg border-2 border-white/20 bg-black/40 px-2 py-1 text-[15px] font-bold outline-none focus:border-[#FF8A3D]"
            />
            <Btn className="px-2 py-1 text-[12px]" color="#8b93b8" onClick={() => setName(NAMES[Math.floor(Math.random() * NAMES.length)])}>
              🎲
            </Btn>
          </Field>
          <Field label="등번호">
            <input
              type="number"
              min={0}
              max={99}
              value={num}
              onChange={(e) => setNum(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
              className="w-[70px] rounded-lg border-2 border-white/20 bg-black/40 px-2 py-1 font-mono text-[15px] font-bold outline-none focus:border-[#FF8A3D]"
            />
          </Field>
          <Field label="타석">
            {(["R", "L"] as const).map((b) => (
              <Btn key={b} active={bats === b} className="px-3 py-1 text-[13px]" onClick={() => setBats(b)}>
                {b === "R" ? "우타" : "좌타"}
              </Btn>
            ))}
          </Field>
          <Field label="난이도">
            {([0, 1, 2] as Diff[]).map((d) => (
              <Btn key={d} active={diff === d} className="px-3 py-1 text-[13px]" color="#7ad7ff" onClick={() => setDiff(d)}>
                {DIFF_NAME[d]}
              </Btn>
            ))}
          </Field>
          <div className="pl-[68px] text-[11px] text-white/45">경기 공 속도 · 상대 실력 (성장 규칙은 같아요)</div>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-white/70">포지션</span>
            <Btn active className="px-3 py-0.5 text-[12.5px]">
              타자
            </Btn>
            <Btn disabled className="px-3 py-0.5 text-[12.5px]" color="#8b93b8">
              투수 · 준비 중
            </Btn>
            <span className="ml-2 text-[13px] font-bold text-white/70">타입</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {(Object.keys(TYPES) as BatType[]).map((k) => (
              <Btn key={k} active={type === k} className="py-2 text-[14px]" onClick={() => setType(k)}>
                {TYPES[k].name}
              </Btn>
            ))}
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
            <div className="text-[13px] text-white/75">
              {t.desc} · 수비 위치 {t.pos}
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {STAT_KEYS.map((k) => (
                <div key={k} className="text-[12px]">
                  <div className="flex justify-between text-white/60">
                    <span>{STAT_NAME[k]}</span>
                    <span style={{ color: t.apt[k] > 1.05 ? "#7dff9a" : t.apt[k] < 0.95 ? "#ff9a7a" : "#fff" }}>
                      성장 {t.apt[k] > 1.05 ? "▲" : t.apt[k] < 0.95 ? "▼" : "─"}
                    </span>
                  </div>
                  <Bar v={t.start[k]} color={STAT_COLOR[k]} />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 text-[13px] font-bold text-white/70">코치진</div>
          <div className="grid grid-cols-5 gap-1.5">
            {GP_IDS.map((id) => (
              <div key={id} className="rounded-lg border border-white/12 bg-black/30 px-2 py-1.5 text-left text-[11.5px] leading-tight">
                <span className="block text-[13px] font-bold">
                  {GP_BOOSTS[id].name} <span className="text-[#7ad7ff]">C</span>
                </span>
                <span className="block text-white/65">{GP_BOOSTS[id].desc("C")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
          )}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-2.5">
        <div className="text-[12.5px] leading-relaxed text-white/60">
          19세 입단 · 한 해 {GAMES}경기 · {RETIRE_FROM}년차부터 은퇴를 고를 수 있고 {MAX_SEASONS}년차엔 은퇴. 숨은 재능은 1년차가 끝나면 알려 줘요.
          <br />
          결과는 운 · 선택 · 실력에 따라 갈려요 (중앙값 500 정도 · 잘 풀리면 800+ · 안 풀리면 300~400대).
        </div>
        <Btn className={`${font.title} ml-4 shrink-0 px-8 py-3 text-2xl`} disabled={!name} onClick={() => setStepNo(2)}>
          다음 ▶
        </Btn>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[60px] text-[13px] font-bold text-white/70">{label}</span>
      {children}
    </div>
  );
}

function Bar({ v, color, max = 999, h = 7 }: { v: number; color: string; max?: number; h?: number }) {
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-white/10" style={{ height: h }}>
      <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, (v / max) * 100)}%`, background: color }} />
    </div>
  );
}

/* ─────────────── 선수 그림 (등 뒤 · 등번호 · 이름) ─────────────── */

function Portrait({ c, w = 120, h = 150 }: { c: Career; w?: number; h?: number }) {
  return <Figure look={c.look} num={c.num} name={c.name} bats={c.bats} learned={c.learned} metal={!!c.gear.bat} w={w} h={h} />;
}

/** 내 선수 그림 — 뒤(타석 자세) / 앞(정면 · 외형 미리보기) */
function Figure({ look, num, name, bats, learned, metal, front, w, h }: { look: Look; num: number; name: string; bats: "R" | "L"; learned?: CharId; metal?: boolean; front?: boolean; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(look);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const q = Math.min(3, window.devicePixelRatio || 1) * 1.5;
    cv.width = w * q;
    cv.height = h * q;
    const ctx = cv.getContext("2d")!;
    const team = TEAM_DEFS[0];
    const lc = learned ? charById(learned) : null;
    const base = { ...baseSkin(), helmet: HELMETS.basic, bat: lc ? BATS.hero : metal ? BATS.metal : BATS.wood };
    let skin = lookSkin(base, look, { heroBat: !!lc });
    if (front) skin = { ...skin, cap: skin.hairFront, mitt: skin.hand };
    const colors = lookColors({ team: team.color, dark: team.dark, skin: "#eec29e", hair: "#1d1a22", pants: "#eef0f4", accent: lc?.color ?? "#f2f2f2", num: String(num), name, flip: bats === "L" }, look);
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.setTransform(q, 0, 0, q, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (front) {
        const ps = pose(PITCHER_RIG, PIT_IDLE, t);
        // 발끝 ~ 머리 꼭대기가 다 들어오게
        const sc = h / 225;
        drawRig(ctx, PITCHER_RIG, ps, skin, colors, w / 2, h - 72 * sc, sc, false);
      } else {
        const ps = pose(BATTER_RIG, BAT_IDLE, t);
        // 방망이 끝 ~ 발끝이 다 들어오게 (머리 · 방망이 안 잘리게)
        const sc = h / 215;
        drawRig(ctx, BATTER_RIG, ps, skin, colors, w / 2 + (bats === "L" ? 1 : -1) * w * 0.06, h - 64 * sc, sc, bats === "L");
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- look 은 key 로 비교
  }, [key, num, name, bats, learned, metal, front, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}

/* ─────────────── 관리 화면 (시내 지도) ─────────────── */

function Hub(p: {
  c: Career;
  speed: number;
  mode: PlayMode;
  onSpeed: (v: number) => void;
  onMode: (m: PlayMode) => void;
  onBack: () => void;
  onPlace: (place: PlaceId) => void;
  onAdvance: () => void;
  onShop: () => void;
  onRecords: () => void;
  onBonds: () => void;
  /** 팝업이 떠 있음 (힌트 숨김) */
  quiet?: boolean;
  onPlay: () => void;
  onAutoWeek: () => void;
  onSitOut: () => void;
  onSeasonEnd: () => void;
}) {
  const { c } = p;
  const step = stepOf(c);
  return (
    <div className="flex h-full flex-col">
      {/* 위 */}
      <div className="flex h-[50px] items-center gap-3 border-b border-white/10 bg-black/40 px-3">
        <Btn className="px-3 py-1 text-[13px]" color="#8b93b8" onClick={p.onBack}>
          ←
        </Btn>
        <div className={`${font.title} text-[20px] whitespace-nowrap`}>{whenText(c)}</div>
        <Schedule c={c} />
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-0.5 text-[11px] whitespace-nowrap text-white/50">배속</span>
          {SPEEDS.map((v) => (
            <Btn key={v} active={p.speed === v} className="px-1.5 py-0.5 font-mono text-[11.5px] whitespace-nowrap" color="#7dff9a" onClick={() => p.onSpeed(v)}>
              ×{v}
            </Btn>
          ))}
          <span className="ml-1.5 font-mono text-[13px] font-bold whitespace-nowrap text-[#ffd23f]">₩{c.money.toLocaleString()}만</span>
          <Btn className="px-2.5 py-1 text-[13px] whitespace-nowrap" color="#ffd23f" onClick={p.onShop}>
            상점
          </Btn>
          <Btn className="px-2.5 py-1 text-[13px] whitespace-nowrap" color="#ff7ae0" onClick={p.onBonds}>
            인연
          </Btn>
          <Btn className="px-2.5 py-1 text-[13px] whitespace-nowrap" color="#7ad7ff" onClick={p.onRecords}>
            기록
          </Btn>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <PlayerCard c={c} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <StatusRow c={c} />
          {c.injury && (
            <div className="rounded-xl border-2 border-[#ff5a5a]/60 bg-[#ff5a5a]/10 px-3 py-1 text-[12.5px] text-[#ffb0b0]">
              🩹 {INJURY_NAME[c.injury.kind]} — 복귀까지 {c.injury.left} (경기 · 캠프 하루마다 1씩). 숙소 · 병원만 갈 수 있고 경기는 결장. 병원 치료 · 상점 「재활 치료」로 줄일 수 있어요.
            </div>
          )}
          {step === "turn" || step === "pending" || step === "pick" || step === "battle" || step === "retireAsk" ? (
            <TownMap c={c} onPlace={p.onPlace} onAdvance={p.onAdvance} />
          ) : step === "game" ? (
            <GameCard c={c} mode={p.mode} onMode={p.onMode} onPlay={p.onPlay} onAutoWeek={p.onAutoWeek} onSitOut={p.onSitOut} />
          ) : step === "seasonEnd" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-[#ffd23f]/40 bg-black/30">
              <div className={`${font.title} text-[30px]`}>{c.season}년차 시즌 종료!</div>
              <div className="text-[14px] text-white/65">
                {c.line.g}경기 · 타율 {fmtAvg(avg(c.line))} · {c.line.hr}홈런 · {c.line.rbi}타점 · 팀 {c.wins}승 {c.losses}패 (통산)
              </div>
              <Btn className={`${font.title} px-8 py-3 text-xl`} color="#ffd23f" onClick={p.onSeasonEnd}>
                시즌 결산 보기
              </Btn>
            </div>
          ) : null}
          <div className="h-[62px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/35 px-3 py-1">
            <div className="flex justify-between text-[11px] text-white/45">
              <span>최근 소식</span>
              <span>
                이번 시즌 {c.line.g}경기 · 타율 {fmtAvg(avg(c.line))} · {c.line.hr}홈런 · {c.line.rbi}타점
              </span>
            </div>
            {c.log.slice(0, 2).map((l, i) => (
              <div key={i} className="truncate text-[12.5px]" style={{ opacity: 1 - i * 0.3 }}>
                {l}
              </div>
            ))}
          </div>
        </div>
      </div>
      {!p.quiet && step === "turn" && c.turn === 0 && (
        <Hint k="hub" title="관리 턴 — 지도에서 장소를 눌러요">
          ⚡ 행동력이 남아 있는 동안 훈련 · 휴식 · 만남을 해요. 다 쓰면(또는 그만하려면) 오른쪽 위 「{c.phase === "season" ? "경기 진행" : "다음 날"} ▶」. 체력 40 아래로 훈련하면 부상이 확 늘어요.
        </Hint>
      )}
      {!p.quiet && step === "turn" && c.turn > 0 && spotsOf(c).some((s) => s.char) && (
        <Hint k="bond" title="❗ 인연이 나타났어요">
          얼굴이 뜬 장소에 가면 그 사람과 이야기가 이어져요. 대답에 따라 호감이 오르고, 그 사람다운 답을 고르면 「이해」가 쌓여요. 상단 「인연」에서 진행 상황을 볼 수 있어요.
        </Hint>
      )}
      {!p.quiet && step === "turn" && Object.keys(trainersOf(c)).length > 0 && c.turn > 2 && (
        <Hint k="mate" title="함께 훈련">
          운동장 훈련 버튼에 얼굴이 붙어 있으면 그 사람이 같이 해 줘요 — 효율 ×1.3 이상 + 호감 +3. 이번 관리 기간에 한 번만!
        </Hint>
      )}
    </div>
  );
}

function PlayerCard({ c }: { c: Career }) {
  const ovr = ovrOf(c);
  const gr = gradeOf(ovr);
  const tc = tagCount(c);
  return (
    <div className="flex w-[290px] shrink-0 flex-col rounded-2xl border-2 border-white/10 bg-[#0e1226]/90 p-3">
      <div className="flex gap-2">
        <div className="shrink-0 rounded-xl bg-gradient-to-b from-[#2a6b3a]/40 to-transparent">
          <Portrait c={c} w={96} h={124} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`${font.title} truncate text-[21px] leading-tight`}>{c.name}</div>
          <div className="text-[12px] text-white/60">
            #{c.num} · {TYPES[c.type].name} · {c.bats === "R" ? "우타" : "좌타"} · {age(c)}세
          </div>
          <div className="text-[12px] text-white/60">
            숨은 재능{" "}
            <b className="text-[13px]" style={{ color: c.talentKnown ? "#ffd23f" : "#fff" }}>
              {talentName(c)}
            </b>
            {c.awakened && <span className="ml-1 text-[#ff7ae0]">각성</span>}
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className={`${font.title} text-[42px] leading-none`} style={{ color: gr.color }}>
              {ovr}
            </span>
            <span className="pb-1">
              <span className={`${font.title} block text-[20px] leading-none`} style={{ color: gr.color }}>
                {gr.g}
              </span>
              <span className="text-[10px] text-white/50">종합</span>
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {STAT_KEYS.map((k) => {
          const v = Math.round(c.stats[k]);
          const g = statGrade(v);
          return (
            <div key={k} className="flex items-center gap-2">
              <span className="w-[44px] text-[12px] text-white/70">{STAT_NAME[k]}</span>
              <span className={`${font.title} w-[18px] text-center text-[16px]`} style={{ color: g.color }}>
                {g.g}
              </span>
              <span className="w-[30px] text-right font-mono text-[13px] font-bold">{v}</span>
              <div className="flex-1">
                <Bar v={v} color={STAT_COLOR[k]} />
              </div>
            </div>
          );
        })}
      </div>
      {/* 태그 (세트까지 몇 장) */}
      <div className="mt-2 flex flex-wrap gap-1">
        {(Object.keys(TAG_NAME) as Tag[])
          .filter((t) => tc[t])
          .map((t) => (
            <span key={t} className="rounded px-1.5 py-[1px] text-[10.5px] font-bold" style={{ background: `${TAG_COLOR[t]}22`, color: TAG_COLOR[t] }} title="같은 태그 3장이면 세트 효과">
              {TAG_NAME[t]} {Math.min(3, tc[t] ?? 0)}/3
            </span>
          ))}
      </div>
      <div className="mt-1.5 flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto">
        {c.learned && (
          <span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold text-black" style={{ background: charById(c.learned).color }} title={charById(c.learned).swing.desc}>
            ★ {charById(c.learned).swing.name} Lv{spLv(c)} · {spUses(c)}회
          </span>
        )}
        {c.skills.map((id) => (
          <SkillChip key={id} id={id} />
        ))}
        {!c.learned && !c.skills.length && <span className="text-[11px] text-white/35">특수능력 없음 — 시즌 보상 · 인연 · 퀴즈쇼에서 얻어요</span>}
      </div>
    </div>
  );
}

function SkillChip({ id }: { id: SkillId }) {
  const s = skill(id);
  const col = s.set ? "#ffd23f" : s.bad ? "#ff9a9a" : s.risk ? "#ffb070" : s.tag ? TAG_COLOR[s.tag] : "#cfe9ff";
  return (
    <span title={s.desc} className="rounded-md border px-1.5 py-0.5 text-[11px]" style={{ borderColor: `${col}88`, color: col, fontWeight: s.set ? 700 : 400, background: s.set ? "#ffd23f1a" : undefined }}>
      {s.set ? "★ " : ""}
      {s.name}
    </span>
  );
}

function StatusRow({ c }: { c: Career }) {
  const slot = slotOf(c.trust);
  return (
    <div className="grid grid-cols-4 gap-2">
      <Gauge label="체력" value={`${Math.round(c.stamina)}`} pct={c.stamina} color={c.stamina < 30 ? "#ff5a5a" : c.stamina < 50 ? "#ffd23f" : "#7dff9a"} />
      <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5">
        <div className="flex justify-between text-[12px] text-white/60">
          <span>컨디션</span>
          <b style={{ color: ["#ff5a5a", "#ff9a7a", "#fff", "#7dff9a", "#ffd23f"][c.cond] }}>{COND_NAME[c.cond]}</b>
        </div>
        <div className="mt-1 flex gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[7px] flex-1 rounded-full" style={{ background: i <= c.cond ? ["#ff5a5a", "#ff9a7a", "#fff", "#7dff9a", "#ffd23f"][c.cond] : "rgba(255,255,255,0.1)" }} />
          ))}
        </div>
      </div>
      <Gauge label="감독 신뢰" value={`${Math.round(c.trust)} · ${slotName(slot)}`} pct={c.trust} color="#7ad7ff" />
      <Gauge label="인기도" value={Math.round(c.fame).toLocaleString()} pct={Math.min(100, (c.fame / 3000) * 100)} color="#ff7ae0" />
    </div>
  );
}

function Schedule({ c }: { c: Career }) {
  const done = c.phase === "season" ? gameNo(c) : c.phase === "seasonEnd" || c.phase === "off" ? GAMES : 0;
  return (
    <div className="flex items-center gap-[2px]">
      {Array.from({ length: GAMES }, (_, i) => (
        <div
          key={i}
          className="h-[10px] w-[4px] rounded-[1px]"
          style={{ background: i < done ? "#FF8A3D" : i === done && c.phase === "season" ? "#ffd23f" : "rgba(255,255,255,0.12)", marginLeft: i && i % 2 === 0 ? 2 : 0 }}
        />
      ))}
      <span className="ml-1.5 text-[11px] whitespace-nowrap text-white/45">
        {c.season}/{MAX_SEASONS}년
      </span>
    </div>
  );
}

function Gauge({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5">
      <div className="flex justify-between text-[12px] text-white/60">
        <span>{label}</span>
        <b className="truncate pl-1" style={{ color }}>
          {value}
        </b>
      </div>
      <div className="mt-1">
        <Bar v={pct} max={100} color={color} />
      </div>
    </div>
  );
}

/** 시내 지도: 장소 버튼 + 이번 주 ❗ (캐릭터 얼굴 · 이벤트) */
function TownMap({ c, onPlace, onAdvance }: { c: Career; onPlace: (p: PlaceId) => void; onAdvance: () => void }) {
  const spots = spotsOf(c);
  const mates = trainersOf(c);
  const season = c.phase === "season";
  const out = c.active < MIN_COST;
  const at = (p: PlaceId) => spots.find((s) => s.place === p);
  const injured = !!c.injury;
  return (
    <div className="relative flex-1 overflow-hidden rounded-2xl border-2 border-white/10" style={{ background: "linear-gradient(180deg, #1d3b5c 0%, #1a4a3a 55%, #23402c 100%)" }}>
      {/* 길 */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M5 44 H95 M50 10 V95 M5 72 H95" stroke="rgba(255,255,255,0.12)" strokeWidth="3" fill="none" />
        <path d="M5 44 H95 M50 10 V95 M5 72 H95" stroke="rgba(255,255,255,0.25)" strokeWidth="0.4" strokeDasharray="2 2" fill="none" />
      </svg>
      {/* 행동력 (원작 ACTIVE) */}
      <div className="absolute top-2 left-3 z-10 flex items-center gap-2 rounded-xl border border-white/15 bg-black/60 px-3 py-1.5">
        <span className={`${font.title} text-[15px] text-[#ffd23f]`}>⚡ 행동력</span>
        <div className="flex gap-[3px]">
          {Array.from({ length: ACTIVE_MAX }, (_, i) => (
            <div key={i} className="h-[14px] w-[11px] rounded-[3px]" style={{ background: i < c.active ? "#ffd23f" : "rgba(255,255,255,0.12)", boxShadow: i < c.active ? "0 0 6px #ffd23f88" : undefined }} />
          ))}
        </div>
        <span className="font-mono text-[14px] font-bold">
          {c.active}/{ACTIVE_MAX}
        </span>
        <span className="text-[11px] text-white/50">{season ? `경기마다 +${ACTIVE_PER_GAME}` : `하루 지나면 +${ACTIVE_PER_DAY}`} · 남으면 넘어가요</span>
      </div>
      <div className="absolute top-2 right-3 z-10 flex flex-col items-end gap-1">
        <Btn className={`${font.title} px-4 py-2 text-[17px]`} color={out ? ACCENT : "#7ad7ff"} active={out} onClick={onAdvance}>
          {season ? "경기 진행 ▶" : "다음 날 ▶"}
        </Btn>
        <span className="text-[10.5px] text-white/50">{out ? "행동력이 모자라요" : "❗ 는 이번에만 · 남은 행동력은 다음으로"}</span>
      </div>
      {PLACE_IDS.map((id) => {
        const pl = PLACES[id];
        const s = at(id);
        const ch = s?.char ? charById(s.char) : null;
        const ev = s?.event ? SPOT_EVENTS[s.event] : null;
        const off = injured && !(id === "dorm" || id === "hospital" || id === "mall");
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              sfx.ui();
              onPlace(id);
            }}
            className="absolute flex w-[120px] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center rounded-xl border-2 px-2 py-1.5 transition-transform hover:-translate-y-[54%] disabled:cursor-not-allowed"
            style={{
              left: `${pl.x}%`,
              top: `${pl.y}%`,
              borderColor: ch ? ch.color : ev ? "#ffd23f" : "rgba(255,255,255,0.18)",
              background: ch || ev ? "rgba(10,14,30,0.92)" : "rgba(10,14,30,0.78)",
              boxShadow: ch ? `0 0 16px ${ch.color}88` : ev ? "0 0 14px #ffd23f66" : "0 3px 0 rgba(0,0,0,0.45)",
              opacity: off ? 0.4 : 1,
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[20px] leading-none">{pl.icon}</span>
              <span className={`${font.title} text-[15px]`}>{pl.name}</span>
            </div>
            {ch ? (
              <div className="mt-0.5 flex items-center gap-1">
                <img src={faceUrl(ch.id)} alt={ch.name} className="h-[26px] w-[26px] rounded-md object-cover object-top" />
                <span className="text-[11.5px] font-bold" style={{ color: ch.color }}>
                  {s?.special ? "🎁" : "❗"} {ch.name}
                </span>
              </div>
            ) : id === "ground" && Object.keys(mates).length ? (
              <div className="mt-0.5 flex items-center gap-1">
                {Object.values(mates).map((m) => (
                  <img key={m} src={faceUrl(m!)} alt="" className="h-[22px] w-[22px] rounded-md object-cover object-top" style={{ outline: `1.5px solid ${charById(m!).color}` }} />
                ))}
                <span className="text-[10.5px] font-bold text-[#7dff9a]">함께 훈련</span>
              </div>
            ) : ev ? (
              <span className="mt-0.5 text-[11.5px] font-bold text-[#ffd23f]">❗ {ev.name}</span>
            ) : (
              <span className="mt-0.5 text-[10.5px] text-white/55">{pl.desc}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 장소를 눌렀을 때: 그 장소에서 할 수 있는 것 */
function PlaceModal({ c, place, onClose, onAct }: { c: Career; place: PlaceId; onClose: () => void; onAct: (a: Action) => void }) {
  const pl = PLACES[place];
  const spot: Spot | undefined = spotsOf(c).find((s) => s.place === place);
  const risk = trainRisk(c);
  const opt = (a: Action, title: string, sub: string, foot0: string, color: string, extra?: ReactNode) => {
    const foot = `⚡${costOf(a)} · ${foot0}`;
    const why = whyNot(c, a);
    return (
      <Btn key={title} disabled={!!why} color={color} className="flex flex-col items-start gap-0.5 px-3 py-2 text-left" onClick={() => onAct(a)}>
        <span className={`${font.title} text-[18px] leading-tight`} style={{ color }}>
          {title}
        </span>
        <span className="text-[11.5px] leading-snug font-normal text-white/75">{why ?? sub}</span>
        {extra}
        <span className="mt-0.5 font-mono text-[11px] text-white/55">{foot}</span>
      </Btn>
    );
  };
  let body: ReactNode = null;
  if (place === "ground") {
    body = (
      <>
        <div className="grid grid-cols-5 gap-2">
          {TRAIN_KEYS.map((k) => {
            const t = TRAINS[k];
            const mate = trainersOf(c)[k];
            const mm = mate ? 1.3 + Math.min(0.3, (c.aff[mate] ?? 0) / 330) : 1;
            const mul = trainMul(c, k) * mm;
            return opt(
              { kind: "train", key: k },
              t.name,
              t.desc,
              k === "special" ? `체력 -${t.cost} · 필살 Lv${spLv(c) || "-"}` : `체력 -${t.cost} · Lv${trainLv(c, k)} · 효율 ×${mul.toFixed(2)}`,
              k === "special" ? "#ff5fb4" : STAT_COLOR[k as StatKey],
              mate ? (
                <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold" style={{ color: charById(mate).color }}>
                  <img src={faceUrl(mate)} alt="" className="h-[20px] w-[20px] rounded object-cover object-top" />
                  {charById(mate).name}와 함께 ×{mm.toFixed(2)}
                </span>
              ) : undefined
            );
          })}
        </div>
        <div className="mt-2 flex gap-4 rounded-lg bg-black/30 px-3 py-1.5 text-[12.5px] text-white/70">
          <span>
            대성공 <b className="text-[#ffd23f]">{Math.round(risk.great * 100)}%</b>
          </span>
          <span>
            실패 <b className={risk.fail > 0.15 ? "text-[#ff9a7a]" : "text-white"}>{Math.round(risk.fail * 100)}%</b>
          </span>
          <span>
            부상 <b className={risk.injury > 0.05 ? "text-[#ff5a5a]" : "text-white"}>{(risk.injury * 100).toFixed(risk.injury < 0.1 ? 1 : 0)}%</b>
          </span>
          <span className="text-white/45">체력 40 아래부터 부상이 확 늘어요</span>
        </div>
      </>
    );
  } else if (place === "dorm") {
    body = (
      <div className="grid grid-cols-2 gap-2">
        {opt({ kind: "rest" }, c.injury ? "요양" : "휴식", "체력 크게 회복 · 가끔 컨디션 ↑", "체력 +45 (부상 중 +30)", "#b6ffb0")}
        {opt({ kind: "care" }, "개인정비", "장비 손질 · 스트레칭 · 영상 복기", "체력 +20 · 컨디션 +1", "#7ad7ff")}
      </div>
    );
  } else if (place === "hospital") {
    body = <div className="grid grid-cols-1 gap-2">{opt({ kind: "clinic" }, "치료", c.injury ? "부상 남은 기간 -2턴" : "피로 회복 (체력 70 아래일 때)", `자금 -${CLINIC_PRICE}만 · 체력 +30`, "#ff9a9a")}</div>;
  } else if (spot?.char) {
    const bid = spot.char;
    const ch = charById(bid);
    const sd = SPECIAL_DAY[ROLE[bid]];
    body = spot.special ? (
      <div className="flex gap-3 text-left">
        <img src={artUrl(sd.skin[bid] ?? bid)} alt={ch.name} className="h-[200px] w-auto shrink-0 object-contain" />
        <div className="flex flex-1 flex-col gap-2">
          <div className={`${font.title} text-[24px]`} style={{ color: ch.color }}>
            🎁 {sd.title}
          </div>
          <div className="text-[13px] text-white/75">올해 가장 가까웠던 {ch.name}와 특별한 하루. 호감 +10 · 컨디션 크게 ↑ · 체력 +30 · {ch.name}의 축복 하나.</div>
          {opt({ kind: "meet", char: bid }, `${ch.name}와 ${sd.title}`, "1년에 한 번", "비시즌 첫날에만", ch.color)}
        </div>
      </div>
    ) : (
      <div className="flex flex-col gap-2">
        <BondCard c={c} id={bid} />
        {opt({ kind: "meet", char: bid }, `${ch.name} 만나기`, (c.bonds[bid] ?? 0) >= BOND_MAX ? "같이 놀기 · 호감 · 능력치 조금" : "다음 이야기 진행", "체력 +8 · 컨디션 +1", ch.color)}
      </div>
    );
  } else if (spot?.event) {
    const ev = SPOT_EVENTS[spot.event];
    body = <div className="grid grid-cols-1 gap-2">{opt({ kind: "event", event: spot.event }, ev.name, ev.desc, "이번 주에만", "#ffd23f")}</div>;
  } else if (pl.spot) {
    body = <div className="grid grid-cols-1 gap-2">{opt({ kind: "stroll", place }, place === "downtown" ? "외식" : "산책", place === "downtown" ? "맛있는 거 먹기" : "바람 쐬기", place === "downtown" ? "체력 +15 · 컨디션 +1 · 자금 -60만" : "체력 +10 · 컨디션 +1", "#b6ffb0")}</div>;
  }
  return (
    <Modal w={place === "ground" ? 820 : 560} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <div className={`${font.title} text-[26px]`}>
          {pl.icon} {pl.name} <span className="ml-2 font-mono text-[15px] text-[#ffd23f]">⚡ {c.active}/{ACTIVE_MAX}</span>
        </div>
        <Btn className="px-3 py-1 text-[13px]" color="#8b93b8" onClick={onClose}>
          닫기
        </Btn>
      </div>
      {body}
    </Modal>
  );
}

function GameCard({ c, mode, onMode, onPlay, onAutoWeek, onSitOut }: { c: Career; mode: PlayMode; onMode: (m: PlayMode) => void; onPlay: () => void; onAutoWeek: () => void; onSitOut: () => void }) {
  const st = setupOfSafe(c);
  const opp = st.opp;
  const oppHero = opp.batters.find((b) => b.special);
  const oppAce = opp.pitchers.find((pp) => pp.special);
  const tired = c.stamina < 20;
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-2xl border-2 border-[#FF8A3D]/50 bg-black/35 p-3">
      <div className="flex items-center justify-between">
        <div className={`${font.title} text-[22px]`}>
          {gameNo(c) + 1}경기 <span className="text-white/50">vs</span> <span style={{ color: opp.color }}>{opp.name}</span>
          <span className="ml-2 text-[13px] text-white/50">(이번 주 {c.gameInWeek + 1}/2)</span>
        </div>
        <div className="text-[13px] text-white/60">
          {st.userHome ? "홈" : "원정"} · 9이닝 · {DIFF_NAME[c.diff]}
        </div>
      </div>
      <div className="flex gap-2 text-[13px]">
        <div className="flex-1 rounded-xl bg-white/[0.04] px-3 py-1.5">
          <div className="text-white/55">내 자리</div>
          <div className="text-[15px] font-bold">
            {slotName(st.myIdx)} 타자 · {TYPES[c.type].pos}
          </div>
          <div className="text-[12px] text-white/55">
            컨디션 {COND_NAME[c.cond]}
            {c.learned ? ` · 필살 ${spUses(c)}회` : ""}
            {tired && <span className="text-[#ff9a7a]"> · 지쳐서 타격 -10%</span>}
          </div>
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-1.5">
          {[oppHero?.special, oppAce?.special].map((id, i) =>
            id ? <img key={i} src={faceUrl(id)} alt="" className="h-[42px] w-[38px] rounded-md object-cover object-top" style={{ outline: `2px solid ${charById(id).color}` }} /> : null
          )}
          <div className="text-[12px] leading-snug text-white/70">
            상대 마타자 <b style={{ color: oppHero?.special ? charById(oppHero.special).color : undefined }}>{oppHero?.name}</b>
            <br />
            마무리 마투수 <b style={{ color: oppAce?.special ? charById(oppAce.special).color : undefined }}>{oppAce?.name}</b> — {oppAce?.special ? charById(oppAce.special).ball.name : ""}
          </div>
        </div>
      </div>
      <div className="text-[11.5px] text-white/50">
        경기 평가 {GAME_GRADES.map((g) => `${g.g} ×${g.xp}`).join(" · ")} — 잘 칠수록 경기 경험치가 크게 늘어요 · 타순은 감독 신뢰 25 · 50 · 75에서 올라가요
      </div>
      {canPlay(c) ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {(["direct", "highlight", "auto"] as PlayMode[]).map((m) => (
              <Btn key={m} active={mode === m} color={m === "auto" ? "#7ad7ff" : ACCENT} className="px-2 py-1.5 text-left" onClick={() => onMode(m)}>
                <span className={`${font.title} block text-[16px]`}>{MODE_NAME[m]}</span>
                <span className="block text-[11px] font-normal opacity-80">{MODE_DESC[m]}</span>
              </Btn>
            ))}
          </div>
          <div className="mt-auto grid grid-cols-[2fr_1fr] gap-2">
            <Btn className={`${font.title} py-3.5 text-[24px]`} onClick={onPlay}>
              ⚾ {MODE_NAME[mode]}로 경기 시작
            </Btn>
            <Btn className={`${font.title} py-3.5 text-[16px] leading-tight`} color="#7ad7ff" onClick={onAutoWeek}>
              ⏩ 이번 주 남은 경기
              <span className="block font-['Nanum_Gothic'] text-[11px] font-normal opacity-80">전부 자동</span>
            </Btn>
          </div>
        </>
      ) : (
        <Btn className={`${font.title} mt-auto py-4 text-[22px]`} color="#ff7a7a" onClick={onSitOut}>
          결장 ({INJURY_NAME[c.injury!.kind]}) — 다음으로
        </Btn>
      )}
    </div>
  );
}
const setupOfSafe = (c: Career) => {
  return setupOfCache(c);
};
// 같은 경기 동안 다시 만들지 않게 (팀 생성이 무겁진 않지만 렌더마다 돌 필요는 없음)
let cacheKey = "";
let cacheVal: ReturnType<typeof setupOf> | null = null;
function setupOfCache(c: Career) {
  const k = `${c.id}:${c.season}:${c.week}:${c.gameInWeek}:${Math.round(c.trust)}:${c.cond}`;
  if (k !== cacheKey || !cacheVal) {
    cacheKey = k;
    cacheVal = setupOf(c);
  }
  return cacheVal;
}

/* ─────────────── 팝업 ─────────────── */

function DeltaChips({ d }: { d: Delta }) {
  const chips: { t: string; good: boolean }[] = [];
  for (const k of STAT_KEYS) {
    const v = d.stats[k];
    if (v) chips.push({ t: `${STAT_NAME[k]} ${v > 0 ? "+" : ""}${v}`, good: v > 0 });
  }
  if (d.stamina) chips.push({ t: `체력 ${d.stamina > 0 ? "+" : ""}${d.stamina}`, good: d.stamina > 0 });
  if (d.cond) chips.push({ t: `컨디션 ${d.cond > 0 ? "↑" : "↓"}`, good: d.cond > 0 });
  if (d.trust) chips.push({ t: `신뢰 ${d.trust > 0 ? "+" : ""}${d.trust}`, good: d.trust > 0 });
  if (d.fame) chips.push({ t: `인기도 ${d.fame > 0 ? "+" : ""}${d.fame}`, good: d.fame > 0 });
  if (d.money) chips.push({ t: `자금 ${d.money > 0 ? "+" : ""}${d.money.toLocaleString()}만`, good: d.money > 0 });
  if (!chips.length) return null;
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {chips.map((c, i) => (
        <span key={i} className="rounded-full px-2.5 py-1 text-[13px] font-bold" style={{ background: c.good ? "rgba(125,255,154,0.15)" : "rgba(255,90,90,0.15)", color: c.good ? "#7dff9a" : "#ff8a8a" }}>
          {c.t}
        </span>
      ))}
    </div>
  );
}

function TurnModal({ out, onNext }: { out: TurnOut; onNext: () => void }) {
  const col = TONE_COLOR[out.tone];
  const ch = out.char ? charById(out.char) : null;
  return (
    <Modal w={460} onClose={onNext}>
      {ch && <img src={faceUrl(ch.id)} alt={ch.name} className="mx-auto mb-2 h-[86px] w-[80px] rounded-xl object-cover object-top" style={{ outline: `3px solid ${ch.color}` }} />}
      <div className={`${font.title} text-[28px]`} style={{ color: col, textShadow: out.tone === "awaken" ? "0 0 20px #ff7ae0" : undefined }}>
        {out.title}
      </div>
      <div className="mt-2 flex flex-col gap-1 text-[14px] text-white/80">
        {out.lines.map((l, i) => (
          <div key={i} className={l.startsWith("★") ? "font-bold text-[#ffd23f]" : undefined}>
            {l}
          </div>
        ))}
      </div>
      <DeltaChips d={out.delta} />
      <Btn className="mt-4 w-full py-2.5 text-lg" color={col === "#ffffff" ? ACCENT : col} onClick={onNext}>
        확인
      </Btn>
    </Modal>
  );
}

function ChoiceModal({ c, onPick }: { c: Career; onPick: (i: 0 | 1) => void }) {
  const p = c.pending!;
  const ch = p.char ? charById(p.char) : null;
  return (
    <Modal w={480}>
      <div className="flex items-center gap-3 text-left">
        {ch && <img src={faceUrl(ch.id)} alt={ch.name} className="h-[88px] w-[80px] shrink-0 rounded-xl object-cover object-top" style={{ outline: `3px solid ${ch.color}` }} />}
        <div>
          <div className={`${font.title} text-[22px]`} style={{ color: ch?.color ?? "#7ad7ff" }}>
            {p.title}
          </div>
          <div className="mt-1 text-[15px] text-white/85">{p.text}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {p.choices.map((t, i) => (
          <Btn key={i} className="py-3 text-[15px]" color={i ? "#7ad7ff" : ACCENT} onClick={() => onPick(i as 0 | 1)}>
            {t}
          </Btn>
        ))}
      </div>
    </Modal>
  );
}

/** 특수능력 3장 중 1장 */
function PickModal({ c, onPick }: { c: Career; onPick: (i: number) => void }) {
  const p = c.pick!;
  const tc = tagCount(c);
  return (
    <Modal w={760}>
      <div className={`${font.title} text-[28px] text-[#ffd23f]`}>{p.from}</div>
      <div className="text-[13px] text-white/60">특수능력 하나를 골라요 · 같은 태그 3장이면 세트 효과 · 주황 테두리는 양날 카드</div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {p.options.map((id, i) => {
          const s = skill(id);
          const col = s.risk ? "#ffb070" : s.tag ? TAG_COLOR[s.tag] : "#fff";
          const have = s.tag ? tc[s.tag] ?? 0 : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                sfx.ui();
                onPick(i);
              }}
              className="flex min-h-[170px] cursor-pointer flex-col items-center justify-between rounded-2xl border-[3px] bg-[#0b0e1c] p-3 transition-transform hover:-translate-y-1"
              style={{ borderColor: col, boxShadow: `0 0 18px ${col}55` }}
            >
              <span className="rounded px-2 py-0.5 text-[11px] font-bold" style={{ background: `${col}22`, color: col }}>
                {s.risk ? "양날" : s.tag ? TAG_NAME[s.tag] : ""}
              </span>
              <span className={`${font.title} text-[24px]`} style={{ color: col }}>
                {s.name}
              </span>
              <span className="text-[13px] text-white/80">{s.desc}</span>
              <span className="text-[11px] text-white/45">{s.tag && !s.risk ? `${TAG_NAME[s.tag]} ${have} → ${have + 1}/3${have + 1 >= 3 ? " · 세트 완성!" : ""}` : `종합 +${s.val}`}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="mt-3 cursor-pointer text-[12px] text-white/40 underline" onClick={() => onPick(-1)}>
        안 고르고 넘기기
      </button>
    </Modal>
  );
}

function RetireAskModal({ c, onAnswer }: { c: Career; onAnswer: (yes: boolean) => void }) {
  const ovr = ovrOf(c);
  return (
    <Modal w={500}>
      <div className={`${font.title} text-[28px]`}>{c.season}년차를 마쳤다</div>
      <div className="mt-1 text-[14px] text-white/70">
        {age(c)}세 · 종합 {ovr} ({gradeOf(ovr).g}) · 통산 {c.total.g}경기 {c.total.hr}홈런
      </div>
      <div className="mt-2 text-[13px] text-white/60">
        여기서 은퇴할 수 있어요. 한 해 더 뛰면 기록은 쌓이지만, 8년차부터는 노쇠로 주루 · 수비부터 조금씩 떨어져요. 은퇴 종합은 은퇴하는 순간 능력치로 정해져요.
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Btn className={`${font.title} py-3 text-xl`} color="#ffd23f" onClick={() => onAnswer(true)}>
          은퇴한다
        </Btn>
        <Btn className={`${font.title} py-3 text-xl`} onClick={() => onAnswer(false)}>
          한 해 더!
        </Btn>
      </div>
    </Modal>
  );
}

function ReportModal({ r, more, onClose }: { r: GameReport; more: number; onClose: () => void }) {
  const g = r.sum.grade !== undefined ? GAME_GRADES[r.sum.grade] : undefined;
  return (
    <Modal w={500} onClose={onClose}>
      <div className="flex items-center justify-center gap-3">
        {g && (
          <span className={`${font.title} text-[46px] leading-none`} style={{ color: g.color }}>
            {g.g}
          </span>
        )}
        <div className="text-left">
          <div className="text-[12px] text-white/50">{r.sum.dnp ? "결장" : `경기 평가 · ${r.auto ? "자동 진행" : "직접 출전"}`}</div>
          <div className={`${font.title} text-[20px] leading-tight`}>{r.sum.title.replace(/^\[.\]\s*/, "")}</div>
        </div>
      </div>
      <div className="mt-1 font-mono text-[15px] text-white/70">{r.score}</div>
      {r.note && <div className="mt-1 text-[12px] text-[#ffb0b0]">{r.note}</div>}
      {r.pas.length > 0 && (
        <div className="mx-auto mt-2 flex max-w-[380px] flex-col gap-0.5 rounded-lg bg-black/30 px-3 py-1.5 text-left text-[13px]">
          {r.pas.map((pa, i) => (
            <div key={i} className="flex justify-between" style={{ opacity: pa.auto ? 0.6 : 1 }}>
              <span className="text-white/50">{pa.inning}회</span>
              <span className="flex-1 px-3" style={{ color: pa.kind === "HR" ? "#ffd23f" : pa.kind === "HIT" ? "#7dff9a" : pa.kind === "BB" ? "#7ad7ff" : pa.kind === "K" ? "#ff8a8a" : "#fff" }}>
                {pa.text}
                {pa.rbi ? ` (${pa.rbi}타점)` : ""}
                {pa.auto ? " · 자동" : ""}
              </span>
              {pa.mission && <span className={pa.mission.ok ? "text-[#ffd23f]" : "text-white/40"}>{pa.mission.ok ? "미션 ✓" : "미션 ✗"}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-col gap-0.5 text-[13px] text-white/75">
        {r.sum.lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <DeltaChips d={r.sum.delta} />
      <Btn className="mt-4 w-full py-2.5 text-lg" onClick={onClose}>
        {more ? `다음 경기 결과 (${more})` : "확인"}
      </Btn>
    </Modal>
  );
}

function SeasonModal({ s, c, onClose }: { s: SeasonSummary; c: Career; onClose: () => void }) {
  const L = s.line;
  return (
    <Modal w={540}>
      <div className={`${font.title} text-[30px] text-[#ffd23f]`}>{s.season}년차 시즌 결산</div>
      <div className="mt-2 grid grid-cols-6 gap-1 rounded-xl bg-black/30 py-2 font-mono text-[13px]">
        {[
          ["경기", L.g],
          ["타율", fmtAvg(avg(L))],
          ["홈런", L.hr],
          ["타점", L.rbi],
          ["안타", L.h],
          ["OPS", ops(L).toFixed(3)],
        ].map(([k, v]) => (
          <div key={k as string}>
            <div className="text-[11px] text-white/45">{k}</div>
            <div className="text-[16px] font-bold">{v}</div>
          </div>
        ))}
      </div>
      {s.awards.length > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {s.awards.map((a) => (
            <span key={a} className={`${font.title} rounded-lg bg-[#ffd23f] px-3 py-1 text-[18px] text-black`}>
              🏆 {a}
            </span>
          ))}
        </div>
      )}
      {s.talentReveal && (
        <div className="mt-3 rounded-xl border-2 border-[#ffd23f]/50 bg-[#ffd23f]/10 py-2">
          <div className="text-[12px] text-white/60">스카우트 평가 — 숨은 재능</div>
          <div className={`${font.title} text-[40px] leading-none text-[#ffd23f]`}>{s.talentReveal}</div>
          <div className="text-[11px] text-white/50">F · D · C · B · A · S (각성하면 한 단계 위로)</div>
        </div>
      )}
      {s.decline && (
        <div className="mt-2 text-[12.5px] text-[#ff9a9a]">
          노쇠: {STAT_KEYS.filter((k) => s.decline![k]).map((k) => `${STAT_NAME[k]} ${s.decline![k]}`).join(" · ")}
        </div>
      )}
      <div className="mt-2 flex flex-col gap-0.5 text-[13px] text-white/75">
        {s.lines
          .filter((l) => !l.startsWith("스카우트") && !l.startsWith("수상") && !l.startsWith("나이가"))
          .map((l, i) => (
            <div key={i}>{l}</div>
          ))}
      </div>
      <div className="mt-1 text-[13px] text-white/60">
        종합 {ovrOf(c)} ({gradeOf(ovrOf(c)).g})
        {s.retire ? " · 10년 커리어 끝" : ` · 다음: 시즌 보상 고르기${s.canRetire ? " → 은퇴할지 고르기" : ""} → 비시즌 ${OFF_TURNS}턴`}
      </div>
      <Btn className="mt-4 w-full py-2.5 text-lg" color="#ffd23f" onClick={onClose}>
        {s.retire ? "은퇴식으로" : "다음"}
      </Btn>
    </Modal>
  );
}

function ShopModal({
  c, onClose, onBuyGear, onBuy, onUse,
}: { c: Career; onClose: () => void; onBuyGear: (id: GearId) => void; onBuy: (id: ConsumableId) => void; onUse: (id: ConsumableId) => void }) {
  return (
    <Modal w={760} onClose={onClose}>
      <div className="flex items-center justify-between">
        <div className={`${font.title} text-[26px]`}>🛍️ 쇼핑몰</div>
        <div className="text-right">
          <div className="font-mono text-[15px] font-bold text-[#ffd23f]">자금 {c.money.toLocaleString()}만원</div>
          <div className="text-[11px] text-white/50">인기도 {Math.round(c.fame).toLocaleString()} · 턴 안 써요</div>
        </div>
      </div>
      <div className="mt-2 text-left text-[13px] font-bold text-white/70">장비 (계속) — 그 훈련 효율 + 경기 능력치 · 단계마다 인기도 조건</div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {GEAR_IDS.map((id) => {
          const g = GEAR[id];
          const cur = c.gear[id] ?? 0;
          const n = gearNext(c, id);
          return (
            <div key={id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold">
                  {cur ? g.tiers[cur - 1] : `${g.name} 없음`}{" "}
                  <span className="text-[11px] font-normal" style={{ color: STAT_COLOR[g.stat] }}>
                    {"★".repeat(cur)}
                    {"☆".repeat(3 - cur)}
                  </span>
                </div>
                <div className="text-[11.5px] text-white/60">
                  {cur ? `${TRAINS[g.train].name} +${Math.round(GEAR_TIER[cur - 1].train * 100)}% · 경기 ${STAT_NAME[g.stat]} +${GEAR_TIER[cur - 1].game}` : `${TRAINS[g.train].name} · 경기 ${STAT_NAME[g.stat]}`}
                </div>
                {n && (
                  <div className="text-[11px] text-white/45">
                    다음: {n.name} (+{Math.round(n.train * 100)}% · +{n.game}){n.fame ? ` · 인기도 ${n.fame}` : ""}
                  </div>
                )}
              </div>
              <Btn className="w-[96px] py-1 text-[12px]" color="#ffd23f" disabled={!n || !!n.why} onClick={() => onBuyGear(id)}>
                {!n ? "최고 단계" : n.why && n.why.startsWith("인기도") ? n.why : `${n.price.toLocaleString()}만`}
              </Btn>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-left text-[13px] font-bold text-white/70">
        소모품 — 턴마다 하나만 쓸 수 있어요{c.usedItem ? <span className="text-[#ff9a7a]"> (이번 턴엔 이미 씀)</span> : null}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {CONSUMABLE_IDS.map((id) => {
          const it = CONSUMABLES[id];
          const have = c.bag[id] ?? 0;
          return (
            <div key={id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold">
                  {it.name}
                  {have > 0 && <span className="ml-1 text-[12px] text-[#7dff9a]">×{have}</span>}
                </div>
                <div className="text-[11.5px] text-white/60">{it.desc}</div>
              </div>
              {have > 0 && (
                <Btn className="px-2.5 py-1 text-[12px]" color="#7dff9a" disabled={c.usedItem} onClick={() => onUse(id)}>
                  쓰기
                </Btn>
              )}
              <Btn className="w-[80px] py-1 text-[12px]" color="#ffd23f" disabled={c.money < it.price} onClick={() => onBuy(id)}>
                {it.price}만
              </Btn>
            </div>
          );
        })}
      </div>
      {c.charmNext && <div className="mt-2 text-[12px] text-[#ffd23f]">행운의 부적 효과 중 — 다음 훈련 대성공 ↑</div>}
      <Btn className="mt-3 w-full py-2" color="#8b93b8" onClick={onClose}>
        닫기
      </Btn>
    </Modal>
  );
}

function RecordsModal({ c, onClose }: { c: Career; onClose: () => void }) {
  const rows = [
    ...c.seasons.map((s) => ({ k: `${s.season}년차`, l: s.line, aw: s.awards.join(" · "), ovr: s.ovr })),
    ...(c.line.g ? [{ k: `${c.season}년차 (진행)`, l: c.line, aw: "", ovr: ovrOf(c) }] : []),
  ];
  return (
    <Modal w={700} onClose={onClose}>
      <div className={`${font.title} text-[26px]`}>{c.name} 기록</div>
      <table className="mt-2 w-full font-mono text-[13px]">
        <thead>
          <tr className="text-[11px] text-white/50">
            {["시즌", "경기", "타율", "안타", "홈런", "타점", "볼넷", "삼진", "OPS", "종합", "수상"].map((h) => (
              <th key={h} className="px-1 py-1 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} className="border-t border-white/10">
              <td className="px-1 py-1 font-['Nanum_Gothic'] text-[12px]">{r.k}</td>
              <td>{r.l.g}</td>
              <td>{fmtAvg(avg(r.l))}</td>
              <td>{r.l.h}</td>
              <td>{r.l.hr}</td>
              <td>{r.l.rbi}</td>
              <td>{r.l.bb}</td>
              <td>{r.l.k}</td>
              <td>{ops(r.l).toFixed(3)}</td>
              <td>{r.ovr}</td>
              <td className="font-['Nanum_Gothic'] text-[11px] text-[#ffd23f]">{r.aw}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={11} className="py-4 font-['Nanum_Gothic'] text-white/45">
                아직 경기 기록이 없어요
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-2 text-left text-[12px] text-white/55">
        팀 성적 {c.wins}승 {c.losses}패 · 연봉 {c.salary.toLocaleString()}만원 · 인기도 {Math.round(c.fame).toLocaleString()} · 훈련 횟수{" "}
        {TRAIN_KEYS.map((k) => `${TRAINS[k].name.replace(" 훈련", "")} ${c.tCount[k]}`).join(" · ")}
      </div>
      <div className="mt-1 text-left text-[12px] text-white/55">
        인연:{" "}
        {c.deck.map((id) => `${charById(id).name} ${c.bonds[id] ?? 0}/${BOND_MAX} · 호감 ${c.aff[id] ?? 0}`).join(" · ")}
      </div>
      {c.gp.length > 0 && <div className="mt-1 text-left text-[12px] text-[#7ad7ff]/80">코치진: {c.gp.map((g) => `${GP_BOOSTS[g]?.name ?? g} C`).join(" · ")}</div>}
      <Btn className="mt-3 w-full py-2" color="#8b93b8" onClick={onClose}>
        닫기
      </Btn>
    </Modal>
  );
}

/* ─────────────── 은퇴 · 명예의 전당 ─────────────── */

function Retire({ c, onHome, onNew, onHof, onEpilogue }: { c: Career; onHome: () => void; onNew: () => void; onHof: () => void; onEpilogue: () => void }) {
  const r = retireCard(c);
  const t = r.total;
  const awardText = [...new Set(r.awards)].map((a) => `${a}${r.awards.filter((x) => x === a).length > 1 ? ` ×${r.awards.filter((x) => x === a).length}` : ""}`).join(" · ");
  return (
    <div className="flex h-full items-center justify-center gap-6 px-8">
      <div className="flex flex-col items-center">
        <div className="rounded-2xl bg-gradient-to-b from-[#ffd23f]/25 to-transparent p-2">
          <Portrait c={c} w={170} h={220} />
        </div>
        <div className={`${font.title} mt-1 text-[28px]`}>{c.name}</div>
        <div className="text-[13px] text-white/60">
          #{c.num} · {TYPES[c.type].name} · {c.seasons.length}년 · 재능 {talentName(c)}
          {c.awakened ? " (각성)" : ""}
        </div>
      </div>
      <div className="flex w-[560px] flex-col gap-2">
        <div className="text-[14px] text-white/60">
          은퇴 — {c.seasons.length}년 커리어 · {age(c)}세
        </div>
        <div className="flex items-end gap-4">
          <span className={`${font.title} text-[96px] leading-none`} style={{ color: r.grade.color, textShadow: `0 0 30px ${r.grade.color}66` }}>
            {r.grade.g}
          </span>
          <div className="pb-2">
            <div className={`${font.title} text-[46px] leading-none`}>{r.ovr}</div>
            <div className="text-[15px] text-[#ffd23f]">상위 {r.top < 1 ? r.top.toFixed(1) : Math.round(r.top)}%</div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1 pb-2">
            {r.nick.slice(0, 3).map((n) => (
              <span key={n} className="rounded-md bg-white/10 px-2 py-0.5 text-[13px] font-bold">
                「{n}」
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {STAT_KEYS.map((k) => {
            const v = Math.round(c.stats[k]);
            const g = statGrade(v);
            return (
              <div key={k} className="rounded-xl bg-black/30 px-2 py-1.5 text-center">
                <div className="text-[11px] text-white/55">{STAT_NAME[k]}</div>
                <div className={`${font.title} text-[22px] leading-none`} style={{ color: g.color }}>
                  {g.g} <span className="font-mono text-[16px] text-white">{v}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-xl bg-black/30 px-3 py-2 font-mono text-[13px]">
          통산 {t.g}경기 · 타율 {fmtAvg(avg(t))} · {t.h}안타 · {t.hr}홈런 · {t.rbi}타점 · OPS {ops(t).toFixed(3)}
          {r.awards.length > 0 && <div className="font-['Nanum_Gothic'] text-[12px] text-[#ffd23f]">수상: {awardText}</div>}
          <div className="font-['Nanum_Gothic'] text-[12px] text-white/55">
            특수능력 {c.skills.length}개 (세트 {c.skills.filter((s) => skill(s).set).length}){c.learned ? ` · 필살 「${charById(c.learned).swing.name}」 Lv${spLv(c)} (+${LEARNED_VAL}~)` : ""} · 최종 연봉{" "}
            {c.salary.toLocaleString()}만원
          </div>
        </div>
        {r.partner && (
          <button type="button" onClick={onEpilogue} className="flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-left" style={{ borderColor: charById(r.partner).color, background: `${charById(r.partner).color}1c` }}>
            <img src={faceUrl(r.partner)} alt="" className="h-[40px] w-[38px] rounded-md object-cover object-top" />
            <span className="flex-1 text-[13px]">
              <b style={{ color: charById(r.partner).color }}>파트너 {charById(r.partner).name}</b> — 에필로그 보기 ▶
            </span>
          </button>
        )}
        <div className="text-[12px] text-white/45">명예의 전당에 올라갔어요 · 덱 사람들 인연 레벨이 쌓였어요. 이 선수의 특수능력은 다음 선수에게 「선배의 유산」으로 물려줄 수 있어요.</div>
        <div className="mt-1 flex gap-2">
          <Btn className={`${font.title} flex-1 py-3 text-xl`} onClick={onNew}>
            새 선수 키우기
          </Btn>
          <Btn className={`${font.title} flex-1 py-3 text-xl`} color="#ffd23f" onClick={onHof}>
            명예의 전당
          </Btn>
          <Btn className="px-4 py-3 text-sm" color="#8b93b8" onClick={onHome}>
            처음으로
          </Btn>
        </div>
      </div>
    </div>
  );
}

function Hof({ list, onBack }: { list: HofEntry[]; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col px-8 py-5">
      <div className="flex items-center justify-between">
        <span className={`${font.title} text-[30px] text-[#ffd23f]`}>명예의 전당</span>
        <Btn className="px-4 py-1.5 text-sm" color="#8b93b8" onClick={onBack}>
          ← 뒤로
        </Btn>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/30">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-[#11152a] text-[11px] text-white/50">
            <tr>
              {["#", "등급", "종합", "이름", "타입", "별명", "맞히기", "파워", "주루", "수비", "통산", ""].map((h, i) => (
                <th key={i} className="px-2 py-2 text-left font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((e, i) => {
              const g = gradeOf(e.ovr);
              return (
                <tr key={e.id} className="border-t border-white/5">
                  <td className="px-2 py-1.5 font-mono text-white/50">{i + 1}</td>
                  <td className={`${font.title} px-2 text-[18px]`} style={{ color: g.color }}>
                    {e.grade}
                  </td>
                  <td className="px-2 font-mono text-[15px] font-bold">{e.ovr}</td>
                  <td className="px-2 font-bold">{e.name}</td>
                  <td className="px-2 text-white/65">{TYPES[e.type].name}</td>
                  <td className="px-2 text-white/80">「{e.nick}」</td>
                  {STAT_KEYS.map((k) => (
                    <td key={k} className="px-2 font-mono" style={{ color: statGrade(e.stats[k]).color }}>
                      {e.stats[k]}
                    </td>
                  ))}
                  <td className="px-2 font-mono text-white/65">
                    {e.seasons ?? "-"}년 · {fmtAvg(e.avg)} · {e.hr}HR
                  </td>
                  <td className="px-2 text-[11px] text-[#ffd23f]/70">{e.gp ? "GP" : ""}</td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={12} className="py-10 text-center text-white/45">
                  아직 은퇴한 선수가 없어요. 선수를 끝까지 키우면 여기에 올라가요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
