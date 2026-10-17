"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BLESS, DASH_CD, DT, ENEMIES, EVOLUTIONS, FLAG_NAME, GIMMICK_GUIDE, type GuideK, PATROL_EVOLUTIONS, GUARD_HP, HEROES, PASSIVES, RARITY_COLOR, RARITY_NAME, STAGES, ULT_NEED, VIEW_H, VIEW_W, WEAPONS, type FlagBuff, type HeroId, type PassiveId, type StageId, type Stats, type WeaponId } from "@/lib/survivor/data";
import { RELICS, RELIC_RARITY_COLOR, RELIC_RARITY_NAME, type RelicId } from "@/lib/survivor/relics";
import { ARMY_CAP, ARMY_GRADE_COLOR, ARMY_GRADE_NAME, FACTION_COLOR, FACTION_NAME, UNIT, buyCost, craftable, mergeKey, mergeable } from "@/lib/survivor/army";
import { armyBuy, armyCraft, armyMerge, banishCard, bossLimit, buyRelic, chooseBless, chooseCard, chooseWish, closeChest, dawnChoice, leaveThing, maxHp, needXp, newRun, reroll, result, step, type Card, type Ev, type Input, type Pause, type Run, type RunOpts, type RunResult } from "@/lib/survivor/sim";
import { getArt, loadFiles, loadHero, type HeroArt } from "./art";
import { jingle, playBgm, preloadSfx, sfx, type Sfx } from "./audio";
import SoundSliders from "./SoundSliders";
import { useStage } from "./Stage";
import { draw, mobColor, newFx, preloadLight, tickFx, type Fx, type HitK } from "./render";

/* ───────────── 아이콘 (public/survivor/icon/<id>.png — 없으면 색 · 첫 글자) ───────────── */

export type IconKind = "weapon" | "passive" | "relic";
const iconDef = (k: IconKind, id: string) => (k === "weapon" ? WEAPONS[id as WeaponId] : k === "passive" ? PASSIVES[id as PassiveId] : RELICS[id as RelicId]);

export function ItemIcon({ k, id, size = 26 }: { k: IconKind; id: WeaponId | PassiveId | RelicId; size?: number }) {
  const [bad, setBad] = useState(false);
  const def = iconDef(k, id);
  if (bad || !def)
    return (
      <span className="flex shrink-0 items-center justify-center font-bold text-[#07051a] select-none" style={{ width: size, height: size, background: def?.color ?? "#888", fontSize: Math.round(size * 0.5), boxShadow: "inset 0 0 0 2px #07051a" }}>
        {def?.name[0] ?? "?"}
      </span>
    );
  return <img src={`/survivor/icon/${id}.png`} alt={def.name} draggable={false} onError={() => setBad(true)} className="shrink-0 select-none" style={{ width: size, height: size, objectFit: "contain", imageRendering: size >= 40 ? "pixelated" : "auto" }} />;
}

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;
const STAT_LABEL: Partial<Record<keyof Stats, [string, "pct" | "num" | "neg"]>> = {
  might: ["피해", "pct"],
  cooldown: ["쿨타임", "neg"],
  area: ["범위", "pct"],
  amount: ["투사체", "num"],
  speed: ["이동 속도", "pct"],
  maxHp: ["최대 체력", "num"],
  regen: ["초당 회복", "num"],
  armor: ["방어", "num"],
  magnet: ["줍는 범위", "pct"],
  luck: ["행운", "num"],
  growth: ["경험치", "pct"],
};
const statFmt = (k: keyof Stats, v: number) => {
  const f = STAT_LABEL[k]?.[1] ?? "num";
  if (f === "neg") return `−${Math.round(v * 100)}%`;
  if (f === "pct") return pct(v);
  return `${v >= 0 ? "+" : ""}${Math.round(v * 10) / 10}`;
};

/** 카드 숫자: 무기 레벨 수치 변화 · 패시브 합 변화 */
function cardLines(c: Card): string[] {
  if (c.k === "weapon") {
    const d = WEAPONS[c.id as WeaponId];
    const b = d.lv[Math.max(0, c.to - 1)];
    if (c.from === 0) return [`피해 ${b.dmg} · 쿨 ${b.cd ? b.cd + "초" : "계속"}${b.n > 1 ? ` · ${b.n}개` : ""}`];
    const a = d.lv[c.from - 1];
    const out: string[] = [];
    if (a.dmg !== b.dmg) out.push(`피해 ${a.dmg} → ${b.dmg}`);
    if (a.n !== b.n) out.push(`개수 ${a.n} → ${b.n}`);
    if (a.cd !== b.cd) out.push(`쿨타임 ${a.cd} → ${b.cd}초`);
    if (a.size !== b.size) out.push(`크기 ${a.size} → ${b.size}`);
    if (a.pierce !== b.pierce && b.pierce < 99) out.push(`관통 ${a.pierce} → ${b.pierce}`);
    if (a.dur !== b.dur && a.dur > 0) out.push(`지속 ${a.dur} → ${b.dur}초`);
    if (a.spd !== b.spd && d.pattern === "orbit") out.push("회전 더 빨리");
    return out;
  }
  if (c.k === "passive") {
    const d = PASSIVES[c.id as PassiveId];
    return (Object.entries(d.per) as [keyof Stats, number][]).map(([k, v]) => `${STAT_LABEL[k]?.[0] ?? k} ${statFmt(k, v * c.from)} → ${statFmt(k, v * c.to)}`);
  }
  return [];
}

/** 이 무기의 진화 (순찰대 판이면 새 무기 진화도) */
export const evoOf = (w: WeaponId, patrol: boolean): WeaponId | undefined => [...EVOLUTIONS, ...(patrol ? PATROL_EVOLUTIONS : [])].find((e) => WEAPONS[e].evo![0] === w);
/** 이 능력치가 재료인 진화 (가진 무기 것만) */
const evosNeeding = (pid: PassiveId, own: WeaponId[], patrol: boolean) => [...EVOLUTIONS, ...(patrol ? PATROL_EVOLUTIONS : [])].filter((e) => WEAPONS[e].evo![1] === pid && own.includes(WEAPONS[e].evo![0]));
/** 진화 준비: 무기 최대 레벨 + 짝 능력치 */
const evoReady = (w: { id: WeaponId; lv: number }, hud: Hud) => {
  const e = evoOf(w.id, !!hud.ch);
  return !!e && w.lv >= WEAPONS[w.id].lv.length && hud.passives.some((p) => p.id === WEAPONS[e].evo![1]);
};

const cardText = (c: Card): { name: string; desc: string; k: IconKind | null; id?: WeaponId | PassiveId | RelicId } => {
  if (c.k === "fuse" || c.k === "evo") {
    const d = WEAPONS[c.id as WeaponId];
    return { name: d.name, desc: d.desc[0], k: "weapon", id: c.id };
  }
  if (c.k === "awake") {
    const d = WEAPONS[c.id as WeaponId];
    return { name: `각성 ${d.name}`, desc: "피해 ×1.6 · +1개 · 크기 ×1.2 · 더 빨리", k: "weapon", id: c.id };
  }
  if (c.k === "relic") {
    const d = RELICS[c.id as RelicId];
    return { name: d.name, desc: d.desc, k: "relic", id: c.id };
  }
  if (c.k === "weapon") {
    const d = WEAPONS[c.id as WeaponId];
    const lines = [];
    for (let l = c.from + 1; l <= c.to; l++) lines.push(d.desc[l - 1]);
    return { name: d.name, desc: lines.join(" · "), k: "weapon", id: c.id };
  }
  if (c.k === "passive") {
    const d = PASSIVES[c.id as PassiveId];
    const n = c.to - c.from;
    return { name: d.name, desc: n > 1 ? `${d.desc} (×${n})` : d.desc, k: "passive", id: c.id };
  }
  return c.k === "coin" ? { name: "금화 주머니", desc: "금화 +25", k: null } : { name: "따끈한 고기", desc: "체력 +40", k: null };
};

/* ───────────── 입력 ───────────── */

function useKeys() {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      keys.current.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return keys;
}

interface Hud {
  t: number;
  /** 판 길이 (이때 마지막 보스) · 챕터 이름 */
  len: number;
  ch: string | null;
  hp: number;
  max: number;
  lv: number;
  xp: number;
  kills: number;
  gold: number;
  ult: number;
  dash: number;
  boss: { name: string; hp: number; left: number; rage: boolean } | null;
  weapons: { id: WeaponId; lv: number; awake?: boolean }[];
  passives: { id: PassiveId; lv: number }[];
  relics: { id: RelicId; n: number }[];
  rerolls: number;
  skips: number;
  banish: number;
  stats: Stats;
  flag: { k: FlagBuff; t: number } | null;
  curse: number;
  depth: number;
  ot: boolean;
  otT: number;
  otLv: number;
  /** 진행 중인 시련 남은 시간 */
  trial: number;
  /** 자정의 종 남은 시간 · 다음 종까지 (시계탑 광장) */
  toll: number;
  tollNext: number;
  /** 순찰대 특수 판 목표: 문구 · 진행 · 끝남/실패 · 등불 체력 */
  quest: { text: string; got: number; need: number; done: boolean; fail: boolean; hp: number } | null;
  /** 럭키 출격 부대 (묶음: 세력 · 등급) */
  army: { groups: { key: string; id: string; n: number; grade: number; faction: string }[]; count: number; cost: number; merge: string | null; craft: { id: string; name: string } | null } | null;
}
const hudOf = (r: Run): Hud => {
  const b = r.bossId >= 0 ? r.enemies.find((e) => e.id === r.bossId) : undefined;
  return {
    t: r.t,
    len: r.len,
    ch: r.ch ? (r.ch.st ? `${r.ch.id}-${r.ch.sub} · ${r.ch.name}` : `챕터 ${r.ch.id} · ${r.ch.name}`) : null,
    hp: r.p.hp,
    max: maxHp(r),
    lv: r.p.lv,
    xp: r.p.xp / needXp(r),
    kills: r.p.kills,
    gold: r.p.gold,
    ult: r.p.ult / ULT_NEED,
    dash: 1 - r.p.dashCd / DASH_CD,
    boss: b ? { name: b.def.name, hp: b.hp / b.maxHp, left: Math.max(0, bossLimit(b.kind) - (b.boss?.age ?? 0)), rage: !!b.boss?.rage } : null,
    weapons: r.weapons.map((w) => ({ id: w.id, lv: w.lv, awake: w.awake })),
    passives: r.passives.map((p) => ({ ...p })),
    relics: r.relicOrder.map((id) => ({ id, n: r.relics[id] ?? 0 })),
    rerolls: r.rerolls,
    skips: r.skips,
    banish: r.banish,
    stats: { ...r.stats },
    flag: r.flag ? { ...r.flag } : null,
    curse: r.curse,
    depth: r.depth,
    ot: r.ot,
    otT: r.otT,
    otLv: r.otLv,
    trial: r.things.find((t) => t.alive && t.k === "trial" && t.on)?.t ?? 0,
    toll: r.toll.on,
    army: r.army ? armyHud(r) : null,
    tollNext: r.def.toll ? r.toll.next - r.t : 0,
    quest: r.quest
      ? {
          text: r.quest.q.k === "goblin" ? "보물 도깨비" : r.quest.q.k === "rush" ? "정예 처치" : "등불 지키기",
          got: r.quest.got,
          need: r.quest.need,
          done: r.quest.done,
          fail: r.quest.fail,
          hp: r.guard?.alive ? Math.max(0, r.guard.t) / GUARD_HP : 0,
        }
      : null,
  };
};

function armyHud(r: Run): NonNullable<Hud["army"]> {
  const a = r.army!;
  const ids = a.units.map((u) => u.id);
  const groups = new Map<string, { key: string; id: string; n: number; grade: number; faction: string }>();
  for (const id of ids) {
    const d = UNIT[id];
    // 레전드 이상은 하나씩 (조합식 재료라 이름이 중요)
    const key = d.grade >= 3 ? id : mergeKey(id);
    const g = groups.get(key) ?? { key, id, n: 0, grade: d.grade, faction: d.faction };
    g.n++;
    if (UNIT[g.id].grade < d.grade) g.id = id;
    groups.set(key, g);
  }
  const cr = craftable(ids)[0];
  return {
    groups: [...groups.values()].sort((x, y) => y.grade - x.grade || x.faction.localeCompare(y.faction)),
    count: ids.length,
    cost: buyCost(a.bought),
    merge: mergeable(ids)[0] ?? null,
    craft: cr ? { id: cr.id, name: UNIT[cr.id].name } : null,
  };
}

/** 무기 계열 → 발사 · 타격 소리 */
type Fam = "lantern" | "blade" | "boom" | "thunder" | "thorn" | "missile" | "ball" | "water" | "grenade" | "notes" | "coin";
const FAM: Partial<Record<WeaponId, Fam>> = {
  lantern: "lantern",
  shuriken: "blade", gale: "blade", blades: "blade", cards: "blade", whip: "blade",
  boomerang: "boom", cyclone: "boom", apple: "boom", kick: "boom", punch: "boom",
  bolt: "thunder", judgment: "thunder", lance: "thunder",
  thorns: "thorn", rose: "thorn", sleep: "thorn",
  missile: "missile", barrage: "missile", fireball: "missile", parcel: "missile", roll: "missile",
  ball: "ball", rainbow: "ball", pinball: "ball", circus: "ball", dice6: "ball",
  umbrella: "water", grenade: "grenade", notes: "notes", coins: "coin",
  downpour: "water", cluster: "grenade", symphony: "notes", goldrain: "coin",
};
const HIT: Record<Fam, Sfx> = {
  lantern: "w_lantern_hit",
  blade: "w_blade_hit",
  boom: "w_boom_hit",
  thunder: "w_thunder_hit",
  thorn: "w_thorn_hit",
  missile: "w_missile_hit",
  ball: "w_ball_hit",
  water: "w_water_hit",
  // 수류탄은 맞을 때 말고 터질 때 (boom) 한 번
  grenade: "w_blade_hit",
  notes: "w_notes_hit",
  coin: "w_coin_hit",
};
const FIRE: Partial<Record<Fam, Sfx>> = { lantern: "w_lantern_fire", blade: "w_blade_fire", boom: "w_boom_fire", missile: "w_missile_fire", ball: "w_ball_fire", grenade: "w_grenade_fire", notes: "w_notes_fire", coin: "w_coin_fire" };
/** 타격 그림: 무기 계열 → 그림 · 지름 · 길이 · 화면에 최대 몇 개 */
const HIT_FX: Partial<Record<Fam, { k: HitK; s: number; life: number; max: number }>> = {
  water: { k: "water", s: 24, life: 0.3, max: 12 },
  notes: { k: "notes", s: 26, life: 0.36, max: 10 },
  coin: { k: "coins", s: 16, life: 0.26, max: 14 },
};
/** 음표 파동: 박자마다 펜타토닉 음계를 따라 올라갔다 내려옴 (도 레 미 솔 라) */
const NOTE_STEPS = [0, 2, 4, 7, 9, 12, 9, 7, 4, 2];
/** 몹 색을 어둡게 (바닥 얼룩) */
const dark = (hex: string) => {
  const v = parseInt(hex.slice(1, 7), 16);
  const f = (x: number) => Math.round(x * 0.45);
  return `rgb(${f((v >> 16) & 255)},${f((v >> 8) & 255)},${f(v & 255)})`;
};
/** 판 음악: 순찰대는 챕터마다 (곡이 없으면 1장 곡) · 서바이버는 밤 */
const CH_BGM: Record<number, string> = { 1: "pt_ch1", 2: "pt_ch2", 3: "pt_ch3", 4: "pt_ch4", 5: "pt_ch5", 6: "pt_ch6" };
const HAS_BGM = new Set(["pt_ch1", "pt_ch2", "pt_ch3", "pt_ch4", "pt_ch5", "pt_ch6"]);
const stageBgm = (r: Run) => {
  if (!r.ch) return "night";
  const n = CH_BGM[r.ch.id] ?? "pt_ch1";
  // 곡이 아직 없으면: 구역 2 는 밤 축제(2장) 곡 · 나머지는 1장 곡
  return HAS_BGM.has(n) ? n : r.ch.id >= 4 ? "pt_ch2" : "pt_ch1";
};
/** 필살기 컷인 그림 (public/patrol/cutin) */
const CUTIN: Partial<Record<HeroId, string>> = { bandi: "/patrol/cutin/bandi.webp" };
/** 연속 처치 외침 */
const COMBO_SHOUT: Record<number, string> = { 25: "좋아요!", 50: "대단해요!", 100: "엄청나요!!", 200: "멈출 수 없어!!", 500: "전설의 순찰!!!" };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const THING_COLOR: Record<string, string> = { shrine: "#7ff0d8", gshrine: "#ffd23a", statue: "#ffd23a", bell: "#ff8a6b", flag: "#ff9cc8", box: "#ffd23a", merchant: "#c58bff", fountain: "#7ad7ff", trial: "#e0d8ff" };

/* ───────────── 판 ───────────── */

export interface GameSetup {
  hero: HeroId;
  sup: HeroId[];
  seed: number;
  bonus: Partial<Stats>;
  opts: RunOpts;
}

export default function Game({ setup, onEnd, onQuit }: { setup: GameSetup; onEnd(r: RunResult): void; onQuit(): void }) {
  const { hero, sup, seed } = setup;
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [run0] = useState(() => newRun(hero, seed, setup.bonus, setup.opts));
  const runRef = useRef<Run>(run0);
  const fxRef = useRef<Fx>(newFx());
  const heroArt = useRef<HeroArt | null>(null);
  const supArt = useRef<(HeroArt | null)[]>([]);
  const keys = useKeys();
  const stick = useRef({ x: 0, y: 0, on: false, bx: 0, by: 0, id: -1 });
  const btn = useRef({ dash: false, ult: false });
  const [hud, setHud] = useState<Hud>(() => hudOf(run0));
  const [pause, setPause] = useState<Pause | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(false);
  const [banner, setBanner] = useState<{ id: number; text: string; c: string } | null>(null);
  const [stickView, setStickView] = useState<{ bx: number; by: number; x: number; y: number } | null>(null);
  const ended = useRef(false);
  const noteN = useRef(0);
  const evoSaid = useRef(new Set<WeaponId>());
  /** 기믹 안내: 판마다 처음 한 번 · 브라우저마다 종류별 3번까지 */
  const [guide, setGuide] = useState<{ id: number; k: GuideK } | null>(null);
  const guided = useRef(new Set<GuideK>());
  const closeGuide = useCallback(() => setGuide(null), []);

  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);
  // 개발 중에만: 콘솔 · 자동 테스트에서 판 상태 보기
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __pts?: { current: Run } }).__pts = runRef;
  }, []);

  useEffect(() => {
    let alive = true;
    // 캐릭터는 4배 해상도로 준비해서 고해상도 화면에서 또렷하게
    void loadHero(HEROES[hero].sprite, 40, 4).then((a) => alive && (heroArt.current = a));
    sup.forEach((h, i) => void loadHero(HEROES[h].sprite, 26, 4).then((a) => alive && (supArt.current[i] = a)));
    getArt();
    void loadFiles();
    preloadSfx();
    if (hero === "bandi") preloadLight();
    playBgm(stageBgm(runRef.current));
    return () => {
      alive = false;
      playBgm(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero]);

  const say = useCallback((text: string, c = "#ffd23a") => setBanner({ id: Date.now(), text, c }), []);
  const lastNoGold = useRef(0);
  const lastUlt = useRef(0);
  const [toasts, setToasts] = useState<{ id: number; relic: RelicId }[]>([]);
  const toast = useCallback((relic: RelicId) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, relic }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  /** 연속 처치 (2.5초 안에 다음 처치가 없으면 끊김) */
  const stg = useStage();
  const combo = useRef({ n: 0, at: 0, best: 0 });
  const [cut, setCut] = useState<{ id: number; hero: HeroId } | null>(null);
  /** 한꺼번에 처치 (0.25초 창) */
  const multi = useRef({ n: 0, at: 0, shown: 0 });
  const [multiN, setMultiN] = useState<{ id: number; n: number } | null>(null);
  const [comboN, setComboN] = useState(0);

  /** 시뮬에서 나온 일 → 화면 효과 · 소리 */
  const onEv = useCallback(
    (evs: Ev[]) => {
      const fx = fxRef.current;
      let dmgN = 0;
      for (const e of evs) {
        switch (e.t) {
          case "dmg": {
            if (dmgN++ < 14) fx.nums.push({ x: e.x + (Math.random() - 0.5) * 6, y: e.y, v: e.v, crit: e.crit, t: 0 });
            const f = e.w && FAM[e.w];
            if (f !== "grenade") sfx(f ? HIT[f] : "hit", { vol: f ? 0.75 : 1 });
            const hf = f && HIT_FX[f];
            if (hf && fx.hits.filter((h) => h.k === hf.k).length < hf.max) fx.hits.push({ k: hf.k, x: e.x + (Math.random() - 0.5) * 6, y: e.y - 2, s: hf.s * (e.big ? 1.5 : 1), t: 0, life: hf.life, flip: Math.random() < 0.5 });
            if (e.crit) {
              sfx("crit", { vol: e.big ? 1 : 0.55 });
              // 정예 · 보스에 크리티컬 → 아주 잠깐 멈춤
              if (e.big) {
                fx.stop = Math.max(fx.stop, 0.04);
                fx.shake = Math.max(fx.shake, 2);
              }
            }
            break;
          }
          case "kill": {
            const c = mobColor(e.kind);
            // 죽는 몹: 번쩍 → 날아가며 납작 (보스는 따로 크게) · 바닥 얼룩 · 조각 · 하얀 고리
            const big = e.boss ? 2 : e.elite ? 1.7 : 1;
            // 보스는 깜빡이며 떨다 터짐 (렌더 tickFx), 나머진 날아감
            fx.corpses.push({ kind: e.kind, x: e.x, y: e.y, dx: e.dx, dy: e.dy, face: e.face, big, t: 0, boss: e.boss });
            if (fx.corpses.length > 70) {
              const old = fx.corpses.findIndex((x) => !x.boss);
              if (old >= 0) fx.corpses.splice(old, 1);
            }
            // 한꺼번에 여러 마리: 0.25초 안에 8마리 · 20마리 넘으면 쿵 + 흔들림 + 「×N 동시 처치」
            const mk = multi.current;
            const nowT = performance.now();
            if (nowT - mk.at > 250) {
              mk.n = 0;
              mk.shown = 0;
            }
            mk.at = nowT;
            mk.n++;
            const tier = mk.n >= 20 ? 2 : mk.n >= 8 ? 1 : 0;
            if (tier > mk.shown) {
              mk.shown = tier;
              fx.shake = Math.max(fx.shake, tier === 2 ? 7 : 4);
              fx.flash = Math.max(fx.flash, tier === 2 ? 0.45 : 0.22);
              fx.flashC = "#ffffff";
              if (tier === 2) sfx("bossdown", { vol: 0.55, rate: 1.35 });
              else sfx("w_boom_hit", { rate: 0.7 });
            }
            if (tier && mk.n % 4 === 0) setMultiN({ id: nowT, n: mk.n });
            fx.stains.push({ x: e.x, y: e.y, c: dark(c), seed: Math.floor(Math.random() * 1e6), s: Math.round(5 * big), t: 0 });
            if (fx.stains.length > 160) fx.stains.shift();
            if (fx.rings.length < 40) fx.rings.push({ x: e.x, y: e.y - 6, r: 10 * big, c: "#ffffff", t: 0, life: 0.16, fill: false });
            const n = e.boss ? 40 : e.elite ? 16 : 7;
            for (let i = 0; i < n; i++) {
              // 맞은 반대쪽으로 더 많이 튐
              const sp = e.boss ? 260 : 140;
              fx.parts.push({ x: e.x, y: e.y - 5, vx: (Math.random() - 0.5) * sp + e.dx * sp * 0.6, vy: -Math.random() * (e.boss ? 200 : 100) + e.dy * sp * 0.3, c: i % 3 ? c : "#ffffff", t: 0, life: 0.35 + Math.random() * 0.3, s: e.boss ? 3 : 2 });
            }
            if (fx.parts.length > 600) fx.parts.splice(0, fx.parts.length - 600);
            const cb = combo.current;
            const now = performance.now();
            cb.n = now - cb.at < 2500 ? cb.n + 1 : 1;
            cb.at = now;
            if (COMBO_SHOUT[cb.n]) {
              sfx(cb.n >= 100 ? "combo2" : "combo1");
              say(`${cb.n} 연속 처치! ${COMBO_SHOUT[cb.n]}`, cb.n >= 100 ? "#ff4fa3" : "#4ff0c8");
            }
            if (e.boss) {
              fx.shake = 6;
              fx.flash = 0.6;
              fx.flashC = "#ffffff";
              // 보스 처치: 느린 화면 + 깜빡이며 떨다가 0.9초 뒤 터짐
              fx.slow = 1.1;
              fx.stop = 0.12;
              sfx("crit");
              window.setTimeout(() => {
                sfx("bossdown");
                sfx("boom");
              }, 900);
              say(`${ENEMIES[e.kind].name} 처치!`, "#ffd23a");
            } else if (e.elite) {
              fx.stop = Math.max(fx.stop, 0.07);
              fx.shake = Math.max(fx.shake, 4);
              sfx("crit");
              sfx("kill2", { rate: 0.8 });
            } else {
              // 연속 처치가 이어질수록 음이 올라감 (4마리마다 반음 · 한 옥타브까지)
              sfx("kill2", { rate: 2 ** (Math.min(12, Math.floor(cb.n / 4)) / 12), vol: 0.7 });
            }
            break;
          }
          case "gem":
            sfx("gem");
            break;
          case "lvl":
            sfx("lvl");
            break;
          case "pick":
            sfx(e.k === "coin" || e.k === "bag" ? "coin" : "pick");
            if (e.k === "bomb") {
              fx.flash = 1;
              fx.flashC = "#ffffff";
              fx.shake = 8;
              sfx("boom");
            }
            if (e.k === "magnet") say("자석! 젬이 몰려와요", "#9fb6ff");
            break;
          case "hurt":
            fx.hurt = 1;
            fx.shake = Math.max(fx.shake, 3);
            sfx("hurt");
            break;
          case "boom":
            if (e.w === "downpour") {
              // 폭우 우산 빗방울: 큰 물보라
              fx.hits.push({ k: "water", x: e.x, y: e.y - 2, s: 34, t: 0, life: 0.34, flip: Math.random() < 0.5 });
              sfx("w_water_hit", { vol: 0.8, rate: 0.85 + Math.random() * 0.2 });
              break;
            }
            if (e.w === "grenade" || e.w === "cluster") {
              // 수류탄: 폭발 그림 (하얀 섬광 → 불덩이 → 연기) + 쿵
              fx.hits.push({ k: "grenade", x: e.x, y: e.y - 4, s: e.r * 2.6, t: 0, life: 0.45, flip: Math.random() < 0.5 });
              fx.rings.push({ x: e.x, y: e.y, r: e.r * 1.1, c: "#fff2c0", t: 0, life: 0.2, fill: false });
              fx.shake = Math.max(fx.shake, 2.5);
              sfx("w_grenade_hit", { rate: 0.92 + Math.random() * 0.16 });
              break;
            }
            fx.rings.push({ x: e.x, y: e.y, r: e.r, c: e.c, t: 0, life: 0.3, fill: true });
            fx.rings.push({ x: e.x, y: e.y, r: e.r * 1.1, c: "#ffffff", t: 0, life: 0.25, fill: false });
            if (e.r >= 16) sfx("boom");
            break;
          case "guide": {
            if (guided.current.has(e.k)) break;
            guided.current.add(e.k);
            let n = 0;
            try {
              n = Number(localStorage.getItem(`pt-guide-${e.k}`) ?? 0);
              localStorage.setItem(`pt-guide-${e.k}`, String(n + 1));
            } catch {
              /* 저장 안 돼도 보여 줌 */
            }
            if (n < 3) setGuide({ id: Date.now(), k: e.k });
            break;
          }
          case "thorns": {
            // 가시 돋음: 고리 가시가 솟고 · 초록 파편이 튐
            fx.spikes.push({ x: e.x, y: e.y, r: e.r, t: 0, rot: Math.random() * Math.PI });
            for (let i = 0; i < 10; i++) {
              const a = Math.random() * Math.PI * 2;
              const v = 90 + Math.random() * 80;
              fx.parts.push({ x: e.x + Math.cos(a) * e.r * 0.6, y: e.y + Math.sin(a) * e.r * 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8 - 30, c: i % 3 ? "#7dff9a" : "#2f7a3a", t: 0, life: 0.3 + Math.random() * 0.15, s: 2 });
            }
            sfx("w_thorn_fire", { vol: 0.75, rate: 0.95 + Math.random() * 0.1 });
            break;
          }
          case "bolt":
            fx.bolts.push({ x: e.x, y: e.y, r: e.r, t: 0, seed: Math.floor(Math.random() * 1000), j: e.j });
            sfx("w_thunder_hit", { vol: 0.8 });
            break;
          case "fire": {
            const f = FAM[e.w];
            if (f === "notes") {
              // 박자마다 음이 바뀜
              const k = NOTE_STEPS[noteN.current++ % NOTE_STEPS.length];
              sfx("w_notes_fire", { vol: 0.7, rate: Math.pow(2, k / 12) });
              break;
            }
            sfx((f && FIRE[f]) || "throw", { vol: 0.7 });
            break;
          }
          case "dice": {
            const big = e.face >= 6 || fx.dice.length === 0;
            fx.dice.push({ x: e.x, y: e.y, face: e.face, t: 0, big: e.face === 6 && big });
            if (e.face === 6) {
              sfx("jackpot");
              fx.shake = Math.max(fx.shake, 4);
            } else sfx("reel");
            break;
          }
          case "chest":
            sfx("chest");
            break;
          case "boss":
            fx.shake = 8;
            sfx("boss");
            say(e.arena ? `${runRef.current.ch ? (runRef.current.ch.sub && runRef.current.ch.sub < 5 ? "미니 보스" : "챕터 보스") : "새벽 보스"} — ${ENEMIES[e.kind].name}` : `보스 등장 — ${ENEMIES[e.kind].name}`, "#ff3d6e");
            if (e.arena) playBgm(runRef.current.ch ? "pt_boss" : "boss");
            break;
          case "warn":
            sfx("warn");
            say(e.text, "#ff4fa3");
            break;
          case "ult":
            if (CUTIN[e.hero]) {
              // 컷인: 판을 잠깐 멈추고 일러스트가 가로 띠로 지나감
              fx.stop = Math.max(fx.stop, 0.65);
              setCut({ id: Date.now(), hero: e.hero });
              sfx("ult");
              break;
            }
            fx.flash = 1.2;
            fx.flashC = HEROES[e.hero].color;
            fx.shake = 8;
            sfx("ult");
            say(HEROES[e.hero].ult.name + "!", HEROES[e.hero].color);
            break;
          case "lhflash":
            fx.flash = 1.4;
            fx.flashC = "#fff6d8";
            fx.shake = 10;
            fx.stop = Math.max(fx.stop, 0.08);
            fx.bursts.push({ x: e.x, y: e.y, t: 0 });
            sfx("boom");
            sfx("crit");
            break;
          case "dash":
            sfx("dash");
            break;
          case "assist":
            fx.flash = Math.max(fx.flash, 0.5);
            fx.flashC = HEROES[e.hero].color;
            sfx("ult");
            say(`${HEROES[e.hero].name} 거들기!`, HEROES[e.hero].color);
            break;
          case "fuse":
          case "evo":
          case "awake":
            fx.flash = 1.4;
            fx.flashC = "#ffd23a";
            // 진화 · 합체 · 각성: 잠깐 느린 화면
            fx.slow = Math.max(fx.slow, 0.6);
            sfx("fuse");
            say(`${e.t === "fuse" ? "합체" : e.t === "evo" ? "진화" : "각성"}! ${e.t === "awake" ? "각성 " : ""}${WEAPONS[e.id].name}`, "#ffd23a");
            break;
          case "relic":
            toast(e.id);
            sfx("relic");
            break;
          case "thing":
            sfx(e.k === "statue" ? "curse" : e.k === "flag" ? "flag" : e.k === "shrine" || e.k === "gshrine" ? "bless" : "pick");
            say(e.text, THING_COLOR[e.k]);
            break;
          case "trialgo":
            sfx("trial");
            say("원 안에서 25초 버텨요!", "#e0d8ff");
            break;
          case "slam":
            fx.shake = Math.max(fx.shake, 5);
            sfx("slam");
            break;
          case "nogold":
            if (performance.now() - lastNoGold.current > 1500) {
              lastNoGold.current = performance.now();
              sfx("warn");
              say(`금화 ${e.need} 필요해요`, "#ffd23a");
            }
            break;
          case "trial":
            sfx(e.ok ? "jackpot" : "curse");
            say(e.ok ? "시련 성공! 보물 상자 · 큰 경험치" : "원 밖으로 나가서 시련 실패…", e.ok ? "#ffd23a" : "#ff4fa3");
            break;
          case "tide":
            say("🌊 밀물! 물 안 적은 느리고 약해져요", "#5fb8ff");
            sfx("toll", { rate: 0.7, vol: 0.7 });
            fx.shake = Math.max(fx.shake, 2);
            break;
          case "toll":
            if (e.on) {
              fx.shake = 6;
              fx.flash = 0.6;
              fx.flashC = "#ff3d6e";
              sfx("toll");
              say("자정의 종! 적이 빨라지고 경험치 두 배", "#ffb03a");
            } else say("종소리가 그쳤어요", "#a9a2d6");
            break;
          case "rage":
            fx.shake = 8;
            sfx("rage");
            say(`${e.name} 격노! 서둘러요`, "#ff3d6e");
            break;
          case "ot":
            sfx("ot");
            say(e.lv ? `오버타임 Lv${e.lv} — 적이 더 세져요` : "오버타임! 버틸수록 기록이 올라가요", "#ff9cc8");
            if (!e.lv) playBgm("boss");
            break;
          case "summon": {
            const d = UNIT[e.id];
            const p = runRef.current.p;
            if (e.src === "start") break;
            if (e.full) {
              say(`부대가 가득 — ${d.name}는 금화 +${e.full}`, "#ffd23a");
              sfx("coin");
              break;
            }
            fx.rings.push({ x: p.x, y: p.y - 8, r: 14 + d.grade * 6, c: ARMY_GRADE_COLOR[d.grade], t: 0, life: 0.4, fill: false });
            if (e.src === "craft") {
              fx.flash = 1;
              fx.flashC = ARMY_GRADE_COLOR[d.grade];
              fx.shake = 8;
              sfx("legend");
              say(`신화 조합! ${d.name}`, ARMY_GRADE_COLOR[d.grade]);
            } else if (d.grade >= 3) {
              fx.flash = 0.8;
              fx.flashC = ARMY_GRADE_COLOR[d.grade];
              fx.shake = 5;
              sfx("legend");
              say(`${ARMY_GRADE_NAME[d.grade]} ${e.src === "merge" ? "합성" : "소환"}! ${d.name}`, ARMY_GRADE_COLOR[d.grade]);
            } else if (d.grade === 2) {
              sfx("rare");
              say(`에픽 ${e.src === "merge" ? "합성" : "소환"}! ${d.name}`, ARMY_GRADE_COLOR[2]);
            } else sfx(e.src === "merge" ? "fuse" : "reveal");
            break;
          }
          case "ahit":
            if (fx.shots.length < 80) fx.shots.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, c: e.c, melee: e.melee, t: 0 });
            break;
          case "ault":
            fx.rings.push({ x: e.x, y: e.y - 6, r: Math.max(18, e.r), c: e.c, t: 0, life: 0.45, fill: true });
            fx.shake = Math.max(fx.shake, 3);
            if (UNIT[e.id].grade >= 3 && performance.now() - lastUlt.current > 1200) {
              lastUlt.current = performance.now();
              say(`${UNIT[e.id].name} — ${e.name}!`, e.c);
              sfx("ult");
            } else sfx("boom");
            break;
          case "zap":
            fx.zaps.push({ x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, t: 0 });
            sfx("bolt");
            break;
          case "shield":
            fx.rings.push({ x: runRef.current.p.x, y: runRef.current.p.y - 8, r: 22, c: "#7ff0d8", t: 0, life: 0.35, fill: false });
            sfx("shield");
            break;
          case "prop":
            for (let i = 0; i < 8; i++) fx.parts.push({ x: e.x, y: e.y - 12, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 100, c: i % 2 ? "#ffe9a0" : "#3c3f5c", t: 0, life: 0.5, s: 2 });
            sfx("hit");
            break;
          case "win":
            say(runRef.current.ch ? (runRef.current.ch.sub && runRef.current.ch.sub < 5 ? "스테이지 클리어!" : "챕터 클리어!") : "새벽이 밝았어요!", "#ffd23a");
            if (runRef.current.ch) jingle("pt_clear");
            else {
              sfx("win");
              playBgm(null);
            }
            break;
          case "dead":
            sfx("dead");
            if (runRef.current.ch) jingle("pt_fail");
            break;
        }
      }
    },
    [say, toast]
  );

  /* 메인 루프 */
  useEffect(() => {
    const c = cvRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    // 캔버스를 화면 실제 픽셀 크기 그대로 (브라우저가 다시 줄이거나 늘리지 않아 도트가 번지지 않음) · 배율 S 는 소수
    let S = 0;
    let fitT = 0;
    const fit = () => {
      const w = Math.round(c.getBoundingClientRect().width * (window.devicePixelRatio || 1));
      const cw = Math.max(VIEW_W, Math.min(VIEW_W * 4, w));
      if (cw === c.width && S) return;
      S = cw / VIEW_W;
      c.width = cw;
      c.height = Math.round(VIEW_H * S);
    };
    fit();
    let raf = 0;
    let lastT = performance.now();
    let acc = 0;
    let hudT = 0;
    let lastPause: Pause | null = null;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      const r = runRef.current;
      const fx = fxRef.current;
      const stop = menuRef.current || !!r.pause;
      // 타격 멈춤 · 느린 화면 (실제 시간으로 줄어듦)
      let ts = 1;
      if (fx.stop > 0) {
        fx.stop -= dt;
        ts = 0.05;
      } else if (fx.slow > 0) {
        fx.slow -= dt;
        ts = 0.35;
      }
      if (!stop && !r.over) {
        acc += dt * ts;
        const k = keys.current;
        let mx = (k.has("d") || k.has("ArrowRight") ? 1 : 0) - (k.has("a") || k.has("ArrowLeft") ? 1 : 0);
        let my = (k.has("s") || k.has("ArrowDown") ? 1 : 0) - (k.has("w") || k.has("ArrowUp") ? 1 : 0);
        if (stick.current.on) {
          mx = stick.current.x;
          my = stick.current.y;
        }
        const inp: Input = { mx, my, dash: k.has(" ") || k.has("Shift") || btn.current.dash, ult: k.has("e") || k.has("q") || btn.current.ult };
        let n = 0;
        while (acc >= DT && n++ < 5) {
          step(r, inp);
          if (r.ev.length) {
            onEv(r.ev);
            r.ev.length = 0;
          }
          acc -= DT;
          if (r.pause || r.over) break;
        }
        if (n >= 5) acc = 0;
        btn.current.dash = false;
        btn.current.ult = false;
        fx.walkT += dt;
      } else acc = 0;
      if (!stop) tickFx(fx, dt);
      fitT += dt;
      if (fitT > 0.5) {
        fitT = 0;
        fit();
      }
      ctx.setTransform(S, 0, 0, S, 0, 0);
      draw(ctx, r, fx, heroArt.current, now / 1000, supArt.current);
      // 체력 막대 (캐릭터 아래)
      drawHp(ctx, r);
      if (r.pause !== lastPause) {
        lastPause = r.pause;
        setPause(r.pause);
        if (r.pause?.k === "level") sfx("card");
      }
      hudT += dt;
      if (hudT > 0.1) {
        hudT = 0;
        const h = hudOf(r);
        setHud(h);
        // 처음 진화 준비가 된 무기 → 알림 (다음 레벨업 · 상자에서 진화)
        for (const w of h.weapons)
          if (evoReady(w, h) && !evoSaid.current.has(w.id)) {
            evoSaid.current.add(w.id);
            const e = evoOf(w.id, !!h.ch)!;
            say(`✦ 진화 준비! ${WEAPONS[w.id].name} → ${WEAPONS[e].name} — 다음 레벨업 · 상자에서`, "#ffd23a");
            sfx("rare");
          }
        const cb = combo.current;
        if (cb.n && performance.now() - cb.at > 2500) cb.n = 0;
        setComboN(cb.n);
      }
      if (r.over && !ended.current) {
        ended.current = true;
        setTimeout(() => onEnd(result(r)), r.win ? 2200 : 1400);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [keys, onEv, onEnd, say]);

  const pickCard = (i: number) => {
    const r = runRef.current;
    if (r.pause?.k !== "level") return;
    if (i >= r.pause.cards.length && !(i === -1)) return;
    sfx(r.pause.jackpot ? "jackpot" : "click");
    chooseCard(r, i);
    if (r.ev.length) {
      onEv(r.ev);
      r.ev.length = 0;
    }
    setPause(r.pause);
    setHud(hudOf(r));
  };
  const doReroll = () => {
    const r = runRef.current;
    reroll(r);
    sfx("card");
    setPause(r.pause);
    setHud(hudOf(r));
  };
  const shutChest = () => {
    const r = runRef.current;
    closeChest(r);
    setPause(r.pause);
    setHud(hudOf(r));
  };
  /** 시뮬 함수 하나 부르고 화면 맞추기 */
  const act = (f: (r: Run) => void, snd: Parameters<typeof sfx>[0] = "click") => {
    const r = runRef.current;
    f(r);
    sfx(snd);
    if (r.ev.length) {
      onEv(r.ev);
      r.ev.length = 0;
    }
    setPause(r.pause);
    setHud(hudOf(r));
  };

  // Esc = 일시정지 · 숫자 = 카드
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const r = runRef.current;
      if (e.key === "Escape" && !r.pause) setMenu((m) => !m);
      const n = ["1", "2", "3", "4"].indexOf(e.key);
      if (r.pause?.k === "level" && n >= 0) pickCard(n);
      // 레벨업: R 다시 뽑기 · X 건너뛰기
      if (r.pause?.k === "level" && !r.pause.jackpot && !e.repeat) {
        const kk = e.key.toLowerCase();
        if (kk === "r" && r.rerolls > 0) doReroll();
        if (kk === "x" && r.skips > 0) pickCard(-1);
      }
      if (r.pause?.k === "bless" && n >= 0) act((x) => chooseBless(x, n), "card");
      if (r.pause?.k === "wish" && n >= 0) act((x) => chooseWish(x, n), "jackpot");
      if (r.pause?.k === "shop" && n >= 0) act((x) => buyRelic(x, n), "buy");
      if ((r.pause?.k === "shop" || r.pause?.k === "wish") && e.key === "Escape") act(leaveThing);
      // 럭키 출격: R 소환 · F 합성 · G 조합
      if (r.army && !r.pause && !e.repeat) {
        const k = e.key.toLowerCase();
        if (k === "r") act(armyBuy, "buy");
        if (k === "f") act((x) => void armyMerge(x), "click");
        if (k === "g") act((x) => void armyCraft(x), "click");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 터치 조이스틱 (왼쪽 아무 데나 누르면 그 자리에 생김) */
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1024;
    const y = ((e.clientY - rect.top) / rect.height) * 576;
    if (x > 600) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    stick.current = { x: 0, y: 0, on: true, bx: x, by: y, id: e.pointerId };
    setStickView({ bx: x, by: y, x: 0, y: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    const s = stick.current;
    if (!s.on || e.pointerId !== s.id) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1024 - s.bx;
    const y = ((e.clientY - rect.top) / rect.height) * 576 - s.by;
    const d = Math.hypot(x, y);
    const R = 60;
    const k = d > R ? R / d : 1;
    s.x = (x * k) / R;
    s.y = (y * k) / R;
    setStickView({ bx: s.bx, by: s.by, x: x * k, y: y * k });
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerId !== stick.current.id) return;
    stick.current = { x: 0, y: 0, on: false, bx: 0, by: 0, id: -1 };
    setStickView(null);
  };

  const left = hud.len - hud.t;
  return (
    <div className="absolute inset-0" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ touchAction: "none" }}>
      <canvas ref={cvRef} width={VIEW_W} height={VIEW_H} className="absolute inset-0 h-full w-full" style={{ imageRendering: "auto" }} />

      {/* 위: 경험치 · 시간 · 처치 */}
      <div className="pointer-events-none absolute inset-x-0 top-0">
        <div className="pts-bar mx-[6px] mt-[6px] h-[14px]" style={{ "--c": "#5fd0ff" } as CSSProperties}>
          <i style={{ width: `${Math.min(100, hud.xp * 100)}%` }} />
          <span className="pts-sub absolute top-[-1px] right-[6px] text-[12px] leading-[14px] font-bold">LV {hud.lv}</span>
        </div>
        <div className="mt-[6px] flex items-start justify-between px-[10px]">
          <div className="flex flex-col gap-[6px]">
            <div className="flex gap-[6px]">
              {Array.from({ length: 6 }, (_, i) => {
                const w = hud.weapons[i];
                const ev = w && !WEAPONS[w.id].evo && !WEAPONS[w.id].fuse ? evoOf(w.id, !!hud.ch) : undefined;
                const ready = !!w && evoReady(w, hud);
                const need = ev ? WEAPONS[ev].evo![1] : undefined;
                return (
                  <span
                    key={i}
                    className={`pts-slot ${w?.awake || ready ? "pts-glow" : ""}`}
                    style={{ width: 30, height: 30, boxShadow: `0 0 0 2px ${w && (WEAPONS[w.id].fuse || WEAPONS[w.id].evo || w.awake || ready) ? "#ffd23a" : "#3a3080"}` }}
                    title={ev ? `진화: Lv${WEAPONS[w!.id].lv.length} + ${PASSIVES[need!].name} → ${WEAPONS[ev].name}` : undefined}
                  >
                    {w && <ItemIcon k="weapon" id={w.id} size={26} />}
                    {/* 진화 짝 능력치 (없으면 흐리게 · 있으면 또렷 · 준비되면 반짝) */}
                    {ev && need && (
                      <span className={`absolute -top-[7px] -left-[7px] ${ready ? "pts-blink" : ""}`} style={{ opacity: hud.passives.some((p) => p.id === need) ? 1 : 0.45, filter: ready ? "drop-shadow(0 0 3px #ffd23a)" : undefined }}>
                        <ItemIcon k="passive" id={need} size={14} />
                      </span>
                    )}
                    {w && <b className="pts-sub absolute -right-[3px] -bottom-[6px] text-[10px]">{WEAPONS[w.id].fuse || WEAPONS[w.id].evo || w.awake ? "★" : w.lv}</b>}
                  </span>
                );
              })}
            </div>
            <div className="flex gap-[6px]">
              {Array.from({ length: 6 }, (_, i) => {
                const p = hud.passives[i];
                return (
                  <span key={i} className="pts-slot" style={{ width: 24, height: 24, boxShadow: "0 0 0 2px #2a2468" }}>
                    {p && <ItemIcon k="passive" id={p.id} size={22} />}
                    {p && <b className="pts-sub absolute -right-[3px] -bottom-[6px] text-[10px]">{p.lv}</b>}
                  </span>
                );
              })}
            </div>
            {hud.relics.length > 0 && (
              <div className="flex max-w-[260px] flex-wrap gap-[3px]">
                {hud.relics.map((x) => (
                  <span key={x.id} className="relative" title={`${RELICS[x.id].name} — ${RELICS[x.id].desc}`}>
                    <ItemIcon k="relic" id={x.id} size={18} />
                    {x.n > 1 && <b className="pts-sub absolute -right-[2px] -bottom-[4px] text-[9px]">{x.n}</b>}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-center">
            <b className={`pts-title text-[30px] leading-none ${hud.ot ? "text-[#ff9cc8]" : left < 30 && left > 0 ? "text-[#ff4fa3]" : "text-white"}`}>{hud.ot ? `+${fmt(hud.otT)}` : left > 0 ? fmt(left) : fmt(hud.t - hud.len)}</b>
            <span className="pts-sub mt-[2px] text-[11px] text-[#a9a2d6]">{hud.ch ? (left > 0 ? `${hud.ch} · 보스까지` : `${hud.ch} · 보스전`) : hud.ot ? `오버타임 Lv${hud.otLv}` : left > 0 ? "새벽까지" : "새벽 이후"}</span>
            {(hud.depth > 0 || hud.curse > 0) && (
              <span className="pts-sub mt-[3px] flex gap-[6px] text-[11px]">
                {hud.depth > 0 && <span className="text-[#c58bff]">깊이 {hud.depth}</span>}
                {hud.curse > 0 && <span className="text-[#ff8a6b]">저주 +{Math.round(hud.curse * 100)}%</span>}
              </span>
            )}
            {hud.trial > 0 && <b className="pts-title pts-blink mt-[4px] text-[18px] text-[#e0d8ff]">시련 {Math.ceil(hud.trial)}초</b>}
            {hud.quest && (
              <span className={`pts-sub mt-[4px] text-[13px] font-bold ${hud.quest.done ? "text-[#ffd23a]" : hud.quest.fail ? "text-[#6b63a3] line-through" : "text-[#fff6c8]"}`}>
                ★ {hud.quest.text}{" "}
                {hud.quest.done ? "달성!" : hud.quest.fail ? "실패" : hud.quest.need > 1 ? `${hud.quest.got}/${hud.quest.need}` : hud.quest.hp > 0 ? `${Math.round(hud.quest.hp * 100)}%` : ""}
              </span>
            )}
            {hud.toll > 0 ? (
              <b className="pts-title pts-blink mt-[4px] text-[16px] text-[#ffb03a]">🔔 자정의 종 {Math.ceil(hud.toll)}초 · 경험치 ×2</b>
            ) : (
              hud.tollNext > 0 &&
              hud.tollNext < 10 &&
              !hud.boss && <span className="pts-sub mt-[3px] text-[11px] text-[#ffb03a]">🔔 종이 곧 울려요 {Math.ceil(hud.tollNext)}</span>
            )}
          </div>
          <div className="flex flex-col items-end gap-[4px] text-[14px] font-bold">
            <span className="pts-sub flex items-center gap-[6px]">
              <span className="inline-block h-[10px] w-[10px] bg-[#ff3d6e]" style={{ boxShadow: "0 0 0 2px #07051a" }} />
              {hud.kills.toLocaleString()}
            </span>
            <span className="pts-sub flex items-center gap-[6px] text-[#ffd23a]" title={hud.ch ? "주운 코인 — 끝나면 받아요" : "금화 — 상자 · 상인에 써요"}>
              <span className="inline-block h-[10px] w-[10px] rounded-full bg-[#ffd23a]" style={{ boxShadow: "0 0 0 2px #07051a" }} />
              {hud.gold.toLocaleString()}
            </span>
            <span className="mt-[4px] flex gap-[6px]">
              {stg.canFs && (
                <button type="button" onClick={stg.toggleFs} className="pts-btn ghost pointer-events-auto h-[28px] w-[32px] text-[13px]" title={stg.fs ? "전체화면 끄기" : "전체화면"}>
                  {stg.fs ? "✕" : "⛶"}
                </button>
              )}
              <button type="button" onClick={() => setMenu(true)} className="pts-btn ghost pointer-events-auto h-[28px] px-[10px] text-[12px]">
                II 일시정지
              </button>
            </span>
          </div>
        </div>
        {hud.boss && (
          <div className="mx-auto mt-[6px] w-[420px]">
            <div className="pts-sub mb-[4px] flex justify-center gap-[10px] text-[13px] font-bold text-[#ff8fb8]">
              {hud.boss.name}
              <span className={hud.boss.rage ? "pts-blink text-[#ff3d6e]" : hud.boss.left < 20 ? "text-[#ffd23a]" : "text-[#a9a2d6]"}>{hud.boss.rage ? "격노!" : `격노까지 ${Math.ceil(hud.boss.left)}초`}</span>
            </div>
            <div className="pts-bar h-[12px]" style={{ "--c": "#ff3d6e" } as CSSProperties}>
              <i style={{ width: `${hud.boss.hp * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* 아래: 체력 · 대시 · 필살기 */}
      <div className="pointer-events-none absolute bottom-[12px] left-[12px] w-[220px]">
        {hud.flag && (
          <span className="pts-tag mb-[6px] inline-block text-[11px]" style={{ background: "#ff9cc8" }}>
            🚩 {FLAG_NAME[hud.flag.k]} {Math.ceil(hud.flag.t)}초
          </span>
        )}
        <div className="pts-sub mb-[4px] flex justify-between text-[12px] font-bold">
          <span>{HEROES[hero].name}</span>
          <span>
            {Math.ceil(hud.hp)} / {hud.max}
          </span>
        </div>
        <div className="pts-bar h-[12px]" style={{ "--c": hud.hp / hud.max < 0.3 ? "#ff3d6e" : "#4ff0c8" } as CSSProperties}>
          <i style={{ width: `${Math.max(0, (hud.hp / hud.max) * 100)}%` }} />
        </div>
      </div>
      <div className="absolute right-[14px] bottom-[14px] flex items-end gap-[12px]">
        <RoundBtn label="대시" sub="SPACE" k={hud.dash} c="#5fd0ff" size={62} onPress={() => (btn.current.dash = true)} />
        <RoundBtn label="필살" sub="E" k={hud.ult} c={HEROES[hero].color} size={78} ready={hud.ult >= 1} onPress={() => (btn.current.ult = true)} />
      </div>

      {/* 럭키 출격 부대 */}
      {hud.army && <ArmyTray a={hud.army} gold={hud.gold} onBuy={() => act(armyBuy, "buy")} onMerge={() => act((x) => void armyMerge(x), "click")} onCraft={() => act((x) => void armyCraft(x), "click")} />}

      {/* 조이스틱 */}
      {stickView && (
        <div className="pointer-events-none absolute" style={{ left: stickView.bx - 60, top: stickView.by - 60, width: 120, height: 120 }}>
          <div className="absolute inset-0 rounded-full bg-white/10" style={{ boxShadow: "0 0 0 2px rgba(255,255,255,0.4)" }} />
          <div className="absolute h-[44px] w-[44px] rounded-full bg-white/60" style={{ left: 38 + stickView.x, top: 38 + stickView.y, boxShadow: "0 0 0 2px #07051a" }} />
        </div>
      )}

      {/* 필살기 컷인 */}
      {cut && CUTIN[cut.hero] && (
        <div key={cut.id} className="pts-cutin pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2" onAnimationEnd={() => setCut(null)}>
          <div className="pts-cutin-band relative h-[180px] overflow-hidden" style={{ boxShadow: `0 3px 0 0 ${HEROES[cut.hero].color}, 0 -3px 0 0 ${HEROES[cut.hero].color}` }}>
            <img src={CUTIN[cut.hero]} alt="" draggable={false} className="pts-cutin-img absolute top-1/2 left-1/2 h-auto w-[112%] max-w-none" />
            <b className="pts-title absolute right-[6%] bottom-[10px] text-[38px] leading-none" style={{ color: "#fff6d8", textShadow: `3px 3px 0 #07051a, 0 0 18px ${HEROES[cut.hero].color}` }}>
              {HEROES[cut.hero].ult.name}!
            </b>
          </div>
        </div>
      )}

      {/* 한꺼번에 처치 */}
      {multiN && (
        <div key={multiN.id} className="pts-pop pointer-events-none absolute top-[40%] left-1/2 -translate-x-1/2" onAnimationEnd={() => window.setTimeout(() => setMultiN((m) => (m && m.id === multiN.id ? null : m)), 500)}>
          <b className="pts-title text-[30px] leading-none whitespace-nowrap" style={{ color: multiN.n >= 20 ? "#ff4fa3" : "#ffd23a", textShadow: "3px 3px 0 #07051a" }}>
            ×{multiN.n} 동시 처치!
          </b>
        </div>
      )}

      {/* 연속 처치 */}
      {comboN >= 10 && (
        <div className="pointer-events-none absolute top-[42%] left-[14px] flex flex-col items-start">
          <b key={Math.floor(comboN / 25)} className="pts-title pts-pop leading-none" style={{ fontSize: comboN >= 100 ? 40 : comboN >= 50 ? 34 : 28, color: comboN >= 200 ? "#ffd23a" : comboN >= 100 ? "#ff4fa3" : comboN >= 50 ? "#c58bff" : "#4ff0c8", textShadow: "2px 2px 0 #07051a" }}>
            {comboN}
          </b>
          <span className="pts-sub text-[12px] text-[#e8e4ff]">연속 처치</span>
        </div>
      )}

      {/* 알림 띠 */}
      {banner && (
        <div key={banner.id} className="pts-warn pointer-events-none absolute inset-x-0 top-[150px] flex justify-center" onAnimationEnd={() => setBanner(null)}>
          <div className="px-[30px] py-[8px]" style={{ background: "rgba(7,5,26,0.82)", boxShadow: `0 2px 0 0 ${banner.c}, 0 -2px 0 0 ${banner.c}` }}>
            <b className="pts-title text-[26px]" style={{ color: banner.c }}>
              {banner.text}
            </b>
          </div>
        </div>
      )}

      {/* 기믹 안내 (왼쪽 · 6초) */}
      {guide && <GuideCard key={guide.id} k={guide.k} onDone={closeGuide} />}

      {/* 유물 얻음 알림 */}
      <div className="pointer-events-none absolute top-[130px] right-[12px] flex flex-col items-end gap-[6px]">
        {toasts.map((t) => (
          <div key={t.id} className="pts-pop flex items-center gap-[8px] px-[10px] py-[5px]" style={{ background: "rgba(7,5,26,0.85)", boxShadow: `0 0 0 2px ${RELIC_RARITY_COLOR[RELICS[t.relic].rarity]}` }}>
            <ItemIcon k="relic" id={t.relic} size={24} />
            <span className="text-[12px] leading-[15px]">
              <b style={{ color: RELIC_RARITY_COLOR[RELICS[t.relic].rarity] }}>{RELICS[t.relic].name}</b>
              <br />
              <span className="text-[#a9a2d6]">{RELICS[t.relic].desc}</span>
            </span>
          </div>
        ))}
      </div>

      {pause?.k === "level" && <LevelUp pause={pause} hud={hud} onPick={pickCard} onReroll={doReroll} onBanish={(i) => act((x) => banishCard(x, i), "card")} />}
      {pause?.k === "chest" && <Chest pause={pause} onClose={shutChest} />}
      {pause?.k === "bless" && <BlessPick pause={pause} onPick={(i) => act((x) => chooseBless(x, i), "card")} />}
      {pause?.k === "shop" && <ShopPick pause={pause} gold={hud.gold} onBuy={(i) => act((x) => buyRelic(x, i), "buy")} onLeave={() => act(leaveThing)} />}
      {pause?.k === "wish" && <WishPick pause={pause} onPick={(i) => act((x) => chooseWish(x, i), "jackpot")} onLeave={() => act(leaveThing)} />}
      {pause?.k === "dawn" && <Dawn hud={hud} stage={run0.stage} onPick={(more) => act((x) => dawnChoice(x, more), more ? "boss" : "click")} />}
      {menu && !pause && (
        <PauseMenu
          hud={hud}
          onResume={() => setMenu(false)}
          onQuit={() => {
            setMenu(false);
            if (ended.current) return;
            ended.current = true;
            playBgm(null);
            // 1분도 안 버텼으면 그냥 나감, 아니면 여기까지 정산
            if (runRef.current.t < 60) onQuit();
            else onEnd(result(runRef.current));
          }}
        />
      )}
    </div>
  );
}

function drawHp(ctx: CanvasRenderingContext2D, r: Run) {
  const k = Math.max(0, r.p.hp / maxHp(r));
  if (k >= 1) return;
  const x = Math.round(VIEW_W / 2 - 10);
  const y = Math.round(VIEW_H / 2 + 12);
  ctx.fillStyle = "#07051a";
  ctx.fillRect(x - 1, y - 1, 22, 4);
  ctx.fillStyle = "#3a1030";
  ctx.fillRect(x, y, 20, 2);
  ctx.fillStyle = k < 0.3 ? "#ff3d6e" : "#4ff0c8";
  ctx.fillRect(x, y, Math.round(20 * k), 2);
}

function RoundBtn({ label, sub, k, c, size, ready, onPress }: { label: string; sub: string; k: number; c: string; size: number; ready?: boolean; onPress(): void }) {
  const full = k >= 1;
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.stopPropagation();
        onPress();
      }}
      className={`relative flex flex-col items-center justify-center rounded-full font-bold ${ready ? "pts-bob" : ""}`}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${c} ${Math.min(1, k) * 360}deg, rgba(7,5,26,0.7) 0deg)`,
        boxShadow: `0 0 0 3px #07051a, inset 0 0 0 5px rgba(7,5,26,0.85)${ready ? `, 0 0 18px 4px ${c}` : ""}`,
        color: full ? "#07051a" : "#fff",
        opacity: full ? 1 : 0.85,
      }}
    >
      <span className="text-[14px] leading-none">{label}</span>
      <span className="mt-[3px] text-[9px] leading-none opacity-80">{sub}</span>
    </button>
  );
}

/* ───────────── 레벨업 ───────────── */

/** 지금 능력치 표 (메가봉크식 — 고를 때 옆에 늘 보임) */
function StatPanel({ hud }: { hud: Hud }) {
  const st = hud.stats;
  const rows: [string, string][] = [
    ["피해", pct(st.might)],
    ["쿨타임", `−${Math.round(Math.min(0.6, st.cooldown) * 100)}%`],
    ["범위", pct(st.area)],
    ["투사체", `+${st.amount}`],
    ["이동", pct(st.speed)],
    ["최대 체력", String(hud.max)],
    ["회복", `${Math.round(st.regen * 10) / 10}/초`],
    ["방어", String(st.armor)],
    ["줍는 범위", pct(st.magnet)],
    ["행운", String(st.luck)],
    ["경험치", pct(st.growth)],
    ["치명타", `${Math.round((0.05 + st.luck * 0.015) * 100)}%`],
  ];
  return (
    <div className="pts-win flex w-[150px] flex-col gap-[3px] px-[10px] py-[8px] text-[11px]">
      <b className="pts-sub mb-[2px] text-[12px] text-[#ffd23a]">능력치</b>
      {rows.map(([k, v]) => (
        <span key={k} className="flex justify-between">
          <span className="text-[#a9a2d6]">{k}</span>
          <b>{v}</b>
        </span>
      ))}
    </div>
  );
}

/** 순찰대 기믹 안내 카드 — 무엇을 하면 되는지 2~3줄 */
function GuideCard({ k, onDone }: { k: GuideK; onDone(): void }) {
  const g = GIMMICK_GUIDE[k];
  useEffect(() => {
    const t = window.setTimeout(onDone, 6500);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div className="pts-pop pointer-events-none absolute top-[190px] left-[12px] w-[270px] px-[12px] py-[10px]" style={{ background: "rgba(7,5,26,0.88)", boxShadow: `0 0 0 2px ${g.c}, 0 0 0 4px #07051a` }}>
      <div className="flex items-center gap-[8px]">
        <span className="text-[22px] leading-none">{g.icon}</span>
        <b className="pts-title text-[18px]" style={{ color: g.c }}>
          {g.title}
        </b>
        <span className="pts-tag ml-auto text-[9px]" style={{ background: g.c }}>
          기믹
        </span>
      </div>
      <ol className="mt-[6px] flex flex-col gap-[3px]">
        {g.steps.map((t, i) => (
          <li key={i} className="flex gap-[6px] text-[12px] leading-[16px] text-[#e8e4ff]">
            <b style={{ color: g.c }}>{i + 1}</b>
            <span className="break-keep">{t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 카드 아래 진화 힌트: 무기 카드 = 진화 짝 능력치 · 능력치 카드 = 이걸로 진화하는 가진 무기 */
function EvoHint({ c, hud }: { c: Card; hud: Hud }) {
  const patrol = !!hud.ch;
  if (c.k === "weapon") {
    const e = evoOf(c.id as WeaponId, patrol);
    if (!e) return null;
    const need = WEAPONS[e].evo![1];
    const have = hud.passives.some((p) => p.id === need);
    return (
      <span className="mt-[6px] flex items-center gap-[3px] rounded-[2px] px-[5px] py-[2px] text-[10.5px] leading-[13px]" style={{ background: "#ffd23a1f", color: "#ffd27a" }}>
        ✦ 진화 Lv{WEAPONS[c.id as WeaponId].lv.length} + <ItemIcon k="passive" id={need} size={13} />
        {have ? <b className="text-[#7dff9a]">✓</b> : PASSIVES[need].name}
      </span>
    );
  }
  if (c.k === "passive") {
    const es = evosNeeding(c.id as PassiveId, hud.weapons.map((w) => w.id), patrol);
    if (!es.length || c.from > 0) return null;
    return (
      <span className="mt-[6px] flex items-center gap-[3px] rounded-[2px] px-[5px] py-[2px] text-[10.5px] leading-[13px]" style={{ background: "#ffd23a1f", color: "#ffd27a" }}>
        ✦ 진화 재료 <ItemIcon k="weapon" id={WEAPONS[es[0]].evo![0]} size={13} />→ {WEAPONS[es[0]].name}
      </span>
    );
  }
  return null;
}

function LevelUp({ pause, hud, onPick, onReroll, onBanish }: { pause: Extract<Pause, { k: "level" }>; hud: Hud; onPick(i: number): void; onReroll(): void; onBanish(i: number): void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(7,5,26,0.72)" }}>
      <b className="pts-title pts-drop text-[34px] text-[#ffd23a]">{pause.jackpot ? "★ 잭팟! 전부 받아요 ★" : "LEVEL UP!"}</b>
      <span className="pts-sub mt-[4px] mb-[16px] text-[13px] text-[#a9a2d6]">{pause.jackpot ? "아무 카드나 누르면 다 가져가요" : `하나를 골라요 · 숫자키 1~${pause.cards.length}`}</span>
      <div className="flex items-start gap-[16px]">
        <div className="flex gap-[14px]">
          {pause.cards.map((c, i) => {
            const t = cardText(c);
            const sp = c.k === "fuse" || c.k === "evo" || c.k === "awake";
            const col = sp ? "#ffd23a" : RARITY_COLOR[c.rarity];
            const lines = cardLines(c);
            const w = pause.cards.length > 3 ? 168 : 188;
            // 무기(투사체) · 능력치를 한눈에: 위 띠 색 · 아이콘 받침 모양
            const kind = c.k === "weapon" || sp ? "weapon" : c.k === "passive" ? "passive" : null;
            const KC = kind === "weapon" ? "#ff8a5c" : "#4ff0c8";
            return (
              <div key={i} className="flex flex-col items-center gap-[6px]">
                <button type="button" onClick={() => onPick(i)} className={`pts-card pts-pop relative flex h-[280px] flex-col items-center overflow-hidden px-[12px] pt-[26px] pb-[10px] text-left ${sp || c.rarity === 2 ? "legend" : ""}`} style={{ width: w, "--r": col, animationDelay: `${i * 70}ms` } as CSSProperties}>
                  {kind && (
                    <span className="absolute inset-x-0 top-0 flex h-[18px] items-center justify-center gap-[4px] text-[11px] font-bold tracking-[1px]" style={{ background: `${KC}33`, color: KC, boxShadow: `inset 0 -1px 0 ${KC}66` }}>
                      {kind === "weapon" ? "⚔ 무기 · 공격" : "✚ 능력치"}
                    </span>
                  )}
                  <span className="mb-[8px] self-stretch text-center text-[11px] font-bold" style={{ color: col }}>
                    {c.k === "fuse" ? "★ 합체 ★" : c.k === "evo" ? "★ 진화 ★" : c.k === "awake" ? "★ 각성 ★" : c.rarity ? `${RARITY_NAME[c.rarity]} +${c.to - c.from}` : c.from === 0 && c.k !== "coin" && c.k !== "heal" ? "NEW" : RARITY_NAME[0]}
                  </span>
                  <span className="flex h-[60px] w-[60px] items-center justify-center" style={kind === "weapon" ? { background: `${KC}22`, boxShadow: `0 0 0 2px ${KC}88`, transform: "rotate(45deg)" } : kind === "passive" ? { background: `${KC}22`, boxShadow: `0 0 0 2px ${KC}88`, borderRadius: 999 } : undefined}>
                    <span style={kind === "weapon" ? { transform: "rotate(-45deg)" } : undefined}>{t.k ? <ItemIcon k={t.k} id={t.id!} size={44} /> : <span className="block h-[44px] w-[44px] bg-[#ffd23a]" />}</span>
                  </span>
                  <b className="mt-[8px] text-center text-[16px] leading-[19px] text-white">{t.name}</b>
                  {c.k === "weapon" || c.k === "passive" ? (
                    <span className="mt-[2px] text-[12px] text-[#a9a2d6]">{c.from === 0 ? `Lv ${c.to}` : `Lv ${c.from} → ${c.to}`}</span>
                  ) : c.k === "fuse" || c.k === "evo" ? (
                    <span className="mt-[2px] flex items-center gap-[4px] text-[11px] text-[#ffd23a]">
                      {c.k === "fuse" ? (
                        <>
                          <ItemIcon k="weapon" id={WEAPONS[c.id as WeaponId].fuse![0]} size={16} />+<ItemIcon k="weapon" id={WEAPONS[c.id as WeaponId].fuse![1]} size={16} />
                        </>
                      ) : (
                        <>
                          <ItemIcon k="weapon" id={WEAPONS[c.id as WeaponId].evo![0]} size={16} />+<ItemIcon k="passive" id={WEAPONS[c.id as WeaponId].evo![1]} size={16} />
                        </>
                      )}
                    </span>
                  ) : null}
                  <span className="mt-[8px] text-center text-[12.5px] leading-[17px] text-[#e8e4ff] [word-break:keep-all]">{t.desc}</span>
                  {lines.length > 0 && (
                    <span className="mt-[6px] flex flex-col items-center gap-[1px] text-[11.5px] leading-[15px] text-[#7dff9a]">
                      {lines.map((l) => (
                        <span key={l}>{l}</span>
                      ))}
                    </span>
                  )}
                  <EvoHint c={c} hud={hud} />
                  <span className="pts-sub mt-auto text-[11px] text-[#6b63a3]">{i + 1}</span>
                </button>
                {hud.banish > 0 && !pause.jackpot && !sp && (c.k === "weapon" || c.k === "passive") && (
                  <button type="button" onClick={() => onBanish(i)} className="pts-btn ghost h-[24px] px-[8px] text-[11px]" title="이번 판에서 다시 안 나와요">
                    ✕ 지우기
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <StatPanel hud={hud} />
      </div>
      {!pause.jackpot && (
        <div className="mt-[16px] flex gap-[14px]">
          <button type="button" disabled={hud.rerolls <= 0} onClick={onReroll} className="pts-btn h-[34px] px-[16px] text-[13px]" style={{ "--c": "#5fd0ff" } as CSSProperties}>
            다시 뽑기 (R) · {hud.rerolls}
          </button>
          <button type="button" disabled={hud.skips <= 0} onClick={() => onPick(-1)} className="pts-btn ghost h-[34px] px-[16px] text-[13px]">
            건너뛰기 (X) +10금화 · {hud.skips}
          </button>
          {hud.banish > 0 && <span className="pts-sub self-center text-[12px] text-[#a9a2d6]">카드 지우기 {hud.banish}번 남음</span>}
        </div>
      )}
    </div>
  );
}

/* ───────────── 보물 상자 (슬롯 연출) ───────────── */

function Chest({ pause, onClose }: { pause: Extract<Pause, { k: "chest" }>; onClose(): void }) {
  // 0: 릴 도는 중 → 1..n 하나씩 공개 → done
  const [shown, setShown] = useState(0);
  const n = pause.items.length;
  const timers = useRef<{ ids: ReturnType<typeof setTimeout>[]; spin: ReturnType<typeof setInterval> | null }>({ ids: [], spin: null });
  /** 다 보인 시각 · 열린 시각 (스페이스를 누른 채(대시) 열려도 바로 안 닫히게) */
  const doneAt = useRef(0);
  const openAt = useRef(0);
  useEffect(() => {
    openAt.current = performance.now();
    const t = timers.current;
    t.spin = setInterval(() => sfx("reel"), 70);
    for (let i = 1; i <= n; i++)
      t.ids.push(
        setTimeout(() => {
          setShown(i);
          sfx(i === n && n >= 3 ? "jackpot" : "card");
          if (i === n) {
            if (t.spin) clearInterval(t.spin);
            doneAt.current = performance.now();
          }
        }, 900 + i * 380)
      );
    if (!n)
      t.ids.push(
        setTimeout(() => {
          if (t.spin) clearInterval(t.spin);
          doneAt.current = performance.now();
        }, 900)
      );
    return () => {
      t.ids.forEach(clearTimeout);
      t.ids = [];
      if (t.spin) clearInterval(t.spin);
    };
  }, [n]);
  const done = shown >= n;
  // 스페이스 · 엔터: 1번째 = 바로 다 보여 주기 · 2번째 = 받기 (꾹 누른 키 · 너무 빠른 연타는 무시)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (e.repeat || performance.now() - openAt.current < 250) return;
      if (shown < n) {
        const t = timers.current;
        t.ids.forEach(clearTimeout);
        t.ids = [];
        if (t.spin) clearInterval(t.spin);
        setShown(n);
        doneAt.current = performance.now();
        sfx(n >= 3 ? "jackpot" : "card");
        return;
      }
      if (performance.now() - doneAt.current < 350) return;
      onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [shown, n, onClose]);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(7,5,26,0.78)" }}>
      <b className="pts-title pts-drop text-[30px] text-[#ffd23a]">{pause.big ? "보스의 보물 상자!" : "보물 상자!"}</b>
      <div className="pts-win mt-[16px] flex gap-[10px] px-[18px] py-[16px]">
        {Array.from({ length: Math.max(n, 1) }, (_, i) => {
          const it = pause.items[i];
          const open = i < shown && it;
          const t = it ? cardText(it) : null;
          return (
            <div key={i} className="flex w-[110px] flex-col items-center">
              <div className="relative flex h-[90px] w-[90px] items-center justify-center overflow-hidden bg-[#07051a]" style={{ boxShadow: `0 0 0 2px ${open ? (it!.k === "relic" ? RELIC_RARITY_COLOR[RELICS[it!.id as RelicId].rarity] : "#ffd23a") : "#6b63a3"}` }}>
                {open && t?.k ? (
                  <span className="pts-pop">
                    <ItemIcon k={t.k} id={t.id!} size={56} />
                  </span>
                ) : (
                  <div className="pts-reel flex flex-col gap-[10px]">
                    {(["gym", "firecracker", "zap", "fork"] as const).map((x, j) => (
                      <ItemIcon key={j} k="relic" id={x} size={40} />
                    ))}
                  </div>
                )}
              </div>
              <span className="mt-[8px] h-[34px] text-center text-[12px] leading-[16px] [word-break:keep-all]">
                {open && t ? (
                  <>
                    <b className={it?.k === "fuse" || it?.k === "evo" || it?.k === "awake" ? "text-[#ffd23a]" : "text-white"}>{t.name}</b>
                    <br />
                    <span style={{ color: it?.k === "relic" ? RELIC_RARITY_COLOR[RELICS[it.id as RelicId].rarity] : "#a9a2d6" }}>{it?.k === "fuse" ? "합체!" : it?.k === "evo" ? "진화!" : it?.k === "awake" ? "각성!" : it?.k === "relic" ? RELIC_RARITY_NAME[RELICS[it.id as RelicId].rarity] : `Lv ${it!.to}`}</span>
                  </>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-[14px] flex items-center gap-[16px]">
        {pause.coins > 0 && <span className="pts-sub text-[15px] font-bold text-[#ffd23a]">+{pause.coins} 금화</span>}
        <button type="button" disabled={!done} onClick={onClose} className="pts-btn h-[38px] px-[26px] text-[15px]">
          {done ? "받기 (스페이스)" : "두근두근… (스페이스로 바로 보기)"}
        </button>
      </div>
    </div>
  );
}

/* ───────────── 일시정지 ───────────── */

function PauseMenu({ hud, onResume, onQuit }: { hud: Hud; onResume(): void; onQuit(): void }) {
  const st = useStage();
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(7,5,26,0.75)" }}>
      <div className="pts-win pts-pop w-[440px] px-[22px] py-[18px]">
        <span className="pts-tag text-[13px]">일시정지</span>
        <div className="mt-[14px] grid grid-cols-2 gap-x-[16px] gap-y-[6px] text-[13px]">
          {hud.weapons.map((w) => (
            <span key={w.id} className="flex items-center gap-[8px]">
              <ItemIcon k="weapon" id={w.id} size={20} />
              {WEAPONS[w.id].name} <b className="text-[#ffd23a]">Lv{w.lv}</b>
            </span>
          ))}
          {hud.passives.map((p) => (
            <span key={p.id} className="flex items-center gap-[8px]">
              <ItemIcon k="passive" id={p.id} size={20} />
              {PASSIVES[p.id].name} <b className="text-[#4ff0c8]">Lv{p.lv}</b>
            </span>
          ))}
        </div>
        <div className="mt-[16px]">
          <SoundSliders />
        </div>
        {st.canFs && (
          <button type="button" onClick={st.toggleFs} className="pts-btn ghost mt-[10px] h-[30px] w-full text-[12px]">
            {st.fs ? "✕ 전체화면 끄기" : "⛶ 전체화면"}
          </button>
        )}
        <div className="mt-[18px] flex justify-end gap-[12px]">
          <button type="button" onClick={onQuit} className="pts-btn ghost h-[36px] px-[16px] text-[13px]">
            {hud.t < 60 ? "그만하기" : "포기하고 정산"}
          </button>
          <button type="button" onClick={onResume} className="pts-btn h-[36px] px-[22px] text-[14px]">
            계속 (ESC)
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 성소 · 상인 · 우물 · 새벽 ───────────── */

function BlessPick({ pause, onPick }: { pause: Extract<Pause, { k: "bless" }>; onPick(i: number): void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(7,5,26,0.72)" }}>
      <b className="pts-title pts-drop text-[32px]" style={{ color: pause.gold ? "#ffd23a" : "#7ff0d8" }}>
        {pause.gold ? "황금 성소의 축복" : "성소의 축복"}
      </b>
      <span className="pts-sub mt-[4px] mb-[18px] text-[13px] text-[#a9a2d6]">능력치 하나를 골라요 · 판 끝까지</span>
      <div className="flex gap-[18px]">
        {pause.opts.map((b, i) => {
          const def = BLESS.find((x) => x.k === b.k)!;
          const col = RELIC_RARITY_COLOR[b.rar];
          return (
            <button key={i} type="button" onClick={() => onPick(i)} className={`pts-card pts-pop flex h-[200px] w-[180px] flex-col items-center justify-center gap-[10px] ${b.rar >= 2 ? "legend" : ""}`} style={{ "--r": col, animationDelay: `${i * 70}ms` } as CSSProperties}>
              <span className="text-[11px] font-bold" style={{ color: col }}>
                {RELIC_RARITY_NAME[b.rar]}
              </span>
              <BlessIcon k={b.k} />
              <b className="text-[18px]">{def.name}</b>
              <b className="pts-title text-[30px]" style={{ color: col }}>
                {def.fmt === "pct" ? `+${Math.round(b.v * 100)}%` : `+${b.v}`}
              </b>
              <span className="pts-sub text-[11px] text-[#6b63a3]">{i + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 성소 축복 그림: 같은 패시브 아이콘 · 없으면 비슷한 유물 */
function BlessIcon({ k }: { k: keyof Stats }) {
  if (k in PASSIVES) return <ItemIcon k="passive" id={k as PassiveId} size={44} />;
  if (k === "regen") return <ItemIcon k="relic" id="bandage" size={44} />;
  if (k === "armor") return <ItemIcon k="relic" id="bubble" size={44} />;
  return <img src="/survivor/item/gem3.png" alt="" className="h-[40px] w-[40px] object-contain" style={{ imageRendering: "pixelated" }} draggable={false} />;
}

function RelicCard({ id, i, foot, dim, onClick }: { id: RelicId; i: number; foot?: React.ReactNode; dim?: boolean; onClick(): void }) {
  const d = RELICS[id];
  const col = RELIC_RARITY_COLOR[d.rarity];
  return (
    <button type="button" onClick={onClick} className={`pts-card pts-pop flex h-[236px] w-[180px] flex-col items-center px-[12px] pt-[14px] pb-[10px] ${d.rarity >= 2 ? "legend" : ""}`} style={{ "--r": col, animationDelay: `${i * 70}ms`, opacity: dim ? 0.5 : 1 } as CSSProperties}>
      <span className="mb-[8px] text-[11px] font-bold" style={{ color: col }}>
        {RELIC_RARITY_NAME[d.rarity]} 유물
      </span>
      <ItemIcon k="relic" id={id} size={52} />
      <b className="mt-[10px] text-[16px]">{d.name}</b>
      <span className="mt-[8px] text-center text-[12.5px] leading-[17px] text-[#e8e4ff] [word-break:keep-all]">{d.desc}</span>
      <span className="mt-auto">{foot}</span>
    </button>
  );
}

function ShopPick({ pause, gold, onBuy, onLeave }: { pause: Extract<Pause, { k: "shop" }>; gold: number; onBuy(i: number): void; onLeave(): void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(7,5,26,0.72)" }}>
      <b className="pts-title pts-drop text-[30px] text-[#c58bff]">떠돌이 상인</b>
      <span className="pts-sub mt-[4px] mb-[16px] text-[13px] text-[#a9a2d6]">「하나만 골라 가라냥. 사면 난 떠난다냥」 · 금화 {gold.toLocaleString()}</span>
      <div className="flex gap-[16px]">
        {pause.offers.map((o, i) => (
          <RelicCard
            key={o.id}
            id={o.id}
            i={i}
            dim={gold < o.price}
            onClick={() => onBuy(i)}
            foot={
              <b className="pts-sub text-[15px]" style={{ color: gold >= o.price ? "#ffd23a" : "#ff8fb8" }}>
                ● {o.price}
              </b>
            }
          />
        ))}
      </div>
      <button type="button" onClick={onLeave} className="pts-btn ghost mt-[18px] h-[34px] px-[18px] text-[13px]">
        그냥 갈래요 (ESC)
      </button>
    </div>
  );
}

function WishPick({ pause, onPick, onLeave }: { pause: Extract<Pause, { k: "wish" }>; onPick(i: number): void; onLeave(): void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(7,5,26,0.72)" }}>
      <b className="pts-title pts-drop text-[30px] text-[#7ad7ff]">소원 우물</b>
      <span className="pts-sub mt-[4px] mb-[16px] text-[13px] text-[#a9a2d6]">동전을 던지고 소원을 빌어요 — 하나를 공짜로</span>
      <div className="flex gap-[16px]">
        {pause.offers.map((id, i) => (
          <RelicCard key={id} id={id} i={i} onClick={() => onPick(i)} foot={<span className="pts-sub text-[11px] text-[#6b63a3]">{i + 1}</span>} />
        ))}
      </div>
      <button type="button" onClick={onLeave} className="pts-btn ghost mt-[18px] h-[34px] px-[18px] text-[13px]">
        나중에 (ESC)
      </button>
    </div>
  );
}

function Dawn({ hud, stage, onPick }: { hud: Hud; stage: StageId; onPick(more: boolean): void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "linear-gradient(180deg, rgba(255,180,107,0.55), rgba(58,42,138,0.85))" }}>
      <b className="pts-title pts-drop text-[44px] text-[#ffd23a]">새벽이 왔다!</b>
      <span className="pts-sub mt-[6px] text-[14px]">
        {ENEMIES[STAGES[stage].final].name}{stage === "clock" ? "를 다시 돌려 놓았어요" : "를 쓰러뜨렸어요"} · 처치 {hud.kills.toLocaleString()}
      </span>
      <div className="pts-win mt-[20px] flex w-[520px] flex-col gap-[10px] px-[22px] py-[16px] text-[13px]">
        <p>
          <b className="text-[#ff9cc8]">오버타임</b> — 몹이 끝없이 몰려오고 30초마다 더 세져요. 버틴 시간만큼 <b>랭킹 기록</b> · 별사탕 · 코인이 늘어요. 쓰러져도 클리어는 그대로!
        </p>
        <div className="mt-[4px] flex justify-end gap-[12px]">
          <button type="button" onClick={() => onPick(false)} className="pts-btn ghost h-[40px] px-[18px] text-[14px]">
            여기서 정산
          </button>
          <button type="button" onClick={() => onPick(true)} className="pts-btn h-[40px] px-[22px] text-[15px]" style={{ "--c": "#ff4fa3", "--t": "#fff" } as CSSProperties}>
            오버타임 도전! ▶
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 럭키 출격: 부대 칸 ───────────── */

function ArmyTray({ a, gold, onBuy, onMerge, onCraft }: { a: NonNullable<Hud["army"]>; gold: number; onBuy(): void; onMerge(): void; onCraft(): void }) {
  return (
    <div className="pointer-events-none absolute bottom-[10px] left-1/2 flex w-[500px] -translate-x-1/2 flex-col items-center gap-[5px]">
      <div className="flex flex-wrap justify-center gap-[4px]">
        {a.groups.map((g) => {
          const ready = a.merge === g.key;
          return (
            <span
              key={g.key}
              title={g.grade >= 3 ? UNIT[g.id].name : `${FACTION_NAME[g.faction as keyof typeof FACTION_NAME]} ${ARMY_GRADE_NAME[g.grade]} ${g.n}/3`}
              className={`relative flex h-[34px] w-[34px] items-end justify-center overflow-hidden ${ready ? "pts-blink" : ""}`}
              style={{ background: "rgba(7,5,26,0.75)", boxShadow: `0 0 0 2px ${ARMY_GRADE_COLOR[g.grade]}, 0 0 0 4px #07051a` }}
            >
              <img src={`/defense/units/${g.id}.webp`} alt="" className="h-[32px] w-[32px]" draggable={false} />
              <i className="absolute top-0 left-0 h-[4px] w-full" style={{ background: FACTION_COLOR[g.faction as keyof typeof FACTION_COLOR] }} />
              {g.n > 1 && <b className="pts-sub absolute right-[1px] bottom-[-1px] text-[11px]">{g.n}</b>}
            </span>
          );
        })}
      </div>
      <div className="pointer-events-auto flex items-center gap-[8px]">
        <span className="pts-sub text-[11px] text-[#a9a2d6]">
          부대 {a.count}/{ARMY_CAP}
        </span>
        <button type="button" onClick={onBuy} disabled={gold < a.cost} className="pts-btn h-[28px] px-[10px] text-[12px]" style={{ "--c": "#ffd23a" } as CSSProperties}>
          R 소환 ● {a.cost}
        </button>
        <button type="button" onClick={onMerge} disabled={!a.merge} className={`pts-btn h-[28px] px-[10px] text-[12px] ${a.merge ? "pts-bob" : ""}`} style={{ "--c": "#4ff0c8" } as CSSProperties}>
          F 합성{a.merge ? ` · ${FACTION_NAME[a.merge.split(":")[0] as keyof typeof FACTION_NAME]} ${ARMY_GRADE_NAME[Number(a.merge.split(":")[1])]}` : ""}
        </button>
        {a.craft && (
          <button type="button" onClick={onCraft} className="pts-btn pts-bob h-[28px] px-[10px] text-[12px]" style={{ "--c": "#ff5c8a", "--t": "#fff" } as CSSProperties}>
            G 신화 조합 · {a.craft.name}
          </button>
        )}
      </div>
    </div>
  );
}
