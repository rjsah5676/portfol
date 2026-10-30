"use client";

/*
 * 육성 모드 v4 「라이징 시즌」 화면 — 슈퍼스타즈식 배치.
 * 허브(왼쪽 위 상태 · 위 능력 4칩 · 오른쪽 위 재화 · 왼쪽 미션/인연 · 가운데 연습장 · 오른쪽 메뉴 · 오른쪽 아래 훈련/숙소)
 * → 훈련 화면(종류 탭 + 미리보기) → 훈련 결과 카드 → 「누구와 만나게 될까?」 → 주말 경기 → 경기 평가 · 주차 결산 → 시즌 결산.
 * 규칙 · 숫자는 lib/baseball/career.ts, 저장은 careerStore.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Diff } from "@/lib/baseball/ai";
import {
  BEATS, BEAT_NAME, BOND_MAX, CAMP_TICKETS, COND_COLOR, COND_FACE, COND_NAME, CONSUMABLES, CONSUMABLE_IDS, DECK_SIZE, DORM, FINAL_TICKETS, FRIEND_AFF, GAME_GRADES, GEAR, GEAR_IDS, GEAR_TIER,
  INJURY_NAME, LEARNED_VAL, MISSION_CATS, MISSION_TIER, SET_NEED, SPOT_EVENTS, STAT_COLOR, STAT_KEYS, STAT_NAME, TAG_COLOR, TAG_NAME, TICKETS, TRAINS, TRAIN_KEYS, TRAIN_LV_EVERY, TYPES, WEEKS,
  CAREER_DIFF, PICK_POS, PICK_TYPES, act, autoBattle, avg, awardRace, buy, buyGear, buySkill, canPlay, careerBatter, careerGameStats, choose, chooseMissions, chooseOffer, choosePick, consumeItem, endSeason,
  finishBattle, fmtAvg, gameName, gearNext, gradeOf, matesOf, missionName, missionNeed, missionNow, myRank, newCareer, nextBeat, oppOf, ops, ovrOf, posOf, seasonGrade, skill, skillPrice, skillShop, spLv, spUses,
  standings, statGrade, stepOf, tagCount, trainLv, trainPreview, whenText, whyNot, chapterOf, storyFx,
  type Action, type BatType, type Career, type ConsumableId, type Delta, type FieldPos, type GearId, type HofEntry, type SeasonMission, type SkillId, type StatKey, type Tag, type TrainKey, type TurnOut,
} from "@/lib/baseball/career";
import { slotName } from "@/lib/baseball/careerGame";
import { ending, orderText, pendingStory, postGame, scouting } from "@/lib/baseball/story";
import { StoryLines, StorySceneView } from "./CareerStory";
import { TEAM_DEFS, charById, faceUrl, type CharId } from "@/lib/baseball/data";
import { isBond, type BondId } from "@/lib/baseball/bonds";
import { makeRng } from "@/lib/baseball/rng";
import { BattleModal, BondPanel, BondsModal, BoonPickModal, DeckStep, GuideModal, Hint, VnScene, recommendDeck, seenHint } from "./CareerBonds";
import { BAT_IDLE, BATS, BATTER_RIG, HELMETS, PITCHER_RIG, PIT_IDLE, baseSkin } from "@/lib/baseball/figures";
import { DEFAULT_LOOK, LOOK_KEYS, LOOK_LABEL, LOOK_OPTS, SKINS, lookColors, lookSkin, type Look } from "@/lib/baseball/look";
import { drawRig, pose } from "@/lib/baseball/rig";
import { batterFrame, drawBatter } from "@/lib/baseball/batterSprite";
import { BATCOL } from "@/lib/baseball/look";
import {
  SPEEDS, addHof, affStart, autoGame, bondLevel, careerSnap, loadBondXp, loadCareer, loadHof, loadMode, loadSpeed, saveCareer, saveMode, saveSpeed, setupOf, takeBackToHub, takeBattle, takeReport, type GameReport, type PlayMode,
} from "./careerStore";
import { logPlay, logUi } from "@/lib/baseball/telemetry";
import type { MatchCfg } from "./match";
import { sfx } from "./sfx";
import { prefetchBondArt } from "./loadTasks";
import { ACCENT, Btn, MenuBg, Modal, font } from "./ui";

type View = "home" | "create" | "hub" | "hof";
type ModalKind = null | "train" | "dorm" | "shop" | "skills" | "records" | "standings" | "bonds" | "guide" | "newConfirm" | "epilogue";

/** 슈퍼스타즈식 패널 (남색 반투명 + 하늘색 테두리) */
const PANEL = "rounded-xl border-2 border-[#5fc8ff]/45 bg-[#0d1838]/88 shadow-[0_4px_0_rgba(0,0,0,0.35)]";
const SKY = "#5fc8ff";
const TONE_COLOR: Record<TurnOut["tone"], string> = { great: "#ffd23f", ok: "#7ad7ff", fail: "#9aa3c7", injury: "#ff5a5a", event: "#7ad7ff", awaken: "#ff7ae0" };
const NAMES = ["김픽셀", "이도트", "박비트", "최렌더", "정버퍼", "강루프", "조캐시", "윤커밋", "장스택", "한패치", "오클릭", "서해시"];
const MODE_NAME: Record<PlayMode, string> = { direct: "직접 출전", highlight: "하이라이트", auto: "자동 진행" };
const MODE_DESC: Record<PlayMode, string> = {
  direct: "내 타석 전부 직접 · 경기당 2분쯤",
  highlight: "찬스 · 돌발미션 · 접전 타석만 직접",
  auto: "결과만 바로 · 돌발미션 없음",
};
const TRAIN_ICON: Record<TrainKey, string> = { hit: "🏏", power: "🏋️", run: "👟", def: "🧤", special: "🔥" };
const TRAIN_COLOR: Record<TrainKey, string> = { ...STAT_COLOR, special: "#ff5fb4" };
const RESULT_BADGE: Record<string, { t: string; col: string }> = {
  우승: { t: "🏆 라이징스타 리그 우승!", col: "#ffd23f" },
  준우승: { t: "🥈 준우승", col: "#d8e2f0" },
  "2위": { t: "리그 2위", col: "#7ad7ff" },
  "3위": { t: "리그 3위", col: "#9aa3c2" },
  "4위": { t: "리그 4위", col: "#9aa3c2" },
};

const clone = (c: Career): Career => JSON.parse(JSON.stringify(c));
const ticketMax = (c: Career) => (c.phase === "camp" ? CAMP_TICKETS : c.phase === "final" ? FINAL_TICKETS : TICKETS);

export default function CareerMode({ onExit, onPlay }: { onExit: () => void; onPlay: (cfg: MatchCfg) => void }) {
  const [view, setView] = useState<View>("home");
  const [c, setC] = useState<Career | null>(null);
  const [hof, setHof] = useState<HofEntry[]>([]);
  const [queue, setQueue] = useState<TurnOut[]>([]);
  const [reports, setReports] = useState<GameReport[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [trainTab, setTrainTab] = useState<TrainKey>("hit");
  /** 큐 맨 앞 결과의 미연시 장면을 봤나 */
  const [vnSeen, setVnSeen] = useState(false);
  const [toast, setToast] = useState("");
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<PlayMode>("highlight");

  useEffect(() => {
    prefetchBondArt();
    let cur = loadCareer();
    let rep = takeReport();
    if (cur?.inGame) {
      if (stepOf(cur) !== "game") {
        cur.inGame = false;
        saveCareer(cur);
      } else {
        try {
          rep = autoGame(cur, "경기 중에 나가서 나머지는 자동으로 진행됐어요");
        } catch {
          cur.inGame = false;
          saveCareer(cur);
        }
        cur = loadCareer();
      }
    }
    if (cur?.phase === "done") addHof(cur);
    // 스토리 전 저장: 프롤로그 · 지난 챕터는 건너뛰고 이어감
    if (cur && !cur.story && cur.phase !== "done") {
      cur.story = { pro: true, ch: chapterOf(cur) };
      saveCareer(cur);
    }
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
    if (takeBackToHub() && cur) setView("hub");
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
    window.setTimeout(() => setToast((v) => (v === t ? "" : v)), 1700);
  };
  const showOut = (out: TurnOut) => {
    const q = [out, ...(out.extra && !out.extra.stub ? [out.extra] : [])].filter((o) => !o.stub || o.vn);
    setQueue(q);
    setVnSeen(false);
    if (q[0]) playTone(q[0].tone);
  };

  const doAct = (a: Action) => {
    if (!c) return;
    const why = whyNot(c, a);
    if (why) return flash(why);
    const n = clone(c);
    const out = act(n, a);
    commit(n);
    setModal(null);
    showOut(out);
  };
  const doChoose = (i: number) => {
    if (!c) return;
    const n = clone(c);
    const out = choose(n, i);
    commit(n);
    showOut(out);
  };
  const doOffer = (i: number) => {
    if (!c) return;
    const n = clone(c);
    logPlay("offer", { ...careerSnap(n), cards: n.offer?.cards.map((x) => x.char ?? x.event) ?? [], chosen: i });
    const out = chooseOffer(n, i);
    commit(n);
    showOut(out);
  };
  const doMissions = (ms: SeasonMission[]) => {
    if (!c) return;
    const n = clone(c);
    const why = chooseMissions(n, ms);
    if (why) return flash(why);
    logPlay("missions", { ...careerSnap(n), missions: ms.map((m) => `${m.key}${m.tier}`) });
    commit(n);
    sfx.cheer(0.6);
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
      speed,
      bond: { char: bt.char, pitches: bt.pitches, need: bt.need, magic: bt.magic, batter: careerBatter(c), title: `${ch.name}와 ${bt.kind === "final" ? "필살 전수 대결" : "대결"}` },
    });
  };
  const battleAuto = () => {
    if (!c?.battle) return;
    const n = clone(c);
    const out = finishBattle(n, autoBattle(n, makeRng((n.seed * 31 + n.turn * 7 + n.battle!.tries) >>> 0)), true);
    commit(n);
    showOut(out);
  };
  const doPick = (i: number) => {
    if (!c) return;
    const n = clone(c);
    if (n.pick) logPlay("pick", { ...careerSnap(n), from: n.pick.from, boon: n.pick.boon ?? null, options: n.pick.options, chosen: i >= 0 ? n.pick.options[i] ?? null : null });
    const out = choosePick(n, i);
    commit(n);
    setQueue([out]);
    playTone(out.tone);
  };
  const doSeasonEnd = () => {
    if (!c) return;
    const n = clone(c);
    const s = endSeason(n);
    logPlay("season", { ...careerSnap(n), line: s.line, awards: s.awards, result: s.result, ovr: s.ovr });
    addHof(n);
    commit(n);
    sfx.cheer(0.9);
  };
  const changeSpeed = (v: number) => {
    setSpeed(v);
    saveSpeed(v);
    logUi("speed", { v });
  };
  const changeMode = (m: PlayMode) => {
    setMode(m);
    saveMode(m);
    logUi("mode", { m });
  };
  useEffect(() => {
    if (modal) logUi(`modal:${modal}`);
  }, [modal]);

  const playGame = () => {
    if (!c) return;
    if (mode === "auto" || !canPlay(c)) {
      const n = clone(c);
      n.inGame = true;
      const r = autoGame(n);
      setC(n);
      setReports([r]);
      (r.pas.some((p) => p.kind === "HR") ? sfx.homerun : () => sfx.cheer(0.5))();
      return;
    }
    const n = clone(c);
    n.inGame = true;
    commit(n);
    onPlay({ mode: "career", diff: c.diff, innings: 9, userHome: true, career: setupOf(n), highlight: mode === "highlight", speed });
  };

  const step = c ? stepOf(c) : null;
  const overlayBusy = queue.length > 0 || reports.length > 0;
  const hub = view === "hub" && c;
  // 메인 스토리: 프롤로그 · 주가 바뀌면 챕터 · 시즌 끝 엔딩 (다른 창이 다 닫힌 뒤)
  const story = hub && !overlayBusy && !modal ? (c.phase === "done" ? (c.story && c.story.ch < 8 ? ending(c) : null) : step === "turn" ? pendingStory(c) : null) : null;
  const doneStory = (pick: number) => {
    if (!c?.story || !story) return;
    const n = clone(c);
    const st = n.story!;
    if (story.key === "story:pro") {
      st.pro = true;
      if (pick >= 0 && story.choices) storyFx(n, story.choices[pick].fx);
    } else if (story.key.startsWith("story:end")) st.ch = 8;
    else st.ch = chapterOf(n);
    logPlay("story", { ...careerSnap(n), key: story.key, pick });
    commit(n);
  };

  return (
    <MenuBg>
      {view === "home" && (
        <Home
          c={c}
          onBack={onExit}
          onContinue={() => setView("hub")}
          onNew={() => {
            setHof(loadHof());
            if (c && c.phase !== "done") setModal("newConfirm");
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
            const nc = newCareer({ ...o, affStart: affStart() });
            logPlay("career_start", careerSnap(nc));
            commit(nc);
            setView("hub");
            sfx.cheer(0.7);
          }}
        />
      )}
      {view === "hof" && <Hof list={hof} onBack={() => setView("home")} />}
      {hub &&
        (c.phase === "done" ? (
          <SeasonEnd
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
            onModal={setModal}
            onTrain={(k) => {
              if (k) setTrainTab(k);
              setModal("train");
            }}
            quiet={overlayBusy || !!modal}
            onPlay={playGame}
            onSeasonEnd={doSeasonEnd}
          />
        ))}

      {story && c && <StorySceneView key={story.key} c={c} scene={story} onDone={doneStory} />}
      {/* 결과 팝업들 (턴 결과 → 경기 평가 → 이벤트 고르기 → 특수능력 고르기 · 대결) */}
      {queue.length > 0 &&
        (queue[0].vn && !vnSeen ? (
          <VnScene
            key={c?.turn + queue[0].title}
            char={queue[0].vn.char}
            skin={queue[0].vn.skin}
            lines={queue[0].vn.lines}
            title={queue[0].title}
            seenKey={queue[0].vn.key}
            panel={c && isBond(queue[0].vn.char) && c.deck.includes(queue[0].vn.char) ? <BondPanel c={c} id={queue[0].vn.char} label={queue[0].title.split(" · ")[1]} /> : undefined}
            result={queue[0].stub || queue[0].lines.length > 2 ? undefined : queue[0]}
            onDone={() => {
              if (queue[0].stub || queue[0].lines.length > 2) setVnSeen(true);
              else {
                setQueue((q) => q.slice(1));
                setVnSeen(false);
              }
            }}
          />
        ) : queue[0].stub ? null : queue[0].train ? (
          <TrainResult
            out={queue[0]}
            onNext={() => {
              setQueue((q) => q.slice(1));
              setVnSeen(false);
            }}
          />
        ) : (
          <TurnModal
            out={queue[0]}
            onNext={() => {
              setQueue((q) => q.slice(1));
              setVnSeen(false);
            }}
          />
        ))}
      {!queue.length && reports.length > 0 && c && <ReportModal c={c} r={reports[0]} more={reports.length - 1} onClose={() => setReports((r) => r.slice(1))} />}
      {!overlayBusy && hub && step === "pending" &&
        (c.pending?.scene && c.pending.char ? (
          <VnScene
            key={`${c.turn}-${c.pending.char}`}
            char={c.pending.char}
            lines={c.pending.scene.lines}
            title={c.pending.title}
            choices={c.pending.choices}
            onChoose={doChoose}
            seenKey={`${c.pending.char}:${c.pending.scene.beat}`}
            panel={isBond(c.pending.char) ? <BondPanel c={c} id={c.pending.char} label={`${BEAT_NAME[BEATS[c.pending.scene.beat]]} ${c.pending.scene.beat + 1}/${BOND_MAX}`} /> : undefined}
          />
        ) : (
          <ChoiceModal c={c} onPick={doChoose} />
        ))}
      {!overlayBusy && hub && step === "pick" && (c.pick?.boon ? <BoonPickModal c={c} onPick={doPick} /> : <PickModal c={c} onPick={doPick} />)}
      {!overlayBusy && hub && step === "battle" && <BattleModal c={c} onDirect={battleDirect} onAuto={battleAuto} />}
      {!overlayBusy && hub && step === "offer" && <OfferModal c={c} onPick={doOffer} />}
      {!overlayBusy && hub && step === "missions" && <MissionSelect c={c} onDone={doMissions} />}

      {modal === "train" && c && <TrainModal c={c} tab={trainTab} setTab={setTrainTab} onClose={() => setModal(null)} onAct={doAct} />}
      {modal === "dorm" && c && <DormModal c={c} onClose={() => setModal(null)} onAct={doAct} />}
      {modal === "shop" && c && (
        <ShopModal
          c={c}
          onClose={() => setModal(null)}
          onBuyGear={(id) => {
            const n = clone(c);
            flash(buyGear(n, id));
            commit(n);
          }}
          onBuy={(id) => {
            const n = clone(c);
            flash(buy(n, id));
            commit(n);
          }}
          onUse={(id) => {
            const n = clone(c);
            flash(consumeItem(n, id));
            commit(n);
          }}
        />
      )}
      {modal === "skills" && c && (
        <SkillShopModal
          c={c}
          onClose={() => setModal(null)}
          onBuy={(id) => {
            const n = clone(c);
            const r = buySkill(n, id);
            if (typeof r === "string") return flash(r);
            logPlay("skill_buy", { ...careerSnap(n), id });
            commit(n);
            sfx.missionOk();
            flash(r.join(" · "));
          }}
        />
      )}
      {modal === "records" && c && <RecordsModal c={c} onClose={() => setModal(null)} />}
      {modal === "standings" && c && <StandingsModal c={c} onClose={() => setModal(null)} />}
      {modal === "bonds" && c && <BondsModal c={c} onClose={() => setModal(null)} />}
      {modal === "guide" && <GuideModal onClose={() => setModal(null)} />}
      {modal === "epilogue" && c?.summary?.partner && <VnScene char={c.summary.partner} lines={[c.summary.epilogue ?? ""]} title="에필로그" onDone={() => setModal(null)} />}
      {modal === "newConfirm" && (
        <Modal>
          <div className={`${font.title} mb-2 text-2xl`}>새로 시작할까요?</div>
          <p className="text-[14px] text-white/70">키우던 {c?.name}의 이번 시즌은 사라져요. 명예의 전당엔 시즌을 끝낸 선수만 남아요.</p>
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
        <div className="pointer-events-none absolute top-[84px] left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/85 px-5 py-2 text-[14px] font-bold text-white">
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

/* ─────────────── 공용 조각 ─────────────── */

/** 이벤트 시작 · 끝 사선 띠 배너 */
function Banner({ children, color = SKY }: { children: ReactNode; color?: string }) {
  return (
    <div
      className={`${font.title} relative mx-auto w-fit -skew-x-12 px-8 py-1 text-[22px] text-white`}
      style={{ background: `repeating-linear-gradient(135deg, ${color}, ${color} 10px, ${color}cc 10px, ${color}cc 20px)`, boxShadow: `0 0 18px ${color}66`, textShadow: "0 2px 0 rgba(0,0,0,0.5)" }}
    >
      <span className="inline-block skew-x-12">{children}</span>
    </div>
  );
}

function Bar({ v, color, max = 999, h = 7 }: { v: number; color: string; max?: number; h?: number }) {
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-white/10" style={{ height: h }}>
      <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%`, background: color }} />
    </div>
  );
}

/** 행동권 칸 */
function Tickets({ n, max }: { n: number; max: number }) {
  return (
    <div className="flex items-center gap-[3px]" title="행동권 — 훈련 · 숙소 하나에 1장">
      {Array.from({ length: max }, (_, i) => (
        <div
          key={i}
          className="h-[16px] w-[11px] rounded-[3px] border"
          style={{ background: i < n ? "#ffd23f" : "rgba(255,255,255,0.08)", borderColor: i < n ? "#fff3b0" : "rgba(255,255,255,0.15)", boxShadow: i < n ? "0 0 6px #ffd23f88" : undefined }}
        />
      ))}
    </div>
  );
}

/** 능력 칩 (슈퍼스타즈: 늘 같은 색) */
function StatChip({ k, v, gain }: { k: StatKey; v: number; gain?: number }) {
  const g = statGrade(v);
  return (
    <div className="flex h-[44px] w-[92px] flex-col justify-center rounded-lg border-2 px-1.5" style={{ borderColor: `${STAT_COLOR[k]}aa`, background: `linear-gradient(180deg, ${STAT_COLOR[k]}33, ${STAT_COLOR[k]}10)` }}>
      <div className="flex items-center justify-between text-[11px] font-bold" style={{ color: STAT_COLOR[k] }}>
        <span>{STAT_NAME[k]}</span>
        {gain ? <span className="text-[10.5px] text-[#ffe680]">▲{gain}</span> : null}
      </div>
      <div className="flex items-baseline justify-between leading-none">
        <span className={`${font.title} text-[18px]`} style={{ color: g.color }}>
          {g.g}
        </span>
        <span className="font-mono text-[17px] font-bold">{Math.round(v)}</span>
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

function DeltaChips({ d }: { d: Delta }) {
  const chips: { t: string; good: boolean; col?: string }[] = [];
  for (const k of STAT_KEYS) {
    const v = d.stats[k];
    if (v) chips.push({ t: `${STAT_NAME[k]} ${v > 0 ? "+" : ""}${v}`, good: v > 0, col: v > 0 ? STAT_COLOR[k] : undefined });
  }
  if (d.sp) chips.push({ t: `스킬P ${d.sp > 0 ? "+" : ""}${d.sp}`, good: d.sp > 0, col: "#c9a2ff" });
  if (d.stamina) chips.push({ t: `체력 ${d.stamina > 0 ? "+" : ""}${d.stamina}`, good: d.stamina > 0 });
  if (d.cond) chips.push({ t: `컨디션 ${d.cond > 0 ? "▲" : "▼"}`, good: d.cond > 0 });
  if (d.money) chips.push({ t: `자금 ${d.money > 0 ? "+" : ""}${d.money.toLocaleString()}만`, good: d.money > 0, col: "#ffd23f" });
  if (!chips.length) return null;
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {chips.map((x, i) => (
        <span key={i} className="rounded-full px-2.5 py-1 text-[13px] font-bold" style={{ background: x.good ? `${x.col ?? "#7dff9a"}22` : "rgba(255,90,90,0.15)", color: x.good ? x.col ?? "#7dff9a" : "#ff8a8a" }}>
          {x.t}
        </span>
      ))}
    </div>
  );
}

/* ─────────────── 시작 화면 ─────────────── */

function Home({ c, onBack, onContinue, onNew, onHof }: { c: Career | null; onBack: () => void; onContinue: () => void; onNew: () => void; onHof: () => void }) {
  const live = c && c.phase !== "done";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <div className="text-center">
        <div className={`${font.title} text-[52px] leading-none`} style={{ color: ACCENT, textShadow: "0 5px 0 #000" }}>
          라이징 시즌
        </div>
        <div className="mt-2 text-[14px] text-white/65">
          한 판 = 한 시즌 · 캠프 → 정규 {WEEKS}주 → 챔피언 결정전 · 훈련 · 함께 훈련 · 인연 · 필살타법
        </div>
        <div className="mt-1 text-[12px] text-white/45">육성 모드 · 30분 안팎 · 이 브라우저에 자동 저장</div>
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
              {TYPES[c!.type].name} · {whenText(c!)} · {c!.wins}승 {c!.losses}패
            </div>
          </div>
          <span className="text-2xl">▶</span>
        </button>
      )}
      {c && !live && (
        <Btn className="w-[440px] py-2.5 text-[15px]" color="#ffd23f" onClick={onContinue}>
          {c.name} 시즌 결산 다시 보기 · 종합 {ovrOf(c)} ({gradeOf(ovrOf(c)).g})
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
  const [type, setType] = useState<BatType>("all");
  const [pos, setPos] = useState<FieldPos>(TYPES.all.pos);
  const diff: Diff = CAREER_DIFF;
  const look: Look = DEFAULT_LOOK;
  const [tab, setTab] = useState<"look" | "base">("base");
  const t = TYPES[type];
  const start = () => {
    const lg = legacy ? hof.find((h) => h.id === legacy.id) : undefined;
    onStart({ name, num, bats, type, pos, look, deck: deck.length === DECK_SIZE ? deck : recommendDeck(type), legacy: lg ? { name: lg.name, skill: legacy?.skill, stats: lg.stats } : undefined });
  };
  void diff;
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
            <br />덱 사람들은 훈련장에 같이 나와요 — 얼굴 있는 훈련을 고르면 효율 ↑ · 호감 ↑. 시즌이 끝나면 호감이 「인연 레벨」로 쌓여요.
          </div>
          <Btn className={`${font.title} ml-4 shrink-0 px-8 py-3 text-2xl`} disabled={!name} onClick={start}>
            입단!
          </Btn>
        </div>
      </div>
    );
  const lookTab = (
    <div className="relative flex flex-1 flex-col gap-2">
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-black/55 text-center backdrop-blur-[1px]">
        <div className={`${font.title} text-[26px] text-white/90`}>🔒 커스터마이징 준비 중</div>
        <div className="mt-1 text-[12.5px] text-white/60">헤어 · 얼굴 · 피부 · 배트 · 유니폼 꾸미기는 다음 업데이트에서 열려요</div>
      </div>
      {LOOK_KEYS.map((k) => (
        <div key={k} className="flex items-center gap-2 opacity-40">
          <span className="w-[56px] text-[13px] font-bold text-white/70">{LOOK_LABEL[k]}</span>
          {LOOK_OPTS[k].map((nm, i) => (
            <Btn key={nm} disabled active={look[k] === i} className="flex w-[118px] items-center justify-center gap-1.5 py-1.5 text-[13px]">
              {k === "skin" && <span className="inline-block h-[14px] w-[14px] rounded-full border border-black/40" style={{ background: SKINS[i].c }} />}
              {nm}
            </Btn>
          ))}
        </div>
      ))}
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
            <Btn active={tab === "look"} className="px-4 py-1 text-[13px]" color="#8b93b8" onClick={() => setTab("look")}>
              🔒 외형
            </Btn>
            <Btn active={tab === "base"} className="px-4 py-1 text-[13px]" onClick={() => setTab("base")}>
              기본 · 타입
            </Btn>
          </div>
          {tab === "look" ? (
            lookTab
          ) : (
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
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-[56px] text-[13px] font-bold text-white/70">타입</span>
                  <div className="grid flex-1 grid-cols-5 gap-1.5">
                    {PICK_TYPES.map((k) => (
                      <Btn
                        key={k}
                        active={type === k}
                        className="py-1.5 text-[14px]"
                        onClick={() => {
                          setType(k);
                          setPos(TYPES[k].pos);
                        }}
                      >
                        {TYPES[k].name}
                      </Btn>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-[56px] text-[13px] font-bold text-white/70">수비 위치</span>
                  <div className="grid flex-1 grid-cols-4 gap-1.5">
                    {PICK_POS.map((p) => (
                      <Btn key={p.pos} active={pos === p.pos} className="py-1 text-[13px]" color="#7ad7ff" onClick={() => setPos(p.pos)}>
                        {p.name}
                      </Btn>
                    ))}
                  </div>
                </div>
                <div className={`${PANEL} px-3 py-2`}>
                  <div className="text-[13px] text-white/80">
                    {t.desc} · {PICK_POS.find((p) => p.pos === pos)?.name}
                  </div>
                  <div className="mt-1.5 grid grid-cols-4 gap-2">
                    {STAT_KEYS.map((k) => (
                      <div key={k} className="text-[12px]">
                        <div className="flex justify-between">
                          <span style={{ color: STAT_COLOR[k] }} className="font-bold">
                            {STAT_NAME[k]}
                          </span>
                          <span style={{ color: t.apt[k] > 1.05 ? "#7dff9a" : t.apt[k] < 0.95 ? "#ff9a7a" : "#fff" }}>성장 {t.apt[k] > 1.05 ? "▲" : t.apt[k] < 0.95 ? "▼" : "─"}</span>
                        </div>
                        <Bar v={t.start[k]} max={400} color={STAT_COLOR[k]} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-2.5">
        <div className="text-[12.5px] leading-relaxed text-white/60">
          한 시즌 = 캠프 + 정규 {WEEKS}주(주마다 행동권 {TICKETS}장 + 주말 경기) + 1위면 챔피언 결정전.
          <br />
          끝나면 종합 등급 · 수상 · 칭호로 명예의 전당에 올라가요 — 보통 종합 450 안팎 · 잘 풀리면 550+.
        </div>
        <Btn space className={`${font.title} ml-4 shrink-0 px-8 py-3 text-2xl`} disabled={!name} onClick={() => setStepNo(2)}>
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

/* ─────────────── 선수 그림 ─────────────── */

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
    const spriteLook = {
      team: colors.team,
      helm: colors.team,
      skin: colors.skin,
      pants: colors.pants,
      dark: colors.dark,
      bat: lc ? "#fff3d6" : BATCOL[look.bat]?.wood ?? BATCOL[0].wood,
      num: String(num),
      glow: lc ? lc.color : undefined,
    };
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.setTransform(q, 0, 0, q, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (front) {
        const ps = pose(PITCHER_RIG, PIT_IDLE, t);
        const sc = h / 225;
        drawRig(ctx, PITCHER_RIG, ps, skin, colors, w / 2, h - 72 * sc, sc, false);
      } else {
        const ps = pose(BATTER_RIG, BAT_IDLE, t);
        const sc = h / 215;
        const bx = w / 2 + (bats === "L" ? 1 : -1) * w * 0.06;
        if (!drawBatter(ctx, batterFrame(BAT_IDLE, t), spriteLook, bx, h - 64 * sc, sc, bats === "L")) drawRig(ctx, BATTER_RIG, ps, skin, colors, bx, h - 64 * sc, sc, bats === "L");
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- look 은 key 로 비교
  }, [key, num, name, bats, learned, metal, front, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}

/* ─────────────── 허브 (슈퍼스타즈 배치) ─────────────── */

function Hub(p: {
  c: Career;
  speed: number;
  mode: PlayMode;
  onSpeed: (v: number) => void;
  onMode: (m: PlayMode) => void;
  onBack: () => void;
  onModal: (m: ModalKind) => void;
  onTrain: (k?: TrainKey) => void;
  quiet?: boolean;
  onPlay: () => void;
  onSeasonEnd: () => void;
}) {
  const { c } = p;
  const step = stepOf(c);
  const ovr = ovrOf(c);
  const gr = gradeOf(ovr);
  const stCol = c.stamina < 30 ? "#ff5a5a" : c.stamina < 50 ? "#ffd23f" : "#7dff9a";
  const turnish = step === "turn" || step === "pending" || step === "pick" || step === "battle" || step === "offer" || step === "missions";
  return (
    <div className="flex h-full flex-col">
      {/* 위: 상태 · 능력 · 재화 */}
      <div className="flex h-[66px] shrink-0 items-center gap-2 border-b-2 border-[#5fc8ff]/30 bg-[#081028]/85 px-2">
        <Btn className="px-2 py-1 text-[13px]" color="#8b93b8" onClick={p.onBack}>
          ←
        </Btn>
        <div className={`${PANEL} flex h-[56px] items-center gap-2 px-2`}>
          <div className="flex h-[50px] w-[40px] items-end justify-center overflow-hidden rounded-md bg-gradient-to-b from-[#2a6b3a]/50 to-transparent">
            <Portrait c={c} w={40} h={50} />
          </div>
          <div className="w-[118px]">
            <div className="flex items-center gap-1">
              <span className="text-[17px] leading-none" title={`컨디션 ${COND_NAME[c.cond]}`}>
                {COND_FACE[c.cond]}
              </span>
              <span className="truncate text-[13px] font-bold">{c.name}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10.5px]">
              <span className="text-white/55">체력</span>
              <div className="flex-1">
                <Bar v={c.stamina} max={100} color={stCol} h={8} />
              </div>
              <span className="font-mono font-bold" style={{ color: stCol }}>
                {Math.round(c.stamina)}
              </span>
            </div>
            <div className="text-[10.5px]" style={{ color: COND_COLOR[c.cond] }}>
              컨디션 {COND_NAME[c.cond]}
            </div>
          </div>
          <div className="flex flex-col items-center border-l border-white/10 pl-2">
            <span className={`${font.title} text-[15px] leading-tight text-[#ffd23f]`}>{whenText(c)}</span>
            <Tickets n={c.tickets} max={ticketMax(c)} />
          </div>
        </div>
        <div className="mx-auto flex items-center gap-1.5">
          {STAT_KEYS.map((k) => (
            <StatChip key={k} k={k} v={c.stats[k]} gain={Math.round(c.stats[k]) - Math.round(c.weekStart[k]) || undefined} />
          ))}
          <div className="flex h-[44px] w-[64px] flex-col items-center justify-center rounded-lg border-2 border-white/20 bg-black/40" title="종합 = 능력치 평균 + 특수능력">
            <span className="text-[10px] text-white/55">종합</span>
            <span className={`${font.title} text-[18px] leading-none`} style={{ color: gr.color }}>
              {gr.g} {ovr}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="rounded-md bg-black/50 px-2 font-mono text-[13px] font-bold text-[#ffd23f]">💰 {c.money.toLocaleString()}만</span>
          <span className="rounded-md bg-black/50 px-2 font-mono text-[13px] font-bold text-[#c9a2ff]">SP {c.sp}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <Btn className="px-2 py-0.5 font-mono text-[11px]" color="#7dff9a" onClick={() => p.onSpeed(SPEEDS[(SPEEDS.indexOf(p.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length])}>
            ×{p.speed}
          </Btn>
          <Btn className="px-2 py-0.5 text-[11px]" color="#8b93b8" onClick={() => p.onModal("guide")}>
            ?
          </Btn>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {/* 왼쪽: 시즌 미션 · 인연 · 특수능력 */}
        <div className="flex w-[214px] shrink-0 flex-col gap-2">
          <MissionPanel c={c} />
          <BondList c={c} onOpen={() => p.onModal("bonds")} />
          <SkillPanel c={c} onOpen={() => p.onModal("skills")} />
        </div>

        {/* 가운데: 연습장 · 경기 전 · 시즌 끝 */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {c.injury && (
            <div className="rounded-xl border-2 border-[#ff5a5a]/60 bg-[#ff5a5a]/10 px-3 py-1 text-[12.5px] text-[#ffb0b0]">
              🩹 {INJURY_NAME[c.injury.kind]} — 복귀까지 {c.injury.left}턴. 훈련은 못 하고 숙소(휴식 · 치료)만. 경기는 결장.
            </div>
          )}
          {turnish ? (
            <PracticeField c={c} onTrain={p.onTrain} />
          ) : step === "game" ? (
            <PreGame c={c} mode={p.mode} onMode={p.onMode} onPlay={p.onPlay} />
          ) : step === "end" ? (
            <div className={`${PANEL} flex flex-1 flex-col items-center justify-center gap-3`}>
              <Banner color="#ffb020">시즌 종료</Banner>
              {c.result && (
                <div className={`${font.title} text-[26px]`} style={{ color: RESULT_BADGE[c.result]?.col }}>
                  {RESULT_BADGE[c.result]?.t}
                </div>
              )}
              <div className="text-[14px] text-white/70">
                {c.line.g}경기 · 타율 {fmtAvg(avg(c.line))} · {c.line.hr}홈런 · {c.line.rbi}타점 · {c.wins}승 {c.losses}패
              </div>
              <Btn space className={`${font.title} px-10 py-3 text-xl`} color="#ffd23f" onClick={p.onSeasonEnd}>
                시즌 결산 보기 ▶
              </Btn>
            </div>
          ) : null}
          <div className="flex h-[30px] shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-black/40 px-3">
            <span className="text-[11px] font-bold text-[#5fc8ff]">LOG</span>
            <span className="truncate text-[12.5px] text-white/85">{c.log[0] ?? "시즌을 시작했다!"}</span>
          </div>
        </div>

        {/* 오른쪽: 메뉴 · 훈련 · 숙소 */}
        <div className="flex w-[116px] shrink-0 flex-col gap-1.5">
          <MenuBtn icon="🛒" label="상점" color="#ffd23f" onClick={() => p.onModal("shop")} />
          <MenuBtn icon="✨" label="스킬" color="#c9a2ff" badge={c.sp >= Math.min(...skillShop(c).map((id) => skillPrice(c, id)), 9999) ? "!" : undefined} onClick={() => p.onModal("skills")} />
          <MenuBtn icon="💞" label="인연" color="#ff7ae0" onClick={() => p.onModal("bonds")} />
          <MenuBtn icon="📊" label="순위" color="#7dff9a" onClick={() => p.onModal("standings")} />
          <MenuBtn icon="📜" label="기록" color="#7ad7ff" onClick={() => p.onModal("records")} />
          <div className="mt-auto flex flex-col items-center gap-1.5">
            <button
              type="button"
              disabled={step !== "turn"}
              onClick={() => {
                sfx.ui();
                p.onTrain();
              }}
              className={`${font.title} flex h-[104px] w-[104px] cursor-pointer flex-col items-center justify-center text-[24px] text-white transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40`}
              style={{ clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%)", background: "linear-gradient(180deg, #ff9a3d, #e0571c)", textShadow: "0 2px 0 rgba(0,0,0,0.45)" }}
            >
              <span className="text-[26px] leading-none">💪</span>
              훈련
            </button>
            <Btn className={`${font.title} w-full py-1.5 text-[16px]`} color="#7ad7ff" disabled={step !== "turn"} onClick={() => p.onModal("dorm")}>
              🛏️ 숙소
            </Btn>
          </div>
        </div>
      </div>
      {!p.quiet && step === "turn" && !seenHint("hub4") && (
        <Hint k="hub4" title="한 판 = 한 시즌">
          🎫 행동권 {ticketMax(c)}장으로 「훈련」이나 「숙소」를 해요. 다 쓰면 주말 리그 경기. 연습장에 얼굴이 있는 훈련은 덱 사람과 「함께 훈련」 — 효율 ↑ · 호감 ↑. 상점 · 스킬은 행동권 안 써요.
        </Hint>
      )}
    </div>
  );
}

function MenuBtn({ icon, label, color, badge, onClick }: { icon: string; label: string; color: string; badge?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx.ui();
        onClick();
      }}
      className="relative flex h-[40px] cursor-pointer items-center gap-2 rounded-xl border-2 bg-[#0d1838]/90 px-2.5 text-left transition-transform hover:-translate-x-0.5"
      style={{ borderColor: `${color}88`, boxShadow: "0 3px 0 rgba(0,0,0,0.4)" }}
    >
      <span className="text-[18px]">{icon}</span>
      <span className={`${font.title} text-[16px]`} style={{ color }}>
        {label}
      </span>
      {badge && <span className="absolute -top-1.5 -right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#ff5a5a] text-[11px] font-bold">{badge}</span>}
    </button>
  );
}

/** 왼쪽: 시즌 미션 */
function MissionPanel({ c }: { c: Career }) {
  return (
    <div className={`${PANEL} px-2.5 py-1.5`}>
      <div className="flex items-center justify-between text-[12px] font-bold text-[#5fc8ff]">
        <span>시즌 미션</span>
        {c.missions && <span className="text-white/50">{c.missions.filter((m) => m.done).length}/3</span>}
      </div>
      {c.missions ? (
        <div className="mt-1 flex flex-col gap-1">
          {c.missions.map((m) => {
            const now = missionNow(c, m.key);
            const need = missionNeed(m);
            const T = MISSION_TIER[m.tier];
            return (
              <div key={m.key} className="text-[11.5px]">
                <div className="flex justify-between">
                  <span className={m.done ? "text-[#ffd23f]" : "text-white/85"}>
                    {m.done ? "✓ " : ""}
                    {missionName(m)}
                  </span>
                  <span className="font-mono text-white/60">
                    {Math.min(now, need)}/{need}
                  </span>
                </div>
                <Bar v={Math.min(now, need)} max={need} color={m.done ? "#ffd23f" : T.color} h={5} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-0.5 text-[11.5px] leading-snug text-white/55">캠프가 끝나면 3개를 골라요 — 이루는 순간 스킬P!</div>
      )}
    </div>
  );
}

/** 왼쪽: 인연 덱 */
function BondList({ c, onOpen }: { c: Career; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={`${PANEL} cursor-pointer px-2.5 py-1.5 text-left hover:border-[#5fc8ff]/80`}>
      <div className="text-[12px] font-bold text-[#ff7ae0]">인연</div>
      <div className="mt-1 flex flex-col gap-1.5">
        {c.deck.map((id) => {
          const ch = charById(id);
          const aff = c.aff[id] ?? 0;
          const ready = nextBeat(c, id).kind !== "hang";
          const v = c.bonds[id] ?? 0;
          return (
            <div key={id} className="flex items-center gap-1.5">
              <div className="relative shrink-0">
                <img src={faceUrl(id)} alt={ch.name} className="h-[32px] w-[30px] rounded-md object-cover object-top" style={{ outline: `2px solid ${ch.color}` }} />
                {ready && <span className="absolute -top-2 -right-1.5 text-[14px]">❗</span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-[11.5px]">
                  <b style={{ color: ch.color }}>{ch.name}</b>
                  <span className="text-white/55">
                    {Math.min(v, BOND_MAX)}/{BOND_MAX}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[#ff7ae0]">♥</span>
                  <Bar v={aff} max={100} color={aff >= FRIEND_AFF ? "linear-gradient(90deg,#ff7ae0,#ffd23f)" : "#ff7ae0"} h={5} />
                  <span className="w-[18px] text-right font-mono text-[10px] text-white/60">{aff}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {c.learned && (
        <div className="mt-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-black" style={{ background: charById(c.learned).color }}>
          ★ {charById(c.learned).swing.name} Lv{spLv(c)}
        </div>
      )}
    </button>
  );
}

/** 왼쪽: 특수능력 (태그 세트 진행) */
function SkillPanel({ c, onOpen }: { c: Career; onOpen: () => void }) {
  const tc = tagCount(c);
  return (
    <button type="button" onClick={onOpen} className={`${PANEL} flex min-h-0 flex-1 cursor-pointer flex-col px-2.5 py-1.5 text-left hover:border-[#5fc8ff]/80`}>
      <div className="flex justify-between text-[12px] font-bold text-[#c9a2ff]">
        <span>특수능력 {c.skills.length}</span>
        <span className="text-white/45">스킬 습득 ▶</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {(Object.keys(TAG_NAME) as Tag[])
          .filter((t) => tc[t])
          .map((t) => (
            <span key={t} className="rounded px-1.5 py-[1px] text-[10.5px] font-bold" style={{ background: `${TAG_COLOR[t]}22`, color: TAG_COLOR[t] }}>
              {TAG_NAME[t]} {Math.min(SET_NEED, tc[t] ?? 0)}/{SET_NEED}
            </span>
          ))}
      </div>
      <div className="mt-1 flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-hidden">
        {c.skills.slice(-8).map((id) => (
          <SkillChip key={id} id={id} />
        ))}
        {!c.skills.length && <span className="text-[11px] text-white/40">스킬P로 배우거나 이벤트 · 인연 축복으로 얻어요</span>}
      </div>
    </button>
  );
}

/** 훈련장 자리 (가운데 연습장) */
const STATION: Record<Exclude<TrainKey, "special">, { x: number; y: number; name: string }> = {
  hit: { x: 20, y: 30, name: "타격 케이지" },
  power: { x: 80, y: 30, name: "웨이트장" },
  run: { x: 20, y: 76, name: "러닝 트랙" },
  def: { x: 80, y: 76, name: "펑고 수비장" },
};

/** 가운데: 연습장 — 내 선수 + 훈련장마다 함께할 덱 캐릭터 */
function PracticeField({ c, onTrain }: { c: Career; onTrain: (k?: TrainKey) => void }) {
  const mates = matesOf(c);
  const opp = c.phase === "camp" ? null : TEAM_DEFS[oppOf(c)];
  const canAct = stepOf(c) === "turn";
  return (
    <div className="relative flex-1 overflow-hidden rounded-2xl border-2 border-[#5fc8ff]/30" style={{ background: "radial-gradient(ellipse at 50% 65%, #3f8a46 0%, #2c6b35 45%, #1d4a27 75%, #13301f 100%)" }}>
      {/* 흙 다이아몬드 */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points="50,30 74,56 50,82 26,56" fill="#a8743f" opacity="0.55" />
        <polygon points="50,38 66,56 50,74 34,56" fill="#3f8a46" opacity="0.9" />
        <path d="M0 12 H100" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
      </svg>
      {/* 이번 주 경기 띠 */}
      <div className="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-4 py-1 text-[12.5px] whitespace-nowrap">
        {opp ? (
          <>
            이번 주말 · {gameName(c)} vs <b style={{ color: opp.color }}>{opp.name}</b> · 팀 {myRank(c)}위
          </>
        ) : (
          <>스프링 캠프 · 행동권 {CAMP_TICKETS}장 · 끝나면 시즌 미션 고르기</>
        )}
      </div>
      {/* 이번 주 감독 지시 (챕터 장면에서 받음) */}
      {c.story?.order && (
        <button
          type="button"
          disabled={!canAct || c.story.order.ok}
          onClick={() => onTrain(c.story!.order!.key)}
          className="absolute top-[40px] left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-0.5 text-[12px] font-bold whitespace-nowrap disabled:cursor-default"
          style={{ borderColor: c.story.order.ok ? "#7dff9a88" : "#ffcf4aaa", background: c.story.order.ok ? "#7dff9a1f" : "#ffcf4a24", color: c.story.order.ok ? "#7dff9a" : "#ffcf4a" }}
        >
          📣 감독 지시 · {orderText(c.story.order)} {c.story.order.ok ? "✓ 달성" : `${c.story.order.done}/${c.story.order.need}`}
        </button>
      )}
      {/* 내 선수 */}
      <div className="absolute top-[54%] left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <Portrait c={c} w={92} h={120} />
        <span className="-mt-1 rounded bg-black/60 px-2 text-[11px] font-bold">
          #{c.num} {c.name}
        </span>
      </div>
      {(Object.keys(STATION) as (keyof typeof STATION)[]).map((k) => {
        const st = STATION[k];
        const ms = mates[k] ?? [];
        const col = TRAIN_COLOR[k];
        return (
          <button
            key={k}
            type="button"
            disabled={!canAct}
            onClick={() => {
              sfx.ui();
              onTrain(k);
            }}
            className="absolute flex w-[150px] -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center rounded-xl border-2 bg-[#0d1838]/85 px-2 py-1 transition-transform hover:-translate-y-[55%] disabled:cursor-default"
            style={{ left: `${st.x}%`, top: `${st.y}%`, borderColor: ms.length ? col : `${col}55`, boxShadow: ms.length ? `0 0 14px ${col}77` : "0 3px 0 rgba(0,0,0,0.4)" }}
          >
            <div className="flex items-center gap-1">
              <span className="text-[16px]">{TRAIN_ICON[k]}</span>
              <span className={`${font.title} text-[14px] whitespace-nowrap`} style={{ color: col }}>
                {st.name}
              </span>
              <span className="font-mono text-[10.5px] text-white/60">Lv{trainLv(c, k)}</span>
            </div>
            <div className="mt-0.5 flex h-[30px] items-center gap-1">
              {ms.length ? (
                ms.map((id) => {
                  const ch = charById(id);
                  const ready = nextBeat(c, id).kind !== "hang";
                  return (
                    <div key={id} className="relative">
                      <img src={faceUrl(id)} alt={ch.name} className="h-[28px] w-[26px] rounded-md object-cover object-top" style={{ outline: `2px solid ${ch.color}` }} />
                      {ready && <span className="absolute -top-2 -right-1 text-[12px]">❗</span>}
                      {(c.aff[id] ?? 0) >= FRIEND_AFF && <span className="absolute -bottom-1 -left-1 text-[10px]">💛</span>}
                    </div>
                  );
                })
              ) : (
                <span className="text-[10.5px] text-white/40">혼자 훈련</span>
              )}
            </div>
          </button>
        );
      })}
      {c.learned && (
        <button
          type="button"
          disabled={!canAct}
          onClick={() => onTrain("special")}
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border-2 border-[#ff5fb4]/70 bg-[#0d1838]/85 px-3 py-0.5 text-[12px] font-bold text-[#ff5fb4] disabled:cursor-default"
        >
          🔥 필살 훈련 Lv{spLv(c)}
        </button>
      )}
    </div>
  );
}

/* ─────────────── 훈련 화면 (종류 탭 + 미리보기) ─────────────── */

function TrainModal({ c, tab, setTab, onClose, onAct }: { c: Career; tab: TrainKey; setTab: (k: TrainKey) => void; onClose: () => void; onAct: (a: Action) => void }) {
  const mates = matesOf(c);
  const pv = trainPreview(c, tab);
  const why = whyNot(c, { kind: "train", key: tab });
  const t = TRAINS[tab];
  const col = TRAIN_COLOR[tab];
  const after = Math.max(0, Math.round(c.stamina - pv.cost));
  return (
    <Modal w={860} onClose={onClose}>
      <div className="flex items-center justify-between">
        <div className={`${font.title} text-[26px]`}>💪 훈련</div>
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-white/60">
            {whenText(c)} · 행동권 {c.tickets}/{ticketMax(c)}
          </span>
          <Btn className="px-3 py-1 text-[13px]" color="#8b93b8" onClick={onClose}>
            닫기
          </Btn>
        </div>
      </div>
      <div className="mt-2 flex gap-3 text-left">
        {/* 훈련 종류 탭 */}
        <div className="flex w-[300px] shrink-0 flex-col gap-1.5">
          {TRAIN_KEYS.map((k) => {
            const ms = k === "special" ? [] : mates[k] ?? [];
            const lv = k === "special" ? spLv(c) : trainLv(c, k);
            const cnt = c.tCount[k] ?? 0;
            const locked = k === "special" && !c.learned;
            const on = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  sfx.ui();
                  setTab(k);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-xl border-2 px-2.5 py-1.5"
                style={{ borderColor: on ? TRAIN_COLOR[k] : "rgba(255,255,255,0.12)", background: on ? `${TRAIN_COLOR[k]}26` : "rgba(0,0,0,0.3)", opacity: locked ? 0.45 : 1 }}
              >
                <span className="text-[22px]">{TRAIN_ICON[k]}</span>
                <div className="min-w-0 flex-1">
                  <div className={`${font.title} flex items-center gap-1.5 text-[16px]`} style={{ color: TRAIN_COLOR[k] }}>
                    {TRAINS[k].name}
                    {c.story?.order?.key === k && !c.story.order.ok && (
                      <span className="rounded bg-[#ffcf4a] px-1 font-sans text-[10px] font-bold text-black">
                        📣 지시 {c.story.order.done}/{c.story.order.need}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i} className="h-[5px] w-[14px] rounded-full" style={{ background: i < lv ? TRAIN_COLOR[k] : "rgba(255,255,255,0.12)" }} />
                    ))}
                    <span className="ml-1 font-mono text-[10.5px] text-white/55">{locked ? "잠김" : `Lv${lv}${k !== "special" && lv < 5 ? ` · 다음 ${TRAIN_LV_EVERY - (cnt % TRAIN_LV_EVERY)}번` : ""}`}</span>
                  </div>
                </div>
                <div className="flex gap-0.5">
                  {ms.map((id) => (
                    <img key={id} src={faceUrl(id)} alt="" className="h-[30px] w-[28px] rounded-md object-cover object-top" style={{ outline: `2px solid ${charById(id).color}` }} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
        {/* 미리보기 */}
        <div className={`${PANEL} flex flex-1 flex-col p-3`}>
          <div className="flex items-center gap-2">
            <span className={`${font.title} text-[24px]`} style={{ color: col }}>
              {t.name}
            </span>
            <span className="text-[12px] text-white/55">{t.desc}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.entries(pv.gain) as [StatKey, number][]).map(([k, v]) => (
              <div key={k} className="flex w-[96px] flex-col items-center rounded-lg border-2 py-1" style={{ borderColor: `${STAT_COLOR[k]}aa`, background: `${STAT_COLOR[k]}1c` }}>
                <span className="text-[12px] font-bold" style={{ color: STAT_COLOR[k] }}>
                  {STAT_NAME[k]}
                </span>
                <span className={`${font.title} text-[22px] leading-none text-[#ffe680]`}>▲{v}</span>
              </div>
            ))}
            <div className="flex w-[96px] flex-col items-center rounded-lg border-2 border-[#c9a2ff]/70 bg-[#c9a2ff]/10 py-1">
              <span className="text-[12px] font-bold text-[#c9a2ff]">스킬P</span>
              <span className={`${font.title} text-[22px] leading-none text-[#ffe680]`}>▲{pv.sp}</span>
            </div>
            <div className="flex w-[96px] flex-col items-center rounded-lg border-2 border-[#ffd23f]/60 bg-[#ffd23f]/10 py-1">
              <span className="text-[12px] font-bold text-[#ffd23f]">자금</span>
              <span className={`${font.title} text-[22px] leading-none text-[#ffe680]`}>+{pv.money}</span>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-white/45">대략값 · 대성공이면 ×1.6 · 실패면 ×0.3 · 컨디션 {COND_NAME[c.cond]} 반영</div>
          {pv.mates.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 rounded-lg bg-black/30 px-2 py-1.5">
              {pv.mates.map((id) => {
                const ch = charById(id);
                const fr = (c.aff[id] ?? 0) >= FRIEND_AFF;
                return (
                  <div key={id} className="flex items-center gap-2 text-[12.5px]">
                    <img src={faceUrl(id)} alt="" className="h-[24px] w-[22px] rounded object-cover object-top" />
                    <b style={{ color: ch.color }}>{ch.name}</b>
                    <span className={fr ? "font-bold text-[#ffd23f]" : "text-[#7dff9a]"}>{fr ? "우정 훈련" : "함께 훈련"}</span>
                    <span className="text-white/60">· 호감 +{fr ? 4 : 6}</span>
                    {nextBeat(c, id).kind !== "hang" && <span className="text-[#ffd23f]">❗ 이야기 준비됨</span>}
                  </div>
                );
              })}
              <div className="text-[11.5px] text-white/60">효율 ×{pv.mateMul.toFixed(2)}</div>
            </div>
          )}
          <div className="mt-auto grid grid-cols-3 gap-2 pt-2 text-[12px]">
            <div>
              <div className="flex justify-between text-white/60">
                <span>성공률</span>
                <b className={pv.success < 0.85 ? "text-[#ff9a7a]" : "text-[#7dff9a]"}>{Math.round(pv.success * 100)}%</b>
              </div>
              <Bar v={pv.success * 100} max={100} color={pv.success < 0.85 ? "#ff9a7a" : "#7dff9a"} />
            </div>
            <div>
              <div className="flex justify-between text-white/60">
                <span>대성공</span>
                <b className="text-[#ffd23f]">{Math.round(pv.great * 100)}%</b>
              </div>
              <Bar v={pv.great * 100} max={100} color="#ffd23f" />
            </div>
            <div>
              <div className="flex justify-between text-white/60">
                <span>체력</span>
                <b style={{ color: after < 30 ? "#ff5a5a" : "#fff" }}>
                  {Math.round(c.stamina)} → {after}
                </b>
              </div>
              <Bar v={after} max={100} color={after < 30 ? "#ff5a5a" : after < 50 ? "#ffd23f" : "#7dff9a"} />
            </div>
          </div>
          {pv.injury > 0.02 && <div className="mt-1 text-[12px] font-bold text-[#ff5a5a]">⚠ 부상 위험 {Math.round(pv.injury * 100)}% — 숙소에서 쉬는 게 좋아요</div>}
          <Btn space className={`${font.title} mt-2 py-2.5 text-[22px]`} disabled={!!why} onClick={() => onAct({ kind: "train", key: tab })}>
            {why ?? "훈련하기 🎫1"}
          </Btn>
        </div>
      </div>
      <Hint k="train4" title="훈련 미리보기">
        오를 양 · 스킬P · 성공률 · 체력 소모가 다 보여요. 얼굴이 붙은 훈련은 「함께 훈련」이라 크게 오르고 호감도 쌓여요. 같은 훈련 {TRAIN_LV_EVERY}번마다 레벨 업!
      </Hint>
    </Modal>
  );
}

function DormModal({ c, onClose, onAct }: { c: Career; onClose: () => void; onAct: (a: Action) => void }) {
  return (
    <Modal w={640} onClose={onClose}>
      <div className="flex items-center justify-between">
        <div className={`${font.title} text-[26px]`}>🛏️ 숙소</div>
        <span className="text-[12.5px] text-white/60">
          체력 {Math.round(c.stamina)} · 컨디션 {COND_NAME[c.cond]} · 행동권 {c.tickets}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["rest", "play", "clinic"] as const).map((k) => {
          const d = DORM[k];
          const why = whyNot(c, { kind: k });
          return (
            <button
              key={k}
              type="button"
              disabled={!!why}
              onClick={() => onAct({ kind: k })}
              className="flex h-[150px] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-[#5fc8ff]/50 bg-[#0d1838]/90 transition-transform hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="text-[38px]">{d.icon}</span>
              <span className={`${font.title} text-[20px]`}>{d.name}</span>
              <span className="text-[12px] text-white/70">{why && k === "clinic" ? why : d.desc}</span>
              <span className="text-[11px] text-[#ffd23f]">🎫1</span>
            </button>
          );
        })}
      </div>
      <Btn space className="mt-3 w-full py-2" color="#8b93b8" onClick={onClose}>
        닫기
      </Btn>
    </Modal>
  );
}

/* ─────────────── 결과 팝업 ─────────────── */

/** 훈련 결과 카드 줄 */
function TrainResult({ out, onNext }: { out: TurnOut; onNext: () => void }) {
  const col = out.tone === "great" ? "#ffd23f" : out.tone === "fail" ? "#9aa3c7" : out.tone === "injury" ? "#ff5a5a" : SKY;
  const d = out.delta;
  return (
    <Modal w={620} onClose={onNext}>
      <Banner color={col}>{out.title}</Banner>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {STAT_KEYS.filter((k) => d.stats[k]).map((k) => (
          <div key={k} className="flex w-[100px] flex-col items-center rounded-xl border-2 py-2" style={{ borderColor: STAT_COLOR[k], background: `${STAT_COLOR[k]}22` }}>
            <span className="text-[13px] font-bold" style={{ color: STAT_COLOR[k] }}>
              {STAT_NAME[k]}
            </span>
            <span className={`${font.title} text-[28px] leading-none text-[#ffe680]`}>▲{d.stats[k]}</span>
          </div>
        ))}
        {d.sp > 0 && (
          <div className="flex w-[100px] flex-col items-center rounded-xl border-2 border-[#c9a2ff] bg-[#c9a2ff]/15 py-2">
            <span className="text-[13px] font-bold text-[#c9a2ff]">스킬P</span>
            <span className={`${font.title} text-[28px] leading-none text-[#ffe680]`}>▲{d.sp}</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-1.5 text-[12px]">
        {(out.bonus ?? []).map((b) => (
          <span key={b} className="rounded-full bg-[#ffd23f]/15 px-2.5 py-0.5 font-bold text-[#ffd23f]">
            {b}
          </span>
        ))}
        {d.stamina !== 0 && <span className="rounded-full bg-white/10 px-2.5 py-0.5">체력 {d.stamina > 0 ? "+" : ""}{d.stamina}</span>}
        {d.money > 0 && <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[#ffd23f]">자금 +{d.money}만</span>}
        {d.cond !== 0 && <span className="rounded-full bg-white/10 px-2.5 py-0.5">컨디션 {d.cond > 0 ? "▲" : "▼"}</span>}
      </div>
      {out.mates && out.mates.length > 0 && (
        <div className="mt-3 flex justify-center gap-3">
          {out.mates.map((m) => {
            const ch = charById(m.id);
            return (
              <div key={m.id} className="flex items-center gap-1.5 rounded-xl border px-2 py-1" style={{ borderColor: `${ch.color}88` }}>
                <img src={faceUrl(m.id)} alt="" className="h-[36px] w-[33px] rounded-md object-cover object-top" />
                <div className="text-left text-[12px]">
                  <b style={{ color: ch.color }}>{ch.name}</b>
                  <div className="text-[#ff7ae0]">♥ +{m.aff}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {out.lines.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 text-[13.5px] text-white/80">
          {out.lines.map((l, i) => (
            <div key={i} className={l.includes("레벨") || l.includes("마스터") ? "font-bold text-[#ffd23f]" : undefined}>
              {l}
            </div>
          ))}
        </div>
      )}
      <Btn space className="mt-4 w-full py-2" color={col} onClick={onNext}>
        화면을 누르세요
      </Btn>
    </Modal>
  );
}

function TurnModal({ out, onNext }: { out: TurnOut; onNext: () => void }) {
  const col = TONE_COLOR[out.tone];
  const ch = out.char ? charById(out.char) : null;
  return (
    <Modal w={480} onClose={onNext}>
      {ch && <img src={faceUrl(ch.id)} alt={ch.name} className="mx-auto mb-2 h-[86px] w-[80px] rounded-xl object-cover object-top" style={{ outline: `3px solid ${ch.color}` }} />}
      <Banner color={col}>{out.title}</Banner>
      <div className="mt-3 flex flex-col gap-1 text-[14px] text-white/80">
        {out.lines.map((l, i) => (
          <div key={i} className={l.startsWith("★") || l.includes("획득") ? "font-bold text-[#ffd23f]" : undefined}>
            {l}
          </div>
        ))}
      </div>
      <DeltaChips d={out.delta} />
      <Btn space className="mt-4 w-full py-2.5 text-lg" color={col} onClick={onNext}>
        확인
      </Btn>
    </Modal>
  );
}

function ChoiceModal({ c, onPick }: { c: Career; onPick: (i: number) => void }) {
  const p = c.pending!;
  const ch = p.char ? charById(p.char) : null;
  return (
    <Modal w={480}>
      <Banner>{p.title}</Banner>
      <div className="mt-3 flex items-center gap-3 text-left">
        {ch && <img src={faceUrl(ch.id)} alt={ch.name} className="h-[88px] w-[80px] shrink-0 rounded-xl object-cover object-top" style={{ outline: `3px solid ${ch.color}` }} />}
        <div className="text-[15px] text-white/85">{p.text}</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {p.choices.map((t, i) => (
          <Btn key={i} className="py-3 text-[15px]" color={i ? "#7ad7ff" : ACCENT} onClick={() => onPick(i)}>
            {t}
          </Btn>
        ))}
      </div>
    </Modal>
  );
}

/** 「누구와 만나게 될까?」 — 세로 카드 3장 */
function OfferModal({ c, onPick }: { c: Career; onPick: (i: number) => void }) {
  const cards = c.offer!.cards;
  const TONE = { good: "#7dff9a", risk: "#ffb070", bad: "#ff7a7a" } as const;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70">
      <Banner color="#ff7ae0">누구와 만나게 될까?</Banner>
      <div className="mt-5 flex gap-4">
        {cards.map((cd, i) => {
          const ch = cd.char ? charById(cd.char) : null;
          const ev = cd.event ? SPOT_EVENTS[cd.event] : null;
          const col = ch ? ch.color : ev ? TONE[ev.tone] : SKY;
          const ready = cd.char ? nextBeat(c, cd.char).kind !== "hang" : false;
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                sfx.ui();
                onPick(i);
              }}
              className="flex h-[330px] w-[220px] cursor-pointer flex-col items-center overflow-hidden rounded-2xl border-[3px] bg-[#0d1838] transition-transform hover:-translate-y-2"
              style={{ borderColor: col, boxShadow: `0 0 22px ${col}55` }}
            >
              <div className="flex h-[190px] w-full items-end justify-center" style={{ background: `linear-gradient(180deg, ${col}44, transparent)` }}>
                {ch ? <img src={faceUrl(ch.id)} alt={ch.name} className="h-[180px] w-[170px] object-cover object-top" /> : <span className="mb-8 text-[84px]">{ev?.icon}</span>}
              </div>
              <div className="flex flex-1 flex-col items-center justify-center gap-1 px-3">
                {ready && <span className="rounded bg-[#ffd23f] px-2 text-[11px] font-bold text-black">이야기 ❗</span>}
                {ev && (
                  <span className="rounded px-2 text-[11px] font-bold" style={{ background: `${col}22`, color: col }}>
                    {ev.tone === "good" ? "좋은 일" : ev.tone === "risk" ? "고르기" : "불길"}
                  </span>
                )}
                <span className={`${font.title} text-[19px] leading-tight`} style={{ color: col }}>
                  {cd.title}
                </span>
                <span className="text-[12px] leading-snug text-white/75">{cd.desc}</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-[12px] text-white/50">하나를 골라요 · 인연 이야기는 호감이 문턱을 넘어야 다음으로 가요</div>
    </div>
  );
}

/** 특수능력 3장 중 1장 */
function PickModal({ c, onPick }: { c: Career; onPick: (i: number) => void }) {
  const p = c.pick!;
  const tc = tagCount(c);
  return (
    <Modal w={760}>
      <Banner color="#ffb020">{p.from}</Banner>
      <div className="mt-2 text-[13px] text-white/60">특수능력 하나를 골라요 · 같은 태그 {SET_NEED}장이면 세트 효과 · 주황 테두리는 양날 카드</div>
      {!p.options.length && <div className="mt-4 text-[14px] text-white/70">더 고를 수 있는 특수능력이 없어요. 넘기기를 눌러 주세요.</div>}
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
              <span className="text-[11px] text-white/45">{s.tag && !s.risk ? `${TAG_NAME[s.tag]} ${have} → ${have + 1}/${SET_NEED}${have + 1 >= SET_NEED ? " · 세트 완성!" : ""}` : `종합 +${s.val}`}</span>
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

/** 캠프 끝: 시즌 미션 3개 고르기 (6종 × 쉬움 · 보통 · 어려움) */
function MissionSelect({ c, onDone }: { c: Career; onDone: (ms: SeasonMission[]) => void }) {
  const [sel, setSel] = useState<SeasonMission[]>([]);
  const toggle = (key: SeasonMission["key"], tier: number) => {
    setSel((s) => {
      const cur = s.find((m) => m.key === key);
      if (cur && cur.tier === tier) return s.filter((m) => m.key !== key);
      if (cur) return s.map((m) => (m.key === key ? { key, tier } : m));
      if (s.length >= 3) return s;
      return [...s, { key, tier }];
    });
  };
  const sum = sel.reduce((a, m) => a + MISSION_TIER[m.tier].sp, 0);
  return (
    <Modal w={800}>
      <Banner color="#ffb020">시즌 미션 고르기</Banner>
      <div className="mt-2 text-[13px] text-white/65">
        {c.name}의 이번 시즌 목표 3개! 정규 {WEEKS}주 + 결승 동안 이루면 그 순간 스킬P. 서로 다른 종류로 골라요.
      </div>
      <div className="mt-3 grid grid-cols-[110px_1fr_1fr_1fr] gap-1.5 text-[13px]">
        <span />
        {MISSION_TIER.map((t) => (
          <span key={t.name} className="text-center font-bold" style={{ color: t.color }}>
            {t.name} · SP {t.sp}
          </span>
        ))}
        {MISSION_CATS.map((cat) => (
          <MissionRow key={cat.key} cat={cat} sel={sel.find((m) => m.key === cat.key)?.tier} onPick={(t) => toggle(cat.key, t)} />
        ))}
      </div>
      <div className="mt-2 text-[11.5px] text-white/45">도루 · 호수비는 경기 중 찬스가 오면 직접 고르거나 눌러서 쌓여요 · 자동이면 능력치로</div>
      <Btn space className={`${font.title} mt-3 w-full py-2.5 text-[20px]`} color="#ffd23f" disabled={sel.length !== 3} onClick={() => onDone(sel)}>
        {sel.length === 3 ? `이걸로 시즌 개막! · 최대 SP ${sum}` : `${3 - sel.length}개 더 골라요`}
      </Btn>
    </Modal>
  );
}
function MissionRow({ cat, sel, onPick }: { cat: (typeof MISSION_CATS)[number]; sel?: number; onPick: (t: number) => void }) {
  return (
    <>
      <span className="flex items-center font-bold text-white/80">{cat.name}</span>
      {cat.tiers.map((n, t) => {
        const on = sel === t;
        const col = MISSION_TIER[t].color;
        return (
          <button
            key={t}
            type="button"
            onClick={() => {
              sfx.ui();
              onPick(t);
            }}
            className="cursor-pointer rounded-lg border-2 py-1.5 font-bold"
            style={{ borderColor: on ? col : `${col}44`, background: on ? `${col}33` : "rgba(0,0,0,0.3)", color: on ? "#fff" : "rgba(255,255,255,0.75)", boxShadow: on ? `0 0 12px ${col}66` : undefined }}
          >
            {on ? "✓ " : ""}
            {cat.name} {n}
            {cat.unit}
          </button>
        );
      })}
    </>
  );
}

/* ─────────────── 경기 전 ─────────────── */

function PreGame({ c, mode, onMode, onPlay }: { c: Career; mode: PlayMode; onMode: (m: PlayMode) => void; onPlay: () => void }) {
  const opp = TEAM_DEFS[oppOf(c)];
  const rows = standings(c);
  const st = setupOfCache(c);
  const oppAce = st.opp.pitchers.find((pp) => pp.role === "SP");
  return (
    <div className={`${PANEL} flex flex-1 flex-col gap-2 p-3`}>
      <div className="flex items-center justify-between">
        <div className={`${font.title} text-[24px]`}>
          {c.phase === "final" ? <span className="text-[#ffd23f]">🏆 챔피언 결정전</span> : gameName(c)} <span className="text-white/50">vs</span> <span style={{ color: opp.color }}>{opp.name}</span>
        </div>
        <span className="text-[12px] text-white/55">
          {slotName(st.myIdx)} 타자 · {posOf(c)} · 컨디션 {COND_FACE[c.cond]}
        </span>
      </div>
      {/* 일정 진행 원 */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: WEEKS }, (_, i) => {
          const r = c.hist[i];
          const cur = c.phase === "season" && i === c.week - 1;
          const col = r === "W" ? "#ffd23f" : r === "L" ? "#7a86b0" : r ? "#9aa3c2" : cur ? SKY : "rgba(255,255,255,0.15)";
          return (
            <div key={i} className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 text-[12px] font-bold" style={{ borderColor: col, background: r === "W" ? "#ffd23f33" : cur ? `${SKY}33` : "transparent", boxShadow: cur ? `0 0 10px ${SKY}` : undefined }}>
              {r === "W" ? "승" : r === "L" ? "패" : r ? "무" : i + 1}
            </div>
          );
        })}
        <span className="mx-1 text-white/30">▶</span>
        <div className="flex h-[30px] items-center rounded-full border-2 px-2.5 text-[12px] font-bold" style={{ borderColor: c.phase === "final" ? "#ffd23f" : "rgba(255,255,255,0.15)", color: c.phase === "final" ? "#ffd23f" : "rgba(255,255,255,0.4)" }}>
          🏆 결승
        </div>
        <span className="ml-auto text-[11.5px] text-white/45">리그 1위만 결승</span>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <StandingsTable rows={rows} compact />
        </div>
        <div className="flex w-[180px] flex-col gap-1 rounded-xl bg-black/30 px-2.5 py-1.5 text-[12px]">
          <div className="text-white/55">상대 선발</div>
          <b style={{ color: opp.color }}>
            {oppAce?.name} · {oppAce?.velo}km/h
          </b>
          <div className="mt-1 text-white/55">내 시즌</div>
          <span className="font-mono">
            {fmtAvg(avg(c.line))} · {c.line.hr}HR · {c.line.rbi}타점
          </span>
          {c.learned && <span className="text-[#ff7ae0]">필살 {spUses(c)}회</span>}
        </div>
      </div>
      <StoryLines c={c} lines={scouting(c)} />
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
          <Btn space className={`${font.title} mt-auto py-3 text-[24px]`} onClick={onPlay}>
            ⚾ {MODE_NAME[mode]}로 경기 시작
          </Btn>
        </>
      ) : (
        <Btn space className={`${font.title} mt-auto py-4 text-[22px]`} color="#ff7a7a" onClick={onPlay}>
          결장 ({INJURY_NAME[c.injury!.kind]}) — 결과 보기
        </Btn>
      )}
      <div className="text-center text-[11px] text-white/45">경기 평가 {GAME_GRADES.map((g) => `${g.g} SP${g.sp}`).join(" · ")} · 기록만큼 「실전 경험」으로 능력치도 올라요</div>
    </div>
  );
}

// 같은 경기 동안 다시 만들지 않게
let cacheKey = "";
let cacheVal: ReturnType<typeof setupOf> | null = null;
function setupOfCache(c: Career) {
  const k = `${c.id}:${c.phase}:${c.week}:${c.cond}:${c.skills.length}:${Math.round(c.stats.hit)}`;
  if (k !== cacheKey || !cacheVal) {
    cacheKey = k;
    cacheVal = setupOf(c);
  }
  return cacheVal;
}

function StandingsTable({ rows, compact }: { rows: ReturnType<typeof standings>; compact?: boolean }) {
  const top = rows[0];
  const py = compact ? "py-0.5" : "py-1.5";
  return (
    <div className={`overflow-hidden rounded-xl border border-white/10 bg-black/30 ${compact ? "text-[12.5px]" : "text-[14px]"}`}>
      <div className={`grid grid-cols-[34px_1fr_36px_36px_52px_44px] px-2 ${py} text-[11px] text-white/45`}>
        <span>순위</span>
        <span className="text-left">팀</span>
        <span>승</span>
        <span>패</span>
        <span>승률</span>
        <span>차</span>
      </div>
      {rows.map((r) => (
        <div key={r.i} className={`grid grid-cols-[34px_1fr_36px_36px_52px_44px] items-center px-2 ${py} font-mono`} style={r.i === 0 ? { background: `${r.color}26`, boxShadow: `inset 3px 0 0 ${r.color}` } : undefined}>
          <b style={{ color: r.rank === 1 ? "#ffd23f" : r.color }}>{r.rank}</b>
          <span className="truncate text-left font-['Nanum_Gothic'] font-bold" style={{ color: r.i === 0 ? r.color : "#fff" }}>
            {r.name}
          </span>
          <span>{r.w}</span>
          <span>{r.l}</span>
          <span>{fmtAvg(r.pct)}</span>
          <span className="text-white/60">{r.rank === 1 ? "-" : ((top.w - r.w + (r.l - top.l)) / 2).toFixed(1)}</span>
        </div>
      ))}
    </div>
  );
}
function StandingsModal({ c, onClose }: { c: Career; onClose: () => void }) {
  return (
    <Modal w={500} onClose={onClose}>
      <div className={`${font.title} text-[26px]`}>라이징스타 리그 순위</div>
      <div className="mt-3">
        <StandingsTable rows={standings(c)} />
      </div>
      <div className="mt-2 text-[12px] text-white/55">
        정규 {WEEKS}주 · 주마다 한 경기 · 1위는 2위와 챔피언 결정전 · 지금 {c.wins}승 {c.losses}패
      </div>
      <Btn space className={`${font.title} mt-4 px-8 py-2 text-lg`} color="#7dff9a" onClick={onClose}>
        닫기
      </Btn>
    </Modal>
  );
}

/* ─────────────── 경기 평가 · 주차 결산 ─────────────── */

function ReportModal({ c, r, more, onClose }: { c: Career; r: GameReport; more: number; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const s = r.sum;
  const g = s.grade !== undefined ? GAME_GRADES[s.grade] : undefined;
  const d = s.delta;
  const PA_COLOR: Record<string, string> = { HR: "#ffd23f", HIT: "#7dff9a", BB: "#7ad7ff", K: "#ff8a8a" };
  const race = c.line.g >= 2 ? awardRace(c)[0] : null;
  const L = c.line;
  if (page === 1 && s.week) {
    const wk = s.week;
    return (
      <Modal w={620} onClose={onClose}>
        <Banner color="#4fb0ff">{wk.label} 결산</Banner>
        <div className="mt-4 flex flex-col gap-2 text-left">
          {STAT_KEYS.map((k) => {
            const v = wk.stats[k];
            const gn = wk.gain[k] ?? 0;
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="w-[44px] text-[14px] font-bold" style={{ color: STAT_COLOR[k] }}>
                  {STAT_NAME[k]}
                </span>
                <span className={`${font.title} w-[22px] text-[17px]`} style={{ color: statGrade(v).color }}>
                  {statGrade(v).g}
                </span>
                <div className="relative h-[14px] flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, ((v - gn) / 999) * 100)}%`, background: STAT_COLOR[k] }} />
                  <div className="absolute inset-y-0 rounded-r-full" style={{ left: `${Math.min(100, ((v - gn) / 999) * 100)}%`, width: `${(gn / 999) * 100}%`, background: "#ffe680" }} />
                </div>
                <span className="w-[38px] text-right font-mono text-[15px] font-bold">{Math.round(v)}</span>
                <span className="w-[46px] text-right font-mono text-[14px] font-bold text-[#ffe680]">{gn ? `▲${gn}` : ""}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-[13px] text-white/70">
          팀 {myRank(c)}위 · {c.wins}승 {c.losses}패 · 타율 {fmtAvg(avg(L))} · {L.hr}홈런 · {L.rbi}타점{L.sb ? ` · ${L.sb}도루` : ""}
        </div>
        {s.next === "final" && <div className={`${font.title} mt-2 text-[22px] text-[#ffd23f]`}>🏆 챔피언 결정전 진출! 보너스 행동권 {FINAL_TICKETS}장</div>}
        {s.next === "end" && <div className={`${font.title} mt-2 text-[20px] text-[#ffd23f]`}>시즌 끝 — 결산으로!</div>}
        <Btn space className={`${font.title} mt-4 w-full py-2.5 text-[20px]`} onClick={onClose}>
          {more ? `다음 경기 결과 ▶ ${more}` : "확인"}
        </Btn>
      </Modal>
    );
  }
  return (
    <Modal w={780} onClose={() => (s.week ? setPage(1) : onClose())}>
      <Banner color={g?.color ?? "#9aa3c2"}>경기 평가</Banner>
      <div className="mt-3 flex items-center justify-center gap-5">
        {g && (
          <div className="flex flex-col items-center">
            <span className={`${font.title} text-[68px] leading-none`} style={{ color: g.color, textShadow: `0 0 24px ${g.color}66` }}>
              {g.g}
            </span>
            <span className="text-[13px] font-bold" style={{ color: g.color }}>
              {g.label}
            </span>
          </div>
        )}
        <div className="text-left">
          <div className={`${font.title} text-[28px] leading-tight`} style={{ color: s.win ? "#ffd23f" : s.win === false ? "#ff9a9a" : "#fff" }}>
            {s.dnp ? "결장" : s.win ? "팀 승리!" : s.win === false ? "팀 패배" : "무승부"}
          </div>
          <div className="font-mono text-[16px] text-white/75">{r.score}</div>
          <div className="text-[11.5px] text-white/45">
            {r.auto ? "자동 진행" : "직접 출전"}
            {r.note ? ` · ${r.note}` : ""}
          </div>
          {g && (
            <div className="mt-1 flex gap-[3px]">
              {[...GAME_GRADES].reverse().map((x, i) => (
                <div key={x.g} className="h-[8px] w-[34px] rounded-full" style={{ background: 4 - i >= s.grade! ? x.color : "rgba(255,255,255,0.1)" }} />
              ))}
            </div>
          )}
        </div>
      </div>
      {!s.dnp && (
        <div className="mt-3 flex gap-3 text-left">
          <div className="flex w-[300px] shrink-0 flex-col gap-1">
            <div className="text-[12px] font-bold text-white/60">내 타석</div>
            {r.pas.length ? (
              r.pas.map((pa, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border px-2 py-0.5 text-[12.5px]" style={{ borderColor: pa.kind === "HR" ? "#ffd23f88" : "rgba(255,255,255,0.1)", background: pa.kind === "HR" ? "#ffd23f14" : "rgba(0,0,0,0.25)", opacity: pa.auto ? 0.7 : 1 }}>
                  <span className="w-[30px] text-white/50">{pa.inning}회</span>
                  <span className="flex-1 font-bold" style={{ color: PA_COLOR[pa.kind] ?? "#fff" }}>
                    {pa.text}
                    {pa.rbi ? ` ${pa.rbi}타점` : ""}
                  </span>
                  {pa.mission && <span className={pa.mission.ok ? "text-[11px] text-[#ffd23f]" : "text-[11px] text-white/40"}>{pa.mission.ok ? "미션✓" : pa.mission.partial ? "미션△" : "미션✗"}</span>}
                </div>
              ))
            ) : (
              <div className="rounded-lg bg-black/25 px-2 py-2 text-[12.5px] text-white/50">기록 없음</div>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1.5 rounded-xl border-2 border-[#5fc8ff]/30 bg-black/25 p-2.5">
            <div className="text-[12px] font-bold text-white/60">보상</div>
            <div className="flex flex-wrap gap-1.5 text-[12px] font-bold">
              {d.sp > 0 && <span className="rounded-md bg-[#c9a2ff22] px-2 py-0.5 text-[#c9a2ff]">스킬P +{d.sp}</span>}
              {d.money > 0 && <span className="rounded-md bg-[#ffd23f22] px-2 py-0.5 text-[#ffd23f]">자금 +{d.money}만</span>}
              {d.cond !== 0 && <span className="rounded-md bg-white/10 px-2 py-0.5">컨디션 {d.cond > 0 ? "▲" : "▼"}</span>}
              {d.stamina !== 0 && <span className="rounded-md bg-white/10 px-2 py-0.5">체력 {d.stamina > 0 ? "+" : ""}{d.stamina}</span>}
            </div>
            {s.exp && Object.keys(s.exp).length > 0 && (
              <>
                <div className="text-[12px] font-bold text-white/60">실전 경험</div>
                <div className="flex flex-wrap gap-1.5">
                  {STAT_KEYS.filter((k) => s.exp![k]).map((k) => (
                    <span key={k} className="rounded-md px-2 py-0.5 text-[12px] font-bold" style={{ background: `${STAT_COLOR[k]}22`, color: STAT_COLOR[k] }}>
                      {STAT_NAME[k]} ▲{s.exp![k]}
                    </span>
                  ))}
                </div>
              </>
            )}
            {s.lines.length > 0 && (
              <div className="flex flex-col gap-0.5 text-[12px] text-white/75">
                {s.lines.map((l, i) => (
                  <div key={i} className={l.startsWith("시즌 미션") || l.startsWith("🏆") ? "font-bold text-[#ffd23f]" : undefined}>
                    {l}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {s.dnp && <div className="mt-3 text-[13px] text-white/70">{s.lines.join(" · ")}</div>}
      <div className="mt-2 text-left">
        <StoryLines c={c} lines={postGame(c, s)} />
      </div>
      {race && (
        <div className="mt-2 rounded-lg border px-2.5 py-1 text-[12px]" style={{ borderColor: race.lead ? "#ffd23f" : "rgba(255,255,255,0.2)" }}>
          👑 {race.title} 레이스 <b style={{ color: race.lead ? "#ffd23f" : "#fff" }}>{race.lead ? "1위 페이스!" : `1위 페이스와 ${race.fmt(Math.abs(race.gap))} 차`}</b>
        </div>
      )}
      <Btn space className={`${font.title} mt-3 w-full py-2.5 text-[20px]`} onClick={() => (s.week ? setPage(1) : onClose())}>
        {s.week ? "주차 결산 ▶" : "확인"}
      </Btn>
    </Modal>
  );
}

/* ─────────────── 상점 · 스킬 · 기록 ─────────────── */

function SkillShopModal({ c, onClose, onBuy }: { c: Career; onClose: () => void; onBuy: (id: SkillId) => void }) {
  const list = skillShop(c);
  const tc = tagCount(c);
  return (
    <Modal w={800} onClose={onClose}>
      <div className="flex items-center justify-between">
        <div className={`${font.title} text-[26px]`}>✨ 스킬 습득</div>
        <div className="text-right">
          <div className="font-mono text-[16px] font-bold text-[#c9a2ff]">SP {c.sp}</div>
          <div className="text-[11px] text-white/50">진열은 주마다 바뀌어요 · 행동권 안 써요</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {list.map((id) => {
          const s = skill(id);
          const col = s.risk ? "#ffb070" : s.tag ? TAG_COLOR[s.tag] : "#fff";
          const price = skillPrice(c, id);
          const have = s.tag ? tc[s.tag] ?? 0 : 0;
          return (
            <div key={id} className="flex min-h-[150px] flex-col items-center justify-between rounded-2xl border-2 bg-[#0b0e1c] p-2.5" style={{ borderColor: `${col}aa` }}>
              <span className="rounded px-2 py-0.5 text-[11px] font-bold" style={{ background: `${col}22`, color: col }}>
                {s.risk ? "양날" : s.tag ? `${TAG_NAME[s.tag]} ${have}/${SET_NEED}` : ""}
              </span>
              <span className={`${font.title} text-[20px]`} style={{ color: col }}>
                {s.name}
              </span>
              <span className="text-[12px] text-white/80">{s.desc}</span>
              <Btn className="mt-1 w-full py-1 text-[13px]" color="#c9a2ff" disabled={c.sp < price} onClick={() => onBuy(id)}>
                SP {price}
              </Btn>
            </div>
          );
        })}
        {!list.length && <div className="col-span-3 py-6 text-white/50">이번 주 진열을 다 배웠어요!</div>}
      </div>
      {c.skills.length > 0 && (
        <div className="mt-3 text-left">
          <div className="text-[12px] font-bold text-white/60">가진 특수능력</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {c.skills.map((id) => (
              <SkillChip key={id} id={id} />
            ))}
          </div>
        </div>
      )}
      <div className="mt-2 text-[11.5px] text-white/45">같은 태그 {SET_NEED}장이면 세트 효과 · 많이 가질수록 값이 올라요 · SP는 훈련 · 경기 평가 · 시즌 미션으로</div>
      <Btn space className="mt-3 w-full py-2" color="#8b93b8" onClick={onClose}>
        닫기
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
        <div className={`${font.title} text-[26px]`}>🛒 상점</div>
        <div className="text-right">
          <div className="font-mono text-[15px] font-bold text-[#ffd23f]">💰 {c.money.toLocaleString()}만원</div>
          <div className="text-[11px] text-white/50">행동권 안 써요</div>
        </div>
      </div>
      <div className="mt-2 text-left text-[13px] font-bold text-white/70">장비 — 그 훈련 효율 + 경기 능력치</div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {GEAR_IDS.map((id) => {
          const g = GEAR[id];
          const cur = c.gear[id] ?? 0;
          const n = gearNext(c, id);
          return (
            <div key={id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left">
              <span className="text-[24px]">{g.icon}</span>
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
                {n && <div className="text-[11px] text-white/45">다음: {n.name} (+{Math.round(n.train * 100)}% · +{n.game})</div>}
              </div>
              <Btn className="w-[86px] py-1 text-[12px]" color="#ffd23f" disabled={!n || !!n.why} onClick={() => onBuyGear(id)}>
                {!n ? "최고 단계" : `${n.price.toLocaleString()}만`}
              </Btn>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-left text-[13px] font-bold text-white/70">
        소모품 — 턴마다 하나만{c.usedItem ? <span className="text-[#ff9a7a]"> · 이번 턴엔 이미 씀</span> : null}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {CONSUMABLE_IDS.map((id) => {
          const it = CONSUMABLES[id];
          const have = c.bag[id] ?? 0;
          return (
            <div key={id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left">
              <span className="text-[24px]">{it.icon}</span>
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
              <Btn className="w-[72px] py-1 text-[12px]" color="#ffd23f" disabled={c.money < it.price} onClick={() => onBuy(id)}>
                {it.price}만
              </Btn>
            </div>
          );
        })}
      </div>
      {c.charmNext && <div className="mt-2 text-[12px] text-[#ffd23f]">행운의 부적 효과 중 — 다음 훈련 대성공 ↑</div>}
      <Btn space className="mt-3 w-full py-2" color="#8b93b8" onClick={onClose}>
        닫기
      </Btn>
    </Modal>
  );
}

function RecordsModal({ c, onClose }: { c: Career; onClose: () => void }) {
  const L = c.line;
  const gs = careerGameStats(c).stats;
  return (
    <Modal w={720} onClose={onClose}>
      <div className={`${font.title} text-[26px]`}>{c.name} 기록</div>
      <div className="mt-2 grid grid-cols-9 gap-1 rounded-xl bg-black/30 py-2 font-mono text-[13px]">
        {[
          ["경기", L.g],
          ["타율", fmtAvg(avg(L))],
          ["안타", L.h],
          ["홈런", L.hr],
          ["타점", L.rbi],
          ["도루", L.sb],
          ["호수비", L.df],
          ["볼넷", L.bb],
          ["OPS", ops(L).toFixed(3)],
        ].map(([k, v]) => (
          <div key={k as string}>
            <div className="font-['Nanum_Gothic'] text-[11px] text-white/45">{k}</div>
            <div className="text-[15px] font-bold">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {STAT_KEYS.map((k) => (
          <div key={k} className="rounded-xl border-2 px-2 py-1" style={{ borderColor: `${STAT_COLOR[k]}66` }}>
            <div className="text-[12px] font-bold" style={{ color: STAT_COLOR[k] }}>
              {STAT_NAME[k]} {Math.round(c.stats[k])}
            </div>
            <div className="text-[11px] text-white/55">
              경기에선 {gs[k]} · 훈련 {c.tCount[k]}번 · Lv{trainLv(c, k)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-left text-[12px] text-white/60">
        팀 {c.wins}승 {c.losses}패 · {myRank(c)}위 · 특수능력 {c.skills.length}개{c.learned ? ` · 필살 「${charById(c.learned).swing.name}」 Lv${spLv(c)} 종합 +${LEARNED_VAL}~` : ""}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {c.skills.map((id) => (
          <SkillChip key={id} id={id} />
        ))}
      </div>
      <div className="mt-2 max-h-[120px] overflow-y-auto rounded-lg bg-black/30 px-2 py-1 text-left text-[12px] text-white/65">
        {c.log.slice(0, 20).map((l, i) => (
          <div key={i}>· {l}</div>
        ))}
      </div>
      <Btn space className="mt-3 w-full py-2" color="#8b93b8" onClick={onClose}>
        닫기
      </Btn>
    </Modal>
  );
}

/* ─────────────── 시즌 결산 · 명예의 전당 ─────────────── */

function SeasonEnd({ c, onHome, onNew, onHof, onEpilogue }: { c: Career; onHome: () => void; onNew: () => void; onHof: () => void; onEpilogue: () => void }) {
  const s = c.summary;
  if (!s) return null;
  const L = s.line;
  const sg = L.ab ? seasonGrade(L) : null;
  const rb = RESULT_BADGE[s.result];
  return (
    <div className="flex h-full items-center justify-center gap-6 px-8">
      <div className="flex flex-col items-center">
        <div className="rounded-2xl bg-gradient-to-b from-[#ffd23f]/25 to-transparent p-2">
          <Portrait c={c} w={170} h={220} />
        </div>
        <div className={`${font.title} mt-1 text-[28px]`}>{c.name}</div>
        <div className="text-[13px] text-white/60">
          #{c.num} · {TYPES[c.type].name} · {posOf(c)}
        </div>
        {rb && (
          <div className={`${font.title} mt-1 text-[20px]`} style={{ color: rb.col }}>
            {rb.t}
          </div>
        )}
      </div>
      <div className="flex w-[580px] flex-col gap-2">
        <Banner color="#ffb020">시즌 결산</Banner>
        <div className="flex items-end gap-4">
          <span className={`${font.title} text-[92px] leading-none`} style={{ color: s.grade.color, textShadow: `0 0 30px ${s.grade.color}66` }}>
            {s.grade.g}
          </span>
          <div className="pb-2">
            <div className={`${font.title} text-[44px] leading-none`}>{s.ovr}</div>
            <div className="text-[15px] text-[#ffd23f]">상위 {s.top < 1 ? s.top.toFixed(1) : Math.round(s.top)}%</div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1 pb-2">
            {s.nick.slice(0, 3).map((n) => (
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
              <div key={k} className="rounded-xl border-2 bg-black/30 px-2 py-1 text-center" style={{ borderColor: `${STAT_COLOR[k]}66` }}>
                <div className="text-[11px] font-bold" style={{ color: STAT_COLOR[k] }}>
                  {STAT_NAME[k]}
                </div>
                <div className={`${font.title} text-[22px] leading-none`} style={{ color: g.color }}>
                  {g.g} <span className="font-mono text-[16px] text-white">{v}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-black/30 px-3 py-2">
          <div className="flex-1 font-mono text-[13px]">
            {L.g}경기 · 타율 {fmtAvg(avg(L))} · {L.h}안타 · {L.hr}홈런 · {L.rbi}타점 · {L.sb}도루 · OPS {ops(L).toFixed(3)}
            <div className="font-['Nanum_Gothic'] text-[12px] text-white/60">
              시즌 미션 {s.missions.filter((m) => m.done).length}/{s.missions.length}
              {s.missions.length ? ` — ${s.missions.map((m) => `${m.done ? "✓" : "✗"}${m.name}`).join(" · ")}` : ""}
            </div>
          </div>
          {sg && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-white/50">시즌 성적</span>
              <span className={`${font.title} text-[30px] leading-none`} style={{ color: sg.color }}>
                {sg.g}
              </span>
            </div>
          )}
        </div>
        {s.awards.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {s.awards.map((a) => (
              <span key={a} className={`${font.title} rounded-lg bg-[#ffd23f] px-3 py-1 text-[17px] text-black`}>
                🏆 {a}
              </span>
            ))}
          </div>
        )}
        {s.partner && (
          <button type="button" onClick={onEpilogue} className="flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-left" style={{ borderColor: charById(s.partner).color, background: `${charById(s.partner).color}1c` }}>
            <img src={faceUrl(s.partner)} alt="" className="h-[40px] w-[38px] rounded-md object-cover object-top" />
            <span className="flex-1 text-[13px]">
              <b style={{ color: charById(s.partner).color }}>파트너 {charById(s.partner).name}</b> — 에필로그 보기 ▶
            </span>
          </button>
        )}
        <div className="text-[12px] text-white/45">명예의 전당에 올라갔어요 · 덱 사람들 인연 레벨이 쌓였어요 · 이 선수의 특수능력 하나를 다음 선수에게 「선배의 유산」으로 물려줄 수 있어요.</div>
        <div className="mt-1 flex gap-2">
          <Btn space className={`${font.title} flex-1 py-3 text-xl`} onClick={onNew}>
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
              {["#", "등급", "종합", "이름", "타입", "별명", "타격", "파워", "주루", "수비", "기록"].map((h, i) => (
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
                  <td className="px-2 text-white/65">{TYPES[e.type]?.name ?? e.type}</td>
                  <td className="px-2 text-white/80">「{e.nick}」</td>
                  {STAT_KEYS.map((k) => (
                    <td key={k} className="px-2 font-mono" style={{ color: e.stats[k] !== undefined ? statGrade(e.stats[k]!).color : "rgba(255,255,255,0.3)" }}>
                      {e.stats[k] ?? "-"}
                    </td>
                  ))}
                  <td className="px-2 text-white/65">
                    <span className="font-mono">
                      {fmtAvg(e.avg)} · {e.hr}HR
                    </span>
                    {e.result && <span className="ml-1 text-[11px] text-[#ffd23f]">{e.result === "우승" ? "🏆" : e.result}</span>}
                    {e.awards && e.awards.length > 0 && <span className="ml-1 text-[11px] text-[#ffd23f]">{e.awards.join(" · ")}</span>}
                    {!e.result && e.seasons > 1 && <span className="ml-1 text-[11px] text-white/40">{e.seasons}년</span>}
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={11} className="py-10 text-center text-white/45">
                  아직 아무도 없어요. 한 시즌을 끝까지 치르면 여기에 올라가요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
