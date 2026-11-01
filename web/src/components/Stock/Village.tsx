"use client";

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { HubStatus } from "@/lib/stock/types";
import { BUILDINGS, type Building } from "@/lib/stock/village";
import { AMY, AMY_BASE, ART, IDLE_MS, LAMPS, LOT_ART, MAP, ROADS, SPAWN, WALK_MS, WALK_SPEED, Y_SCALE, dirOf, roadPath, type AmyDir } from "@/lib/stock/villageArt";
import { sfx } from "@/lib/stock/sound";
import { C, NUM } from "./ui";

/*
 * 2.5D 마을 — 그림 한 장(35° 쿼터뷰) 위를 에이미가 길을 따라 걸어 다님.
 *  - 카메라: 에이미를 따라 부드럽게, 그림 밖은 안 보이게 고정. 폰 · PC 모두 같은 논리 크기(stage) 로 그림
 *  - 건물: 그림 위 네모(ART) 를 누르면 길 그래프(ROADS) 로 문까지 걸어가서 들어감 (화면 아무 데나 누르면 그리로)
 *  - 밤: 실제 시간(19시~6시) 또는 버튼. 어두운 덮개 + 창문 · 가로등 빛
 *  - 스프라이트: 방향 5종 × 걷기 20프레임 · 서 있기 N프레임, 왼쪽은 좌우 반전. 그림자는 발 아래 타원
 *  - 들어갈 때: 문 쪽으로 0.45초 줌인 + 어두워짐 → onEnter
 */

export type NightMode = "auto" | "day" | "night";
export const isNightNow = () => {
  const h = (new Date().getUTCHours() + 9) % 24; // KST
  return h >= 19 || h < 6;
};

interface Pt {
  x: number;
  y: number;
}
/** 건물에서 나오면 그 문 앞에 서 있게 (화면이 바뀌어도 기억) */
let remembered: { pos: Pt; dir: AmyDir } | null = null;
type Target = { pts: Pt[]; then?: () => void };
export interface VillageApi {
  goBuilding: (b: Building) => void;
  enterNow: (b: Building) => void;
  walkTo: (p: Pt) => void;
}

export default function Village({
  w,
  h,
  nick,
  status,
  night,
  onEnter,
  onLot,
  ctlRef,
  children,
}: {
  w: number;
  h: number;
  nick: string;
  status: HubStatus | null;
  night: boolean;
  /** 건물 문 앞에 도착해 줌인까지 끝난 뒤 */
  onEnter: (b: Building) => void;
  /** 단독주택 자리를 누름 (부동산으로) */
  onLot: (lot: string) => void;
  /** 바깥(허브 목록 · 단축키)에서 걷게 · 들어가게 */
  ctlRef?: MutableRefObject<VillageApi | null>;
  /** 화면 위에 겹쳐 그릴 UI */
  children?: ReactNode;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const world = useRef<HTMLDivElement | null>(null);
  const spr = useRef<HTMLDivElement | null>(null);
  const shadow = useRef<HTMLDivElement | null>(null);
  const tag = useRef<HTMLDivElement | null>(null);
  /** 문으로 줌인 중 — 화면 기준 원점 */
  const [zoomTo, setZoomTo] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // 화면에 맞는 배율: 세로를 다 보여 주되 캐릭터가 너무 작지 않게 (최소 0.5)
  const zoom = Math.max(w / MAP.w, (h / MAP.h) * 1.3);
  const st = useRef({
    pos: remembered ? { ...remembered.pos } : { ...SPAWN },
    dir: remembered?.dir ?? ("front" as AmyDir),
    flip: false,
    walking: false,
    frame: 0,
    acc: 0,
    target: null as Target | null,
    cam: remembered ? { ...remembered.pos } : { x: SPAWN.x, y: SPAWN.y },
    last: 0,
    keys: new Set<string>(),
  });

  // 애니메이션 루프 (React 상태 없이 DOM 직접)
  useEffect(() => {
    const s = st.current;
    let raf = 0;
    const camClamp = (c: Pt) => ({ x: Math.min(MAP.w - w / zoom / 2, Math.max(w / zoom / 2, c.x)), y: Math.min(MAP.h - h / zoom / 2, Math.max(h / zoom / 2, c.y)) });
    s.cam = camClamp(s.cam);
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, s.last ? (t - s.last) / 1000 : 0.016);
      s.last = t;
      // 키보드로 걷기
      let kx = 0,
        ky = 0;
      if (s.keys.has("ArrowLeft") || s.keys.has("a")) kx -= 1;
      if (s.keys.has("ArrowRight") || s.keys.has("d")) kx += 1;
      if (s.keys.has("ArrowUp") || s.keys.has("w")) ky -= 1;
      if (s.keys.has("ArrowDown") || s.keys.has("s")) ky += 1;
      let moved = false;
      if (kx || ky) {
        s.target = null;
        const n = Math.hypot(kx, ky);
        const dx = (kx / n) * WALK_SPEED * dt,
          dy = (ky / n) * WALK_SPEED * Y_SCALE * dt;
        s.pos.x = Math.min(MAP.w - 20, Math.max(20, s.pos.x + dx));
        s.pos.y = Math.min(MAP.h - 10, Math.max(60, s.pos.y + dy));
        const d = dirOf(dx, dy);
        s.dir = d.dir;
        s.flip = d.flip;
        moved = true;
      } else if (s.target) {
        const p = s.target.pts[0];
        const dx = p.x - s.pos.x,
          dy = p.y - s.pos.y;
        // 세로는 눌려 보이니 실제 거리 기준으로 속도 맞춤
        const dist = Math.hypot(dx, dy / Y_SCALE);
        const step = WALK_SPEED * dt;
        if (dist <= step) {
          s.pos = { ...p };
          s.target.pts.shift();
          if (!s.target.pts.length) {
            const then = s.target.then;
            s.target = null;
            then?.();
          }
        } else {
          const ux = dx / dist,
            uy = dy / Y_SCALE / dist;
          s.pos.x += ux * step;
          s.pos.y += uy * step * Y_SCALE;
          const d = dirOf(ux, uy * Y_SCALE);
          s.dir = d.dir;
          s.flip = d.flip;
          moved = true;
        }
      }
      // 프레임
      const set = AMY[s.dir];
      if (moved !== s.walking) {
        s.walking = moved;
        s.frame = moved ? set.start : 0;
        s.acc = 0;
      }
      s.acc += dt * 1000;
      const per = s.walking ? WALK_MS : IDLE_MS;
      const sheet = s.walking ? set.walk : set.idle;
      while (s.acc >= per) {
        s.acc -= per;
        s.frame = (s.frame + 1) % sheet.n;
      }
      // 카메라 (부드럽게 따라감)
      const want = camClamp(s.pos);
      s.cam.x += (want.x - s.cam.x) * Math.min(1, dt * 4);
      s.cam.y += (want.y - s.cam.y) * Math.min(1, dt * 4);
      if (world.current) world.current.style.transform = `translate(${(w / 2 - s.cam.x * zoom).toFixed(1)}px, ${(h / 2 - s.cam.y * zoom).toFixed(1)}px) scale(${zoom})`;
      const el = spr.current;
      if (el) {
        const f = s.frame % sheet.n;
        el.style.width = `${sheet.w}px`;
        el.style.height = `${sheet.h}px`;
        el.style.backgroundImage = `url(${AMY_BASE}/${sheet.file})`;
        el.style.backgroundPosition = `${-f * sheet.w}px 0`;
        // 발 기준점(ax, ay) 을 pos 에 맞춤 · 왼쪽이면 반전
        const left = s.pos.x - (s.flip ? sheet.w - sheet.ax : sheet.ax);
        el.style.transform = `translate(${left.toFixed(1)}px, ${(s.pos.y - sheet.ay).toFixed(1)}px)${s.flip ? " scaleX(-1)" : ""}`;
        el.style.transformOrigin = s.flip ? `${sheet.w - sheet.ax}px 0` : "0 0";
        el.style.zIndex = String(10 + Math.round(s.pos.y));
      }
      if (shadow.current) shadow.current.style.transform = `translate(${(s.pos.x - 34).toFixed(1)}px, ${(s.pos.y - 10).toFixed(1)}px)`;
      if (tag.current) tag.current.style.transform = `translate(${s.pos.x.toFixed(1)}px, ${(s.pos.y - 186).toFixed(1)}px) translateX(-50%)`;
    };
    raf = requestAnimationFrame(tick);
    const kd = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "w", "a", "s", "d"].includes(k)) {
        s.keys.add(k);
        if (k.startsWith("Arrow")) e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => s.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      remembered = { pos: { ...s.pos }, dir: "front" };
    };
  }, [w, h, zoom]);

  /** 그림 좌표 → 화면 좌표 (지금 카메라 기준) */
  const toScreen = (p: Pt): Pt => {
    const s = st.current;
    return { x: (p.x - s.cam.x) * zoom + w / 2, y: (p.y - s.cam.y) * zoom + h / 2 };
  };
  const walkTo = (p: Pt, then?: () => void) => {
    const s = st.current;
    s.target = { pts: roadPath(s.pos, p), then };
  };
  /** 건물로: 문까지 걷고 → 줌인 → onEnter */
  const goBuilding = (b: Building) => {
    if (b.action.type === "soon") return;
    const a = ART[b.id];
    if (!a) return onEnter(b);
    sfx("tab");
    walkTo(a.door, () => {
      sfx(b.id === "home" ? "home" : "enter");
      setZoomTo(toScreen(a.door));
      setTimeout(() => {
        setZoomTo(null);
        onEnter(b);
      }, 480);
    });
  };
  /** 바로 입장 (걷기 생략) */
  const enterNow = (b: Building) => {
    const a = ART[b.id];
    const s = st.current;
    if (a) {
      s.pos = { ...a.door };
      s.target = null;
    }
    sfx(b.id === "home" ? "home" : "enter");
    setZoomTo(toScreen(a?.door ?? s.pos));
    setTimeout(() => {
      setZoomTo(null);
      onEnter(b);
    }, 480);
  };
  // 바깥에서 쓰게 (허브 목록 · 단축키)
  useEffect(() => {
    if (ctlRef) ctlRef.current = { goBuilding, enterNow, walkTo };
  });

  const toMap = (clientX: number, clientY: number): Pt => {
    const r = host.current!.getBoundingClientRect();
    const s = st.current;
    const sx = ((clientX - r.left) / r.width) * w,
      sy = ((clientY - r.top) / r.height) * h;
    return { x: (sx - w / 2) / zoom + s.cam.x, y: (sy - h / 2) / zoom + s.cam.y };
  };

  return (
    <div
      ref={host}
      className="relative h-full w-full overflow-hidden select-none"
      style={{ background: "#1a2a3a", touchAction: "none" }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-ui]")) return;
        const p = toMap(e.clientX, e.clientY);
        // 건물 · 자리를 눌렀나
        for (const b of BUILDINGS) {
          const a = ART[b.id];
          if (a && p.x >= a.box.x && p.x <= a.box.x + a.box.w && p.y >= a.box.y && p.y <= a.box.y + a.box.h) return goBuilding(b);
        }
        for (const [id, l] of Object.entries(LOT_ART)) if (p.x >= l.box.x && p.x <= l.box.x + l.box.w && p.y >= l.box.y && p.y <= l.box.y + l.box.h) return (sfx("tab"), onLot(id));
        walkTo({ x: Math.min(MAP.w - 20, Math.max(20, p.x)), y: Math.min(MAP.h - 10, Math.max(60, p.y)) });
      }}
      onPointerMove={(e) => {
        const p = toMap(e.clientX, e.clientY);
        const hit = BUILDINGS.find((b) => {
          const a = ART[b.id];
          return a && p.x >= a.box.x && p.x <= a.box.x + a.box.w && p.y >= a.box.y && p.y <= a.box.y + a.box.h;
        });
        setHover(hit?.id ?? null);
      }}
    >
      <div className={zoomTo ? "stk-doorzoom" : ""} style={{ position: "absolute", inset: 0, transformOrigin: zoomTo ? `${zoomTo.x}px ${zoomTo.y}px` : undefined }}>
        <div ref={world} className="absolute top-0 left-0 will-change-transform" style={{ width: MAP.w, height: MAP.h, transformOrigin: "0 0" }}>
          <img src="/stock/village/day.webp" alt="" draggable={false} className="absolute top-0 left-0" style={{ width: MAP.w, height: MAP.h, filter: night ? "brightness(0.55) saturate(0.8)" : undefined, transition: "filter 0.8s" }} />
          {/* 밤 — 푸른 덮개 + 창문 · 가로등 빛 */}
          {night && (
            <>
              <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(20,30,80,0.45), rgba(10,15,50,0.5))", mixBlendMode: "multiply" }} />
              {Object.values(ART).flatMap((a) => a.glow ?? []).map(([x, y, r, col], i) => (
                <div key={`g${i}`} className="stk-glow pointer-events-none absolute rounded-full" style={{ left: x - r, top: y - r, width: r * 2, height: r * 2, background: `radial-gradient(circle, ${col}66 0%, ${col}22 45%, transparent 70%)`, mixBlendMode: "screen", animationDelay: `${(i * 0.37) % 2}s` }} />
              ))}
              {LAMPS.map(([x, y], i) => (
                <div key={`l${i}`} className="stk-glow pointer-events-none absolute rounded-full" style={{ left: x - 70, top: y - 70, width: 140, height: 140, background: "radial-gradient(circle, rgba(255,214,120,0.55) 0%, rgba(255,190,80,0.18) 40%, transparent 70%)", mixBlendMode: "screen", animationDelay: `${(i * 0.53) % 2}s` }} />
              ))}
            </>
          )}
          {/* 건물 이름표 (hover 때 밝게) */}
          {BUILDINGS.map((b) => {
            const a = ART[b.id];
            if (!a) return null;
            const line = status && b.status ? b.status(status) : null;
            const on = hover === b.id;
            return (
              <div key={b.id} className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-full flex-col items-center" style={{ left: a.label.x, top: a.label.y, zIndex: 5, transform: `translate(-50%, -100%) scale(${1 / zoom})`, transformOrigin: "50% 100%" }}>
                <div className="flex items-center gap-[6px] rounded-full px-[10px] py-[4px] text-[12px] font-bold whitespace-nowrap" style={{ background: on ? C.gold : "rgba(9,13,22,0.82)", color: on ? "#1A1408" : C.text, border: `1px solid ${on ? C.gold : b.color}99`, boxShadow: on ? `0 0 16px ${C.gold}88` : "0 2px 8px rgba(0,0,0,0.4)", transition: "background 0.15s" }}>
                  <span>{b.icon}</span>
                  {b.name}
                  {b.action.type === "soon" && <span style={{ color: C.mute, fontWeight: 500 }}>준비 중</span>}
                </div>
                {line && (
                  <div className={`mt-[2px] rounded-[6px] px-[6px] py-[2px] text-[10px] whitespace-nowrap ${NUM}`} style={{ background: "rgba(9,13,22,0.7)", color: C.mute }}>
                    {line}
                  </div>
                )}
                <div className="h-[8px] w-px" style={{ background: `${b.color}99` }} />
              </div>
            );
          })}
          {/* 에이미 */}
          <div ref={shadow} className="pointer-events-none absolute top-0 left-0 rounded-full" style={{ width: 68, height: 22, background: "radial-gradient(ellipse, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.2) 50%, transparent 72%)", zIndex: 9 }} />
          <div ref={spr} className="pointer-events-none absolute top-0 left-0" style={{ backgroundRepeat: "no-repeat", imageRendering: "auto" }} />
          <div ref={tag} className="pointer-events-none absolute top-0 left-0 rounded-full px-[8px] py-[2px] text-[11px] font-bold whitespace-nowrap" style={{ background: "rgba(9,13,22,0.75)", color: C.gold, border: `1px solid ${C.gold}66`, zIndex: 2000, transform: `scale(${1 / zoom})` }}>
            {nick}
          </div>
        </div>
      </div>
      {zoomTo && <div className="stk-doorfade pointer-events-none absolute inset-0" style={{ background: "#000" }} />}
      {children}
    </div>
  );
}

/** 길 그래프 점 찍어 보기 (개발용) */
export const RoadDebug = () => (
  <>
    {ROADS.pts.map(([x, y], i) => (
      <div key={i} className="absolute text-[10px]" style={{ left: x - 4, top: y - 4, width: 8, height: 8, background: "#f00", color: "#fff" }}>
        {i}
      </div>
    ))}
  </>
);

/** 서 있는 에이미 (집 안 · 로딩 등) — 발 위치(x, y) 기준, scale 배 */
export function AmyIdle({ x, y, scale = 1, dir = "front" }: { x: number; y: number; scale?: number; dir?: AmyDir }) {
  const el = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sheet = AMY[dir].idle;
    let f = 0,
      raf = 0,
      last = 0,
      acc = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      acc += last ? t - last : 0;
      last = t;
      while (acc >= IDLE_MS) {
        acc -= IDLE_MS;
        f = (f + 1) % sheet.n;
      }
      if (el.current) el.current.style.backgroundPosition = `${-f * sheet.w}px 0`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dir]);
  const sheet = AMY[dir].idle;
  return (
    <div className="pointer-events-none absolute" style={{ left: x, top: y, width: 0, height: 0 }}>
      <div className="absolute rounded-full" style={{ left: -34 * scale, top: -10 * scale, width: 68 * scale, height: 22 * scale, background: "radial-gradient(ellipse, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.18) 50%, transparent 72%)" }} />
      <div ref={el} className="absolute" style={{ left: -sheet.ax * scale, top: -sheet.ay * scale, width: sheet.w, height: sheet.h, backgroundImage: `url(${AMY_BASE}/${sheet.file})`, backgroundRepeat: "no-repeat", transform: `scale(${scale})`, transformOrigin: "0 0" }} />
    </div>
  );
}
