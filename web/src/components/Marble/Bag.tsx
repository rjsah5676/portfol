"use client";

import { useEffect, useState } from "react";
import { CHAR, GRADE_COLOR, ITEM, ITEMS, MAX_LV, STORE, artOf, charOn, faceOf, giveValueGp, itemUpCost, power, storeBonus, type CharDef, type Grade, type ItemDef, type ItemSlot, type StoreItem } from "@/lib/marble/data";
import { charUpNeed } from "@/lib/marble/gacha";
import type { ProfileWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { sfx } from "./audio";
import { ItemIcon } from "./Gacha";
import { Cur, CurIcon, fmt } from "./pixel";
import Token from "./Token";
import { CharHero, GradeBackdrop, XBtn, XChip, XGrade } from "./ui";

/*
 * 가방 (가챠 게임식) — 왼쪽 큰 그림(고르면 미끄러져 들어옴) · 오른쪽 정보/스킬/강화 탭 · 아래 보유 목록 띠(등급 거르기).
 * 상점 — GP 로 별사탕 · 부품 · 패키지.
 */

type Tab = "char" | ItemSlot;
type Pane = "info" | "skill" | "up";
const GRADE_ORDER = { UR: 0, SSR: 1, SR: 2, R: 3 } as const;
const GRADES: (Grade | "ALL")[] = ["ALL", "UR", "SSR", "SR", "R"];

/** 별 (강화 단계) — 매끈한 별 */
export function XStars({ lv, size = 14 }: { lv: number; size?: number }) {
  return (
    <span className="inline-flex gap-[2px]">
      {Array.from({ length: MAX_LV }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" width={size} height={size} aria-hidden>
          <path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z" fill={i < lv ? "#ffd23a" : "rgba(255,255,255,0.18)"} stroke={i < lv ? "#b87a00" : "rgba(255,255,255,0.3)"} strokeWidth={1.2} />
        </svg>
      ))}
    </span>
  );
}

export default function Bag({ prof, onProf, onBack }: { prof: ProfileWire; onProf(p: ProfileWire): void; onBack(): void }) {
  const [tab, setTab] = useState<Tab>("char");
  const [sel, setSel] = useState<string | null>(prof.load.char);
  const [pane, setPane] = useState<Pane>("info");
  const [grade, setGrade] = useState<Grade | "ALL">("ALL");
  const [err, setErr] = useState("");
  const [burst, setBurst] = useState<{ id: number; lv: number } | null>(null);
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(null), 1700);
    return () => clearTimeout(t);
  }, [burst]);
  const run = async (f: () => Promise<ProfileWire>, snd = "click", up = false) => {
    setErr("");
    try {
      const np = await f();
      onProf(np);
      sfx(snd);
      if (up && sel) setBurst({ id: Date.now(), lv: (tab === "char" ? np.chars[sel]?.lv : np.items[sel]?.lv) ?? 0 });
    } catch (e) {
      sfx("deny");
      setErr((e as Error).message);
    }
  };
  const chars = [...charOn()]
    .filter((d) => grade === "ALL" || d.grade === grade)
    .sort((a, b) => Number(!prof.chars[a.id]) - Number(!prof.chars[b.id]) || GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]);
  const items = ITEMS.filter((i) => i.slot === tab && (grade === "ALL" || i.grade === grade)).sort((a, b) => Number(!prof.items[a.id]) - Number(!prof.items[b.id]) || GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade]);
  const c = tab === "char" && sel ? CHAR[sel] : null;
  const it = tab !== "char" && sel ? ITEM[sel] : null;
  const pick = (id: string) => {
    if (id === sel) return;
    sfx("click");
    setSel(id);
  };
  return (
    <div className="mbx absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(circle at 30% 30%, #2b2a6b, #120d33 70%)" }}>
      {/* 위 막대 */}
      <div className="absolute inset-x-0 top-0 z-[30] flex h-[52px] items-center gap-2 border-b border-white/10 bg-black/25 px-3 backdrop-blur">
        <XBtn className="h-[34px] px-3 text-[13px]" onClick={onBack}>
          ‹ 돌아가기
        </XBtn>
        <b className="ml-1 text-[19px] font-black text-white">가방</b>
        <div className="ml-3 flex rounded-xl bg-black/30 p-[3px]">
          {(["char", "dice", "buddy"] as Tab[]).map((k) => (
            <button
              key={k}
              type="button"
              className={`h-[30px] rounded-[9px] px-4 text-[13px] font-bold transition ${tab === k ? "bg-gradient-to-b from-[#ffe27a] to-[#f5a524] text-[#3a2500] shadow" : "text-white/70 hover:text-white"}`}
              onClick={() => {
                sfx("click");
                setTab(k);
                setPane("info");
                setSel(k === "char" ? prof.load.char : (prof.load[k] ?? ITEMS.find((x) => x.slot === k && prof.items[x.id])?.id ?? ITEMS.find((x) => x.slot === k)?.id ?? null));
              }}
            >
              {k === "char" ? "캐릭터" : k === "dice" ? "주사위" : "동행"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 rounded-full bg-black/30 px-4 py-1.5 text-[13px] text-white">
          <Cur k="star" n={prof.stars} />
          <Cur k="parts" n={prof.parts} />
        </div>
      </div>

      {/* 왼쪽: 큰 그림 */}
      <div className="absolute top-[52px] bottom-[118px] left-0 w-[470px]">
        {c ? (
          <div key={c.id} className="mbx-enter absolute inset-0">
            <div className="absolute inset-0">
              <CharHero id={c.id} className="h-full w-full" />
            </div>
            <div className="absolute inset-x-0 bottom-0 h-[150px]" style={{ background: "linear-gradient(transparent, rgba(12,10,40,0.92))" }} />
            <div className="absolute bottom-[12px] left-[18px] right-[18px]">
              <div className="flex items-center gap-2">
                <XGrade g={c.grade} className="text-[13px]" />
                <span className="text-[13px] font-bold text-white/80">{c.title.replace(c.name, "").trim() || c.title}</span>
              </div>
              <div className="mt-[2px] flex items-end gap-3">
                <b className="text-[34px] leading-[38px] font-black text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
                  {c.name}
                </b>
                <span className="pb-[6px]">{prof.chars[c.id] ? <XStars lv={prof.chars[c.id].lv} size={16} /> : <XChip color="#ffffff22">미보유</XChip>}</span>
              </div>
              <p className="mt-1 text-[13px] text-[#ffe9a8] italic">“{c.line}”</p>
            </div>
            {!prof.chars[c.id] && <div className="absolute inset-0 bg-[#0c0a28]/45" />}
          </div>
        ) : it ? (
          <div key={it.id} className="mbx-enter absolute inset-0 flex items-center justify-center">
            <GradeBackdrop g={it.grade} />
            <div className="mbx-breathe relative" style={{ filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.5))" }}>
              <ItemIcon id={it.id} size={220} />
            </div>
            <div className="absolute bottom-[14px] left-[18px]">
              <div className="flex items-center gap-2">
                <XGrade g={it.grade} className="text-[13px]" />
                <span className="text-[13px] font-bold text-white/80">{it.slot === "dice" ? "주사위" : "동행"}</span>
              </div>
              <b className="text-[30px] font-black text-white" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
                {it.name}
              </b>
              <div>{prof.items[it.id] ? <XStars lv={prof.items[it.id].lv} size={16} /> : <XChip color="#ffffff22">미보유</XChip>}</div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[14px] text-white/60">아래에서 골라 주세요</div>
        )}
        {burst && (
          <div key={burst.id} className="pointer-events-none absolute inset-0 z-[20] flex items-center justify-center">
            <div className="mbx-burst absolute inset-0" />
            <div className="mbx-burst-text text-center">
              <div className="text-[40px] font-black text-white" style={{ textShadow: "0 0 18px #ffb800, 0 3px 0 #8a4b00" }}>
                강화 성공!
              </div>
              <XStars lv={burst.lv} size={26} />
            </div>
          </div>
        )}
      </div>

      {/* 오른쪽: 탭 */}
      <div className="absolute top-[62px] right-[12px] bottom-[128px] left-[482px] flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#191545]/85 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="flex gap-1 border-b border-white/10 px-2 pt-2">
          {(["info", "skill", "up"] as Pane[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                sfx("click");
                setPane(k);
              }}
              className={`relative h-[34px] rounded-t-lg px-4 text-[13px] font-bold transition ${pane === k ? "bg-white/10 text-[#ffe08a]" : "text-white/60 hover:text-white"}`}
            >
              {k === "info" ? "정보" : k === "skill" ? (tab === "char" ? "스킬" : "효과") : "강화"}
              {pane === k && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-[#ffd23a]" />}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[13px] leading-[19px] text-white/90">
          {c && <CharPane d={c} own={prof.chars[c.id]} pane={pane} />}
          {it && <ItemPane d={it} own={prof.items[it.id]} parts={prof.parts} pane={pane} />}
        </div>
        {/* 장착 · 강화 */}
        <div className="flex items-center gap-2 border-t border-white/10 p-3">
          {err && <span className="mr-auto text-[12px] text-[#ff9aa8]">{err}</span>}
          {c &&
            (prof.chars[c.id] ? (
              <>
                <XBtn tone={prof.load.char === c.id ? "dark" : "mint"} className="ml-auto h-[40px] w-[130px] text-[14px]" disabled={prof.load.char === c.id} onClick={() => void run(() => marble.equip({ char: c.id }))}>
                  {prof.load.char === c.id ? "✓ 장착 중" : "장착하기"}
                </XBtn>
                <UpBtn lv={prof.chars[c.id].lv} ok={prof.chars[c.id].dup >= charUpNeed(prof.chars[c.id].lv)} label={`강화 · 카드 ${prof.chars[c.id].dup}/${charUpNeed(prof.chars[c.id].lv)}`} onClick={() => void run(() => marble.charUp(c.id), "upgrade", true)} />
              </>
            ) : (
              <span className="ml-auto text-[12px] text-white/55">뽑기에서 얻을 수 있어요</span>
            ))}
          {it &&
            (prof.items[it.id] ? (
              <>
                <XBtn tone={prof.load[it.slot] === it.id ? "dark" : "mint"} className="ml-auto h-[40px] w-[130px] text-[14px]" onClick={() => void run(() => marble.equip({ [it.slot]: prof.load[it.slot] === it.id ? null : it.id }))}>
                  {prof.load[it.slot] === it.id ? "해제하기" : "장착하기"}
                </XBtn>
                <UpBtn lv={prof.items[it.id].lv} ok={prof.parts >= itemUpCost(it.grade, prof.items[it.id].lv)} label={<>강화 · <Cur k="parts" n={itemUpCost(it.grade, prof.items[it.id].lv)} size={13} /></>} onClick={() => void run(() => marble.itemUp(it.id), "upgrade", true)} />
              </>
            ) : (
              <span className="ml-auto text-[12px] text-white/55">뽑기에서 얻을 수 있어요</span>
            ))}
        </div>
      </div>

      {/* 아래: 보유 목록 띠 */}
      <div className="absolute inset-x-[12px] bottom-[8px] h-[112px] rounded-2xl border border-white/12 bg-black/30 px-2 pt-1.5 backdrop-blur">
        <div className="flex items-center gap-1 px-1">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              className={`h-[20px] rounded-full px-2.5 text-[11px] font-bold transition ${grade === g ? "bg-white text-[#191545]" : "text-white/60 hover:text-white"}`}
            >
              {g === "ALL" ? "전체" : g}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-white/50">
            보유 {tab === "char" ? Object.keys(prof.chars).length : ITEMS.filter((x) => x.slot === tab && prof.items[x.id]).length} / {tab === "char" ? charOn().length : ITEMS.filter((x) => x.slot === tab).length}
          </span>
        </div>
        <div className="mbx-hscroll mt-1 flex gap-2 overflow-x-auto pb-1.5">
          {tab === "char"
            ? chars.map((d) => <FaceTile key={d.id} d={d} own={prof.chars[d.id]} sel={sel === d.id} on={prof.load.char === d.id} onClick={() => pick(d.id)} />)
            : items.map((d) => <ItemFace key={d.id} d={d} own={prof.items[d.id]} sel={sel === d.id} on={prof.load[d.slot] === d.id} onClick={() => pick(d.id)} />)}
        </div>
      </div>
    </div>
  );
}

function UpBtn({ lv, ok, label, onClick }: { lv: number; ok: boolean; label: React.ReactNode; onClick(): void }) {
  return (
    <XBtn tone="gold" silent className={`h-[40px] min-w-[150px] px-3 text-[13px] ${ok && lv < MAX_LV ? "mbx-ready" : ""}`} disabled={lv >= MAX_LV || !ok} onClick={onClick}>
      {lv >= MAX_LV ? "최고 강화" : label}
    </XBtn>
  );
}

/** 목록 띠 얼굴 칸 (없는 캐릭터는 실루엣) */
function FaceTile({ d, own, sel, on, onClick }: { d: CharDef; own?: { lv: number; dup: number }; sel: boolean; on: boolean; onClick(): void }) {
  // 가진 캐릭터는 얼굴 그림, 없는 캐릭터는 배경 없는 전신 그림으로 실루엣
  const [src, setSrc] = useState(own ? faceOf(d) : artOf(d));
  const ready = own && own.lv < MAX_LV && own.dup >= charUpNeed(own.lv);
  return (
    <button type="button" onClick={onClick} title={d.title} className={`relative h-[76px] w-[66px] shrink-0 overflow-hidden rounded-xl transition ${sel ? "-translate-y-[2px] ring-[3px] ring-[#ffd23a]" : "ring-1 ring-white/15 hover:ring-white/40"}`} style={{ background: `linear-gradient(160deg, ${GRADE_COLOR[d.grade]}cc, #1d1a4a)` }}>
      <img src={src} alt="" onError={() => setSrc(d.art ?? `/fight/art/${d.sprite}.webp`)} className={`absolute inset-0 h-full w-full ${own ? "object-cover object-top" : "scale-[1.5] object-contain object-top"}`} style={own ? undefined : { filter: "brightness(0)", opacity: 0.55, transformOrigin: "top" }} />
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 text-[10px] leading-[15px] font-bold text-white">{d.name}</span>
      <XGrade g={d.grade} className="absolute top-[3px] left-[3px] !px-1 !text-[9px] !leading-[13px]" />
      {on && <span className="absolute top-[3px] right-[3px] rounded-full bg-[#2fc3a0] px-1 text-[9px] leading-[13px] font-bold text-white">장착</span>}
      {ready && <span className="mbx-ready absolute right-[3px] bottom-[17px] rounded-full bg-[#ff5f9e] px-1 text-[9px] leading-[13px] font-bold text-white">강화</span>}
    </button>
  );
}

function ItemFace({ d, own, sel, on, onClick }: { d: ItemDef; own?: { lv: number }; sel: boolean; on: boolean; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} title={d.name} className={`relative flex h-[76px] w-[66px] shrink-0 items-center justify-center overflow-hidden rounded-xl transition ${sel ? "-translate-y-[2px] ring-[3px] ring-[#ffd23a]" : "ring-1 ring-white/15 hover:ring-white/40"}`} style={{ background: `linear-gradient(160deg, ${GRADE_COLOR[d.grade]}aa, #1d1a4a)`, opacity: own ? 1 : 0.45 }}>
      <ItemIcon id={d.id} size={46} />
      <XGrade g={d.grade} className="absolute top-[3px] left-[3px] !px-1 !text-[9px] !leading-[13px]" />
      {on && <span className="absolute top-[3px] right-[3px] rounded-full bg-[#2fc3a0] px-1 text-[9px] leading-[13px] font-bold text-white">장착</span>}
      {own && <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[10px] leading-[14px] font-bold text-[#ffe08a]">+{own.lv}</span>}
    </button>
  );
}

const Box = ({ title, children, tone = "#ffffff12" }: { title: React.ReactNode; children: React.ReactNode; tone?: string }) => (
  <div className="rounded-xl px-3 py-2.5" style={{ background: tone, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
    <div className="mb-1 text-[12px] font-bold text-[#ffe08a]">{title}</div>
    {children}
  </div>
);
const Next = ({ children }: { children: React.ReactNode }) => <div className="mt-1 text-[12px] text-[#7ff0c9]">▲ 다음 강화 · {children}</div>;

function CharPane({ d, own, pane }: { d: CharDef; own?: { lv: number; dup: number }; pane: Pane }) {
  const lv = own?.lv ?? 0;
  const p = power(d.grade, lv);
  const pn = power(d.grade, Math.min(MAX_LV, lv + 1));
  const need = charUpNeed(lv);
  if (pane === "info")
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-[88px] w-[80px] shrink-0 items-end justify-center overflow-hidden rounded-xl bg-white/5">
            <Token sprite={d.sprite} h={78} maxW={74} anim={own ? "win" : "idle"} />
          </div>
          <div className="flex flex-col gap-1">
            <b className="text-[16px] text-white">{d.title}</b>
            <span className="text-[12px] text-white/60">
              파워 <b className="text-white">{p}</b> · 강화 {lv}/{MAX_LV}
            </span>
            <span className="text-[12px] text-white/60">{own ? "보유 중" : "아직 없음"}</span>
          </div>
        </div>
        <Box title="소개">
          <p className="text-[13px] text-white/85">{d.bio ?? d.line}</p>
        </Box>
        <div className="grid grid-cols-2 gap-2">
          <Box title={`패시브 · ${d.passive.name}`}>
            <p>{d.passive.desc(p)}</p>
          </Box>
          <Box title={`스킬 · ${d.active.name}`}>
            <p>{d.active.desc(p)}</p>
          </Box>
        </div>
      </div>
    );
  if (pane === "skill")
    return (
      <div className="flex flex-col gap-2">
        <Box title={`패시브 · ${d.passive.name}`}>
          <p>{d.passive.desc(p)}</p>
          {lv < MAX_LV && <Next>{d.passive.desc(pn)}</Next>}
        </Box>
        <Box title={<>스킬 · {d.active.name} <span className="font-normal text-white/50">({d.active.cd(p)}턴마다)</span></>}>
          <p>{d.active.desc(p)}</p>
          {lv < MAX_LV && (d.active.desc(pn) !== d.active.desc(p) || d.active.cd(pn) !== d.active.cd(p)) && (
            <Next>
              {d.active.desc(pn)} ({d.active.cd(pn)}턴)
            </Next>
          )}
        </Box>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <XStars lv={lv} size={24} />
        <span className="text-[13px] text-white/70">
          강화 {lv} / {MAX_LV}
        </span>
      </div>
      {own && lv < MAX_LV ? (
        <>
          <Box title="필요한 같은 카드">
            <div className="flex items-center gap-2">
              <div className="h-[10px] flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-[#ff9ccf] to-[#ffd23a]" style={{ width: `${Math.min(100, (own.dup / Math.max(1, need)) * 100)}%` }} />
              </div>
              <b className="text-[13px] text-white">
                {own.dup} / {need}
              </b>
            </div>
            <p className="mt-1 text-[12px] text-white/55">뽑기에서 같은 캐릭터가 또 나오면 카드가 쌓여요</p>
          </Box>
          <Box title="강화하면">
            <p>파워 {p} → <b className="text-[#7ff0c9]">{pn}</b></p>
            <Next>{d.passive.desc(pn)}</Next>
          </Box>
        </>
      ) : (
        <p className="text-white/60">{own ? "최고 단계까지 강화했어요!" : "먼저 뽑기에서 얻어야 해요"}</p>
      )}
    </div>
  );
}

function ItemPane({ d, own, parts, pane }: { d: ItemDef; own?: { lv: number }; parts: number; pane: Pane }) {
  const lv = own?.lv ?? 0;
  const p = power(d.grade, lv);
  const pn = power(d.grade, Math.min(MAX_LV, lv + 1));
  const cost = itemUpCost(d.grade, lv);
  if (pane !== "up")
    return (
      <div className="flex flex-col gap-2">
        <Box title={`${d.slot === "dice" ? "주사위" : "동행"} 효과`}>
          <p>{d.desc(p)}</p>
          {pane === "skill" && lv < MAX_LV && <Next>{d.desc(pn)}</Next>}
        </Box>
        <p className="text-[12px] text-white/55">{d.slot === "dice" ? "판에서 주사위를 굴릴 때 효과가 나요. 칸마다 하나만 낄 수 있어요." : "판 내내 곁에서 도와줘요. 하나만 데려갈 수 있어요."}</p>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <XStars lv={lv} size={24} />
        <span className="text-[13px] text-white/70">
          강화 {lv} / {MAX_LV}
        </span>
      </div>
      {own && lv < MAX_LV ? (
        <Box title="강화하면">
          <p>
            부품 <b className={parts >= cost ? "text-white" : "text-[#ff9aa8]"}>{fmt(cost)}</b> (가진 부품 {fmt(parts)})
          </p>
          <Next>{d.desc(pn)}</Next>
        </Box>
      ) : (
        <p className="text-white/60">{own ? "최고 단계까지 강화했어요!" : "먼저 뽑기에서 얻어야 해요"}</p>
      )}
    </div>
  );
}

const PASS_KIND = new Set(["pass", "pack"]);

/** 상점 — 위: 패스 · 패키지(크게, 이득 %), 아래: 재화 · GP 로 바꾸기 · (관리자) 지원금 */
export function Shop({ prof, onProf, onBack, admin = false }: { prof: ProfileWire; onProf(p: ProfileWire): void; onBack(): void; admin?: boolean }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const buy = async (s: StoreItem) => {
    setBusy(s.id);
    setErr("");
    try {
      onProf(await marble.buy(s.id));
      sfx(s.kind === "pass" || s.kind === "pack" ? "upgrade" : "coin");
    } catch (e) {
      setErr((e as Error).message);
      sfx("deny");
    } finally {
      setBusy("");
    }
  };
  const state = (s: StoreItem) => {
    const bought = s.once ? (prof.packs[s.id] ?? 0) : (prof.shop[s.id] ?? 0);
    const lim = s.once ? 1 : (s.perWeek ?? Infinity);
    const sold = bought >= lim;
    const poor = prof.gp < s.gp || (s.cost?.stars ?? 0) > prof.stars || (s.cost?.parts ?? 0) > prof.parts;
    return { bought, lim, sold, poor };
  };
  const passes = STORE.filter((s) => PASS_KIND.has(s.kind));
  const rest = STORE.filter((s) => !PASS_KIND.has(s.kind) && (s.kind !== "admin" || admin));
  return (
    <div className="mbx absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(circle at 50% 0%, #3a2a7a, #120d33 70%)" }}>
      {/* 위 막대 */}
      <div className="absolute inset-x-0 top-0 z-[30] flex h-[52px] items-center gap-2 border-b border-white/10 bg-black/25 px-3 backdrop-blur">
        <XBtn className="h-[34px] px-3 text-[13px]" onClick={onBack}>
          ‹ 돌아가기
        </XBtn>
        <b className="ml-1 text-[19px] font-black text-white">상점</b>
        {prof.pass && (
          <XChip color="#ffd23a" text="#3a2500" className="ml-2">
            일일 패스 {prof.pass.left}일 남음 · 오늘 {prof.pass.today ? "받음 ✓" : "아직"}
          </XChip>
        )}
        <div className="ml-auto flex items-center gap-3 rounded-full bg-black/30 px-4 py-1.5 text-[13px] text-white">
          <Cur k="gp" n={prof.gp} />
          <Cur k="star" n={prof.stars} />
          <Cur k="parts" n={prof.parts} />
        </div>
      </div>

      {/* 패스 · 패키지 */}
      <div className="absolute top-[66px] left-1/2 flex w-[996px] -translate-x-1/2 gap-3">
        {passes.map((s) => {
          const st = state(s);
          const bonus = storeBonus(s);
          const isPass = s.kind === "pass";
          const c1 = isPass ? "#7b5cff" : "#ff5f9e";
          const c2 = isPass ? "#36b8ff" : "#ffb23a";
          return (
            <div key={s.id} className="mbx-pass relative flex h-[238px] flex-1 flex-col overflow-hidden rounded-2xl p-4 text-white" style={{ background: `linear-gradient(140deg, ${c1}, ${c2})` }}>
              <div className="pointer-events-none absolute inset-0 opacity-20" style={{ background: "repeating-linear-gradient(115deg, transparent 0 22px, #fff 22px 25px)" }} />
              <div className="mbx-sheen pointer-events-none absolute inset-0" />
              <div className="absolute top-[16px] -right-[36px] w-[136px] rotate-45 bg-gradient-to-r from-[#ffe27a] to-[#ffc23a] py-[3px] text-center text-[11px] font-black tracking-wider text-[#3a2500] shadow">
                {isPass ? "PASS" : "첫 손님 한정"}
              </div>
              <div className="relative flex items-baseline gap-2">
                <span className="text-[24px] leading-none font-black tracking-tight" style={{ textShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>
                  {isPass ? "PASS" : "PACK"}
                </span>
                <b className="text-[15px]">{s.name}</b>
              </div>
              <div className="relative mt-3 flex h-[58px] items-center gap-2">
                {(s.give.stars || s.give.passDays) && <CurIcon k="star" size={46} />}
                {s.give.parts && <CurIcon k="parts" size={38} />}
                {(s.give.charTickets || s.give.itemTickets) && <CurIcon k="ticket" size={46} />}
                {bonus > 0 && (
                  <span className="mbx-ready ml-auto rotate-[-5deg] rounded-lg bg-[#ff2d55] px-2.5 py-1 text-[18px] font-black text-white shadow-lg">+{bonus.toLocaleString()}% 이득</span>
                )}
              </div>
              <span className="relative mt-1 text-[12px] leading-[16px] text-white/95">{s.desc}</span>
              <span className="relative mt-1 text-[11px] text-white/75">
                값어치 약 {fmt(giveValueGp(s.give))}GP · {s.once ? "한 번만" : s.perWeek ? `이번 주 ${st.bought}/${st.lim}` : "언제든"}
              </span>
              <XBtn tone={st.sold ? "dark" : "gold"} className="relative mt-auto h-[42px] w-full text-[15px]" disabled={st.sold || !!busy || st.poor} onClick={() => void buy(s)}>
                {st.sold ? "다 샀어요" : <Cur k="gp" n={fmt(s.gp)} size={16} />}
              </XBtn>
            </div>
          );
        })}
      </div>

      {/* 재화 · 바꾸기 · 관리자 */}
      <div className="absolute top-[320px] left-1/2 flex w-[996px] -translate-x-1/2 gap-3">
        {rest.map((s) => {
          const st = state(s);
          const tag = s.kind === "swap" ? "GP 로 바꾸기" : s.kind === "admin" ? "관리자" : "재화";
          return (
            <div key={s.id} className={`flex h-[184px] flex-1 flex-col items-center gap-1 rounded-2xl border p-3 text-center text-white ${s.kind === "admin" ? "border-[#ff7a9a]/40 bg-[#4a1a3a]/70" : "border-white/12 bg-white/[0.06]"}`}>
              <span className="text-[10px] font-bold tracking-wide text-white/50">{tag}</span>
              <div className="flex h-[48px] items-center justify-center gap-1">
                {(s.give.stars || s.cost?.stars) && <CurIcon k="star" size={36} />}
                {(s.give.parts || s.cost?.parts) && <CurIcon k="parts" size={32} />}
                {s.give.gp && <CurIcon k="gp" size={30} />}
              </div>
              <b className="text-[14px]">{s.name}</b>
              <span className="text-[11px] leading-[14px] text-white/60">{s.desc}</span>
              <XBtn tone={s.kind === "admin" ? "pink" : s.kind === "swap" ? "sky" : "gold"} className="mt-auto h-[36px] w-full text-[13px]" disabled={!!busy || st.poor} onClick={() => void buy(s)}>
                {s.cost?.stars ? <Cur k="star" n={fmt(s.cost.stars)} size={14} /> : s.cost?.parts ? <Cur k="parts" n={fmt(s.cost.parts)} size={14} /> : s.gp ? <Cur k="gp" n={fmt(s.gp)} size={14} /> : "받기"}
              </XBtn>
            </div>
          );
        })}
      </div>
      {err && <p className="absolute top-[512px] w-full text-center text-[13px] text-[#ff9aa8]">{err}</p>}
      <p className="absolute bottom-[12px] w-full text-center text-[12px] text-white/45">GP 는 출석 · 일일 미션 · 업적으로 모으는 사이트 공용 포인트 · 일일 패스는 메뉴에 들어오면 그날 몫을 자동으로 받아요</p>
    </div>
  );
}
