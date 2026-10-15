"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { CHAR, GACHA, GRADE_COLOR, ITEM, ITEMS, artOf, charOn, power, type Grade } from "@/lib/marble/data";
import { CHAR_RATES, type CharPull, type ItemPull } from "@/lib/marble/gacha";
import type { ProfileWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { playBgm, sfx } from "./audio";
import { XBtn, XGrade } from "./ui";
import { Cur, CurIcon, DiceFace, Icon, fmt } from "./pixel";

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

/** 등급 연출 겹: 뒤 배경(무늬) · 앞 반짝 · 테두리. children 은 그 사이 (캐릭터 그림) */
export function GradeFx({ g, children, color }: { g: Grade; children?: React.ReactNode; color?: string }) {
  const stars = g === "UR" ? 7 : g === "SSR" ? 4 : 0;
  return (
    <>
      <img src={`/marble/art/bg-${g}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
      {g === "R" && color && <div className="absolute inset-0" style={{ background: `${color}22` }} />}
      {children}
      {(g === "SSR" || g === "UR") && <div className="mb-shine" />}
      {Array.from({ length: stars }, (_, i) => (
        <span key={i} className="mb-gstar" style={{ left: `${(i * 37 + 11) % 92}%`, top: `${(i * 23 + 7) % 70}%`, animationDelay: `${i * 0.2}s` }} />
      ))}
      <div className={`pointer-events-none absolute inset-0 ${g === "R" ? "" : `mb-gframe-${g}`}`} style={g === "R" ? { boxShadow: "inset 0 0 0 2px #9fb3c8" } : undefined} />
    </>
  );
}

export function CharCardArt({ id, h = 150, dim = false }: { id: string; h?: number; dim?: boolean }) {
  const c = CHAR[id];
  if (!c) return null;
  return (
    <div className="relative overflow-hidden" style={{ height: h }}>
      <GradeFx g={dim ? "R" : c.grade} color={c.color}>
        <img src={artOf(c)} alt="" className="absolute inset-[4px] m-auto h-[calc(100%-8px)] w-[calc(100%-8px)] object-contain" style={{ filter: dim ? "brightness(0) opacity(0.35)" : undefined }} />
      </GradeFx>
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
  return (
    <div className="mbx absolute inset-0 overflow-hidden bg-[#120d33]">
      {/* 배너 그림이 화면 전체 */}
      {tab === "char" ? (
        <div key="char" className="mbx-enter absolute inset-0">
          <img src="/marble/art/banner-ur.webp" alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="mbx-sheen absolute inset-0 opacity-40" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(18,13,51,0.85) 0%, rgba(18,13,51,0.25) 38%, transparent 60%, rgba(18,13,51,0.55) 100%)" }} />
          <div className="absolute inset-x-0 bottom-0 h-[160px]" style={{ background: "linear-gradient(transparent, rgba(18,13,51,0.9))" }} />
        </div>
      ) : (
        <div key="item" className="mbx-enter absolute inset-0">
          <img src="/marble/art/banner-item.webp" alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="mbx-sheen absolute inset-0 opacity-30" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(18,13,51,0.9) 0%, rgba(18,13,51,0.45) 40%, transparent 65%, rgba(18,13,51,0.4) 100%)" }} />
          <div className="absolute inset-x-0 bottom-0 h-[160px]" style={{ background: "linear-gradient(transparent, rgba(18,13,51,0.9))" }} />
          {/* 라인업: 제목 아래 작은 아이콘 줄 */}
          <div className="absolute top-[168px] left-[196px] w-[300px] rounded-2xl border border-white/12 bg-black/40 p-2.5 backdrop-blur">
            <div className="mb-1.5 text-[11px] font-bold text-[#ffe08a]">라인업 · 주사위 6 · 동행 6</div>
            <div className="grid grid-cols-6 gap-1.5">
              {ITEMS.map((it) => (
                <div key={it.id} title={`${it.name} — ${it.desc(power(it.grade, 0))}`}>
                  <ItemIcon id={it.id} size={40} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 위 막대 */}
      <div className="absolute inset-x-0 top-0 z-[30] flex h-[52px] items-center gap-2 bg-gradient-to-b from-black/45 to-transparent px-3">
        <XBtn className="h-[34px] px-3 text-[13px]" onClick={onBack}>
          ‹ 돌아가기
        </XBtn>
        <b className="ml-1 text-[19px] font-black text-white" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>
          뽑기
        </b>
        <div className="ml-auto flex items-center gap-3 rounded-full bg-black/40 px-4 py-1.5 text-[13px] text-white backdrop-blur">
          <Cur k="star" n={prof.stars} />
          <Cur k="parts" n={prof.parts} />
          <span title="10연차 티켓 (캐릭터 · 아이템)" className="inline-flex items-center">
            <Cur k="ticket" n={`${prof.tickets.char} · ${prof.tickets.item}`} />
          </span>
        </div>
      </div>

      {/* 왼쪽: 배너 고르기 */}
      <div className="absolute top-[64px] left-[12px] z-[20] flex w-[164px] flex-col gap-2">
        {(["char", "item"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              sfx("click");
              setTab(k);
            }}
            className={`relative h-[78px] overflow-hidden rounded-xl text-left transition ${tab === k ? "ring-[3px] ring-[#ffd23a]" : "opacity-70 ring-1 ring-white/20 hover:opacity-100"}`}
          >
            <img src={k === "char" ? "/marble/art/banner-ur.webp" : "/marble/art/banner-item.webp"} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: k === "char" ? "center" : "60% 40%" }} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
            <div className="absolute bottom-[6px] left-[8px]">
              <b className="block text-[14px] text-white">{k === "char" ? "마블 축제" : "장착 아이템"}</b>
              <span className="text-[10px] text-white/75">{k === "char" ? "한정 UR · SSR · SR" : "주사위 · 동행 · 부품"}</span>
            </div>
            {k === "char" && <span className="absolute top-[5px] right-[5px] rounded-full bg-[#ff2d55] px-1.5 text-[9px] leading-[15px] font-black text-white">한정</span>}
          </button>
        ))}
      </div>

      {/* 배너 제목 */}
      <div className="absolute top-[64px] left-[196px] z-[10]">
        <div className="text-[13px] font-bold tracking-[0.2em] text-[#ffe08a]" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
          {tab === "char" ? "LIMITED BANNER" : "ITEM BANNER"}
        </div>
        <div className="text-[38px] leading-[44px] font-black text-white" style={{ textShadow: "0 3px 12px rgba(0,0,0,0.55)" }}>
          {tab === "char" ? "마블 축제 뽑기" : "장착 아이템 뽑기"}
        </div>
        {tab === "char" && (
          <div className="mt-2 flex gap-1.5">
            {urs.map((c) => (
              <span key={c.id} className="rounded-full bg-gradient-to-r from-[#ff9ad5] via-[#ffe27a] to-[#8ff0d0] px-2.5 py-[2px] text-[12px] font-black text-[#2a1a4a] shadow">
                UR {c.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 아래 왼쪽: 확률 */}
      <div className="absolute bottom-[12px] left-[12px] z-[20] w-[300px] rounded-2xl border border-white/12 bg-black/45 p-3 text-[12px] text-white backdrop-blur">
        <div className="mb-1.5 flex items-center justify-between">
          <b className="text-[#ffe08a]">확률</b>
          <span className="text-[11px] text-white/60">
            {tab === "char" ? (
              <>
                SSR+ <b className="text-white">{GACHA.char.pity - prof.pity.char}</b> · <span className="text-[#ffb3e6]">UR</span> <b className="text-white">{GACHA.char.urPity - (prof.pity.ur ?? 0)}</b>번 남음
              </>
            ) : (
              <>
                SSR 확정까지 <b className="text-white">{GACHA.item.pity - prof.pity.item}</b>번
              </>
            )}
          </span>
        </div>
        {tab === "char" ? (
          <div className="grid grid-cols-4 gap-1.5">
            {(["UR", "SSR", "SR", "R"] as Grade[]).map((g) => (
              <div key={g} className="flex flex-col items-center rounded-lg bg-white/[0.07] py-1">
                <XGrade g={g} />
                <b className="mt-0.5 text-[13px]">{rates![g] > 0 ? `${(rates![g] * 100).toFixed(1)}%` : "-"}</b>
                <span className="text-[10px] text-white/50">{charOn().filter((c) => c.grade === g).length}종</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {(["SSR", "SR", "R"] as const).map((g) => (
              <div key={g} className="flex flex-col items-center rounded-lg bg-white/[0.07] py-1">
                <XGrade g={g} />
                <b className="mt-0.5 text-[13px]">{(GACHA.item.itemRate * GACHA.item.rate[g] * 100).toFixed(1)}%</b>
              </div>
            ))}
            <div className="flex flex-col items-center rounded-lg bg-white/[0.07] py-1">
              <span className="text-[11px] font-bold">부품</span>
              <b className="mt-0.5 text-[13px]">{(100 - GACHA.item.itemRate * 100).toFixed(0)}%</b>
            </div>
          </div>
        )}
        <p className="mt-1.5 text-[10.5px] leading-[14px] text-white/55">{tab === "char" ? `10연차는 SR 이상 1장 보장 · ${GACHA.char.urPity}번 안에 UR 확정 · 같은 캐릭터는 강화 카드로 쌓여요` : "10연차는 아이템 1개 보장 · 이미 가진 아이템은 부품으로 바뀌어요"}</p>
      </div>

      {/* 아래 오른쪽: 뽑기 버튼 */}
      <div className="absolute right-[12px] bottom-[12px] z-[20] flex items-end gap-2">
        {prof.tickets[tab] > 0 && (
          <XBtn tone="pink" className="mbx-ready h-[64px] w-[150px] flex-col !gap-0 text-[15px]" disabled={busy} onClick={() => void pull(10, true)} silent>
            <span className="flex items-center gap-1">
              <CurIcon k="ticket" size={18} /> 티켓 10번
            </span>
            <span className="text-[11px] opacity-90">남은 티켓 {prof.tickets[tab]}</span>
          </XBtn>
        )}
        <XBtn tone="glass" className="h-[64px] w-[150px] flex-col !gap-0 bg-black/40 text-[16px] backdrop-blur" disabled={busy || prof.stars < G.one} onClick={() => void pull(1)} silent>
          1번 뽑기
          <Cur k="star" n={G.one} size={14} />
        </XBtn>
        <XBtn tone="gold" className="h-[64px] w-[190px] flex-col !gap-0 text-[19px]" disabled={busy || prof.stars < G.ten} onClick={() => void pull(10)} silent>
          10번 뽑기
          <Cur k="star" n={G.ten} size={15} />
        </XBtn>
      </div>
      {err && <p className="absolute right-[12px] bottom-[84px] z-[20] rounded-lg bg-black/60 px-3 py-1 text-[12px] text-[#ff9aa8]">{err}</p>}

      {got && <Reveal got={got} onClose={() => setGot(null)} />}
    </div>
  );
}

const ORDER: Record<string, number> = { R: 0, SR: 1, SSR: 2, UR: 3 };

/** 뽑기 결과: 카드는 뒷면으로 깔리고 눌러야 뒤집힘 (하나씩 · 모두 보기). 뒷면 색으로 등급 귀띔 */
function Reveal({ got, onClose }: { got: (CharPull | ItemPull)[]; onClose(): void }) {
  const [open, setOpen] = useState<boolean[]>(() => got.map(() => false));
  const [auto, setAuto] = useState(false);
  const all = open.every(Boolean);
  const isUR = (x: CharPull | ItemPull) => x.k === "char" && x.grade === "UR";
  // 모두 보기는 UR 을 빼고 엶 (UR 은 직접 눌러서)
  const autoLeft = open.some((v, i) => !v && !isUR(got[i]));
  const urLeft = open.some((v, i) => !v && isUR(got[i]));
  const flip = (i: number) => {
    setOpen((o) => {
      if (o[i]) return o;
      const x = got[i];
      sfx(x.k === "parts" ? "gacha-r" : x.grade === "UR" ? "gacha-ur" : x.grade === "SSR" ? "gacha-ssr" : x.grade === "SR" ? "gacha-sr" : "gacha-r");
      const n = [...o];
      n[i] = true;
      return n;
    });
  };
  // 모두 보기: 앞에서부터 차례로 (높은 등급은 조금 뜸 들임, UR 은 건너뜀)
  useEffect(() => {
    if (!auto) return;
    const i = open.findIndex((v, k) => !v && !isUR(got[k]));
    if (i < 0) return;
    const x = got[i];
    const t = setTimeout(() => flip(i), x.k !== "parts" && ORDER[x.grade] >= 2 ? 520 : 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, open]);
  const big = got.length === 1;
  const w = big ? 200 : 136;
  const h = big ? 280 : 184;
  return (
    <div className="mbx absolute inset-0 z-[80] flex flex-col items-center justify-center gap-4" style={{ background: "radial-gradient(circle at 50% 45%, rgba(60,40,140,0.92), rgba(10,8,30,0.96))" }}>
      <div className={`grid gap-3 ${got.length > 1 ? "grid-cols-5" : "grid-cols-1"}`}>
        {got.map((x, i) =>
          open[i] ? (
            <div key={i} className="mb-flip">
              <PullCard x={x} big={big} />
            </div>
          ) : (
            <CardBack key={i} x={x} w={w} h={h} onClick={() => flip(i)} />
          )
        )}
      </div>
      {all ? (
        <XBtn tone="gold" className="h-[42px] px-8 text-[15px]" onClick={onClose}>
          닫기
        </XBtn>
      ) : autoLeft ? (
        <XBtn tone="pink" className="h-[42px] px-8 text-[15px]" onClick={() => setAuto(true)} disabled={auto}>
          모두 보기
        </XBtn>
      ) : (
        urLeft && <div className="mbx-ready rounded-full bg-gradient-to-r from-[#ff9ad5] via-[#ffe27a] to-[#8ff0d0] px-5 py-2 text-[14px] font-black text-[#2a1a4a]">무지개 카드는 직접 눌러서 열어 보세요!</div>
      )}
    </div>
  );
}

/** 카드 뒷면: 남색 카드 · 금테 · 주사위 문장. 테두리 빛으로 등급 힌트 (R 은빛 · SR 보라 · SSR 금빛 · UR 무지개가 돎) */
function CardBack({ x, w, h, onClick }: { x: CharPull | ItemPull; w: number; h: number; onClick(): void }) {
  const g: Grade = x.k === "parts" ? "R" : x.grade;
  // R 은빛 · SR 진한 보라(+보라 빛) · SSR 금빛 · UR 무지개 — 한눈에 구분되게
  const rim = g === "UR" ? "" : g === "SSR" ? "#ffcf4a" : g === "SR" ? "linear-gradient(160deg, #d6a8ff, #8f3dff)" : "linear-gradient(160deg, #eef1f6, #aab3c4)";
  const face = g === "SR" ? "radial-gradient(circle at 50% 40%, #5a2fa8, #22104f 75%)" : g === "SSR" ? "radial-gradient(circle at 50% 40%, #5a4320, #22183a 75%)" : "radial-gradient(circle at 50% 40%, #2c3048, #15172a 75%)";
  return (
    <button type="button" onClick={onClick} className={`mbx-back group relative cursor-pointer rounded-[14px] p-[3px] transition hover:-translate-y-1 ${g === "UR" ? "mbx-back-ur" : ""} ${g === "SSR" ? "mbx-back-ssr" : ""} ${g === "SR" ? "mbx-back-sr" : ""}`} style={{ width: w, height: h, background: g === "UR" ? undefined : rim }}>
      <div className="relative h-full w-full overflow-hidden rounded-[11px]" style={{ background: face }}>
        {/* 마름모 무늬 */}
        <div className="absolute inset-0 opacity-[0.18]" style={{ background: "repeating-linear-gradient(45deg, #fff 0 1px, transparent 1px 14px), repeating-linear-gradient(-45deg, #fff 0 1px, transparent 1px 14px)" }} />
        {/* 안쪽 금테 */}
        <div className="absolute inset-[7px] rounded-[8px] border border-[#ffd76a]/70" />
        <div className="absolute inset-[11px] rounded-[6px] border border-[#ffd76a]/30" />
        {/* 문장: 주사위 + 별 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <div className="relative transition group-hover:rotate-[8deg]">
            <svg viewBox="0 0 48 48" width={w * 0.42} height={w * 0.42} aria-hidden>
              <defs>
                <linearGradient id="dtg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff6c8" />
                  <stop offset="1" stopColor="#f5b52e" />
                </linearGradient>
              </defs>
              <path d="M24 3 L44 14 L44 34 L24 45 L4 34 L4 14 Z" fill="url(#dtg)" stroke="#7a4b00" strokeWidth="2" strokeLinejoin="round" />
              <path d="M24 3 L44 14 L24 25 L4 14 Z" fill="#fff8dc" opacity="0.55" />
              <path d="M24 25 L24 45" stroke="#7a4b00" strokeWidth="1.5" opacity="0.6" />
              <circle cx="24" cy="14" r="2.6" fill="#ff5f8f" />
              <circle cx="14" cy="27" r="2.4" fill="#262b52" />
              <circle cx="16" cy="35" r="2.4" fill="#262b52" />
              <circle cx="32" cy="27" r="2.4" fill="#262b52" />
              <circle cx="34" cy="35" r="2.4" fill="#262b52" />
            </svg>
          </div>
          <span className="text-[10px] font-black tracking-[0.3em] text-[#ffd76a]">DICE TOWN</span>
        </div>
        {g === "UR" && <div className="mbx-sheen absolute inset-0 opacity-70" />}
        <span className="absolute inset-x-0 bottom-[14px] text-center text-[10px] text-white/60">눌러서 열기</span>
      </div>
    </button>
  );
}

function NewTag() {
  return <span className="rounded-full bg-[#ff5f8f] px-1.5 text-[10px] leading-[16px] font-black text-white">NEW</span>;
}

function PullCard({ x, big }: { x: CharPull | ItemPull; big: boolean }) {
  const w = big ? 200 : 136;
  const h = big ? 280 : 184;
  if (x.k === "parts")
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-[14px] border border-white/15 text-white" style={{ width: w, height: h, background: "linear-gradient(160deg, #3b4a7a, #1d2350)" }}>
        <CurIcon k="parts" size={big ? 64 : 48} />
        <b className="text-[16px]">부품 {x.n}</b>
        <span className="text-[10px] text-white/55">아이템 강화 재료</span>
      </div>
    );
  const g = x.grade;
  const glow = ORDER[g] >= 2;
  if (x.k === "char") {
    const c = CHAR[x.id];
    return (
      <div className={`relative overflow-hidden rounded-[14px] ${glow ? "mbx-ready" : ""}`} style={{ width: w, height: h, boxShadow: `0 0 0 2px ${GRADE_COLOR[g]}` }}>
        <CharCardArt id={x.id} h={h} />
        <div className="absolute inset-x-0 bottom-0 px-2 pt-6 pb-2 text-center text-white" style={{ background: "linear-gradient(transparent, rgba(10,8,30,0.92) 45%)" }}>
          <div className="flex items-center justify-center gap-1">
            <XGrade g={g} />
            {x.fresh && <NewTag />}
          </div>
          <b className="mt-0.5 block truncate text-[13px]">{c?.name}</b>
          <span className="block truncate text-[10px] text-white/65">{x.fresh ? c?.title : x.stars ? `별사탕 +${fmt(x.stars)}` : "강화 카드 +1"}</span>
        </div>
      </div>
    );
  }
  const it = ITEM[x.id];
  return (
    <div className={`relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-[14px] px-2 text-center text-white ${glow ? "mbx-ready" : ""}`} style={{ width: w, height: h, boxShadow: `0 0 0 2px ${GRADE_COLOR[g]}` }}>
      <img src={`/marble/art/bg-${g}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
      <div className="absolute inset-0 bg-[#100c30]/45" />
      <div className="relative">
        <ItemIcon id={x.id} size={big ? 96 : 66} />
      </div>
      <div className="relative flex items-center gap-1">
        <XGrade g={g} />
        {x.fresh && <NewTag />}
      </div>
      <b className="relative text-[13px]" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
        {it?.name}
      </b>
      {!x.fresh && <span className="relative text-[10px] text-white/75">이미 있음 · 부품 +{x.parts}</span>}
    </div>
  );
}
