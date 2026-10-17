"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "@/lib/AuthContext";
import { depthMul, ENEMIES, FREE_HEROES, GRADE_FLOOR, HEROES, HERO_IDS, isStage, MAX_DEPTH, PASSIVES, RUN_SEC, SHARED_WEAPONS, STAGES, STAGE_IDS, WEAPONS, powerBonus, type EnemyKind, type HeroId, type StageId, type Stats } from "@/lib/survivor/data";
import { TEAM_BONUS, TEAM_NAME, TEAM_OF, UPGRADES, supportBonus, upBonus, upCost, type UpId } from "@/lib/survivor/progress";
import { FEAT_NAME, QUEST, QUESTS, unlocksOf, type QuestDef, type QuestReward } from "@/lib/survivor/quests";
import { RELICS, RELIC_IDS, RELIC_RARITY_COLOR, RELIC_RARITY_NAME } from "@/lib/survivor/relics";
import type { RunResult } from "@/lib/survivor/sim";
import { survivor, type FinishOut, type SurvivorProfile } from "@/realtime/survivor";
import { charUpNeed } from "@/lib/marble/gacha";
import { MAX_LV } from "@/lib/marble/data";
import { marble } from "@/realtime/marble";
import Token from "../Marble/Token";
import { playBgm, sfx } from "./audio";
import Game, { ItemIcon, type GameSetup } from "./Game";
import Stage from "./Stage";
import Summon, { GRADE_COL } from "./Summon";
import { ARMY_GRADE_COLOR, UNIT } from "@/lib/survivor/army";

type Scene = { k: "title" } | { k: "pick"; summon?: boolean } | { k: "play"; setup: GameSetup; run: string | null } | { k: "result"; r: RunResult; fin: FinishOut | null; err: string };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const TEAM_KEY = "pts-team";
const STAGE_KEY = "pts-stage";
/** 이 맵에서 클리어한 가장 깊은 밤 (-1 = 아직) */
const depthOf = (prof: SurvivorProfile | null, st: StageId) => prof?.depths?.[st] ?? (st === "town" ? (prof?.depth ?? -1) : -1);
const stageOpen = (prof: SurvivorProfile | null, st: StageId) => {
  const need = STAGES[st].need;
  return !need || depthOf(prof, need) >= 0;
};

function addAll(...xs: Partial<Stats>[]): Partial<Stats> {
  const o: Partial<Stats> = {};
  for (const x of xs) for (const [k, v] of Object.entries(x) as [keyof Stats, number][]) o[k] = (o[k] ?? 0) + v;
  return o;
}

export default function SurvivorApp() {
  const { profile: account } = useAuth();
  const member = !!account;
  const [scene, setScene] = useState<Scene>({ k: "title" });
  const [prof, setProf] = useState<SurvivorProfile | null>(null);
  const [team, setTeam] = useState<{ main: HeroId; sup: HeroId[] }>({ main: "kai", sup: [] });
  const [depth, setDepth] = useState(0);
  const [stage, setStageRaw] = useState<StageId>("town");
  /** 럭키 출격 (실험) — 기록 · 보상 없이 혼자 */
  const [army, setArmyRaw] = useState(false);
  const setArmy = (v: boolean) => {
    setArmyRaw(v);
    try {
      localStorage.setItem("pts-army", v ? "1" : "");
    } catch {}
  };
  const setStage = (st: StageId) => {
    setStageRaw(st);
    setDepth(0);
    try {
      localStorage.setItem(STAGE_KEY, st);
    } catch {}
  };
  const [note, setNote] = useState("");
  useEffect(() => {
    try {
      const t = JSON.parse(localStorage.getItem(TEAM_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 지난 편성 불러오기 (브라우저에서만)
      if (t?.main && HEROES[t.main as HeroId]) setTeam({ main: t.main, sup: (t.sup ?? []).filter((h: HeroId) => HEROES[h]).slice(0, 2) });
      const st = localStorage.getItem(STAGE_KEY);
      if (isStage(st)) setStageRaw(st);
      if (localStorage.getItem("pts-army")) setArmyRaw(true);
    } catch {}
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그아웃하면 프로필 비움
    if (!member) return setProf(null);
    void survivor.profile().then(setProf, (e) => setNote((e as Error).message));
  }, [member]);
  useEffect(() => {
    if (scene.k !== "play") playBgm("night");
    // 페이지를 떠나면 음악도 끔
    return () => playBgm(null);
  }, [scene.k]);
  const owned = useCallback((h: HeroId) => FREE_HEROES.includes(h) || !!prof?.chars[h], [prof]);
  const saveTeam = (t: { main: HeroId; sup: HeroId[] }) => {
    setTeam(t);
    try {
      localStorage.setItem(TEAM_KEY, JSON.stringify(t));
    } catch {}
  };

  const runRef = useRef<string | null>(null);
  const start = async () => {
    sfx("click");
    setNote("");
    const main = owned(team.main) ? team.main : "kai";
    const sup = team.sup.filter((h) => h !== main && owned(h)).slice(0, 2);
    const lvOf = (h: HeroId) => prof?.chars[h]?.lv ?? 0;
    const ub = upBonus(prof?.ups ?? {});
    const sb = supportBonus(main, sup);
    const un = unlocksOf(prof?.quests ?? []);
    const st = stageOpen(prof, stage) ? stage : "town";
    const d = Math.max(0, Math.min(depth, depthOf(prof, st) + 1));
    const setup: GameSetup = {
      hero: main,
      sup,
      seed: Math.floor(Math.random() * 2 ** 31),
      bonus: addAll(powerBonus(HEROES[main].grade, lvOf(main)), ub.stats, sb.stats),
      opts: { sup, revive: ub.revive, rerolls: un.rerolls + ub.rerolls, skips: un.skips, banish: un.banish, gold: un.gold, weapons: un.weapons, relics: un.relics, depth: d, stage: st, army },
    };
    let run: string | null = null;
    if (member && !army) {
      try {
        run = (await survivor.start(main, sup, d, st)).run;
      } catch (e) {
        setNote((e as Error).message);
        return;
      }
    }
    runRef.current = run;
    setScene({ k: "play", setup, run });
  };
  const onEnd = useCallback((r: RunResult) => {
    const run = runRef.current;
    setScene({ k: "result", r, fin: null, err: "" });
    if (!run) return;
    void survivor.finish(run, { sec: r.sec, kills: r.kills, lv: r.lv, win: r.win, ot: r.ot, q: r.q }).then(
      (fin) => {
        setScene((s) => (s.k === "result" ? { ...s, fin } : s));
        setProf((p) => (p ? { ...p, ...fin.profile, stars: p.stars + fin.stars + fin.qStars } : p));
      },
      (e) => setScene((s) => (s.k === "result" ? { ...s, err: (e as Error).message } : s))
    );
  }, []);
  const onQuit = useCallback(() => setScene({ k: "pick" }), []);
  return (
    <Stage>
      {scene.k === "title" && <Title onStart={() => setScene({ k: "pick" })} />}
      {scene.k === "pick" && <Pick army={army} onArmy={setArmy} summon={!!scene.summon} stage={stageOpen(prof, stage) ? stage : "town"} onStage={setStage} prof={prof} member={member} team={team} owned={owned} note={note} depth={depth} onDepth={setDepth} onTeam={saveTeam} onStart={() => void start()} onBack={() => setScene({ k: "title" })} onProf={setProf} />}
      {scene.k === "play" && <Game key={scene.setup.seed} setup={scene.setup} onEnd={onEnd} onQuit={onQuit} />}
      {scene.k === "result" && <Result r={scene.r} fin={scene.fin} err={scene.err} member={member} stars={prof?.stars ?? 0} onAgain={() => void start()} onPick={() => setScene({ k: "pick" })} onSummon={() => setScene({ k: "pick", summon: true })} />}
    </Stage>
  );
}

/* ───────────── 제목 ───────────── */

function Title({ onStart }: { onStart(): void }) {
  return (
    <div className="absolute inset-0 bg-[#0d0a26]">
      <img src="/survivor/title.webp" alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 32%, rgba(7,5,26,0.35), rgba(7,5,26,0) 55%), linear-gradient(180deg, rgba(7,5,26,0) 60%, rgba(7,5,26,0.55))" }} />
      <div className="absolute inset-x-0 top-[40px] flex flex-col items-center">
        <span className="pts-sub text-[14px] tracking-[6px] text-[#4ff0c8]">새벽까지 버텨라</span>
        <img src="/survivor/logo.png" alt="PIXEL TOWN SURVIVOR" className="pts-drop mt-[6px] w-[560px]" style={{ imageRendering: "pixelated" }} draggable={false} />
        <span className="pts-sub mt-[2px] text-[15px]">픽셀 타운 서바이버</span>
      </div>
      <div className="absolute inset-x-0 bottom-[70px] flex flex-col items-center">
        <button type="button" onClick={onStart} className="pts-btn h-[54px] w-[260px] text-[22px]" style={{ "--c": "#ff4fa3", "--t": "#fff" } as CSSProperties}>
          시작하기
        </button>
        <span className="pts-sub pts-blink mt-[14px] text-[12px] text-[#e8e4ff]">WASD 이동 · SPACE 대시 · E 필살기</span>
      </div>
    </div>
  );
}

/* ───────────── 편성 (메인 1 + 응원 동료 2) ───────────── */

function Pick({
  army,
  onArmy,
  summon: summonFirst,
  stage,
  onStage,
  prof,
  member,
  team,
  owned,
  note,
  depth,
  onDepth,
  onTeam,
  onStart,
  onBack,
  onProf,
}: {
  army: boolean;
  onArmy(v: boolean): void;
  summon: boolean;
  stage: StageId;
  onStage(st: StageId): void;
  prof: SurvivorProfile | null;
  member: boolean;
  team: { main: HeroId; sup: HeroId[] };
  owned(h: HeroId): boolean;
  note: string;
  depth: number;
  onDepth(d: number): void;
  onTeam(t: { main: HeroId; sup: HeroId[] }): void;
  onStart(): void;
  onBack(): void;
  onProf(p: SurvivorProfile): void;
}) {
  const [look, setLook] = useState<HeroId>(team.main);
  const [slot, setSlot] = useState(0);
  const [shop, setShop] = useState(false);
  const [quests, setQuests] = useState(false);
  const [summon, setSummon] = useState(summonFirst);
  const [upErr, setUpErr] = useState("");
  const [maps, setMaps] = useState(false);
  const maxDepth = Math.min(MAX_DEPTH, depthOf(prof, stage) + 1);
  const st = STAGES[stage];
  const h = HEROES[look];
  const w = WEAPONS[h.weapon];
  const lv = prof?.chars[look]?.lv ?? 0;
  const can = owned(look);
  const card = prof?.chars[look];
  const need = card ? charUpNeed(card.lv) : 0;
  const levelUp = async () => {
    if (!prof || !card) return;
    setUpErr("");
    try {
      const w = await marble.charUp(look);
      onProf({ ...prof, chars: w.chars, stars: w.stars });
      sfx("levelup");
    } catch (e) {
      setUpErr((e as Error).message);
    }
  };
  const sb = supportBonus(team.main, team.sup);
  const put = (id: HeroId) => {
    sfx("click");
    setLook(id);
    if (!owned(id)) return;
    if (slot === 0) {
      onTeam({ main: id, sup: team.sup.filter((x) => x !== id) });
    } else {
      const sup = [...team.sup.filter((x) => x !== id)];
      if (id === team.main) return;
      sup[slot - 1] = id;
      onTeam({ main: team.main, sup: sup.filter(Boolean).slice(0, 2) });
      setSlot(0);
    }
  };
  return (
    <div className="absolute inset-0 bg-[#0d0a26]">
      <img src={stage === "clock" ? "/survivor/stage/clock-full.webp" : "/survivor/title.webp"} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" draggable={false} />
      <div className="absolute top-[14px] right-[18px] left-[18px] flex items-center gap-[12px]">
        <button type="button" onClick={onBack} className="pts-btn ghost h-[30px] px-[10px] text-[12px]">
          ◀ 처음으로
        </button>
        <b className="pts-title text-[22px]">누구로 버틸까?</b>
        <span className="ml-auto flex items-center gap-[12px] text-[13px]">
          {member ? (
            <>
              <span className="pts-sub text-[#ffd23a]">● 코인 {(prof?.gold ?? 0).toLocaleString()}</span>
              <span className="pts-sub text-[#ff9cc8]">★ 별사탕 {(prof?.stars ?? 0).toLocaleString()}</span>
              <button type="button" onClick={() => setQuests(true)} className="pts-btn h-[30px] px-[12px] text-[12px]" style={{ "--c": "#ffd23a" } as CSSProperties}>
                퀘스트 {prof ? `${prof.quests.length}/${QUESTS.length}` : ""}
              </button>
              <button type="button" onClick={() => setShop(true)} className="pts-btn h-[30px] px-[12px] text-[12px]" style={{ "--c": "#4ff0c8" } as CSSProperties}>
                영구 강화
              </button>
              <button type="button" onClick={() => setSummon(true)} className="pts-btn h-[30px] px-[12px] text-[12px]" style={{ "--c": "#ff9cc8" } as CSSProperties}>
                ★ 별빛 소환
              </button>
            </>
          ) : (
            <span className="pts-sub text-[#a9a2d6]">로그인하면 다이스 타운 캐릭터 · 보상 · 랭킹 · 영구 강화</span>
          )}
        </span>
      </div>

      {/* 캐릭터 16명 */}
      <div className="absolute top-[58px] bottom-[12px] left-[14px] grid w-[460px] grid-cols-4 content-start gap-[8px] overflow-y-auto p-[4px]">
        {HERO_IDS.map((id) => {
          const x = HEROES[id];
          const own = owned(id);
          const inTeam = id === team.main ? "메인" : team.sup.includes(id) ? "동료" : "";
          return (
            <button
              key={id}
              type="button"
              onClick={() => put(id)}
              onMouseEnter={() => setLook(id)}
              className="relative flex h-[104px] flex-col items-center justify-end overflow-hidden pb-[4px]"
              style={{ background: own ? "linear-gradient(180deg,#221b58,#16123d)" : "#100c2c", boxShadow: `0 0 0 2px ${look === id ? "#fff" : GRADE_COL[x.grade]}, 0 0 0 4px #07051a` }}
            >
              <span className="absolute top-[3px] left-[4px] text-[10px] font-bold" style={{ color: GRADE_COL[x.grade] }}>
                {x.grade}
              </span>
              {own && prof?.chars[id] && <span className="absolute top-[3px] right-[4px] text-[10px] text-[#ffd23a]">+{prof.chars[id].lv}</span>}
              <div className="flex h-[72px] items-end" style={{ filter: own ? undefined : "brightness(0.15) saturate(0)" }}>
                <Token sprite={x.sprite} anim={look === id && own ? "walk" : "idle"} h={64} />
              </div>
              <span className="text-[11px] leading-[14px]" style={{ color: own ? "#fff" : "#6b63a3" }}>
                {own ? x.title : "? ? ?"}
              </span>
              {!own && <span className="absolute top-[34px] text-[18px]">🔒</span>}
              {inTeam && <span className="pts-tag absolute top-[22px] text-[10px]" style={inTeam === "동료" ? { background: "#4ff0c8" } : undefined}>{inTeam}</span>}
            </button>
          );
        })}
      </div>

      {/* 자세히 + 편성 */}
      <div className="pts-win absolute top-[58px] right-[18px] bottom-[16px] left-[488px] flex flex-col px-[16px] py-[12px]">
        <div className="flex min-h-0 flex-1 gap-[14px]">
          <div className="flex w-[140px] shrink-0 flex-col items-center justify-end">
            <div style={{ filter: can ? undefined : "brightness(0.15) saturate(0)" }}>
              <Token sprite={h.sprite} anim="walk" h={140} />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[7px] text-[12.5px]">
            <div>
              <span className="text-[11px] font-bold" style={{ color: GRADE_COL[h.grade] }}>
                {h.grade} · {h.title}
              </span>
              <b className="pts-title ml-[8px] text-[24px]" style={{ color: h.color }}>
                {h.name}
              </b>
              {can && <span className="ml-[6px] text-[11px] text-[#ffd23a]">강화 +{lv} · 기본 피해 +{Math.round((GRADE_FLOOR[h.grade] + lv) * 1.5)}%</span>}
            </div>
            <div className="flex items-start gap-[8px]">
              <ItemIcon k="weapon" id={h.weapon} size={30} />
              <div>
                <span className="pts-tag text-[10px]">고유 무기</span> <b>{w.name}</b>
                <p className="text-[#e8e4ff]">{w.desc[0]}</p>
              </div>
            </div>
            <div>
              <span className="pts-tag text-[10px]" style={{ background: "#ff4fa3", color: "#fff" }}>
                필살기
              </span>{" "}
              <b>{h.ult.name}</b>
              <p className="text-[#e8e4ff]">{h.ult.desc}</p>
            </div>
            <div>
              <span className="pts-tag text-[10px]" style={{ background: "#4ff0c8" }}>
                패시브
              </span>{" "}
              <b>{h.passive.name}</b> <span className="text-[#e8e4ff]">{h.passive.desc}</span>
              <span className="ml-[6px] text-[11px] text-[#a9a2d6]">(동료일 땐 절반)</span>
            </div>
            {!can &&
              (member ? (
                <button type="button" onClick={() => setSummon(true)} className="pts-btn self-start h-[30px] px-[12px] text-[12px]" style={{ "--c": "#ff9cc8" } as CSSProperties}>
                  ★ 별빛 소환에서 만나기
                </button>
              ) : (
                <p className="pts-sub text-[12px] text-[#ff9cc8]">로그인하고 별빛 소환(다이스 타운 뽑기)에서 얻을 수 있어요</p>
              ))}
            {can && card && (
              <div className="flex items-center gap-[8px] text-[11.5px]">
                <span className="pts-tag text-[10px]" style={{ background: "#ffd23a" }}>
                  강화 +{card.lv}
                </span>
                {card.lv >= MAX_LV ? (
                  <span className="text-[#ffd23a]">최고 강화!</span>
                ) : (
                  <>
                    <span className="text-[#e8e4ff]">
                      같은 카드 {card.dup}/{need}
                    </span>
                    <button type="button" disabled={card.dup < need} onClick={() => void levelUp()} className="pts-btn h-[24px] px-[10px] text-[11px]" style={{ "--c": "#ffd23a" } as CSSProperties}>
                      강화 → +{card.lv + 1}
                    </button>
                  </>
                )}
                {upErr && <span className="text-[#ff8fb8]">{upErr}</span>}
              </div>
            )}
          </div>
        </div>
        {/* 편성 */}
        <div className="mt-[6px] flex flex-wrap items-center gap-x-[10px] border-t-2 border-[#2a2468] pt-[6px] text-[11.5px] leading-[16px]">
          {sb.team ? (
            <span className="pts-sub text-[#ffd23a]">
              ★ 팀 시너지 「{TEAM_NAME[sb.team]}」 {TEAM_BONUS[sb.team].desc}
            </span>
          ) : (
            <span className="text-[#a9a2d6]">같은 계열 셋이면 팀 시너지! ({TEAM_NAME[TEAM_OF[team.main]]})</span>
          )}
          <span className="text-[#6b63a3]">동료는 패시브 절반 + 필살기 거들기</span>
          {note && <span className="text-[#ff8fb8]">{note}</span>}
        </div>
        <div className="mt-[6px] flex items-end gap-[10px]">
          {[team.main, team.sup[0], team.sup[1]].map((id, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                sfx("click");
                if (i > 0 && id && slot === i) {
                  onTeam({ main: team.main, sup: team.sup.filter((x) => x !== id) });
                  return;
                }
                setSlot(i);
              }}
              className="relative flex h-[78px] w-[70px] flex-col items-center justify-end pb-[2px]"
              style={{ background: "#100c2c", boxShadow: `0 0 0 2px ${slot === i ? "#ffd23a" : "#3a3080"}, 0 0 0 4px #07051a` }}
              title={i === 0 ? "메인 (누르고 위에서 고르기)" : "응원 동료 (누르고 위에서 고르기 · 다시 누르면 빼기)"}
            >
              <span className="absolute top-[2px] text-[10px] text-[#a9a2d6]">{i === 0 ? "메인" : `동료 ${i}`}</span>
              {id ? <Token sprite={HEROES[id].sprite} anim="idle" h={i === 0 ? 54 : 44} /> : <span className="mb-[20px] text-[20px] text-[#3a3080]">＋</span>}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex shrink-0 flex-col items-stretch gap-[6px]">
            <button
              type="button"
              onClick={() => {
                sfx("click");
                onArmy(!army);
              }}
              className="pts-btn flex h-[26px] items-center justify-between gap-[6px] px-[8px] text-[12px]"
              style={(army ? { "--c": "#ff5c8a", "--t": "#fff" } : { "--c": "#221b58", "--t": "#a9a2d6" }) as CSSProperties}
              title="레벨업 · 상자 · 금화로 디펜스 유닛을 소환해 부대를 꾸려요 (실험 — 기록 · 보상 없음)"
            >
              <span>🧪 럭키 출격</span>
              <b>{army ? "ON" : "OFF"}</b>
            </button>
            <button
              type="button"
              onClick={() => {
                sfx("click");
                setMaps(true);
              }}
              className="pts-btn ghost flex h-[26px] items-center justify-between gap-[6px] px-[8px] text-[12px]"
              title="맵 고르기"
            >
              <span className="text-[10px] text-[#a9a2d6]">맵</span>
              <b style={{ color: st.color }}>{st.name}</b>
              <span className="text-[10px]">▸</span>
            </button>
            {member && (
              <div className="flex items-center justify-between gap-[4px] px-[4px]" title="클리어하면 다음 깊이가 열려요 · 깊을수록 적이 세지고 보상이 늘어요">
                <span className="text-[11px] text-[#a9a2d6]">밤의 깊이</span>
                <button type="button" disabled={depth <= 0} onClick={() => onDepth(Math.max(0, depth - 1))} className="pts-btn ghost h-[22px] w-[22px] text-[10px]">
                  ◀
                </button>
                <b className="pts-title w-[22px] text-center text-[17px]" style={{ color: depth ? "#c58bff" : "#fff" }}>
                  {Math.min(depth, maxDepth)}
                </b>
                <button type="button" disabled={depth >= maxDepth} onClick={() => onDepth(Math.min(maxDepth, depth + 1))} className="pts-btn ghost h-[22px] w-[22px] text-[10px]">
                  ▶
                </button>
                <span className="w-[34px] text-right text-[10px] text-[#ffd23a]">×{depthMul(Math.min(depth, maxDepth)).reward.toFixed(1)}</span>
              </div>
            )}
            <button type="button" onClick={onStart} disabled={!owned(team.main)} className="pts-btn h-[46px] px-[22px] text-[19px]" style={{ "--c": "#ff4fa3", "--t": "#fff" } as CSSProperties}>
              출발! ▶
            </button>
          </div>
        </div>
      </div>
      {shop && prof && <Shop prof={prof} onProf={onProf} onClose={() => setShop(false)} />}
      {quests && prof && <Quests prof={prof} onClose={() => setQuests(false)} />}
      {maps && (
        <MapPick
          prof={prof}
          member={member}
          stage={stage}
          onPick={(x) => {
            onStage(x);
            setMaps(false);
          }}
          onClose={() => setMaps(false)}
        />
      )}
      {summon && prof && <Summon prof={prof} focus={look} onProf={onProf} onClose={() => setSummon(false)} />}
    </div>
  );
}

/* ───────────── 맵 고르기 ───────────── */

function MobFace({ k, h }: { k: EnemyKind; h: number }) {
  // 걷기 2칸 띠의 첫 칸만
  return (
    <span className="relative inline-block overflow-hidden" style={{ height: h, width: h * 1.4 }}>
      <img src={`/survivor/mob/${k}.png`} alt="" className="absolute bottom-0 left-0 h-full max-w-none" style={{ imageRendering: "pixelated", width: "auto" }} draggable={false} onError={(e) => (e.currentTarget.style.display = "none")} />
    </span>
  );
}

function MapPick({ prof, member, stage, onPick, onClose }: { prof: SurvivorProfile | null; member: boolean; stage: StageId; onPick(st: StageId): void; onClose(): void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(7,5,26,0.82)" }} onClick={onClose}>
      <div className="pts-win pts-pop flex w-[900px] flex-col px-[18px] py-[14px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-[10px]">
          <span className="pts-tag text-[13px]">맵 고르기</span>
          <span className="text-[12px] text-[#a9a2d6]">맵마다 몹 · 보스 · 장치가 달라요 — 깊이 · 랭킹도 맵마다 따로</span>
          <button type="button" onClick={onClose} className="pts-btn ghost ml-auto h-[28px] w-[28px] text-[14px]">
            ✕
          </button>
        </div>
        <div className="mt-[12px] grid grid-cols-2 gap-[16px]">
          {STAGE_IDS.map((id) => {
            const x = STAGES[id];
            const open = stageOpen(prof, id);
            const best = depthOf(prof, id);
            const on = id === stage;
            return (
              <button
                key={id}
                type="button"
                disabled={!open}
                onClick={() => {
                  sfx("pick");
                  onPick(id);
                }}
                className="pts-card relative flex flex-col overflow-hidden text-left disabled:cursor-default"
                style={{ "--r": on ? "#fff" : x.color } as CSSProperties}
              >
                <div className="relative h-[170px] overflow-hidden" style={{ background: `linear-gradient(180deg, #07051a, ${x.color}55)` }}>
                  <img src={`/survivor/stage/${id}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ imageRendering: "pixelated", filter: open ? undefined : "brightness(0.25) saturate(0.2)" }} draggable={false} onError={(e) => (e.currentTarget.style.display = "none")} />
                  <div className="absolute inset-x-0 bottom-0 h-[60px]" style={{ background: "linear-gradient(180deg, transparent, #16123d)" }} />
                  <div className="absolute bottom-[6px] left-[10px]">
                    <span className="pts-sub text-[11px] tracking-[2px]" style={{ color: x.color }}>
                      {x.en}
                    </span>
                    <b className="pts-title block text-[26px] leading-none">{x.name}</b>
                  </div>
                  {on && <span className="pts-tag absolute top-[8px] right-[8px] text-[11px]">선택됨</span>}
                  {!open && <span className="pts-title absolute inset-0 flex items-center justify-center text-[40px]">🔒</span>}
                </div>
                <div className="flex flex-1 flex-col gap-[6px] px-[12px] py-[10px] text-[12px]">
                  <p className="leading-[17px] text-[#e8e4ff]">{x.desc}</p>
                  <div className="flex items-end gap-[14px]">
                    {(
                      [
                        ["5분", x.mid],
                        ["새벽", x.final],
                      ] as const
                    ).map(([t, k]) => (
                      <span key={k} className="flex items-end gap-[4px]">
                        <MobFace k={k} h={30} />
                        <span className="leading-[14px]">
                          <span className="block text-[10px] text-[#a9a2d6]">{t}</span>
                          <b className="text-[#ff8fb8]">{ENEMIES[k].name}</b>
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-[6px] text-[11px]">
                    {x.hp !== 1 && <span className="pts-box px-[6px] py-[1px] text-[#ff8a6b]">몹 체력 ×{x.hp}</span>}
                    {x.reward !== 1 && <span className="pts-box px-[6px] py-[1px] text-[#ffd23a]">보상 ×{x.reward}</span>}
                    {x.toll && <span className="pts-box px-[6px] py-[1px] text-[#ffb03a]">🔔 자정의 종: {x.toll.dur}초 동안 적 빨라짐 · 경험치 ×2</span>}
                  </div>
                  <span className="mt-auto text-[11.5px]" style={{ color: open ? "#4ff0c8" : "#ff9cc8" }}>
                    {!open
                      ? member
                        ? `${STAGES[x.need!].name}을(를) 클리어하면 열려요`
                        : `로그인하고 ${STAGES[x.need!].name}을(를) 클리어하면 열려요`
                      : best >= 0
                        ? `클리어! 가장 깊은 밤 ${best}`
                        : "아직 클리어 전"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────── 영구 강화 ───────────── */

function Shop({ prof, onProf, onClose }: { prof: SurvivorProfile; onProf(p: SurvivorProfile): void; onClose(): void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const buy = async (id: UpId) => {
    setBusy(true);
    setErr("");
    try {
      const p = await survivor.upgrade(id);
      onProf({ ...prof, ...p });
      sfx("lvl");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(7,5,26,0.8)" }} onClick={onClose}>
      <div className="pts-win pts-pop w-[720px] px-[20px] py-[16px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-[10px]">
          <span className="pts-tag text-[13px]">영구 강화</span>
          <span className="text-[12px] text-[#a9a2d6]">판에서 모은 코인으로 — 모든 캐릭터에 적용</span>
          <span className="pts-sub ml-auto text-[15px] text-[#ffd23a]">● {prof.gold.toLocaleString()}</span>
          <button type="button" onClick={onClose} className="pts-btn ghost h-[28px] w-[28px] text-[14px]">
            ✕
          </button>
        </div>
        <div className="mt-[12px] grid grid-cols-4 gap-[10px]">
          {UPGRADES.map((u) => {
            const lv = prof.ups[u.id] ?? 0;
            const max = lv >= u.max;
            const cost = upCost(u.id, lv);
            return (
              <div key={u.id} className="pts-box flex flex-col items-center px-[6px] py-[8px] text-center">
                <b className="text-[14px]">{u.name}</b>
                <span className="text-[11px] text-[#a9a2d6]">{u.desc}</span>
                <span className="mt-[4px] flex gap-[3px]">
                  {Array.from({ length: u.max }, (_, i) => (
                    <i key={i} className="block h-[6px] w-[10px]" style={{ background: i < lv ? "#4ff0c8" : "#2a2468" }} />
                  ))}
                </span>
                <button type="button" disabled={busy || max || prof.gold < cost} onClick={() => void buy(u.id)} className="pts-btn mt-[6px] h-[26px] w-full text-[12px]">
                  {max ? "최고 단계" : `● ${cost.toLocaleString()}`}
                </button>
              </div>
            );
          })}
        </div>
        {err && <p className="mt-[8px] text-[12px] text-[#ff8fb8]">{err}</p>}
      </div>
    </div>
  );
}

/* ───────────── 퀘스트 · 도감 ───────────── */

export function rewardText(rw: QuestReward): { text: string; c: string } {
  if (rw.k === "weapon") return { text: `무기 해금 · ${WEAPONS[rw.id].name}`, c: "#5fd0ff" };
  if (rw.k === "relic") return { text: `유물 해금 · ${RELICS[rw.id].name}`, c: RELIC_RARITY_COLOR[RELICS[rw.id].rarity] };
  if (rw.k === "feat") return { text: FEAT_NAME[rw.id], c: "#7dff9a" };
  return { text: `별사탕 +${rw.n}`, c: "#ff9cc8" };
}

function RewardIcon({ rw, size = 22 }: { rw: QuestReward; size?: number }) {
  if (rw.k === "weapon") return <ItemIcon k="weapon" id={rw.id} size={size} />;
  if (rw.k === "relic") return <ItemIcon k="relic" id={rw.id} size={size} />;
  return (
    <span className="flex shrink-0 items-center justify-center text-[13px] font-bold" style={{ width: size, height: size, color: rw.k === "stars" ? "#ff9cc8" : "#7dff9a" }}>
      {rw.k === "stars" ? "★" : "＋"}
    </span>
  );
}

function Quests({ prof, onClose }: { prof: SurvivorProfile; onClose(): void }) {
  const [tab, setTab] = useState<"quest" | "dex">("quest");
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const done = new Set(prof.quests);
  const un = unlocksOf(prof.quests);
  const prog = (q: QuestDef) => (q.per === "total" ? Math.min(q.goal, q.value({ hero: "kai", sec: 0, kills: 0, lv: 1, win: false, depth: 0, stage: "town", q: {} as never }, prof.tot)) : 0);
  // 안 깬 것 먼저, 그다음 깬 것
  const list = [...QUESTS].sort((a, b) => Number(done.has(a.id)) - Number(done.has(b.id)));
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(7,5,26,0.8)" }} onClick={onClose}>
      <div className="pts-win pts-pop flex h-[500px] w-[800px] flex-col px-[18px] py-[14px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-[8px]">
          {(
            [
              ["quest", `퀘스트 ${prof.quests.length}/${QUESTS.length}`],
              ["dex", "해금 도감"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`pts-btn h-[30px] px-[14px] text-[13px] ${tab === k ? "" : "ghost"}`} style={tab === k ? ({ "--c": "#ffd23a" } as CSSProperties) : undefined}>
              {label}
            </button>
          ))}
          <span className="ml-[6px] text-[12px] text-[#a9a2d6]">판이 끝날 때 확인해요 — 깨면 무기 · 유물 · 기능 · 별사탕이 열려요</span>
          <button type="button" onClick={onClose} className="pts-btn ghost ml-auto h-[28px] w-[28px] text-[14px]">
            ✕
          </button>
        </div>
        {tab === "quest" ? (
          <div className="mt-[10px] grid min-h-0 flex-1 grid-cols-2 content-start gap-[6px] overflow-y-auto pr-[4px]">
            {list.map((q) => {
              const ok = done.has(q.id);
              const rw = rewardText(q.reward);
              const v = prog(q);
              return (
                <div key={q.id} className="pts-box flex items-center gap-[8px] px-[8px] py-[6px]" style={{ opacity: ok ? 0.55 : 1 }}>
                  <span className="text-[16px]">{ok ? "✅" : "⬜"}</span>
                  <div className="min-w-0 flex-1">
                    <b className="text-[13px]">{q.name}</b>
                    <p className="text-[11.5px] leading-[15px] text-[#a9a2d6]">
                      {q.desc}
                      {q.per === "total" && !ok && (
                        <span className="ml-[4px] text-[#ffd23a]">
                          ({v.toLocaleString()}/{q.goal.toLocaleString()})
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-[4px] text-right text-[11px] leading-[14px]" style={{ color: rw.c, maxWidth: 130 }}>
                    <RewardIcon rw={q.reward} size={20} />
                    {rw.text}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-[10px] flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto pr-[4px] text-[12px]">
            <div>
              <span className="pts-tag text-[11px]">공용 무기 {un.weapons.length}/{SHARED_WEAPONS.length}</span>
              <div className="mt-[6px] flex flex-wrap gap-[8px]">
                {SHARED_WEAPONS.map((id) => {
                  const on = un.weapons.includes(id);
                  return (
                    <span key={id} className="pts-box flex items-center gap-[6px] px-[8px] py-[4px]" style={{ opacity: on ? 1 : 0.4 }}>
                      <ItemIcon k="weapon" id={id} size={22} />
                      {on ? WEAPONS[id].name : "? ? ?"}
                    </span>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="pts-tag text-[11px]">유물 {un.relics.length}/{RELIC_IDS.length}</span>
              <div className="mt-[6px] grid grid-cols-4 gap-[6px]">
                {RELIC_IDS.map((id) => {
                  const d = RELICS[id];
                  const on = un.relics.includes(id);
                  const q = QUESTS.find((x) => x.reward.k === "relic" && x.reward.id === id);
                  return (
                    <div key={id} className="pts-box flex items-start gap-[6px] px-[6px] py-[5px]" style={{ opacity: on ? 1 : 0.55 }}>
                      <span style={{ filter: on ? undefined : "brightness(0.2)" }}>
                        <ItemIcon k="relic" id={id} size={26} />
                      </span>
                      <div className="min-w-0">
                        <b className="text-[11.5px]" style={{ color: RELIC_RARITY_COLOR[d.rarity] }}>
                          {on ? d.name : "? ? ?"}
                        </b>
                        <p className="text-[10.5px] leading-[13px] text-[#a9a2d6]">{on ? d.desc : q ? `퀘스트 「${q.name}」` : RELIC_RARITY_NAME[d.rarity]}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-[12px] text-[#a9a2d6]">
              기능: 다시 뽑기 {un.rerolls} · 건너뛰기 {un.skips} · 카드 지우기 {un.banish} · 시작 금화 {un.gold} <span className="text-[#6b63a3]">(영구 강화 · 해금 합)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── 결과 ───────────── */

function Result({ r, fin, err, member, stars, onAgain, onPick, onSummon }: { r: RunResult; fin: FinishOut | null; err: string; member: boolean; stars: number; onAgain(): void; onPick(): void; onSummon(): void }) {
  const h = HEROES[r.hero];
  const top = Math.max(1, ...r.weapons.map((w) => w.dmg));
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: r.win ? "linear-gradient(180deg, #ffb46b, #ff7fa8 40%, #3a2a8a)" : "linear-gradient(180deg, #07051a, #2a1040)" }}>
      <div className="pts-stars absolute inset-0 opacity-40" />
      <div className="pts-win pts-pop relative flex w-[760px] px-[26px] py-[22px]">
        <div className="flex w-[200px] flex-col items-center">
          <b className="pts-title text-[32px]" style={{ color: r.win ? "#ffd23a" : "#ff8fb8" }}>
            {r.win ? "새벽이다!" : "쓰러졌어요"}
          </b>
          <div className="mt-[10px] flex h-[150px] items-end">
            <Token sprite={h.sprite} anim={r.win ? "win" : "idle"} h={130} />
          </div>
          <span className="mt-[8px] text-[14px]">{h.name}</span>
        </div>
        <div className="ml-[24px] flex min-w-0 flex-1 flex-col">
          <div className="grid grid-cols-4 gap-[10px] text-center">
            {[
              ["버틴 시간", r.win ? "클리어" : fmt(r.sec), r.win ? "#ffd23a" : "#fff"],
              ["레벨", String(r.lv), "#5fd0ff"],
              ["처치", r.kills.toLocaleString(), "#ff8fb8"],
              [r.ot ? "오버타임" : "금화", r.ot ? `+${fmt(r.ot)}` : r.gold.toLocaleString(), r.ot ? "#ff9cc8" : "#ffd23a"],
            ].map(([k, v, c]) => (
              <div key={k} className="pts-box px-[6px] py-[8px]">
                <span className="text-[11px] text-[#a9a2d6]">{k}</span>
                <b className="mt-[2px] block text-[20px]" style={{ color: c }}>
                  {v}
                </b>
              </div>
            ))}
          </div>
          <div className="mt-[16px] flex flex-col gap-[6px] text-[13px]">
            {r.army && r.army.length > 0 && (
              <>
                <span className="pts-tag self-start text-[11px]" style={{ background: "#ff5c8a", color: "#fff" }}>
                  부대 피해
                </span>
                {r.army.slice(0, 5).map((u, i) => (
                  <div key={i} className="flex items-center gap-[8px]">
                    <img src={`/defense/units/${u.id}.webp`} alt="" className="h-[22px] w-[22px]" draggable={false} />
                    <span className="w-[140px] truncate" style={{ color: ARMY_GRADE_COLOR[UNIT[u.id].grade] }}>
                      {UNIT[u.id].name}
                    </span>
                    <div className="pts-bar h-[8px] flex-1" style={{ "--c": ARMY_GRADE_COLOR[UNIT[u.id].grade] } as CSSProperties}>
                      <i style={{ width: `${(u.dmg / Math.max(1, r.army![0].dmg)) * 100}%` }} />
                    </div>
                    <span className="w-[70px] text-right">{u.dmg.toLocaleString()}</span>
                  </div>
                ))}
              </>
            )}
            <span className="pts-tag self-start text-[11px]">무기 피해</span>
            {r.weapons.slice(0, r.army ? 2 : 6).map((w) => (
              <div key={w.id} className="flex items-center gap-[8px]">
                <ItemIcon k="weapon" id={w.id} size={18} />
                <span className="w-[110px] truncate">{WEAPONS[w.id].name}</span>
                <span className="w-[34px] text-[#a9a2d6]">Lv{w.lv}</span>
                <div className="pts-bar h-[8px] flex-1" style={{ "--c": WEAPONS[w.id].color } as CSSProperties}>
                  <i style={{ width: `${(w.dmg / top) * 100}%` }} />
                </div>
                <span className="w-[70px] text-right">{w.dmg.toLocaleString()}</span>
              </div>
            ))}
            {r.relics.length > 0 && (
              <div className="mt-[2px] flex flex-wrap gap-[4px]">
                {r.relics.map((x) => (
                  <span key={x.id} className="relative" title={RELICS[x.id].name}>
                    <ItemIcon k="relic" id={x.id} size={20} />
                    {x.n > 1 && <b className="absolute -right-[2px] -bottom-[3px] text-[9px]">{x.n}</b>}
                  </span>
                ))}
              </div>
            )}
            {r.passives.length > 0 && (
              <div className="mt-[4px] flex flex-wrap gap-[6px]">
                {r.passives.map((p) => (
                  <span key={p.id} className="flex items-center gap-[4px] text-[11px] text-[#a9a2d6]">
                    <ItemIcon k="passive" id={p.id} size={16} />
                    {PASSIVES[p.id].name} {p.lv}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="mt-[12px] flex flex-wrap items-center gap-[10px] text-[13px]">
            {r.army ? (
              <span className="text-[#ff9cc8]">🧪 럭키 출격은 실험 모드라 기록 · 보상이 없어요 — 손맛이 어땠는지 알려 주세요!</span>
            ) : !member ? (
              <span className="text-[#a9a2d6]">로그인하면 별사탕(캐릭터 뽑기) · 코인(영구 강화) · 랭킹이 쌓여요</span>
            ) : fin ? (
              <>
                <span className="pts-box px-[10px] py-[4px] text-[#ff9cc8]">
                  ★ 별사탕 +{fin.stars + fin.qStars}
                  {fin.first ? " (오늘 첫 클리어!)" : ""}
                </span>
                <span className="pts-box px-[10px] py-[4px] text-[#ffd23a]">● 코인 +{fin.gold}</span>
                <span className="pts-box px-[10px] py-[4px] text-[#4ff0c8]">{fin.best ? "최고 기록! " : ""}랭킹 {fin.rank}위</span>
              </>
            ) : err ? (
              <span className="text-[#ff8fb8]">{err}</span>
            ) : (
              <span className="pts-blink text-[#a9a2d6]">보상 받는 중…</span>
            )}
          </div>
          {fin && fin.quests.length > 0 && (
            <div className="mt-[8px] flex flex-col gap-[4px]">
              {fin.quests.slice(0, 4).map((id) => {
                const q = QUEST[id];
                const rw = rewardText(q.reward);
                return (
                  <div key={id} className="pts-pop flex items-center gap-[8px] text-[12.5px]">
                    <span className="pts-tag text-[10px]" style={{ background: "#ffd23a" }}>
                      퀘스트 완료
                    </span>
                    <b>{q.name}</b>
                    <RewardIcon rw={q.reward} size={18} />
                    <span style={{ color: rw.c }}>{rw.text}</span>
                  </div>
                );
              })}
              {fin.quests.length > 4 && <span className="text-[11px] text-[#a9a2d6]">… 외 {fin.quests.length - 4}개</span>}
            </div>
          )}
          <div className="mt-auto flex justify-end gap-[12px] pt-[16px]">
            {member && fin && stars >= 150 && (
              <button type="button" onClick={onSummon} className="pts-btn h-[40px] px-[14px] text-[14px]" style={{ "--c": "#ff9cc8" } as CSSProperties}>
                ★ 소환하러 ({stars.toLocaleString()})
              </button>
            )}
            <button type="button" onClick={onPick} className="pts-btn ghost h-[40px] px-[16px] text-[14px]">
              캐릭터 바꾸기
            </button>
            <button type="button" onClick={onAgain} className="pts-btn h-[40px] px-[26px] text-[16px]" style={{ "--c": "#ff4fa3", "--t": "#fff" } as CSSProperties}>
              한 판 더!
            </button>
          </div>
        </div>
      </div>
      <span className="pts-sub absolute bottom-[12px] text-[11px] text-white/60">
        {r.depth > 0 ? `밤의 깊이 ${r.depth} · ` : ""}
        {STAGES[r.stage].name} · {r.win ? `${fmt(RUN_SEC)} 생존 · ${ENEMIES[STAGES[r.stage].final].name} 처치${r.ot ? ` · 오버타임 ${fmt(r.ot)}` : ""}` : "성소 · 상자 · 상인을 들러 빌드를 키워 보세요"}
      </span>
    </div>
  );
}
