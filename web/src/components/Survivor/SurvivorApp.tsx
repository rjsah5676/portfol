"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "@/lib/AuthContext";
import { FREE_HEROES, GRADE_FLOOR, HEROES, HERO_IDS, PASSIVES, RUN_SEC, WEAPONS, powerBonus, type HeroId, type Stats } from "@/lib/survivor/data";
import { TEAM_BONUS, TEAM_NAME, TEAM_OF, UPGRADES, supportBonus, upBonus, upCost, type UpId } from "@/lib/survivor/progress";
import type { RunResult } from "@/lib/survivor/sim";
import { survivor, type FinishOut, type SurvivorProfile } from "@/realtime/survivor";
import Token from "../Marble/Token";
import { playBgm, sfx } from "./audio";
import Game, { ItemIcon, type GameSetup } from "./Game";
import Stage from "./Stage";

type Scene = { k: "title" } | { k: "pick" } | { k: "play"; setup: GameSetup; run: string | null } | { k: "result"; r: RunResult; fin: FinishOut | null; err: string };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const GRADE_COL: Record<string, string> = { R: "#9fb6ff", SR: "#c58bff", SSR: "#ffb03a", UR: "#ff4fa3" };
const TEAM_KEY = "pts-team";

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
  const [note, setNote] = useState("");
  useEffect(() => {
    try {
      const t = JSON.parse(localStorage.getItem(TEAM_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 지난 편성 불러오기 (브라우저에서만)
      if (t?.main && HEROES[t.main as HeroId]) setTeam({ main: t.main, sup: (t.sup ?? []).filter((h: HeroId) => HEROES[h]).slice(0, 2) });
    } catch {}
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그아웃하면 프로필 비움
    if (!member) return setProf(null);
    void survivor.profile().then(setProf, (e) => setNote((e as Error).message));
  }, [member]);
  useEffect(() => {
    if (scene.k !== "play") playBgm("night");
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
    const setup: GameSetup = {
      hero: main,
      sup,
      seed: Math.floor(Math.random() * 2 ** 31),
      bonus: addAll(powerBonus(HEROES[main].grade, lvOf(main)), ub.stats, sb.stats),
      opts: { sup, revive: ub.revive, rerolls: ub.rerolls },
    };
    let run: string | null = null;
    if (member) {
      try {
        run = (await survivor.start(main, sup)).run;
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
    void survivor.finish(run, { sec: r.sec, kills: r.kills, lv: r.lv, win: r.win, coins: r.coins }).then(
      (fin) => {
        setScene((s) => (s.k === "result" ? { ...s, fin } : s));
        setProf((p) => (p ? { ...p, ...fin.profile, stars: p.stars + fin.stars } : p));
      },
      (e) => setScene((s) => (s.k === "result" ? { ...s, err: (e as Error).message } : s))
    );
  }, []);
  const onQuit = useCallback(() => setScene({ k: "pick" }), []);
  return (
    <Stage>
      {scene.k === "title" && <Title onStart={() => setScene({ k: "pick" })} />}
      {scene.k === "pick" && <Pick prof={prof} member={member} team={team} owned={owned} note={note} onTeam={saveTeam} onStart={() => void start()} onBack={() => setScene({ k: "title" })} onProf={setProf} />}
      {scene.k === "play" && <Game key={scene.setup.seed} setup={scene.setup} onEnd={onEnd} onQuit={onQuit} />}
      {scene.k === "result" && <Result r={scene.r} fin={scene.fin} err={scene.err} member={member} onAgain={() => void start()} onPick={() => setScene({ k: "pick" })} />}
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
  prof,
  member,
  team,
  owned,
  note,
  onTeam,
  onStart,
  onBack,
  onProf,
}: {
  prof: SurvivorProfile | null;
  member: boolean;
  team: { main: HeroId; sup: HeroId[] };
  owned(h: HeroId): boolean;
  note: string;
  onTeam(t: { main: HeroId; sup: HeroId[] }): void;
  onStart(): void;
  onBack(): void;
  onProf(p: SurvivorProfile): void;
}) {
  const [look, setLook] = useState<HeroId>(team.main);
  const [slot, setSlot] = useState(0);
  const [shop, setShop] = useState(false);
  const h = HEROES[look];
  const w = WEAPONS[h.weapon];
  const lv = prof?.chars[look]?.lv ?? 0;
  const can = owned(look);
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
      <img src="/survivor/title.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" draggable={false} />
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
              <button type="button" onClick={() => setShop(true)} className="pts-btn h-[30px] px-[12px] text-[12px]" style={{ "--c": "#4ff0c8" } as CSSProperties}>
                영구 강화
              </button>
              <a href="/games/marble/" className="pts-btn ghost flex h-[30px] items-center px-[12px] text-[12px]">
                캐릭터 뽑기 ↗
              </a>
            </>
          ) : (
            <span className="pts-sub text-[#a9a2d6]">로그인하면 다이스 타운 캐릭터 · 보상 · 랭킹 · 영구 강화</span>
          )}
        </span>
      </div>

      {/* 캐릭터 16명 */}
      <div className="absolute top-[58px] left-[18px] grid w-[452px] grid-cols-4 gap-[8px]">
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
            {!can && <p className="pts-sub text-[12px] text-[#ff9cc8]">다이스 타운 캐릭터 뽑기에서 얻을 수 있어요</p>}
          </div>
        </div>
        {/* 편성 */}
        <div className="mt-[8px] flex items-end gap-[10px] border-t-2 border-[#2a2468] pt-[10px]">
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
          <div className="min-w-0 flex-1 text-[11.5px] leading-[16px]">
            {sb.team ? (
              <p className="pts-sub text-[#ffd23a]">
                ★ 팀 시너지 「{TEAM_NAME[sb.team]}」 {TEAM_BONUS[sb.team].desc}
              </p>
            ) : (
              <p className="text-[#a9a2d6]">같은 계열 셋이면 팀 시너지! ({TEAM_NAME[TEAM_OF[team.main]]})</p>
            )}
            <p className="text-[#a9a2d6]">동료는 패시브 절반 + 필살기 쓸 때 거들기</p>
            {note && <p className="text-[#ff8fb8]">{note}</p>}
          </div>
          <button type="button" onClick={onStart} disabled={!owned(team.main)} className="pts-btn h-[50px] shrink-0 px-[22px] text-[19px]" style={{ "--c": "#ff4fa3", "--t": "#fff" } as CSSProperties}>
            출발! ▶
          </button>
        </div>
      </div>
      {shop && prof && <Shop prof={prof} onProf={onProf} onClose={() => setShop(false)} />}
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

/* ───────────── 결과 ───────────── */

function Result({ r, fin, err, member, onAgain, onPick }: { r: RunResult; fin: FinishOut | null; err: string; member: boolean; onAgain(): void; onPick(): void }) {
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
              ["코인", r.coins.toLocaleString(), "#ffd23a"],
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
            <span className="pts-tag self-start text-[11px]">무기 피해</span>
            {r.weapons.slice(0, 6).map((w) => (
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
            {!member ? (
              <span className="text-[#a9a2d6]">로그인하면 별사탕(캐릭터 뽑기) · 코인(영구 강화) · 랭킹이 쌓여요</span>
            ) : fin ? (
              <>
                <span className="pts-box px-[10px] py-[4px] text-[#ff9cc8]">★ 별사탕 +{fin.stars}{fin.first ? " (오늘 첫 클리어!)" : ""}</span>
                <span className="pts-box px-[10px] py-[4px] text-[#ffd23a]">● 코인 +{fin.gold}</span>
                <span className="pts-box px-[10px] py-[4px] text-[#4ff0c8]">{fin.best ? "최고 기록! " : ""}랭킹 {fin.rank}위</span>
              </>
            ) : err ? (
              <span className="text-[#ff8fb8]">{err}</span>
            ) : (
              <span className="pts-blink text-[#a9a2d6]">보상 받는 중…</span>
            )}
          </div>
          <div className="mt-auto flex justify-end gap-[12px] pt-[16px]">
            <button type="button" onClick={onPick} className="pts-btn ghost h-[40px] px-[16px] text-[14px]">
              캐릭터 바꾸기
            </button>
            <button type="button" onClick={onAgain} className="pts-btn h-[40px] px-[26px] text-[16px]" style={{ "--c": "#ff4fa3", "--t": "#fff" } as CSSProperties}>
              한 판 더!
            </button>
          </div>
        </div>
      </div>
      <span className="pts-sub absolute bottom-[12px] text-[11px] text-white/60">{r.win ? `${fmt(RUN_SEC)} 생존 · 자정의 시계지기 처치` : "레벨업 카드로 빌드를 모아 보세요"}</span>
    </div>
  );
}
