"use client";

import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import { rpc } from "@/lib/api/socket";
import { FURNITURE, checkLayout, footprint, furnById, houseGeo, roomOf, type FurnKind, type Placed } from "@/lib/gmtown/house";
import type { HouseWire } from "@/lib/gmtown/types";
import type { TownEngine } from "./engine";

/*
 * 집 안 화면 (심즈식) — 위: 집 이름 · 꾸미기 · 나가기, 문 앞: 「나가기」, 꾸미기 모드: 아래 가구 목록.
 * 꾸미기: 가구 고르기(창고에 있으면 바로, 없으면 GP 로 사서) → 바닥 칸에 미리 보기(초록 = 놓을 수 있음) → 누르면 놓음.
 * 놓인 가구 누르기 → 들기 · 돌리기 · 창고로. R 회전 · Esc 취소. 바뀔 때마다 서버에 저장(gmtown.house.save).
 * 2층 집: 꾸미기에서 1층 · 2층 고르기 (안 고르면 내가 있는 층). 놀러 온 집(guest)은 꾸미기 없음.
 * 👋 초대: 같은 채널 사람에게 초대 → 그 사람 화면에 「놀러 가기」.
 */

const fmt = (n: number) => n.toLocaleString("ko-KR");
type Cell = { cx: number; cy: number };

export interface HouseState extends HouseWire {
  /** 집 주인 이름 */
  owner: string;
  /** 놀러 온 집 (꾸미기 없음) */
  guest: boolean;
}

export default function HouseHud({
  engine,
  phone,
  house,
  setHouse,
  atDoor,
  onLeave,
  say,
  hover,
  clickRef,
  floor,
}: {
  engine: TownEngine;
  phone: boolean;
  house: HouseState;
  setHouse: (h: HouseState) => void;
  atDoor: boolean;
  onLeave: () => void;
  say: (m: string) => void;
  /** 엔진이 알려 주는 마우스 칸 (GMTownApp 이 넘겨 줌) */
  hover: Cell | null;
  /** 엔진이 바닥 칸을 누르면 부르는 곳 (여기서 채움) */
  clickRef: MutableRefObject<((c: Cell) => void) | null>;
  /** 보이는 층 (엔진이 알려 줌) — 꾸미기는 이 층에 */
  floor: number;
}) {
  const [build, setBuild] = useState(false);
  const [placing, setPlacing] = useState<{ i: FurnKind; r: number } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  /** 폰: 누른 칸 (미리 보기 자리 — 같은 곳을 한 번 더 누르면 놓음) */
  const [tapAt, setTapAt] = useState<Cell | null>(null);
  const [busy, setBusy] = useState(false);
  const layout = house.layout as Placed[];
  const room = roomOf(house.tier);
  const geo = houseGeo(house.tier);
  const two = geo.floors > 1;
  const fl = two ? floor : 0;
  const rows = fl ? geo.d : geo.gd;
  /** 꾸미기에서 고른 층 (null = 내가 있는 층) */
  const [viewF, setViewF] = useState<number | null>(null);
  const [people, setPeople] = useState<ReturnType<TownEngine["people"]> | null>(null);
  const canBuild = !house.guest;
  const used = useMemo(() => {
    const u: Record<string, number> = {};
    for (const p of layout) u[p.i] = (u[p.i] ?? 0) + 1;
    return u;
  }, [layout]);
  const left = (i: string) => (house.inv[i] ?? 0) - (used[i] ?? 0);

  // 엔진: 꾸미기 모드 · 고른 가구 테두리
  useEffect(() => {
    engine.setBuild(build, sel);
  }, [engine, build, sel]);
  useEffect(() => {
    engine.setHouseView(build ? viewF : null);
  }, [engine, build, viewF]);
  useEffect(
    () => () => {
      engine.setBuild(false);
      engine.setHouseView(null);
    },
    [engine]
  );

  const save = useCallback(
    (next: Placed[], ok: string) => {
      const prev = layout;
      setHouse({ ...house, layout: next });
      engine.houseLayout(next);
      void rpc("gmtown.house.save", { layout: next }).then(
        () => ok && say(ok),
        (e) => {
          setHouse({ ...house, layout: prev });
          engine.houseLayout(prev);
          say((e as Error).message || "저장하지 못했어요.");
        }
      );
    },
    [engine, house, layout, say, setHouse]
  );

  /** 이 자리에 놓을 수 있는지 (놓인 것 + 새 것을 통째로 검사) */
  const canPut = useCallback(
    (i: FurnKind, r: number, c: Cell) => !checkLayout(house.tier, [...layout, { i, x: c.cx, y: c.cy, r, ...(fl ? { f: fl } : {}) }], house.inv),
    [house.inv, house.tier, layout, fl]
  );

  // 미리 보기: 마우스 칸 (가구 가운데가 칸에 오게)
  const anchor = useCallback(
    (i: FurnKind, r: number, c: Cell): Cell => {
      const fp = footprint(furnById(i)!, r);
      return {
        cx: Math.max(0, Math.min(room.w - fp.w, c.cx - Math.floor((fp.w - 1) / 2))),
        cy: Math.max(0, Math.min(rows - fp.d, c.cy - Math.floor((fp.d - 1) / 2))),
      };
    },
    [rows, room.w]
  );
  // 미리 보기 자리 (PC = 마우스 칸, 폰 = 누른 칸)
  const aim = phone ? tapAt : hover;
  const ghost = useMemo(() => {
    if (!placing || !aim) return null;
    const a = anchor(placing.i, placing.r, aim);
    return { ...a, ok: canPut(placing.i, placing.r, a) };
  }, [placing, aim, anchor, canPut]);
  useEffect(() => {
    engine.setGhost(placing && ghost ? { i: placing.i, cx: ghost.cx, cy: ghost.cy, r: placing.r, ok: ghost.ok } : null);
  }, [engine, placing, ghost]);

  // 바닥 칸 누름 (엔진 → GMTownApp → 여기)
  useEffect(() => {
    clickRef.current = (c: Cell) => {
      if (!build) return;
      if (placing) {
        const a = anchor(placing.i, placing.r, c);
        // 폰: 처음 누르면 미리 보기만 옮기고, 같은 곳을 한 번 더 누르면 놓음
        if (phone && (!ghost || ghost.cx !== a.cx || ghost.cy !== a.cy)) return setTapAt(c);
        if (!canPut(placing.i, placing.r, a)) return say("여기엔 놓을 수 없어요 (겹치거나 문 앞이에요).");
        save([...layout, { i: placing.i, x: a.cx, y: a.cy, r: placing.r, ...(fl ? { f: fl } : {}) }], "");
        setPlacing(left(placing.i) - 1 > 0 ? placing : null);
        setTapAt(null);
        return;
      }
      // 놓인 가구 고르기 (단단한 것 먼저, 그다음 러그)
      let hit: number | null = null;
      layout.forEach((p, k) => {
        const f = furnById(p.i);
        if (!f || (p.f ?? 0) !== fl) return;
        const fp = footprint(f, p.r);
        if (c.cx >= p.x && c.cx < p.x + fp.w && c.cy >= p.y && c.cy < p.y + fp.d) if (hit === null || !f.flat) hit = k;
      });
      setSel(hit);
    };
    return () => {
      clickRef.current = null;
    };
  });

  const rotateSel = () => {
    if (sel === null) return;
    const p = layout[sel];
    const rest = layout.filter((_, k) => k !== sel);
    for (let d = 1; d <= 3; d++) {
      const r = (p.r + d) % 4;
      const cand = { ...p, r };
      if (!checkLayout(house.tier, [...rest, cand], house.inv)) return save([...rest.slice(0, sel), cand, ...rest.slice(sel)], "");
    }
    say("돌릴 자리가 없어요.");
  };
  const liftSel = () => {
    if (sel === null) return;
    const p = layout[sel];
    save(
      layout.filter((_, k) => k !== sel),
      ""
    );
    setSel(null);
    setPlacing({ i: p.i, r: p.r });
  };
  const storeSel = () => {
    if (sel === null) return;
    const p = layout[sel];
    save(
      layout.filter((_, k) => k !== sel),
      `${furnById(p.i)!.name}을(를) 창고에 넣었어요.`
    );
    setSel(null);
  };
  const pick = (i: FurnKind) => {
    setSel(null);
    if (left(i) > 0) return setPlacing({ i, r: 0 });
    const f = furnById(i)!;
    if (busy) return;
    if ((house.gp ?? 0) < f.price) return say(`GP 가 모자라요 (${fmt(f.price)} GP).`);
    setBusy(true);
    void rpc<HouseWire>("gmtown.house.shop", { id: i }).then(
      (w) => {
        setBusy(false);
        setHouse({ ...house, gp: w.gp, inv: w.inv });
        say(`${f.name} 샀어요! (${fmt(f.price)} GP) 놓을 곳을 골라 주세요.`);
        setPlacing({ i, r: 0 });
      },
      (e) => {
        setBusy(false);
        say((e as Error).message || "사지 못했어요.");
      }
    );
  };

  // 키: R 회전 · Esc 취소 · E 나가기(문 앞)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "r" && build) {
        e.preventDefault();
        if (placing) setPlacing({ ...placing, r: (placing.r + 1) % 4 });
        else rotateSel();
      } else if (k === "escape" && build) {
        if (placing) setPlacing(null);
        else if (sel !== null) setSel(null);
        else setBuild(false);
      } else if (k === "b" && canBuild) setBuild((b) => !b);
      else if ((k === "e" || k === " ") && atDoor && !build) {
        e.preventDefault();
        onLeave();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const name = `${house.owner}의 ${room.name}`;
  const invite = (id: string, who: string) => {
    void rpc("gmtown.house.invite", { to: id }).then(
      () => say(`${who}님을 초대했어요! 💌`),
      (e) => say((e as Error).message || "초대하지 못했어요.")
    );
  };
  return (
    <>
      {/* 위 가운데: 집 이름 · 꾸미기 · 나가기 */}
      <div className="pointer-events-none absolute top-2.5 left-1/2 flex -translate-x-1/2 items-center gap-2">
        <div className="gmt-lo-soft flex h-9 items-center gap-2 rounded-full px-4">
          <span>🏠</span>
          <b className="gmt-lo-title text-[15px]">{name}</b>
          <span className="text-[11px] text-white/55">GP {house.gp === null ? "-" : fmt(house.gp)}</span>
          {two && <span className="rounded bg-white/10 px-1.5 text-[11px] font-bold text-[#9BF0C8]">{fl + 1}층</span>}
        </div>
        {canBuild && (
        <button
          type="button"
          onClick={() => {
            setBuild((b) => !b);
            setPlacing(null);
            setSel(null);
          }}
          className={`${build ? "gmt-gold-btn" : "gmt-dark-btn"} pointer-events-auto flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[13px] font-extrabold`}
        >
          🔨 {build ? "꾸미기 끝" : "꾸미기"}
          {!phone && <kbd className="rounded bg-black/20 px-1 text-[10px]">B</kbd>}
        </button>
        )}
        {canBuild && house.gp !== null && (
          <button
            type="button"
            onClick={() => setPeople((p) => (p ? null : engine.people()))}
            className="gmt-dark-btn pointer-events-auto flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[13px] font-bold"
          >
            👋 초대
          </button>
        )}
        <button
          type="button"
          onClick={onLeave}
          className="gmt-dark-btn pointer-events-auto flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[13px] font-bold"
        >
          🚪 {house.guest ? "돌아가기" : "나가기"}
        </button>
      </div>

      {/* 초대할 사람 (같은 채널) */}
      {people && (
        <div className="gmt-lo gmt-pop absolute top-14 left-1/2 z-10 w-[min(92%,340px)] -translate-x-1/2 rounded-xl p-2">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <b className="text-[13px]">👋 누구를 초대할까요?</b>
            <button type="button" onClick={() => setPeople(null)} aria-label="닫기" className="h-6 w-6 cursor-pointer rounded text-white/60 hover:bg-white/10">
              ✕
            </button>
          </div>
          {people.length ? (
            <div className="gmt-chat-scroll flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
              {people.map((q) => (
                <div key={q.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{q.name}</span>
                  {q.here ? (
                    <span className="text-[11px] text-[#9be7c4]">우리 집에 있어요</span>
                  ) : (
                    <button type="button" onClick={() => invite(q.id, q.name)} className="gmt-gold-btn h-7 cursor-pointer rounded-md px-2.5 text-[11.5px] font-bold">
                      초대
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 py-2 text-[12px] text-white/60">같은 채널에 다른 사람이 없어요. 친구에게 채널 번호를 알려 주세요!</p>
          )}
        </div>
      )}

      {/* 문 앞: 나가기 */}
      {atDoor && !build && (
        <button
          type="button"
          onClick={onLeave}
          className="gmt-glass gmt-pop absolute bottom-24 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-3 rounded-2xl py-2 pr-4 pl-3 text-left"
        >
          <span className="text-[24px]">🚪</span>
          <span className="flex flex-col">
            <b className="text-[14px]">마을로 나가기</b>
            <span className="text-[11px] text-white/60">{house.guest ? `${house.owner}님 집 앞으로` : "우리 집 문 앞으로"}</span>
          </span>
          {!phone && <kbd className="ml-1 rounded-md border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] font-bold">E</kbd>}
        </button>
      )}

      {/* 고른 가구: 들기 · 돌리기 · 창고 */}
      {build && sel !== null && layout[sel] && !placing && (
        <div className="gmt-lo gmt-pop absolute bottom-[150px] left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-xl p-1.5">
          <span className="px-2 text-[13px] font-bold">
            {furnById(layout[sel].i)?.icon} {furnById(layout[sel].i)?.name}
          </span>
          <button type="button" onClick={liftSel} className="gmt-gold-btn h-8 cursor-pointer rounded-lg px-3 text-[12px] font-bold">
            ✋ 옮기기
          </button>
          <button type="button" onClick={rotateSel} className="gmt-dark-btn h-8 cursor-pointer rounded-lg px-3 text-[12px] font-bold">
            ↻ 돌리기{!phone && " (R)"}
          </button>
          <button type="button" onClick={storeSel} className="gmt-dark-btn h-8 cursor-pointer rounded-lg px-3 text-[12px] font-bold">
            📦 창고로
          </button>
        </div>
      )}

      {/* 꾸미기: 아래 가구 목록 */}
      {build && (
        <div className="gmt-lo gmt-pop absolute right-2 bottom-2 left-2 rounded-xl p-2 sm:left-1/2 sm:w-[min(96%,980px)] sm:-translate-x-1/2">
          <div className="mb-1.5 flex items-center justify-between px-1 text-[11.5px] text-white/65">
            <span>
              {placing
                ? `${furnById(placing.i)!.name} — ${phone ? "놓을 칸을 두 번 누르기" : "놓을 칸 누르기"} · ${phone ? "↻ 로" : "R 로"} 돌리기`
                : "가구를 고르면 놓을 수 있어요 · 놓인 가구를 누르면 옮기기 · 돌리기"}
            </span>
            {two && (
              <span className="ml-auto mr-2 flex gap-1">
                {[0, 1].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setViewF(f);
                      setSel(null);
                    }}
                    className={`${fl === f ? "gmt-gold-btn" : "gmt-dark-btn"} h-7 cursor-pointer rounded-md px-2.5 text-[11.5px] font-bold`}
                  >
                    {f + 1}층
                  </button>
                ))}
              </span>
            )}
            {placing && (
              <span className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPlacing({ ...placing, r: (placing.r + 1) % 4 })}
                  className="gmt-dark-btn h-7 cursor-pointer rounded-md px-2.5 text-[11.5px] font-bold"
                >
                  ↻ 돌리기
                </button>
                <button type="button" onClick={() => setPlacing(null)} className="gmt-dark-btn h-7 cursor-pointer rounded-md px-2.5 text-[11.5px] font-bold">
                  취소
                </button>
              </span>
            )}
          </div>
          <div className="gmt-chat-scroll flex gap-1.5 overflow-x-auto pb-1">
            {FURNITURE.filter((f) => (f.where ?? "in") !== "out" || (geo.yard > 0 && fl === 0)).map((f) => {
              const n = left(f.id);
              const on = placing?.i === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pick(f.id)}
                  className={`relative flex w-[84px] shrink-0 cursor-pointer flex-col items-center rounded-lg border px-1 py-1.5 ${
                    on ? "border-[#ffe7a8] bg-[#e9cf8e]/15" : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <span className="text-[26px] leading-none">{f.icon}</span>
                  <span className="mt-1 w-full truncate text-center text-[11px] font-bold">{f.name}</span>
                  {n > 0 ? (
                    <span className="mt-0.5 rounded bg-[#4FD1A5]/20 px-1.5 text-[10px] font-bold text-[#9be7c4]">창고 {n}</span>
                  ) : (
                    <span className="mt-0.5 text-[10px] font-bold text-[#FFE6A0]">{fmt(f.price)} GP</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
