"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { CHAR, CHARS, GACHA, GRADE_COLOR, ITEM, ITEMS, artOf, charOn, type Grade } from "@/lib/marble/data";
import { CHAR_RATES, type CharPull, type ItemPull } from "@/lib/marble/gacha";
import type { ProfileWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { playBgm, sfx } from "./audio";
import { Btn, Cur, DiceFace, GradeTag, Icon, Win, fmt } from "./pixel";

/*
 * 뽑기 — 캐릭터 · 장착 아이템 두 가지. 별사탕 또는 10연차 티켓.
 * 결과는 카드가 한 장씩 뒤집히고, 가장 높은 등급에 맞춰 소리 · 빛.
 */

export function ItemIcon({ id, size = 48 }: { id: string; size?: number }) {
  const it = ITEM[id];
  const [img, setImg] = useState(true);
  if (!it) return null;
  const frame: CSSProperties = { width: size, height: size, background: GRADE_COLOR[it.grade] + "40", boxShadow: `0 0 0 2px #232a4d, inset 0 0 0 3px ${GRADE_COLOR[it.grade]}` };
  if (img)
    return (
      <div className="relative flex items-center justify-center" style={frame}>
        {/* 그림이 오면 public/marble/items/<id>.webp */}
        <img src={`/marble/items/${id}.webp`} alt="" className="h-[86%] w-[86%] object-contain" onError={() => setImg(false)} />
      </div>
    );
  const icon: Record<string, string> = { b_hamster: "coin", b_pigeon: "house", b_robot: "wrench", b_dog: "shield", b_cat: "heart", b_fox: "gold" };
  return (
    <div className="flex items-center justify-center" style={frame}>
      {it.slot === "dice" ? <DiceFace v={({ d_heavy: 6, d_spark: 1, d_twin: 2, d_slide: 3, d_gold: 5, d_time: 4 } as Record<string, number>)[id] ?? 6} size={size * 0.62} /> : <Icon n={icon[id] ?? "heart"} size={size * 0.6} />}
    </div>
  );
}

export function CharCardArt({ id, h = 150, dim = false }: { id: string; h?: number; dim?: boolean }) {
  const c = CHAR[id];
  if (!c) return null;
  return (
    <div className="relative overflow-hidden" style={{ height: h, background: `linear-gradient(${c.color}55, #fff8e7)`, boxShadow: `0 0 0 2px #232a4d, inset 0 0 0 4px ${GRADE_COLOR[c.grade]}` }}>
      <img src={c.art ?? `/fight/art/${c.sprite}.webp`} alt="" className="absolute inset-x-0 top-[4px] mx-auto h-[118%] object-contain object-top" style={{ filter: dim ? "brightness(0) opacity(0.35)" : undefined }} />
    </div>
  );
}

export default function Gacha({ prof, onProf, onBack }: { prof: ProfileWire; onProf(p: ProfileWire): void; onBack(): void }) {
  const [tab, setTab] = useState<"char" | "item">("char");
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<(CharPull | ItemPull)[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => playBgm("gacha"), []);
  const G = GACHA[tab];
  const pull = async (n: 1 | 10, ticket = false) => {
    setBusy(true);
    setErr("");
    try {
      sfx("gacha-pull");
      const r = await marble.pull(tab, n, ticket);
      onProf(r.profile);
      setGot(r.got);
    } catch (e) {
      sfx("deny");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rates = tab === "char" ? CHAR_RATES() : null;
  const ssrs = charOn().filter((c) => c.grade === "SSR" || c.grade === "UR");
  const urs = ssrs.filter((c) => c.grade === "UR");
  const onlySsr = ssrs.filter((c) => c.grade === "SSR");
  // 배너: UR 셋을 가운데, 양옆에 SSR
  const bannerChars = urs.length >= 3 && onlySsr.length >= 2 ? [onlySsr[1], urs[0], urs[1], urs[2], onlySsr[4] ?? onlySsr[0]] : ssrs.slice(0, 5);
  return (
    <div className="mb-dots absolute inset-0">
      <div className="absolute top-[10px] left-[12px] flex items-center gap-2">
        <Btn className="h-[34px] px-3 text-[13px]" onClick={onBack}>
          <Icon n="back" size={12} /> 돌아가기
        </Btn>
        <div className="mb-wood px-3 py-1.5">
          <b className="mb-title mb-out text-[17px] text-white">뽑기</b>
        </div>
      </div>
      <div className="mb-box absolute top-[12px] right-[12px] flex items-center gap-3 px-3 py-1.5 text-[13px]">
        <Cur k="star" n={prof.stars} />
        <Cur k="parts" n={prof.parts} />
        <span title="캐릭터 10연차 티켓">
          <Cur k="ticket" n={`${prof.tickets.char} · ${prof.tickets.item}`} />
        </span>
      </div>

      <div className="absolute top-[60px] left-[12px] flex w-[150px] flex-col gap-2">
        {(["char", "item"] as const).map((k) => (
          <Btn key={k} tone={tab === k ? "gold" : "paper"} className="h-[64px] flex-col gap-0 text-[15px] font-bold" onClick={() => setTab(k)}>
            {k === "char" ? "캐릭터" : "장착 아이템"}
            <span className="text-[11px] font-normal">{k === "char" ? "R · SR · SSR · UR" : "주사위 · 동행 · 부품"}</span>
          </Btn>
        ))}
      </div>

      {/* 배너 */}
      <div className="mb-box absolute top-[60px] left-[178px] h-[360px] w-[560px] overflow-hidden" style={{ "--bg": tab === "char" ? "#ffe9f2" : "#e6f6ff" } as CSSProperties}>
        {tab === "char" ? (
          <div className="relative h-full w-full">
            <div className="absolute inset-0 flex items-end justify-center gap-0">
              {bannerChars.map((c, i) => (
                <img key={c.id} src={artOf(c)} alt="" className="h-[300px] object-contain" style={{ marginLeft: i ? -60 : 0, zIndex: i === 2 ? 3 : i === 1 || i === 3 ? 2 : 1, transform: `translateY(${i === 2 ? 0 : 20}px)` }} />
              ))}
            </div>
            <div className="absolute top-3 left-4">
              <div className="mb-title mb-out text-[30px] text-white">스킨 축제 뽑기</div>
              <div className="mb-out text-[13px] text-white">픽셀파이트 스킨 SSR · 마블 한정 UR</div>
            </div>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            <div className="mb-title mb-out text-[30px] text-white">장착 아이템 뽑기</div>
            <div className="grid grid-cols-6 gap-3">
              {ITEMS.map((it) => (
                <div key={it.id} className="flex flex-col items-center gap-1" title={it.name}>
                  <ItemIcon id={it.id} size={56} />
                  <span className="text-[10px]">{it.name}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-[var(--ink2)]">아이템이 안 나오면 부품 꾸러미 · 이미 가진 아이템은 부품으로 바뀌어요 (강화 재료)</p>
          </div>
        )}
      </div>

      {/* 확률 · 버튼 */}
      <div className="absolute top-[60px] right-[12px] flex w-[258px] flex-col gap-2">
        <Win title="확률">
          <div className="flex flex-col gap-1 p-2.5 text-[12px]">
            {tab === "char" ? (
              (["UR", "SSR", "SR", "R"] as Grade[]).map((g) => (
                <div key={g} className="flex items-center justify-between">
                  <GradeTag g={g} />
                  <span>{rates![g] > 0 ? `${(rates![g] * 100).toFixed(1)}%` : "준비 중"}</span>
                  <span className="text-[11px] text-[var(--mute)]">{charOn().filter((c) => c.grade === g).length}종</span>
                </div>
              ))
            ) : (
              <>
                <div className="flex justify-between">
                  <span>아이템</span>
                  <span>{GACHA.item.itemRate * 100}%</span>
                </div>
                {(["SSR", "SR", "R"] as const).map((g) => (
                  <div key={g} className="flex items-center justify-between pl-2">
                    <GradeTag g={g} />
                    <span>{(GACHA.item.itemRate * GACHA.item.rate[g] * 100).toFixed(1)}%</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span>부품 꾸러미</span>
                  <span>{(100 - GACHA.item.itemRate * 100).toFixed(0)}%</span>
                </div>
              </>
            )}
            <div className="mt-1 text-[11px] leading-[15px] text-[var(--ink2)]">
              {tab === "char" ? (
                <>
                  10연차는 SR 이상 1장 보장 · SSR 이상 확정까지 <b>{GACHA.char.pity - prof.pity.char}</b>번
                  <br />
                  같은 캐릭터는 강화 카드 (아랫 등급 5강 = 윗 등급 0강)
                </>
              ) : (
                <>
                  10연차는 아이템 1개 보장 · SSR 확정까지 <b>{GACHA.item.pity - prof.pity.item}</b>번
                </>
              )}
            </div>
          </div>
        </Win>
        <Btn tone="paper" className="h-[46px] text-[15px] font-bold" disabled={busy || prof.stars < G.one} onClick={() => void pull(1)} silent>
          1번 뽑기 <Cur k="star" n={G.one} size={13} />
        </Btn>
        <Btn tone="gold" className="h-[56px] text-[18px] font-bold" disabled={busy || prof.stars < G.ten} onClick={() => void pull(10)} silent>
          10번 뽑기 <Cur k="star" n={G.ten} size={14} />
        </Btn>
        {prof.tickets[tab] > 0 && (
          <Btn tone="pink" className="mb-glow h-[46px] text-[15px] font-bold" style={{ "--g": "#ff7fa8" } as CSSProperties} disabled={busy} onClick={() => void pull(10, true)} silent>
            <Icon n="ticket" size={16} /> 티켓으로 10번 ({prof.tickets[tab]})
          </Btn>
        )}
        {err && <p className="text-center text-[12px] text-[#d43a3a]">{err}</p>}
      </div>

      <p className="absolute bottom-[14px] left-[178px] w-[560px] text-[11px] leading-[16px] text-[var(--mute)]">
        별사탕은 판 보상(이기면 {60} · 지면 25 · 오늘 첫 승 +100)과 상점에서 · 캐릭터 {CHARS.filter((c) => c.on).length}종
      </p>

      {got && <Reveal got={got} onClose={() => setGot(null)} />}
    </div>
  );
}

const ORDER: Record<string, number> = { R: 0, SR: 1, SSR: 2, UR: 3 };

function Reveal({ got, onClose }: { got: (CharPull | ItemPull)[]; onClose(): void }) {
  const [shown, setShown] = useState(0);
  const best = got.reduce((b, x) => Math.max(b, x.k === "parts" ? -1 : ORDER[x.grade]), -1);
  useEffect(() => {
    if (shown >= got.length) return;
    const x = got[shown];
    const t = setTimeout(
      () => {
        if (x.k !== "parts") sfx(x.grade === "UR" ? "gacha-ur" : x.grade === "SSR" ? "gacha-ssr" : x.grade === "SR" ? "gacha-sr" : "gacha-r");
        else sfx("gacha-r");
        setShown((s) => s + 1);
      },
      shown === 0 ? 500 : x.k !== "parts" && ORDER[x.grade] >= 2 ? 650 : 160
    );
    return () => clearTimeout(t);
  }, [shown, got]);
  const all = shown >= got.length;
  return (
    <div className="absolute inset-0 z-[80] flex flex-col items-center justify-center gap-4" style={{ background: best >= 2 ? "radial-gradient(#fff3c9, rgba(35,42,77,0.85))" : "rgba(35,42,77,0.8)" }} onClick={() => (all ? onClose() : setShown(got.length))}>
      <div className={`grid gap-3 ${got.length > 1 ? "grid-cols-5" : "grid-cols-1"}`}>
        {got.map((x, i) =>
          i < shown ? (
            <div key={i} className="mb-flip">
              <PullCard x={x} big={got.length === 1} />
            </div>
          ) : (
            <div key={i} className="mb-box flex items-center justify-center" style={{ width: got.length === 1 ? 200 : 132, height: got.length === 1 ? 270 : 180, "--bg": "#c98b4f" } as CSSProperties}>
              <Icon n="star" size={34} className="mb-bob" />
            </div>
          )
        )}
      </div>
      <p className="mb-out text-[13px] text-white">{all ? "눌러서 닫기" : "눌러서 모두 보기"}</p>
    </div>
  );
}

function PullCard({ x, big }: { x: CharPull | ItemPull; big: boolean }) {
  const w = big ? 200 : 132;
  const h = big ? 270 : 180;
  if (x.k === "parts")
    return (
      <div className="mb-box flex flex-col items-center justify-center gap-2" style={{ width: w, height: h, "--bg": "#eef2f5" } as CSSProperties}>
        <Icon n="gear" size={48} />
        <b className="text-[15px]">부품 {x.n}</b>
      </div>
    );
  const g = x.grade;
  const glow = ORDER[g] >= 2;
  if (x.k === "char") {
    const c = CHAR[x.id];
    return (
      <div className={`mb-box flex flex-col overflow-hidden ${glow ? "mb-glow" : ""}`} style={{ width: w, height: h, "--g": GRADE_COLOR[g] } as CSSProperties}>
        <CharCardArt id={x.id} h={h - 46} />
        <div className="flex flex-1 flex-col justify-center px-2 text-center leading-[15px]">
          <div className="flex items-center justify-center gap-1">
            <GradeTag g={g} />
            {x.fresh && <span className="mb-chip text-[10px]" style={{ "--c": "#ff7fa8", "--t": "#fff" } as CSSProperties}>NEW</span>}
          </div>
          <b className="truncate text-[13px]">{c && c.title.includes(c.name) ? c.title : c?.name}</b>
          {c && !c.title.includes(c.name) && <span className="truncate text-[10px] text-[var(--ink2)]">{c.title}</span>}
          {!x.fresh && <span className="text-[10px] text-[var(--mute)]">{x.stars ? `별사탕 +${fmt(x.stars)}` : "강화 카드 +1"}</span>}
        </div>
      </div>
    );
  }
  const it = ITEM[x.id];
  return (
    <div className={`mb-box flex flex-col items-center justify-center gap-2 px-2 text-center ${glow ? "mb-glow" : ""}`} style={{ width: w, height: h, "--g": GRADE_COLOR[g] } as CSSProperties}>
      <ItemIcon id={x.id} size={big ? 90 : 64} />
      <div className="flex items-center gap-1">
        <GradeTag g={g} />
        {x.fresh && <span className="mb-chip text-[10px]" style={{ "--c": "#ff7fa8", "--t": "#fff" } as CSSProperties}>NEW</span>}
      </div>
      <b className="text-[13px]">{it?.name}</b>
      {!x.fresh && <span className="text-[10px] text-[var(--mute)]">부품 +{x.parts}</span>}
    </div>
  );
}
