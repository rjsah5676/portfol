"use client";

/*
 * 픽셀 순찰대 — GP 상점: 꾸러미 (처음 한 번 · 매일 · 매주, 효율 좋음) · 재화 직구 (제한 없음, 효율 제일 나쁨)
 * 사기 버튼은 두 번 눌러야 (첫 번째 = 확인 상태)
 */
import { useEffect, useState, type CSSProperties } from "react";
import { GRADE_NAME, type GGrade } from "@/lib/patrol/gear";
import { SHOP, giveText, type ShopItem } from "@/lib/patrol/shop";
import { WEAPONS, type WeaponId } from "@/lib/survivor/data";
import { patrol, type PatrolProfile } from "@/realtime/patrol";
import { sfx } from "../Survivor/audio";
import { ItemIcon } from "../Survivor/Game";
import { Modal, btn } from "./ui";

const wname = (w: WeaponId) => WEAPONS[w].name;
const gname = (g: GGrade) => GRADE_NAME[g];

/** 남은 횟수 (없으면 무제한 = null) */
function leftOf(it: ShopItem, p: PatrolProfile): number | null {
  if (it.once) return 1 - (p.shop.once[it.id] ?? 0);
  if (it.perDay) return it.perDay - (p.shop.day[it.id] ?? 0);
  if (it.perWeek) return it.perWeek - (p.shop.week[it.id] ?? 0);
  return null;
}

export default function Shop({ prof, onProf, onClose }: { prof: PatrolProfile; onProf(p: PatrolProfile): void; onClose(): void }) {
  const [gp, setGp] = useState<number | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; c: string } | null>(null);
  useEffect(() => {
    let on = true;
    patrol
      .gp()
      .then((r) => on && setGp(r.gp))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);

  const buy = async (it: ShopItem) => {
    if (busy) return;
    if (sure !== it.id) {
      sfx("click");
      setSure(it.id);
      setMsg(null);
      return;
    }
    setBusy(true);
    setSure(null);
    try {
      const r = await patrol.shop(it.id);
      onProf(r.profile);
      setGp(r.gp);
      sfx(r.weapon?.isNew ? "legend" : "buy");
      const extra = r.weapon?.isNew ? " — 로비 「무기」에서 덱에 넣어요" : r.weapon ? ` (이미 있어서 ${WEAPONS[r.weapon.id].name} 조각 +1)` : "";
      setMsg({ t: `${it.name} — ${giveText(it.give, wname, gname).join(" · ")}${extra}`, c: "#4ff0c8" });
    } catch (e) {
      sfx("warn");
      setMsg({ t: (e as Error).message, c: "#ff8fb8" });
    } finally {
      setBusy(false);
    }
  };

  const packs = SHOP.filter((x) => x.kind === "pack");
  const curs = SHOP.filter((x) => x.kind === "cur");
  const buyBtn = (it: ShopItem) => {
    const left = leftOf(it, prof);
    const out = left !== null && left <= 0;
    const short = gp !== null && gp < it.gp;
    const ok = sure === it.id;
    return (
      <button
        type="button"
        disabled={out || short || busy}
        onClick={() => void buy(it)}
        className="pts-btn flex h-[42px] w-full flex-col items-center justify-center text-[14px] leading-[16px]"
        style={ok ? btn("#ff4fa3", "#fff") : btn(it.kind === "pack" ? "#ffd23a" : "#9fb6ff")}
      >
        <span>{out ? (it.once ? "구매함" : it.perDay ? "내일 다시" : "다음 주에") : ok ? "한 번 더 눌러 사기" : `${it.gp.toLocaleString()} GP`}</span>
        {!out && !ok && left !== null && <span className="text-[10px] opacity-80">{it.once ? "한 번만" : it.perDay ? `오늘 ${left}번` : `이번 주 ${left}번`}</span>}
      </button>
    );
  };

  return (
    <Modal title="상점" sub="GP 로 사요 · 꾸러미는 효율이 좋고, 재화 직구는 언제든 살 수 있어요" onClose={onClose} w={900} h={540}>
      <div className="mt-[10px] flex items-center gap-[10px] text-[13px]">
        <span className="text-[#a9a2d6]">내 GP</span>
        <b className="pts-title text-[22px] text-[#ffd23a]">{gp === null ? "…" : gp.toLocaleString()}</b>
        <span className="text-[11px] text-[#6b63a3]">GP: 출석 · 업적 · 일일 미션 (모든 게임 공통)</span>
      </div>
      <b className="mt-[10px] text-[14px] text-[#ffd27a]">꾸러미</b>
      <div className="mt-[8px] grid grid-cols-3 gap-[14px]">
        {packs.map((it) => (
          <div key={it.id} className="pts-card relative flex flex-col px-[12px] py-[10px]" style={{ "--r": "#ffd23a" } as CSSProperties}>
            {it.eff && (
              <span className="pts-tag absolute -top-[8px] -right-[6px] text-[10px]" style={{ background: "#ff4fa3", color: "#fff" }}>
                효율 ×{it.eff}
              </span>
            )}
            <div className="flex items-center gap-[8px]">
              {it.give.weapon ? <ItemIcon k="weapon" id={it.give.weapon} size={36} /> : <img src="/patrol/ui/box_weapon.png" alt="" draggable={false} className="h-[40px] w-[40px]" style={{ imageRendering: "pixelated" }} />}
              <div className="flex flex-col">
                <b className="text-[15px]">{it.name}</b>
                <span className="text-[10px] text-[#a9a2d6]">{it.desc}</span>
              </div>
            </div>
            <ul className="mt-[8px] mb-[10px] flex flex-1 flex-col gap-[3px] text-[12px]">
              {giveText(it.give, wname, gname).map((t) => (
                <li key={t} className="flex gap-[6px]">
                  <span className="mt-[6px] h-[5px] w-[5px] shrink-0 bg-[#ffd23a]" />
                  {t}
                </li>
              ))}
            </ul>
            {buyBtn(it)}
          </div>
        ))}
      </div>
      <b className="mt-[14px] text-[14px] text-[#ffd27a]">재화</b>
      <div className="mt-[8px] grid grid-cols-3 gap-[14px]">
        {curs.map((it) => (
          <div key={it.id} className="pts-card flex items-center gap-[10px] px-[12px] py-[8px]" style={{ "--r": "#9fb6ff" } as CSSProperties}>
            <div className="flex min-w-0 flex-1 flex-col">
              <b className="text-[14px]">{it.name}</b>
              <span className="text-[10px] text-[#a9a2d6]">{it.desc}</span>
            </div>
            <div className="w-[120px]">
              {buyBtn(it)}
            </div>
          </div>
        ))}
      </div>
      <span className="mt-[10px] h-[18px] text-[12px]" style={{ color: msg?.c ?? "#6b63a3" }}>
        {msg ? msg.t : "매일 꾸러미는 0시, 주간 꾸러미는 월요일 0시에 다시 살 수 있어요 (한국 시간)"}
      </span>
    </Modal>
  );
}
