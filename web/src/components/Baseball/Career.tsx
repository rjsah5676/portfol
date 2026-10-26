"use client";

/*
 * 육성 모드 화면 — 선수 만들기 · 관리(턴 행동) · 이벤트 · 경기(직접/자동) · 시즌 결산 · 은퇴 · 명예의 전당.
 * 규칙 · 숫자는 lib/baseball/career.ts, 저장은 careerStore.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DIFF_NAME, type Diff } from "@/lib/baseball/ai";
import {
  BONDS, BOND_AT, COND_NAME, GAME_GRADES, GP_BOOSTS, GP_IDS, INJURY_NAME, ITEMS, ITEM_IDS, OFF_TURNS, SEASONS, SKILLS, STAT_KEYS, STAT_NAME,
  TRAINS, TRAIN_KEYS, TYPES, WEEKS, act, age, avg, bondStage, buy, canPlay, choose, endSeason, fmtAvg, gradeOf, newCareer, ops, ovrOf,
  retireCard, statGrade, stepOf, talentName, trainLv, trainRisk, consumeItem, whenText, LEARNED_VAL,
  type Action, type BatType, type Career, type Delta, type GpId, type HofEntry, type ItemId, type SeasonSummary, type StatKey, type TurnOut,
} from "@/lib/baseball/career";
import { slotName, slotOf } from "@/lib/baseball/careerGame";
import { CHARS, TEAM_DEFS, charById, faceUrl, type CharId } from "@/lib/baseball/data";
import { BAT_IDLE, BATS, BATTER_RIG, HELMETS, baseSkin } from "@/lib/baseball/figures";
import { drawRig, pose } from "@/lib/baseball/rig";
import { addHof, autoGame, loadCareer, loadHof, saveCareer, setupOf, takeReport, type GameReport } from "./careerStore";
import type { MatchCfg } from "./match";
import { sfx } from "./sfx";
import { ACCENT, Btn, MenuBg, Modal, font } from "./ui";

type View = "home" | "create" | "hub" | "hof";

const STAT_COLOR: Record<StatKey, string> = { hit: "#7dff9a", power: "#ff7a5c", run: "#7ad7ff", def: "#ffd23f" };
const TONE_COLOR: Record<TurnOut["tone"], string> = { great: "#ffd23f", ok: "#ffffff", fail: "#9aa3c7", injury: "#ff5a5a", event: "#7ad7ff", awaken: "#ff7ae0" };
const NAMES = ["김픽셀", "이도트", "박비트", "최렌더", "정버퍼", "강루프", "조캐시", "윤커밋", "장스택", "한패치", "오클릭", "서해시"];

const clone = (c: Career): Career => JSON.parse(JSON.stringify(c));

export default function CareerMode({ onExit, onPlay }: { onExit: () => void; onPlay: (cfg: MatchCfg) => void }) {
  const [view, setView] = useState<View>("home");
  const [c, setC] = useState<Career | null>(null);
  const [hof, setHof] = useState<HofEntry[]>([]);
  // 결과 팝업 줄 (턴 결과 → 이어진 이벤트 …)
  const [queue, setQueue] = useState<TurnOut[]>([]);
  const [report, setReport] = useState<GameReport | null>(null);
  const [season, setSeason] = useState<SeasonSummary | null>(null);
  const [modal, setModal] = useState<null | "shop" | "outing" | "records" | "newConfirm" | "leaveConfirm">(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let cur = loadCareer();
    let rep = takeReport();
    // 직접 출전 중에 나갔으면 자동 결과로 반영 (다시 하기 방지)
    if (cur?.inGame) {
      rep = autoGame(cur, "경기 중에 나가서 나머지는 자동으로 진행됐어요");
      cur = loadCareer();
    }
    // 은퇴한 선수는 명예의 전당에 (이미 있으면 그대로)
    if (cur?.phase === "retired") addHof(cur);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장값 불러오기
    setC(cur);
    setHof(loadHof());
    if (rep) {
      setReport(rep);
      setView("hub");
      (rep.sum.dnp ? sfx.ui : rep.pas.some((p) => p.kind === "HR") ? sfx.homerun : () => sfx.cheer(0.6))();
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
    const n = clone(c);
    const out = act(n, a);
    commit(n);
    // 고르기 이벤트를 알리기만 하는 팝업은 건너뛰고 바로 고르기 창
    const q = [out, ...(out.extra && !out.extra.stub ? [out.extra] : [])];
    setQueue(q);
    playTone(q[0].tone);
  };

  const doChoose = (i: 0 | 1) => {
    if (!c) return;
    const n = clone(c);
    const out = choose(n, i);
    commit(n);
    setQueue([out]);
    playTone(out.tone);
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

  const playDirect = () => {
    if (!c) return;
    const n = clone(c);
    n.inGame = true;
    commit(n);
    onPlay({ mode: "career", diff: c.diff, innings: 9, userHome: true, myBat: "kai", myPit: "lily", career: setupOf(n) });
  };
  const playAuto = () => {
    if (!c) return;
    const n = clone(c);
    const r = autoGame(n);
    setC(n);
    setReport(r);
    (r.pas.some((p) => p.kind === "HR") ? sfx.homerun : () => sfx.cheer(0.5))();
  };
  const sitOut = () => {
    if (!c) return;
    const n = clone(c);
    n.inGame = true;
    const r = autoGame(n);
    setC(n);
    setReport(r);
  };

  return (
    <MenuBg>
      {view === "home" && (
        <Home
          c={c}
          onBack={onExit}
          onContinue={() => setView("hub")}
          onNew={() => (c && c.phase !== "retired" ? setModal("newConfirm") : setView("create"))}
          onHof={() => {
            setHof(loadHof());
            setView("hof");
          }}
        />
      )}
      {view === "create" && (
        <Create
          onBack={() => setView("home")}
          onStart={(o) => {
            const n = newCareer(o);
            commit(n);
            setView("hub");
            sfx.cheer(0.7);
          }}
        />
      )}
      {view === "hof" && <Hof list={hof} onBack={() => setView("home")} />}
      {view === "hub" && c && (
        c.phase === "retired" && !season ? (
          <Retire
            c={c}
            onHome={() => setView("home")}
            onNew={() => setView("create")}
            onHof={() => {
              setHof(loadHof());
              setView("hof");
            }}
          />
        ) : (
          <Hub
            c={c}
            onBack={() => setView("home")}
            onAct={doAct}
            onShop={() => setModal("shop")}
            onOuting={() => setModal("outing")}
            onRecords={() => setModal("records")}
            onDirect={playDirect}
            onAuto={playAuto}
            onSitOut={sitOut}
            onSeasonEnd={doSeasonEnd}
          />
        )
      )}

      {/* 결과 팝업들 (순서: 턴 결과 → 고르기 → 경기 → 시즌) */}
      {queue.length > 0 && <TurnModal out={queue[0]} onNext={() => setQueue((q) => q.slice(1))} />}
      {!queue.length && c?.pending && view === "hub" && <ChoiceModal c={c} onPick={doChoose} />}
      {!queue.length && report && <ReportModal r={report} onClose={() => setReport(null)} />}
      {!queue.length && !report && season && <SeasonModal s={season} c={c!} onClose={() => setSeason(null)} />}

      {modal === "shop" && c && (
        <ShopModal
          c={c}
          onClose={() => setModal(null)}
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
      {modal === "outing" && c && (
        <OutingModal
          c={c}
          onClose={() => setModal(null)}
          onPick={(id) => {
            setModal(null);
            doAct({ kind: "outing", char: id });
          }}
        />
      )}
      {modal === "records" && c && <RecordsModal c={c} onClose={() => setModal(null)} />}
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
        <div className="pointer-events-none absolute top-[70px] left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/80 px-5 py-2 text-[14px] font-bold text-white">
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
          선수 한 명을 {SEASONS}시즌 동안 키워서 은퇴시키기 · 훈련 · 외출 · 경기 · 픽셀파이트 캐릭터에게 필살타법 전수
        </div>
        <div className="mt-1 text-[12px] text-white/45">타자편 프로토 · 이 브라우저에 저장돼요</div>
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

function Create({ onBack, onStart }: { onBack: () => void; onStart: (o: Parameters<typeof newCareer>[0]) => void }) {
  const [name, setName] = useState(() => NAMES[Math.floor(Math.random() * NAMES.length)]);
  const [num, setNum] = useState(() => 10 + Math.floor(Math.random() * 60));
  const [bats, setBats] = useState<"R" | "L">("R");
  const [type, setType] = useState<BatType>("contact");
  const [diff, setDiff] = useState<Diff>(1);
  const [gp, setGp] = useState<GpId[]>([]);
  const t = TYPES[type];
  return (
    <div className="flex h-full flex-col gap-2.5 px-7 py-4">
      <div className="flex items-center justify-between">
        <span className={`${font.title} text-[28px]`} style={{ color: ACCENT }}>
          새 선수 만들기
        </span>
        <Btn className="px-4 py-1.5 text-sm" color="#8b93b8" onClick={onBack}>
          ← 뒤로
        </Btn>
      </div>
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
          <div className="text-[13px] font-bold text-white/70">타입</div>
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
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[13px] font-bold text-white/70">GP 부스트 (이번 선수만)</span>
            <span className="rounded bg-[#ffd23f]/15 px-2 py-0.5 text-[11px] text-[#ffd23f]">프로토 체험 — GP 안 빠짐 · 육성 영향 30% 이하로 묶음</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {GP_IDS.map((id) => {
              const on = gp.includes(id);
              const g = GP_BOOSTS[id];
              return (
                <Btn
                  key={id}
                  active={on}
                  color="#ffd23f"
                  className="px-2 py-1.5 text-left text-[12px] leading-tight"
                  onClick={() => setGp((v) => (on ? v.filter((x) => x !== id) : [...v, id]))}
                >
                  <span className="block text-[13px]">{g.name}</span>
                  <span className="block font-normal opacity-80">{g.desc}</span>
                  <span className="block font-mono text-[11px] opacity-70">{g.price} GP</span>
                </Btn>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-4 py-2.5">
        <div className="text-[12.5px] leading-relaxed text-white/60">
          숨은 재능은 1시즌이 끝나면 스카우트가 알려 줘요. 결과는 운 · 선택 · 실력에 따라 크게 갈려요
          <br />
          (중앙값 500 정도 · 잘 풀리면 800+ · 안 풀리면 200대).
        </div>
        <Btn className={`${font.title} ml-4 shrink-0 px-8 py-3 text-2xl`} disabled={!name} onClick={() => onStart({ name, num, bats, type, diff, gp })}>
          입단!
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

function Bar({ v, color, max = 999, h = 7, ghost }: { v: number; color: string; max?: number; h?: number; ghost?: number }) {
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-white/10" style={{ height: h }}>
      {ghost !== undefined && ghost > v && <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: `${(ghost / max) * 100}%` }} />}
      <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, (v / max) * 100)}%`, background: color }} />
    </div>
  );
}

/* ─────────────── 선수 그림 (등 뒤 · 등번호 · 이름) ─────────────── */

function Portrait({ c, w = 120, h = 150 }: { c: Career; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const q = Math.min(3, window.devicePixelRatio || 1) * 1.5;
    cv.width = w * q;
    cv.height = h * q;
    const ctx = cv.getContext("2d")!;
    const team = TEAM_DEFS[0];
    const lc = c.learned ? charById(c.learned) : null;
    const skin = { ...baseSkin(), helmet: HELMETS.basic, bat: lc ? BATS.hero : c.gear.includes("bat") ? BATS.metal : BATS.wood };
    const colors = { team: team.color, dark: team.dark, skin: "#eec29e", hair: "#1d1a22", pants: "#eef0f4", accent: lc?.color ?? "#f2f2f2", num: String(c.num), name: c.name, flip: c.bats === "L" };
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.setTransform(q, 0, 0, q, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const ps = pose(BATTER_RIG, BAT_IDLE, t);
      // 방망이 끝 ~ 발끝이 다 들어오게 (머리 · 방망이 안 잘리게)
      const sc = h / 215;
      drawRig(ctx, BATTER_RIG, ps, skin, colors, w / 2 + (c.bats === "L" ? 1 : -1) * w * 0.06, h - 64 * sc, sc, c.bats === "L");
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [c.num, c.name, c.bats, c.learned, c.gear, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}

/* ─────────────── 관리 화면 ─────────────── */

function Hub(p: {
  c: Career;
  onBack: () => void;
  onAct: (a: Action) => void;
  onShop: () => void;
  onOuting: () => void;
  onRecords: () => void;
  onDirect: () => void;
  onAuto: () => void;
  onSitOut: () => void;
  onSeasonEnd: () => void;
}) {
  const { c } = p;
  const step = stepOf(c);
  const ovr = ovrOf(c);
  const gr = gradeOf(ovr);
  const risk = trainRisk(c);
  const slot = slotOf(c.trust);
  const busy = !!c.pending;
  return (
    <div className="flex h-full flex-col">
      {/* 위 */}
      <div className="flex h-[50px] items-center gap-3 border-b border-white/10 bg-black/35 px-3">
        <Btn className="px-3 py-1 text-[13px]" color="#8b93b8" onClick={p.onBack}>
          ←
        </Btn>
        <div className={`${font.title} text-[20px]`}>{whenText(c)}</div>
        <Schedule c={c} />
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[14px] font-bold text-[#ffd23f]">₩ {c.money.toLocaleString()}만</span>
          <Btn className="px-3 py-1 text-[13px]" color="#ffd23f" onClick={p.onShop}>
            상점
          </Btn>
          <Btn className="px-3 py-1 text-[13px]" color="#7ad7ff" onClick={p.onRecords}>
            기록
          </Btn>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* 선수 카드 */}
        <div className="flex w-[300px] shrink-0 flex-col rounded-2xl border-2 border-white/10 bg-[#0e1226]/90 p-3">
          <div className="flex gap-2">
            <div className="shrink-0 rounded-xl bg-gradient-to-b from-[#2a6b3a]/40 to-transparent">
              <Portrait c={c} w={104} h={132} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`${font.title} truncate text-[22px] leading-tight`}>{c.name}</div>
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
              <div className="mt-1.5 flex items-end gap-2">
                <span className={`${font.title} text-[44px] leading-none`} style={{ color: gr.color }}>
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
          <div className="mt-2 flex flex-wrap gap-1">
            {c.learned && (
              <span className="rounded-md px-1.5 py-0.5 text-[11px] font-bold text-black" style={{ background: charById(c.learned).color }} title={charById(c.learned).swing.desc}>
                ★ {charById(c.learned).swing.name}
              </span>
            )}
            {c.skills.map((id) => (
              <span
                key={id}
                title={SKILLS[id].desc}
                className="rounded-md border px-1.5 py-0.5 text-[11px]"
                style={{ borderColor: SKILLS[id].bad ? "#ff7a7a88" : "#7ad7ff66", color: SKILLS[id].bad ? "#ff9a9a" : "#cfe9ff" }}
              >
                {SKILLS[id].name}
              </span>
            ))}
            {!c.learned && !c.skills.length && <span className="text-[11px] text-white/35">특수능력 없음 — 외출로 캐릭터와 친해지면 생겨요</span>}
          </div>
        </div>

        {/* 오른쪽 */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {/* 상태 */}
          <div className="grid grid-cols-3 gap-2">
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
            <Gauge label="감독 신뢰" value={`${Math.round(c.trust)} · ${slotName(slot)} 타자`} pct={c.trust} color="#7ad7ff" />
          </div>

          {c.injury && (
            <div className="rounded-xl border-2 border-[#ff5a5a]/60 bg-[#ff5a5a]/10 px-3 py-1.5 text-[13px] text-[#ffb0b0]">
              🩹 {INJURY_NAME[c.injury.kind]} — {c.injury.left}턴 남음. 재활(휴식)만 할 수 있고 경기는 결장해요. 상점 「재활 치료」로 줄일 수 있어요.
            </div>
          )}

          {/* 행동 */}
          {step === "turn" || step === "pending" ? (
            <div className="grid flex-1 grid-cols-4 grid-rows-2 gap-2">
              {TRAIN_KEYS.map((k) => {
                const t = TRAINS[k];
                const lv = trainLv(c, k);
                return (
                  <ActCard
                    key={k}
                    disabled={!!c.injury || busy}
                    title={t.name}
                    sub={t.desc}
                    color={k === "combo" ? "#ff5fb4" : STAT_COLOR[k as StatKey]}
                    foot={`체력 -${t.cost} · Lv${lv}`}
                    onClick={() => p.onAct({ kind: "train", key: k })}
                  />
                );
              })}
              <ActCard disabled={busy} title={c.injury ? "재활" : "휴식"} sub={c.injury ? "부상 회복에 집중" : "체력 크게 회복 · 컨디션 ↑ 가끔"} color="#b6ffb0" foot="체력 +45" onClick={() => p.onAct({ kind: "rest" })} />
              <ActCard disabled={!!c.injury || busy} title="외출" sub="픽셀파이트 캐릭터 만나기 · 인연 → 특수능력 · 필살 전수" color="#ff7ae0" foot="체력 +12 · 컨디션 ↑" onClick={p.onOuting} />
              <div className="flex flex-col justify-center rounded-xl border border-white/10 bg-black/30 px-3 text-[12px] leading-relaxed text-white/60">
                <div>
                  훈련 대성공 <b className="text-[#ffd23f]">{Math.round(risk.great * 100)}%</b>
                </div>
                <div>
                  실패 <b className={risk.fail > 0.15 ? "text-[#ff9a7a]" : "text-white"}>{Math.round(risk.fail * 100)}%</b> · 부상{" "}
                  <b className={risk.injury > 0.05 ? "text-[#ff5a5a]" : "text-white"}>{(risk.injury * 100).toFixed(risk.injury < 0.1 ? 1 : 0)}%</b>
                </div>
                <div className="text-[11px] text-white/40">체력 40 아래부터 부상이 확 늘어요</div>
              </div>
            </div>
          ) : step === "game" ? (
            <GameCard c={c} onDirect={p.onDirect} onAuto={p.onAuto} onSitOut={p.onSitOut} />
          ) : step === "seasonEnd" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-[#ffd23f]/40 bg-black/30">
              <div className={`${font.title} text-[30px]`}>{c.season}년차 시즌 종료!</div>
              <div className="text-[14px] text-white/65">
                {c.line.g}경기 · 타율 {fmtAvg(avg(c.line))} · {c.line.hr}홈런 · {c.line.rbi}타점 · 팀 {c.wins}승 {c.losses}패
              </div>
              <Btn className={`${font.title} px-8 py-3 text-xl`} color="#ffd23f" onClick={p.onSeasonEnd}>
                시즌 결산 보기
              </Btn>
            </div>
          ) : null}

          {/* 기록 줄 */}
          <div className="h-[86px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/35 px-3 py-1.5">
            <div className="mb-0.5 flex justify-between text-[11px] text-white/45">
              <span>최근 소식</span>
              <span>
                이번 시즌 {c.line.g}경기 · 타율 {fmtAvg(avg(c.line))} · {c.line.hr}홈런 · {c.line.rbi}타점
              </span>
            </div>
            {c.log.slice(0, 4).map((l, i) => (
              <div key={i} className="truncate text-[12.5px]" style={{ opacity: 1 - i * 0.2 }}>
                {l}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Schedule({ c }: { c: Career }) {
  // 시즌 10경기 칸
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: WEEKS }, (_, i) => {
        const done = c.phase === "season" ? i < c.week : c.phase === "seasonEnd" || c.phase === "off";
        const now = c.phase === "season" && i === c.week;
        return (
          <div
            key={i}
            className="h-[10px] w-[16px] rounded-sm"
            style={{ background: done ? "#FF8A3D" : now ? "#ffd23f" : "rgba(255,255,255,0.12)", boxShadow: now ? "0 0 8px #ffd23f" : undefined }}
          />
        );
      })}
      <span className="ml-1 text-[11px] text-white/45">
        {c.season}/{SEASONS}시즌
      </span>
    </div>
  );
}

function Gauge({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5">
      <div className="flex justify-between text-[12px] text-white/60">
        <span>{label}</span>
        <b style={{ color }}>{value}</b>
      </div>
      <div className="mt-1">
        <Bar v={pct} max={100} color={color} />
      </div>
    </div>
  );
}

function ActCard({ title, sub, foot, color, onClick, disabled }: { title: string; sub: string; foot: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Btn disabled={disabled} color={color} className="flex flex-col items-start justify-between px-3 py-2 text-left" onClick={onClick}>
      <span className={`${font.title} text-[19px] leading-tight`} style={{ color }}>
        {title}
      </span>
      <span className="text-[11.5px] leading-snug font-normal text-white/75">{sub}</span>
      <span className="mt-1 font-mono text-[11px] text-white/55">{foot}</span>
    </Btn>
  );
}

function GameCard({ c, onDirect, onAuto, onSitOut }: { c: Career; onDirect: () => void; onAuto: () => void; onSitOut: () => void }) {
  const st = setupOf(c);
  const opp = st.opp;
  const oppHero = opp.batters.find((b) => b.special);
  const oppAce = opp.pitchers.find((pp) => pp.special);
  const tired = c.stamina < 20;
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-2xl border-2 border-[#FF8A3D]/50 bg-black/35 p-3">
      <div className="flex items-center justify-between">
        <div className={`${font.title} text-[24px]`}>
          {c.week + 1}주차 경기 <span className="text-white/50">vs</span> <span style={{ color: opp.color }}>{opp.name}</span>
        </div>
        <div className="text-[13px] text-white/60">{st.userHome ? "홈" : "원정"} · 9이닝 · {DIFF_NAME[c.diff]}</div>
      </div>
      <div className="flex gap-3 text-[13px]">
        <div className="flex-1 rounded-xl bg-white/[0.04] px-3 py-2">
          <div className="text-white/55">내 자리</div>
          <div className="text-[16px] font-bold">
            {slotName(st.myIdx)} 타자 · {TYPES[c.type].pos}
          </div>
          <div className="text-[12px] text-white/55">
            컨디션 {COND_NAME[c.cond]}
            {tired && <span className="text-[#ff9a7a]"> · 지쳐서 타격 -10%</span>}
          </div>
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2">
          {[oppHero?.special, oppAce?.special].map((id, i) =>
            id ? <img key={i} src={faceUrl(id)} alt="" className="h-[46px] w-[40px] rounded-md object-cover object-top" style={{ outline: `2px solid ${charById(id).color}` }} /> : null
          )}
          <div className="text-[12px] leading-snug text-white/70">
            상대 마타자 <b style={{ color: oppHero?.special ? charById(oppHero.special).color : undefined }}>{oppHero?.name}</b>
            <br />
            마무리 마투수 <b style={{ color: oppAce?.special ? charById(oppAce.special).color : undefined }}>{oppAce?.name}</b> — {oppAce?.special ? charById(oppAce.special).ball.name : ""}
          </div>
        </div>
      </div>
      <div className="rounded-xl bg-white/[0.04] px-3 py-2">
        <div className="mb-1 text-[12px] text-white/55">
          오늘 타순 — 감독 신뢰 25 · 50 · 75 에서 올라가요 (중심 타선일수록 찬스 · 타석 ↑)
        </div>
        <div className="grid grid-cols-9 gap-1">
          {st.my.batters.map((b, i) => {
            const me = i === st.myIdx;
            const hero = b.special ? charById(b.special) : null;
            return (
              <div
                key={i}
                className="truncate rounded-md px-1 py-1 text-center text-[11px] leading-tight"
                style={{ background: me ? ACCENT : "rgba(255,255,255,0.06)", color: me ? "#111" : hero ? hero.color : "#fff", fontWeight: me || hero ? 700 : 400 }}
              >
                <div className="opacity-70">{i + 1}번</div>
                <div className="truncate">{me ? "나" : b.name}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 text-[11.5px] text-white/50">
          경기 평가 {GAME_GRADES.map((g) => `${g.g} ×${g.xp}`).join(" · ")} — 잘 칠수록 경기 경험치가 크게 늘어요
        </div>
      </div>
      {canPlay(c) ? (
        <div className="mt-auto grid grid-cols-2 gap-2">
          <Btn className={`${font.title} py-4 text-[24px]`} onClick={onDirect}>
            ⚾ 직접 출전
            <span className="block font-['Nanum_Gothic'] text-[12px] font-normal opacity-80">내 타석만 직접 쳐요 · 잘 치면 성장 ↑↑</span>
          </Btn>
          <Btn className={`${font.title} py-4 text-[24px]`} color="#7ad7ff" onClick={onAuto}>
            ⏩ 자동 진행
            <span className="block font-['Nanum_Gothic'] text-[12px] font-normal opacity-80">{DIFF_NAME[c.diff]} 봇 실력으로 결과만</span>
          </Btn>
        </div>
      ) : (
        <Btn className={`${font.title} mt-auto py-4 text-[22px]`} color="#ff7a7a" onClick={onSitOut}>
          결장 ({INJURY_NAME[c.injury!.kind]}) — 다음으로
        </Btn>
      )}
    </div>
  );
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
  if (d.money) chips.push({ t: `자금 ${d.money > 0 ? "+" : ""}${d.money}만`, good: d.money > 0 });
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
  return (
    <Modal w={420} onClose={onNext}>
      <div className={`${font.title} text-[30px]`} style={{ color: col, textShadow: out.tone === "awaken" ? "0 0 20px #ff7ae0" : undefined }}>
        {out.title}
      </div>
      <div className="mt-2 flex flex-col gap-1 text-[14px] text-white/80">
        {out.lines.map((l, i) => (
          <div key={i}>{l}</div>
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
    <Modal w={460}>
      <div className="flex items-center gap-3 text-left">
        {ch && <img src={faceUrl(ch.id)} alt={ch.name} className="h-[88px] w-[76px] shrink-0 rounded-xl object-cover object-top" style={{ outline: `3px solid ${ch.color}` }} />}
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

function ReportModal({ r, onClose }: { r: GameReport; onClose: () => void }) {
  const gm = /^\[(.)\]/.exec(r.sum.title)?.[1];
  const g = GAME_GRADES.find((x) => x.g === gm);
  return (
    <Modal w={480} onClose={onClose}>
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
        <div className="mx-auto mt-2 flex max-w-[360px] flex-col gap-0.5 rounded-lg bg-black/30 px-3 py-1.5 text-left text-[13px]">
          {r.pas.map((pa, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-white/50">{pa.inning}회</span>
              <span className="flex-1 px-3" style={{ color: pa.kind === "HR" ? "#ffd23f" : pa.kind === "HIT" ? "#7dff9a" : pa.kind === "BB" ? "#7ad7ff" : pa.kind === "K" ? "#ff8a8a" : "#fff" }}>
                {pa.text}
                {pa.rbi ? ` (${pa.rbi}타점)` : ""}
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
        확인
      </Btn>
    </Modal>
  );
}

function SeasonModal({ s, c, onClose }: { s: SeasonSummary; c: Career; onClose: () => void }) {
  const L = s.line;
  return (
    <Modal w={520}>
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
        <div className="mt-3 flex justify-center gap-2">
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
      <div className="mt-2 flex flex-col gap-0.5 text-[13px] text-white/75">
        {s.lines
          .filter((l) => !l.startsWith("스카우트") && !l.startsWith("수상"))
          .map((l, i) => (
            <div key={i}>{l}</div>
          ))}
      </div>
      <div className="mt-1 text-[13px] text-white/60">
        종합 {ovrOf(c)} ({gradeOf(ovrOf(c)).g}){s.retire ? "" : ` · 비시즌 ${OFF_TURNS}턴 뒤 ${s.season + 1}년차`}
      </div>
      <Btn className="mt-4 w-full py-2.5 text-lg" color="#ffd23f" onClick={onClose}>
        {s.retire ? "은퇴식으로" : "비시즌으로"}
      </Btn>
    </Modal>
  );
}

function ShopModal({ c, onClose, onBuy, onUse }: { c: Career; onClose: () => void; onBuy: (id: ItemId) => void; onUse: (id: ItemId) => void }) {
  return (
    <Modal w={640} onClose={onClose}>
      <div className="flex items-center justify-between">
        <div className={`${font.title} text-[26px]`}>상점</div>
        <div className="font-mono text-[15px] font-bold text-[#ffd23f]">자금 {c.money.toLocaleString()}만원</div>
      </div>
      <div className="mt-1 text-left text-[12px] text-white/50">경기 수당 · 연봉으로 모은 자금으로 사요 (턴 안 씀)</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {ITEM_IDS.map((id) => {
          const it = ITEMS[id];
          const owned = it.gear && c.gear.includes(id);
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
                <Btn className="px-2.5 py-1 text-[12px]" color="#7dff9a" onClick={() => onUse(id)}>
                  쓰기
                </Btn>
              )}
              <Btn className="w-[86px] py-1 text-[12px]" color="#ffd23f" disabled={owned || c.money < it.price} onClick={() => onBuy(id)}>
                {owned ? "보유" : `${it.price}만`}
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

function OutingModal({ c, onClose, onPick }: { c: Career; onClose: () => void; onPick: (id: CharId) => void }) {
  return (
    <Modal w={760} onClose={onClose}>
      <div className={`${font.title} text-[26px]`}>누구를 만나러 갈까?</div>
      <div className="text-[12px] text-white/55">
        만남 {BOND_AT.join(" · ")}번째에 이벤트 — ②고르기 ③특수능력 ④필살타법 전수 (필살은 하나만 · 끝까지 친해지면 각성할 수도)
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {CHARS.map((ch) => {
          const b = BONDS[ch.id];
          const v = c.bonds[ch.id] ?? 0;
          const st = bondStage(v);
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => {
                sfx.ui();
                onPick(ch.id);
              }}
              className="flex cursor-pointer flex-col items-center overflow-hidden rounded-xl border-2 bg-[#0b0e1c] pb-1.5 transition-transform hover:-translate-y-0.5"
              style={{ borderColor: `${ch.color}88` }}
            >
              <img src={faceUrl(ch.id)} alt={ch.name} className="mt-1.5 h-[80px] w-[80px] rounded-lg object-cover object-top" style={{ outline: `2px solid ${ch.color}66` }} draggable={false} />
              <div className={`${font.title} mt-1 text-[16px]`} style={{ color: ch.color }}>
                {ch.name}
              </div>
              <div className="text-[11px] text-white/55">
                {b.place} · {STAT_NAME[b.stat]}
              </div>
              <div className="mt-0.5 flex gap-0.5">
                {Array.from({ length: BOND_AT[3] }, (_, i) => (
                  <span key={i} className="text-[11px]" style={{ color: i < v ? ch.color : "rgba(255,255,255,0.2)" }}>
                    {BOND_AT.includes(i + 1) ? "◆" : "•"}
                  </span>
                ))}
              </div>
              <div className="text-[10.5px] text-white/50">{st >= 4 ? (c.learned === ch.id ? `「${ch.swing.name}」 전수` : "인연 완료") : st >= 3 ? `다음: ${ch.swing.name}` : st >= 2 ? `다음: ${SKILLS[`sk_${ch.id}` as keyof typeof SKILLS].name}` : st === 1 ? "다음: 고르기" : "처음 만남"}</div>
            </button>
          );
        })}
      </div>
      <Btn className="mt-3 w-full py-2" color="#8b93b8" onClick={onClose}>
        취소
      </Btn>
    </Modal>
  );
}

function RecordsModal({ c, onClose }: { c: Career; onClose: () => void }) {
  const rows = [...c.seasons.map((s) => ({ k: `${s.season}년차`, l: s.line, aw: s.awards.join(" · "), ovr: s.ovr })), ...(c.line.g ? [{ k: `${c.season}년차 (진행)`, l: c.line, aw: "", ovr: ovrOf(c) }] : [])];
  return (
    <Modal w={640} onClose={onClose}>
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
        팀 성적 {c.wins}승 {c.losses}패 · 연봉 {c.salary.toLocaleString()}만원 · 훈련 횟수{" "}
        {TRAIN_KEYS.map((k) => `${TRAINS[k].name.replace(" 훈련", "")} ${c.tCount[k]}`).join(" · ")}
      </div>
      {c.gp.length > 0 && <div className="mt-1 text-left text-[12px] text-[#ffd23f]/80">GP 부스트: {c.gp.map((g) => GP_BOOSTS[g].name).join(" · ")}</div>}
      <Btn className="mt-3 w-full py-2" color="#8b93b8" onClick={onClose}>
        닫기
      </Btn>
    </Modal>
  );
}

/* ─────────────── 은퇴 · 명예의 전당 ─────────────── */

function Retire({ c, onHome, onNew, onHof }: { c: Career; onHome: () => void; onNew: () => void; onHof: () => void }) {
  const r = retireCard(c);
  const t = r.total;
  return (
    <div className="flex h-full items-center justify-center gap-6 px-8">
      <div className="flex flex-col items-center">
        <div className="rounded-2xl bg-gradient-to-b from-[#ffd23f]/25 to-transparent p-2">
          <Portrait c={c} w={170} h={220} />
        </div>
        <div className={`${font.title} mt-1 text-[28px]`}>{c.name}</div>
        <div className="text-[13px] text-white/60">
          #{c.num} · {TYPES[c.type].name} · 재능 {talentName(c)}
          {c.awakened ? " (각성)" : ""}
        </div>
      </div>
      <div className="flex w-[540px] flex-col gap-2">
        <div className="text-[14px] text-white/60">은퇴 — {SEASONS}시즌 커리어 종합</div>
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
          {r.awards.length > 0 && (
            <div className="font-['Nanum_Gothic'] text-[12px] text-[#ffd23f]">
              수상:{" "}
              {[...new Set(r.awards)].map((a) => `${a}${r.awards.filter((x) => x === a).length > 1 ? ` ×${r.awards.filter((x) => x === a).length}` : ""}`).join(" · ")}
            </div>
          )}
          <div className="font-['Nanum_Gothic'] text-[12px] text-white/55">
            특수능력 {c.skills.length}개{c.learned ? ` · 필살 「${charById(c.learned).swing.name}」 (+${LEARNED_VAL})` : ""} · 최종 연봉 {c.salary.toLocaleString()}만원
          </div>
        </div>
        <div className="text-[12px] text-white/45">명예의 전당에 올라갔어요 (이 브라우저). 서버 랭킹 · 나만의 구단으로 데려가기는 다음 단계예요.</div>
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
                    {fmtAvg(e.avg)} · {e.hr}HR
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
