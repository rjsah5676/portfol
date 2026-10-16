"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BLESS, DASH_CD, DT, ENEMIES, FLAG_NAME, HEROES, PASSIVES, RARITY_COLOR, RARITY_NAME, RUN_SEC, ULT_NEED, VIEW_H, VIEW_W, WEAPONS, xpNeed, type FlagBuff, type HeroId, type PassiveId, type Stats, type WeaponId } from "@/lib/survivor/data";
import { RELICS, RELIC_RARITY_COLOR, RELIC_RARITY_NAME, type RelicId } from "@/lib/survivor/relics";
import { banishCard, bossLimit, buyRelic, chooseBless, chooseCard, chooseWish, closeChest, dawnChoice, leaveThing, maxHp, newRun, reroll, result, step, type Card, type Ev, type Input, type Pause, type Run, type RunOpts, type RunResult } from "@/lib/survivor/sim";
import { getArt, loadFiles, loadHero, type HeroArt } from "./art";
import { playBgm, preloadSfx, sfx, setSound, soundPref } from "./audio";
import { draw, mobColor, newFx, tickFx, type Fx } from "./render";

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
}
const hudOf = (r: Run): Hud => {
  const b = r.bossId >= 0 ? r.enemies.find((e) => e.id === r.bossId) : undefined;
  return {
    t: r.t,
    hp: r.p.hp,
    max: maxHp(r),
    lv: r.p.lv,
    xp: r.p.xp / xpNeed(r.p.lv),
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
  };
};

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

  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);
  // 개발 중에만: 콘솔 · 자동 테스트에서 판 상태 보기
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __pts?: { current: Run } }).__pts = runRef;
  }, []);

  useEffect(() => {
    let alive = true;
    void loadHero(HEROES[hero].sprite, 40).then((a) => alive && (heroArt.current = a));
    sup.forEach((h, i) => void loadHero(HEROES[h].sprite, 26).then((a) => alive && (supArt.current[i] = a)));
    getArt();
    void loadFiles();
    preloadSfx();
    playBgm("night");
    return () => {
      alive = false;
      playBgm(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero]);

  const say = useCallback((text: string, c = "#ffd23a") => setBanner({ id: Date.now(), text, c }), []);
  const lastNoGold = useRef(0);
  const [toasts, setToasts] = useState<{ id: number; relic: RelicId }[]>([]);
  const toast = useCallback((relic: RelicId) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, relic }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  /** 시뮬에서 나온 일 → 화면 효과 · 소리 */
  const onEv = useCallback(
    (evs: Ev[]) => {
      const fx = fxRef.current;
      let dmgN = 0;
      for (const e of evs) {
        switch (e.t) {
          case "dmg":
            if (dmgN++ < 14) fx.nums.push({ x: e.x + (Math.random() - 0.5) * 6, y: e.y, v: e.v, crit: e.crit, t: 0 });
            sfx("hit");
            break;
          case "kill": {
            const c = mobColor(e.kind);
            const n = e.boss ? 40 : e.elite ? 16 : 4;
            for (let i = 0; i < n; i++) fx.parts.push({ x: e.x, y: e.y - 5, vx: (Math.random() - 0.5) * (e.boss ? 260 : 120), vy: -Math.random() * (e.boss ? 200 : 90), c: i % 3 ? c : "#ffffff", t: 0, life: 0.4 + Math.random() * 0.3, s: e.boss ? 3 : 2 });
            if (e.boss) {
              fx.shake = 10;
              fx.flash = 1;
              fx.flashC = "#ffffff";
              sfx("boom");
              say(`${ENEMIES[e.kind].name} 처치!`, "#ffd23a");
            } else sfx("kill");
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
            fx.rings.push({ x: e.x, y: e.y, r: e.r, c: e.c, t: 0, life: 0.3, fill: true });
            fx.rings.push({ x: e.x, y: e.y, r: e.r * 1.1, c: "#ffffff", t: 0, life: 0.25, fill: false });
            if (e.r >= 16) sfx("boom");
            break;
          case "bolt":
            fx.bolts.push({ x: e.x, y: e.y, r: e.r, t: 0, seed: Math.floor(Math.random() * 1000), j: e.j });
            sfx("bolt");
            break;
          case "fire":
            sfx("throw");
            break;
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
            say(e.arena ? `새벽 보스 — ${ENEMIES[e.kind].name}` : `보스 등장 — ${ENEMIES[e.kind].name}`, "#ff3d6e");
            if (e.arena) playBgm("boss");
            break;
          case "warn":
            sfx("warn");
            say(e.text, "#ff4fa3");
            break;
          case "ult":
            fx.flash = 1.2;
            fx.flashC = HEROES[e.hero].color;
            fx.shake = 8;
            sfx("ult");
            say(HEROES[e.hero].ult.name + "!", HEROES[e.hero].color);
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
            sfx("win");
            say("새벽이 밝았어요!", "#ffd23a");
            playBgm(null);
            break;
          case "dead":
            sfx("dead");
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
      if (!stop && !r.over) {
        acc += dt;
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
        setHud(hudOf(r));
      }
      if (r.over && !ended.current) {
        ended.current = true;
        setTimeout(() => onEnd(result(r)), r.win ? 2200 : 1400);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [keys, onEv, onEnd]);

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
      if (r.pause?.k === "chest" && (e.key === "Enter" || e.key === " ")) shutChest();
      if (r.pause?.k === "bless" && n >= 0) act((x) => chooseBless(x, n), "card");
      if (r.pause?.k === "wish" && n >= 0) act((x) => chooseWish(x, n), "jackpot");
      if (r.pause?.k === "shop" && n >= 0) act((x) => buyRelic(x, n), "buy");
      if ((r.pause?.k === "shop" || r.pause?.k === "wish") && e.key === "Escape") act(leaveThing);
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

  const left = RUN_SEC - hud.t;
  return (
    <div className="absolute inset-0" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ touchAction: "none" }}>
      <canvas ref={cvRef} width={VIEW_W} height={VIEW_H} className="absolute inset-0 h-full w-full" />

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
                return (
                  <span key={i} className={`pts-slot ${w?.awake ? "pts-glow" : ""}`} style={{ width: 30, height: 30, boxShadow: `0 0 0 2px ${w && (WEAPONS[w.id].fuse || WEAPONS[w.id].evo || w.awake) ? "#ffd23a" : "#3a3080"}` }}>
                    {w && <ItemIcon k="weapon" id={w.id} size={26} />}
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
            <b className={`pts-title text-[30px] leading-none ${hud.ot ? "text-[#ff9cc8]" : left < 30 && left > 0 ? "text-[#ff4fa3]" : "text-white"}`}>{hud.ot ? `+${fmt(hud.otT)}` : left > 0 ? fmt(left) : fmt(hud.t - RUN_SEC)}</b>
            <span className="pts-sub mt-[2px] text-[11px] text-[#a9a2d6]">{hud.ot ? `오버타임 Lv${hud.otLv}` : left > 0 ? "새벽까지" : "새벽 이후"}</span>
            {(hud.depth > 0 || hud.curse > 0) && (
              <span className="pts-sub mt-[3px] flex gap-[6px] text-[11px]">
                {hud.depth > 0 && <span className="text-[#c58bff]">깊이 {hud.depth}</span>}
                {hud.curse > 0 && <span className="text-[#ff8a6b]">저주 +{Math.round(hud.curse * 100)}%</span>}
              </span>
            )}
            {hud.trial > 0 && <b className="pts-title pts-blink mt-[4px] text-[18px] text-[#e0d8ff]">시련 {Math.ceil(hud.trial)}초</b>}
          </div>
          <div className="flex flex-col items-end gap-[4px] text-[14px] font-bold">
            <span className="pts-sub flex items-center gap-[6px]">
              <span className="inline-block h-[10px] w-[10px] bg-[#ff3d6e]" style={{ boxShadow: "0 0 0 2px #07051a" }} />
              {hud.kills.toLocaleString()}
            </span>
            <span className="pts-sub flex items-center gap-[6px] text-[#ffd23a]" title="금화 — 상자 · 상인에 써요">
              <span className="inline-block h-[10px] w-[10px] rounded-full bg-[#ffd23a]" style={{ boxShadow: "0 0 0 2px #07051a" }} />
              {hud.gold.toLocaleString()}
            </span>
            <button type="button" onClick={() => setMenu(true)} className="pts-btn ghost pointer-events-auto mt-[4px] h-[28px] px-[10px] text-[12px]">
              II 일시정지
            </button>
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

      {/* 조이스틱 */}
      {stickView && (
        <div className="pointer-events-none absolute" style={{ left: stickView.bx - 60, top: stickView.by - 60, width: 120, height: 120 }}>
          <div className="absolute inset-0 rounded-full bg-white/10" style={{ boxShadow: "0 0 0 2px rgba(255,255,255,0.4)" }} />
          <div className="absolute h-[44px] w-[44px] rounded-full bg-white/60" style={{ left: 38 + stickView.x, top: 38 + stickView.y, boxShadow: "0 0 0 2px #07051a" }} />
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
      {pause?.k === "dawn" && <Dawn hud={hud} onPick={(more) => act((x) => dawnChoice(x, more), more ? "boss" : "click")} />}
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
            return (
              <div key={i} className="flex flex-col items-center gap-[6px]">
                <button type="button" onClick={() => onPick(i)} className={`pts-card pts-pop flex h-[262px] flex-col items-center px-[12px] pt-[14px] pb-[10px] text-left ${sp || c.rarity === 2 ? "legend" : ""}`} style={{ width: w, "--r": col, animationDelay: `${i * 70}ms` } as CSSProperties}>
                  <span className="mb-[8px] self-stretch text-center text-[11px] font-bold" style={{ color: col }}>
                    {c.k === "fuse" ? "★ 합체 ★" : c.k === "evo" ? "★ 진화 ★" : c.k === "awake" ? "★ 각성 ★" : c.rarity ? `${RARITY_NAME[c.rarity]} +${c.to - c.from}` : c.from === 0 && c.k !== "coin" && c.k !== "heal" ? "NEW" : RARITY_NAME[0]}
                  </span>
                  {t.k ? <ItemIcon k={t.k} id={t.id!} size={48} /> : <span className="h-[48px] w-[48px] bg-[#ffd23a]" />}
                  <b className="mt-[10px] text-center text-[16px] leading-[19px] text-white">{t.name}</b>
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
            다시 뽑기 ({hud.rerolls})
          </button>
          <button type="button" disabled={hud.skips <= 0} onClick={() => onPick(-1)} className="pts-btn ghost h-[34px] px-[16px] text-[13px]">
            건너뛰기 +10금화 ({hud.skips})
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
  useEffect(() => {
    const ids: ReturnType<typeof setTimeout>[] = [];
    const spin = setInterval(() => sfx("reel"), 70);
    for (let i = 1; i <= n; i++)
      ids.push(
        setTimeout(() => {
          setShown(i);
          sfx(i === n && n >= 3 ? "jackpot" : "card");
          if (i === n) clearInterval(spin);
        }, 900 + i * 380)
      );
    if (!n) ids.push(setTimeout(() => clearInterval(spin), 900));
    return () => {
      ids.forEach(clearTimeout);
      clearInterval(spin);
    };
  }, [n]);
  const done = shown >= n;
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
          {done ? "받기" : "두근두근…"}
        </button>
      </div>
    </div>
  );
}

/* ───────────── 일시정지 ───────────── */

function PauseMenu({ hud, onResume, onQuit }: { hud: Hud; onResume(): void; onQuit(): void }) {
  const [snd, setSnd] = useState(soundPref());
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
        <div className="mt-[16px] flex items-center gap-[10px] text-[13px]">
          <span>소리</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={snd.muted ? 0 : snd.vol}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSound({ vol: v, muted: v === 0 });
              setSnd(soundPref());
            }}
            className="flex-1 cursor-pointer accent-[#ffd23a]"
          />
        </div>
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

function Dawn({ hud, onPick }: { hud: Hud; onPick(more: boolean): void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "linear-gradient(180deg, rgba(255,180,107,0.55), rgba(58,42,138,0.85))" }}>
      <b className="pts-title pts-drop text-[44px] text-[#ffd23a]">새벽이 왔다!</b>
      <span className="pts-sub mt-[6px] text-[14px]">자정의 시계지기를 쓰러뜨렸어요 · 처치 {hud.kills.toLocaleString()}</span>
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
