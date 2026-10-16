"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { DASH_CD, DT, ENEMIES, HEROES, PASSIVES, RARITY_COLOR, RARITY_NAME, RUN_SEC, ULT_NEED, VIEW_H, VIEW_W, WEAPONS, xpNeed, type HeroId, type PassiveId, type Stats, type WeaponId } from "@/lib/survivor/data";
import { chooseCard, closeChest, maxHp, newRun, reroll, result, step, type Card, type Ev, type Input, type Pause, type Run, type RunOpts, type RunResult } from "@/lib/survivor/sim";
import { getArt, loadFiles, loadHero, type HeroArt } from "./art";
import { playBgm, preloadSfx, sfx, setSound, soundPref } from "./audio";
import { draw, mobColor, newFx, tickFx, type Fx } from "./render";

/* ───────────── 아이콘 (에셋 오기 전: 색 · 첫 글자) ───────────── */

export function ItemIcon({ k, id, size = 26 }: { k: "weapon" | "passive"; id: WeaponId | PassiveId; size?: number }) {
  const def = k === "weapon" ? WEAPONS[id as WeaponId] : PASSIVES[id as PassiveId];
  // 도트 아이콘 (public/survivor/icon/<id>.png, 48px)
  return <img src={`/survivor/icon/${id}.png`} alt={def.name} draggable={false} className="shrink-0 select-none" style={{ width: size, height: size, objectFit: "contain", imageRendering: size >= 40 ? "pixelated" : "auto" }} />;
}

const cardText = (c: Card): { name: string; desc: string; k: "weapon" | "passive" | null; id?: WeaponId | PassiveId } => {
  if (c.k === "fuse") {
    const d = WEAPONS[c.id as WeaponId];
    return { name: d.name, desc: d.desc[0], k: "weapon", id: c.id };
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
  return c.k === "coin" ? { name: "코인 주머니", desc: "코인 +25", k: null } : { name: "따끈한 고기", desc: "체력 +40", k: null };
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
  coins: number;
  ult: number;
  dash: number;
  boss: { name: string; hp: number } | null;
  weapons: { id: WeaponId; lv: number }[];
  passives: { id: PassiveId; lv: number }[];
  rerolls: number;
  skips: number;
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
    coins: r.p.coins,
    ult: r.p.ult / ULT_NEED,
    dash: 1 - r.p.dashCd / DASH_CD,
    boss: b ? { name: b.def.name, hp: b.hp / b.maxHp } : null,
    weapons: r.weapons.map((w) => ({ id: w.id, lv: w.lv })),
    passives: r.passives.map((p) => ({ ...p })),
    rerolls: r.rerolls,
    skips: r.skips,
  };
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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
            fx.bolts.push({ x: e.x, y: e.y, r: e.r, t: 0, seed: Math.floor(Math.random() * 1000) });
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
            fx.flash = 1.4;
            fx.flashC = "#ffd23a";
            sfx("fuse");
            say(`합체! ${WEAPONS[e.id].name}`, "#ffd23a");
            break;
          case "prop":
            for (let i = 0; i < 8; i++) fx.parts.push({ x: e.x, y: e.y - 12, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 100, c: i % 2 ? "#ffe9a0" : "#3c3f5c", t: 0, life: 0.5, s: 2 });
            sfx("hit");
            break;
          case "win":
            sfx("win");
            say("새벽이 밝았어요!", "#ffd23a");
            break;
          case "dead":
            sfx("dead");
            break;
        }
      }
    },
    [say]
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

  // Esc = 일시정지 · 숫자 = 카드
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const r = runRef.current;
      if (e.key === "Escape" && !r.pause) setMenu((m) => !m);
      if (r.pause?.k === "level" && ["1", "2", "3", "4"].includes(e.key)) pickCard(Number(e.key) - 1);
      if (r.pause?.k === "chest" && (e.key === "Enter" || e.key === " ")) shutChest();
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
                  <span key={i} className="pts-slot" style={{ width: 30, height: 30, boxShadow: `0 0 0 2px ${w && WEAPONS[w.id].fuse ? "#ffd23a" : "#3a3080"}` }}>
                    {w && <ItemIcon k="weapon" id={w.id} size={26} />}
                    {w && <b className="pts-sub absolute -right-[3px] -bottom-[6px] text-[10px]">{WEAPONS[w.id].fuse ? "★" : w.lv}</b>}
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
          </div>
          <div className="flex flex-col items-center">
            <b className={`pts-title text-[30px] leading-none ${left < 30 && left > 0 ? "text-[#ff4fa3]" : "text-white"}`}>{left > 0 ? fmt(left) : fmt(hud.t - RUN_SEC)}</b>
            <span className="pts-sub mt-[2px] text-[11px] text-[#a9a2d6]">{left > 0 ? "새벽까지" : "새벽 이후"}</span>
          </div>
          <div className="flex flex-col items-end gap-[4px] text-[14px] font-bold">
            <span className="pts-sub flex items-center gap-[6px]">
              <span className="inline-block h-[10px] w-[10px] bg-[#ff3d6e]" style={{ boxShadow: "0 0 0 2px #07051a" }} />
              {hud.kills.toLocaleString()}
            </span>
            <span className="pts-sub flex items-center gap-[6px] text-[#ffd23a]">
              <span className="inline-block h-[10px] w-[10px] rounded-full bg-[#ffd23a]" style={{ boxShadow: "0 0 0 2px #07051a" }} />
              {hud.coins.toLocaleString()}
            </span>
            <button type="button" onClick={() => setMenu(true)} className="pts-btn ghost pointer-events-auto mt-[4px] h-[28px] px-[10px] text-[12px]">
              II 일시정지
            </button>
          </div>
        </div>
        {hud.boss && (
          <div className="mx-auto mt-[6px] w-[420px]">
            <div className="pts-sub mb-[4px] text-center text-[13px] font-bold text-[#ff8fb8]">{hud.boss.name}</div>
            <div className="pts-bar h-[12px]" style={{ "--c": "#ff3d6e" } as CSSProperties}>
              <i style={{ width: `${hud.boss.hp * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* 아래: 체력 · 대시 · 필살기 */}
      <div className="pointer-events-none absolute bottom-[12px] left-[12px] w-[220px]">
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

      {pause?.k === "level" && <LevelUp pause={pause} rerolls={hud.rerolls} skips={hud.skips} onPick={pickCard} onReroll={doReroll} />}
      {pause?.k === "chest" && <Chest pause={pause} onClose={shutChest} />}
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

function LevelUp({ pause, rerolls, skips, onPick, onReroll }: { pause: Extract<Pause, { k: "level" }>; rerolls: number; skips: number; onPick(i: number): void; onReroll(): void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(7,5,26,0.72)" }}>
      <b className="pts-title pts-drop text-[34px] text-[#ffd23a]">{pause.jackpot ? "★ 잭팟! 전부 받아요 ★" : "LEVEL UP!"}</b>
      <span className="pts-sub mt-[4px] mb-[18px] text-[13px] text-[#a9a2d6]">{pause.jackpot ? "아무 카드나 누르면 셋 다 가져가요" : "하나를 골라요 · 숫자키 1 2 3"}</span>
      <div className="flex gap-[22px]">
        {pause.cards.map((c, i) => {
          const t = cardText(c);
          const fuse = c.k === "fuse";
          const col = fuse ? "#ffd23a" : RARITY_COLOR[c.rarity];
          return (
            <button key={i} type="button" onClick={() => onPick(i)} className={`pts-card pts-pop flex h-[250px] w-[200px] flex-col items-center px-[14px] pt-[16px] pb-[12px] text-left ${fuse || c.rarity === 2 ? "legend" : ""}`} style={{ "--r": col, animationDelay: `${i * 70}ms` } as CSSProperties}>
              <span className="mb-[10px] self-stretch text-center text-[11px] font-bold" style={{ color: col }}>
                {fuse ? "★ 합체 ★" : c.rarity ? `${RARITY_NAME[c.rarity]} +${c.to - c.from}` : c.from === 0 && c.k !== "coin" && c.k !== "heal" ? "NEW" : RARITY_NAME[0]}
              </span>
              {t.k ? <ItemIcon k={t.k} id={t.id!} size={52} /> : <span className="h-[52px] w-[52px] bg-[#ffd23a]" />}
              <b className="mt-[12px] text-[17px] text-white">{t.name}</b>
              {c.k === "weapon" || c.k === "passive" ? (
                <span className="mt-[2px] text-[12px] text-[#a9a2d6]">{c.from === 0 ? `Lv ${c.to}` : `Lv ${c.from} → ${c.to}`}</span>
              ) : fuse ? (
                <span className="mt-[2px] flex items-center gap-[4px] text-[11px] text-[#ffd23a]">
                  <ItemIcon k="weapon" id={WEAPONS[c.id as WeaponId].fuse![0]} size={16} />+<ItemIcon k="weapon" id={WEAPONS[c.id as WeaponId].fuse![1]} size={16} />
                </span>
              ) : null}
              <span className="mt-[10px] text-center text-[13px] leading-[19px] text-[#e8e4ff] [word-break:keep-all]">{t.desc}</span>
              <span className="pts-sub mt-auto text-[11px] text-[#6b63a3]">{i + 1}</span>
            </button>
          );
        })}
      </div>
      {!pause.jackpot && (
        <div className="mt-[22px] flex gap-[14px]">
          <button type="button" disabled={rerolls <= 0} onClick={onReroll} className="pts-btn h-[34px] px-[16px] text-[13px]" style={{ "--c": "#5fd0ff" } as CSSProperties}>
            다시 뽑기 ({rerolls})
          </button>
          <button type="button" disabled={skips <= 0} onClick={() => onPick(-1)} className="pts-btn ghost h-[34px] px-[16px] text-[13px]">
            건너뛰기 +10코인 ({skips})
          </button>
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
              <div className="relative flex h-[90px] w-[90px] items-center justify-center overflow-hidden bg-[#07051a]" style={{ boxShadow: `0 0 0 2px ${open ? "#ffd23a" : "#6b63a3"}` }}>
                {open && t?.k ? (
                  <span className="pts-pop">
                    <ItemIcon k={t.k} id={t.id!} size={56} />
                  </span>
                ) : (
                  <div className="pts-reel flex flex-col gap-[10px]">
                    {(["shuriken", "bolt", "might", "fireball"] as const).map((x, j) => (
                      <ItemIcon key={j} k={x === "might" ? "passive" : "weapon"} id={x} size={40} />
                    ))}
                  </div>
                )}
              </div>
              <span className="mt-[8px] h-[34px] text-center text-[12px] leading-[16px] [word-break:keep-all]">
                {open && t ? (
                  <>
                    <b className={it?.k === "fuse" ? "text-[#ffd23a]" : "text-white"}>{t.name}</b>
                    <br />
                    <span className="text-[#a9a2d6]">{it?.k === "fuse" ? "합체!" : `Lv ${it!.to}`}</span>
                  </>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-[14px] flex items-center gap-[16px]">
        <span className="pts-sub text-[15px] font-bold text-[#ffd23a]">+{pause.coins} 코인</span>
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
