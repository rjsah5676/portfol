"use client";

import { useState } from "react";
import { asset, lookReady } from "@/lib/poker/assets";
import {
  CHARS,
  CHAR_IDS,
  SKINS,
  fmtEok,
  fmtWon,
  lookOf,
  type CharId,
  type Skin,
  type SkinId,
} from "@/lib/poker/rules";
import { playVoice } from "@/lib/poker/sfx";
import type { Wallet } from "@/lib/poker/types";
import { buySkin, wearSkin } from "@/realtime/poker";
import { Money } from "./parts";
import Sheet from "./Sheet";

/*
 * 상점 · 옷장 (한 창에 탭 둘).
 *   상점: 모든 캐릭터의 스킨을 보여 주고 칩으로 삼 (두 번 눌러 확인, 지금 캐릭터 것 먼저). 테이블에 앉아 있으면 못 삼 — 앉은 동안의 칩은 판에 들고 있어서.
 *   옷장: 지금 캐릭터의 기본 / 가진 스킨만. 다른 캐릭터 스킨은 그 캐릭터로 바꾼 뒤 입음.
 */

export type ShopTab = "shop" | "closet";

export default function Shop({
  wallet,
  tab,
  setTab,
  mobile,
  maxH,
  inGame,
  onClose,
}: {
  wallet: Wallet;
  tab: ShopTab;
  setTab: (t: ShopTab) => void;
  mobile: boolean;
  maxH: number;
  /** 테이블 화면에서 연 옷장: 갈아입어도 대사 없이 (판 방해 안 되게) */
  inGame?: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<SkinId | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const seated = !!wallet.table;
  const skins = wallet.skins ?? [];
  /** 옷장에 보이는 것 = 지금 캐릭터의 스킨만 */
  const mine = SKINS.filter((sk) => sk.char === wallet.char && skins.includes(sk.id)).length;
  const wear = wallet.wear ?? {};

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "요청을 처리하지 못했어요.", ok: false });
    } finally {
      setBusy("");
    }
  };

  const buy = (sk: Skin) =>
    run(sk.id, async () => {
      await buySkin(sk.id);
      setConfirm(null);
      // 스킨은 사면 그 캐릭터에 입혀짐. 다른 캐릭터 스킨이면 캐릭터는 그대로
      if (wallet.char === sk.char) {
        setMsg({ text: `${sk.name}을(를) 장착했어요!`, ok: true });
        playVoice(sk.id, "select");
      } else
        setMsg({
          text: `${sk.name}을(를) 샀어요! ${CHARS[sk.char].name} 캐릭터로 바꾸면 입혀져 있어요.`,
          ok: true,
        });
    });

  const put = (char: CharId, skin: SkinId | null) =>
    run(`${char}:${skin ?? ""}`, async () => {
      await wearSkin(char, skin);
      // 테이블 화면에서는 판을 방해하지 않게 대사 없이
      if (!inGame && !seated) playVoice(skin ?? char, "select");
    });

  return (
    <Sheet mobile={mobile} maxH={maxH} wide={720} fill onClose={onClose}>
      <div className="shrink-0 px-[0.9em] pt-[0.5em] pr-[3.2em]">
        <div className="pk-seg">
          <button type="button" aria-pressed={tab === "shop"} onClick={() => setTab("shop")}>
            상점
          </button>
          <button type="button" aria-pressed={tab === "closet"} onClick={() => setTab("closet")}>
            옷장
            {mine > 0 && <span className="ml-[0.3em] text-[0.82em] opacity-70">{mine}</span>}
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-[0.4em] px-[0.9em] pt-[0.5em] text-[0.8em] text-white/60">
        보유 칩{}
        <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
        <Money won={wallet.money} className="text-[1.15em] text-[#ffd84a]" />
        {seated && tab === "shop" && (
          <span className="ml-auto text-[0.92em] text-[#ff8a97]">
            테이블에서 일어난 뒤 살 수 있어요
          </span>
        )}
      </div>
      {msg && (
        <p
          role="status"
          className={`mx-[0.9em] mt-[0.4em] rounded-[6px] px-[0.7em] py-[0.35em] text-[0.8em] ${msg.ok ? "bg-[#163b2a] text-[#9ff0c8]" : "bg-[#3a1016] text-[#ffc2ca]"}`}
        >
          {msg.text}
        </p>
      )}

      <div
        data-sheet-scroll
        className="pk-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-[0.9em]"
      >
        {tab === "shop" ? (
          <ul className={`grid gap-[0.7em] ${mobile ? "" : "grid-cols-2"}`}>
            <li className="col-span-full rounded-[8px] bg-white/[0.05] px-[0.8em] py-[0.5em] text-[0.8em] text-white/70">
              <b className="text-[#9fe7ff]">터치 반응</b> 스킨을 입으면 로비에서 캐릭터를 눌러 볼 수
              있어요. 누를 때마다 다른 반응과 대사가 나와요.
            </li>
            {[
              ...SKINS.filter((sk) => sk.char === wallet.char),
              ...SKINS.filter((sk) => sk.char !== wallet.char),
            ].map((sk) => {
              const owned = skins.includes(sk.id);
              const short = Math.max(0, sk.price - wallet.money);
              const asking = confirm === sk.id;
              return (
                <li
                  key={sk.id}
                  className="pk-skin-card"
                  style={{ "--c": CHARS[sk.char].color } as React.CSSProperties}
                >
                  <div className="pk-skin-art">
                    {}
                    <img src={asset.full(sk.id)} alt={sk.name} draggable={false} />
                    {!lookReady(sk.id) && <span className="pk-skin-soon">새 그림 준비 중</span>}
                    {owned && <span className="pk-skin-owned">보유 중</span>}
                    {sk.live && lookReady(sk.id) && <span className="pk-skin-live">터치 반응</span>}
                  </div>
                  <div className="grid gap-[0.3em] p-[0.7em]">
                    <div className="flex items-baseline gap-[0.4em]">
                      <span className="text-[1.1em] font-extrabold">{sk.name}</span>
                      <span
                        className="text-[0.75em] font-bold"
                        style={{ color: CHARS[sk.char].color }}
                      >
                        {CHARS[sk.char].name} 스킨
                      </span>
                    </div>
                    <p className="text-[0.78em] leading-snug text-white/65">{sk.blurb}</p>
                    <div className="mt-[0.2em] flex items-center gap-[0.3em] text-[0.95em] font-extrabold text-[#ffd84a]">
                      {}
                      <img
                        src={asset.chip("gold", "stack")}
                        alt=""
                        className="h-[1.3em] w-[1.3em]"
                      />
                      {fmtWon(sk.price)}
                    </div>
                    {owned ? (
                      <button
                        type="button"
                        disabled={sk.char !== wallet.char}
                        onClick={() => setTab("closet")}
                        className="pk-btn pk-btn-ghost py-[0.55em] text-[0.88em]"
                      >
                        {sk.char === wallet.char
                          ? "옷장에서 장착"
                          : `${CHARS[sk.char].name} 캐릭터로 바꾸면 입을 수 있어요`}
                      </button>
                    ) : asking ? (
                      <div className="flex gap-[0.4em]">
                        <button
                          type="button"
                          onClick={() => setConfirm(null)}
                          className="pk-btn pk-btn-ghost px-[1em] py-[0.55em] text-[0.85em]"
                        >
                          그만두기
                        </button>
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void buy(sk)}
                          className="pk-btn pk-btn-gold flex-1 py-[0.55em] text-[0.88em]"
                        >
                          {busy === sk.id ? "사는 중…" : `칩 ${fmtEok(sk.price)} 내고 사기`}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={seated || short > 0}
                        onClick={() => setConfirm(sk.id)}
                        className="pk-btn pk-btn-gold py-[0.55em] text-[0.88em]"
                      >
                        {seated
                          ? "테이블에서는 못 사요"
                          : short > 0
                            ? `칩 ${fmtEok(short)} 더 필요해요`
                            : "사기"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid gap-[0.7em]">
            {mine === 0 && (
              <p className="rounded-[8px] bg-white/[0.05] px-[0.8em] py-[0.7em] text-[0.82em] text-white/60">
                {CHARS[wallet.char].name}의 스킨이 아직 없어요.{" "}
                <b className="text-[#ffd84a]">상점</b>에서 사면 여기서 갈아입을 수 있어요.
              </p>
            )}
            {/* 지금 캐릭터의 스킨만 (다른 캐릭터 스킨은 그 캐릭터로 바꾼 뒤 입음) */}
            {[wallet.char, ...CHAR_IDS.filter((c) => c !== wallet.char)]
              .filter((c) => c === wallet.char)
              .map((c) => {
                const looks: { id: SkinId | null; name: string }[] = [
                  { id: null, name: "기본" },
                  ...SKINS.filter((sk) => sk.char === c && skins.includes(sk.id)).map((sk) => ({
                    id: sk.id,
                    name: sk.name,
                  })),
                ];
                const now = lookOf(c, wear);
                return (
                  <section
                    key={c}
                    className="rounded-[10px] border border-white/[0.07] bg-white/[0.04] p-[0.7em]"
                  >
                    <div className="mb-[0.5em] flex items-baseline gap-[0.4em]">
                      <span className="font-extrabold" style={{ color: CHARS[c].color }}>
                        {CHARS[c].name}
                      </span>
                      {c === wallet.char && (
                        <span className="text-[0.72em] text-white/45">지금 캐릭터</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-[0.45em] sm:grid-cols-4">
                      {looks.map((l) => {
                        const key = l.id ?? c;
                        const on = now === key && c === wallet.char;
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={on}
                            disabled={!!busy}
                            onClick={() => void put(c, l.id)}
                            className="pk-closet-item"
                          >
                            {}
                            <img src={asset.full(key)} alt="" draggable={false} />
                            <span className="pk-closet-name">{l.name}</span>
                            {on && <span className="pk-closet-on">장착 중</span>}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
