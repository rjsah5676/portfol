"use client";

import { useState } from "react";
import { asset, lookReady } from "@/lib/poker/assets";
import {
  CHARS,
  CHAR_IDS,
  CHAR_PRICE,
  SKINS,
  charOwned,
  fmtEok,
  lookOf,
  type CharId,
  type Skin,
  type SkinId,
} from "@/lib/poker/rules";
import { playVoice } from "@/lib/poker/sfx";
import type { Wallet } from "@/lib/poker/types";
import { buyChar, buySkin, exchange, setChar, wearSkin } from "@/realtime/poker";
import { POINT, POKER_EXCHANGE, SHOP, fmtPoint } from "@/lib/points";
import PointInfo from "@/components/Points/PointInfo";
import { Money } from "./parts";
import Sheet from "./Sheet";

/*
 * 상점 · 옷장 (한 창에 탭 둘).
 *   상점: 모든 캐릭터의 스킨을 보여 주고 포인트로 삼 (두 번 눌러 확인, 지금 캐릭터 것 먼저). 테이블에 앉아 있으면 못 삼.
 *   캐릭터: 포인트로 사야 쓰는 캐릭터 (사면 바로 그 캐릭터로). 봇은 이 캐릭터를 안 씀.
 *   옷장: 지금 캐릭터의 기본 / 가진 스킨만. 다른 캐릭터 스킨은 그 캐릭터로 바꾼 뒤 입음.
 *   환전: 칩 ↔ 포인트 (lib/points.ts 의 POKER_EXCHANGE). 앉아 있으면 못 바꿈.
 */

export type ShopTab = "shop" | "chars" | "closet" | "exchange";

/** 포인트 값 (상점 · 환전의 가격 줄) */
function PointPrice({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.3em] font-extrabold text-[#b9a8ff] ${className}`}>
      <span className="inline-flex h-[1.15em] w-[1.15em] items-center justify-center rounded-full bg-[#7c6cff] text-[0.7em] text-white">
        {POINT.unit[0]}
      </span>
      {fmtPoint(n)}
    </span>
  );
}

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
  /** 상점에서 볼 캐릭터 (전체 / 캐릭터별) */
  const [who, setWho] = useState<CharId | "all">("all");
  const shown = (sk: Skin) => who === "all" || sk.char === who;
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
        {/* 게임방 안: 상점 · 캐릭터 탭 없이 옷장만 */}
        {inGame ? (
          <div className="py-[0.2em] text-[1em] font-extrabold text-white/90">
            옷장 · {CHARS[wallet.char].name}
          </div>
        ) : (
          <div className="pk-seg">
            <button type="button" aria-pressed={tab === "shop"} onClick={() => setTab("shop")}>
              스킨
            </button>
            <button type="button" aria-pressed={tab === "chars"} onClick={() => setTab("chars")}>
              캐릭터
            </button>
            <button type="button" aria-pressed={tab === "closet"} onClick={() => setTab("closet")}>
              옷장
              {mine > 0 && <span className="ml-[0.3em] text-[0.82em] opacity-70">{mine}</span>}
            </button>
            <button type="button" aria-pressed={tab === "exchange"} onClick={() => setTab("exchange")}>
              환전
            </button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-[0.9em] gap-y-[0.3em] px-[0.9em] pt-[0.5em] text-[0.8em] text-white/60">
        <span className="inline-flex items-center gap-[0.4em] whitespace-nowrap">
          보유 칩
          <img src={asset.chip("gold", "top")} alt="" className="h-[1em] w-[1em]" />
          <Money won={wallet.money} className="text-[1.15em] text-[#ffd84a]" />
        </span>
        <span className="inline-flex items-center gap-[0.4em] whitespace-nowrap">
          {POINT.name}
          <PointPrice n={wallet.points ?? 0} className="text-[1.15em]" />
          <PointInfo />
        </span>
        {seated && tab !== "closet" && (
          <span className="ml-auto text-[0.92em] text-[#ff8a97]">
            테이블에서 일어난 뒤 {tab === "exchange" ? "바꿀" : "살"} 수 있어요
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
        {tab === "exchange" && !inGame ? (
          <Exchange wallet={wallet} seated={seated} busy={busy} run={run} setMsg={setMsg} />
        ) : tab === "chars" && !inGame ? (
          <CharShop
            wallet={wallet}
            mobile={mobile}
            seated={seated}
            busy={busy}
            run={run}
            setMsg={setMsg}
          />
        ) : tab === "shop" && !inGame ? (
          <ul className={`grid gap-[0.7em] ${mobile ? "" : "grid-cols-2"}`}>
            <li className="col-span-full rounded-[8px] bg-white/[0.05] px-[0.8em] py-[0.5em] text-[0.8em] text-white/70">
              <b className="text-[#9fe7ff]">터치 반응</b> 스킨을 입으면 로비에서 캐릭터를 눌러 볼 수
              있어요. 누를 때마다 다른 반응과 대사가 나와요.
            </li>
            <li className="col-span-full flex flex-wrap gap-[0.35em]">
              {(["all", ...CHAR_IDS] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={who === c}
                  onClick={() => setWho(c)}
                  className="pk-shop-chip"
                  style={
                    c === "all" ? undefined : ({ "--c": CHARS[c].color } as React.CSSProperties)
                  }
                >
                  {c === "all" ? "전체" : CHARS[c].name}
                </button>
              ))}
            </li>
            {who !== "all" && !SKINS.some((sk) => sk.char === who) && (
              <li className="col-span-full rounded-[8px] bg-white/[0.04] px-[0.8em] py-[1.4em] text-center text-[0.85em] text-white/55">
                {CHARS[who].name}의 스킨은 준비 중이에요.
              </li>
            )}
            {[
              ...SKINS.filter((sk) => sk.char === wallet.char && shown(sk)),
              ...SKINS.filter((sk) => sk.char !== wallet.char && shown(sk)),
            ].map((sk) => {
              const owned = skins.includes(sk.id);
              const short = Math.max(0, sk.price - (wallet.points ?? 0));
              const was = SHOP.find((it) => it.game === "poker" && it.kind === "skin" && it.ref === sk.id)?.was ?? 0;
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
                    <div className="mt-[0.2em] flex items-center gap-[0.45em] text-[0.95em]">
                      {was > sk.price && <s className="text-[0.8em] font-bold text-white/40">{fmtPoint(was)}</s>}
                      <PointPrice n={sk.price} />
                      {was > sk.price && (
                        <span className="rounded-[0.3em] bg-[#e0344a] px-[0.35em] py-[0.05em] text-[0.72em] font-extrabold text-white">
                          -{Math.round((1 - sk.price / was) * 100)}%
                        </span>
                      )}
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
                          {busy === sk.id ? "사는 중…" : `${fmtPoint(sk.price)} 내고 사기`}
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
                            ? `${POINT.name} ${fmtPoint(short)} 더 필요해요`
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
            {mine === 0 &&
              (inGame ? (
                <p className="rounded-[8px] bg-white/[0.05] px-[0.8em] py-[1.4em] text-center text-[0.9em] text-white/60">
                  보유 스킨이 없습니다
                </p>
              ) : (
                <p className="rounded-[8px] bg-white/[0.05] px-[0.8em] py-[0.7em] text-[0.82em] text-white/60">
                  {CHARS[wallet.char].name}의 스킨이 아직 없어요.{" "}
                  <b className="text-[#ffd84a]">상점</b>에서 사면 여기서 갈아입을 수 있어요.
                </p>
              ))}
            {/* 지금 캐릭터의 스킨만 (다른 캐릭터 스킨은 그 캐릭터로 바꾼 뒤 입음) */}
            {[wallet.char, ...CHAR_IDS.filter((c) => c !== wallet.char)]
              .filter((c) => c === wallet.char && !(inGame && mine === 0))
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
                        <span className="text-[0.72em] text-white/45">현재 캐릭터</span>
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

/** 상점 · 캐릭터 탭: 포인트로 사야 쓰는 캐릭터 */
function CharShop({
  wallet,
  mobile,
  seated,
  busy,
  run,
  setMsg,
}: {
  wallet: Wallet;
  mobile: boolean;
  seated: boolean;
  busy: string;
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  setMsg: (m: { text: string; ok: boolean } | null) => void;
}) {
  const [confirm, setConfirm] = useState<CharId | null>(null);
  const forSale = CHAR_IDS.filter((c) => (CHAR_PRICE[c] ?? 0) > 0);
  if (!forSale.length)
    return (
      <p className="rounded-[8px] bg-white/[0.04] px-[0.8em] py-[1.6em] text-center text-[0.85em] text-white/55">
        새 캐릭터를 준비 중이에요.
      </p>
    );
  return (
    <ul className={`grid gap-[0.7em] ${mobile ? "" : "grid-cols-2"}`}>
      <li className="col-span-full rounded-[8px] bg-white/[0.05] px-[0.8em] py-[0.5em] text-[0.8em] text-white/70">
        사면 바로 그 캐릭터로 바뀌고, 언제든 <b className="text-[#ffd84a]">캐릭터 변경</b>에서 다시
        고를 수 있어요.
      </li>
      {forSale.map((c) => {
        const info = CHARS[c];
        const price = CHAR_PRICE[c] ?? 0;
        const owned = charOwned(c, wallet.chars);
        const short = Math.max(0, price - (wallet.points ?? 0));
        const asking = confirm === c;
        return (
          <li key={c} className="pk-skin-card" style={{ "--c": info.color } as React.CSSProperties}>
            <div className="pk-skin-art">
              {}
              <img src={asset.full(c)} alt={info.name} draggable={false} />
              {owned && <span className="pk-skin-owned">보유 중</span>}
            </div>
            <div className="grid gap-[0.3em] p-[0.7em]">
              <div className="flex items-baseline gap-[0.4em]">
                <span className="text-[1.1em] font-extrabold">{info.name}</span>
                <span className="text-[0.75em] text-white/55">
                  {info.age}세 · {info.sign}
                </span>
              </div>
              <p className="text-[0.78em] leading-snug text-white/65">{info.blurb}</p>
              <div className="mt-[0.2em] text-[0.95em]">
                <PointPrice n={price} />
              </div>
              {owned ? (
                <button
                  type="button"
                  disabled={!!busy || wallet.char === c}
                  onClick={() => void run(`pick:${c}`, async () => void (await setChar(c)))}
                  className="pk-btn pk-btn-ghost py-[0.55em] text-[0.88em]"
                >
                  {wallet.char === c ? "현재 캐릭터" : `${info.name}(으)로 바꾸기`}
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
                    onClick={() =>
                      void run(c, async () => {
                        await buyChar(c);
                        setConfirm(null);
                        setMsg({
                          text: `${info.name}을(를) 구매했어요! 현재 캐릭터로 바뀌었어요.`,
                          ok: true,
                        });
                        playVoice(c, "select");
                      })
                    }
                    className="pk-btn pk-btn-gold flex-1 py-[0.55em] text-[0.88em]"
                  >
                    {busy === c ? "사는 중…" : `${fmtPoint(price)} 내고 사기`}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={seated || short > 0}
                  onClick={() => setConfirm(c)}
                  className="pk-btn pk-btn-gold py-[0.55em] text-[0.88em]"
                >
                  {seated
                    ? "테이블에서는 못 사요"
                    : short > 0
                      ? `${POINT.name} ${fmtPoint(short)} 더 필요해요`
                      : "사기"}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** 환전 칸 수 고르기: −100 −10 −1 · 칸 · +1 +10 +100 · 최대 */
function Stepper({ v, set, max }: { v: number; set: (n: number) => void; max: number }) {
  const add = (d: number) => set(Math.max(1, Math.min(Math.max(1, max), v + d)));
  const btn = "pk-btn pk-btn-ghost min-w-[2.6em] px-[0.4em] py-[0.35em] text-[0.85em] tabular-nums";
  return (
    <div className="flex flex-wrap items-center gap-[0.3em]">
      {[-100, -10, -1].map((d) => (
        <button key={d} type="button" className={btn} disabled={v <= 1} onClick={() => add(d)}>
          −{-d}
        </button>
      ))}
      <span className="min-w-[3.2em] text-center font-extrabold tabular-nums">{v}칸</span>
      {[1, 10, 100].map((d) => (
        <button key={d} type="button" className={btn} disabled={v >= max} onClick={() => add(d)}>
          +{d}
        </button>
      ))}
      <button type="button" className="pk-shop-chip" disabled={max < 1} onClick={() => set(Math.max(1, max))}>
        최대
      </button>
    </div>
  );
}

/** 환전 탭: 칩 ↔ 포인트 (칸 단위) */
function Exchange({
  wallet,
  seated,
  busy,
  run,
  setMsg,
}: {
  wallet: Wallet;
  seated: boolean;
  busy: string;
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  setMsg: (m: { text: string; ok: boolean } | null) => void;
}) {
  const X = POKER_EXCHANGE;
  const [toP, setToP] = useState(1);
  const [toC, setToC] = useState(1);
  const pts = wallet.points ?? 0;
  /** 칩 → 포인트: 500만은 남겨야 해서 */
  const maxToP = Math.max(0, Math.min(X.maxUnits, Math.floor((wallet.money - X.keepChips) / X.chips)));
  const maxToC = Math.max(0, Math.min(X.maxUnits, Math.floor(pts / X.points)));
  const card = "rounded-[10px] border border-white/[0.08] bg-white/[0.04] p-[0.8em] grid gap-[0.5em]";
  return (
    <div className="grid gap-[0.7em] text-[0.9em]">
      <p className="rounded-[8px] bg-white/[0.05] px-[0.8em] py-[0.55em] text-[0.88em] leading-snug break-keep text-white/70">
        칩 <b className="text-[#ffd84a]">{fmtEok(X.chips)}</b> = <b className="text-[#b9a8ff]">{fmtPoint(X.points)}</b> 로 서로 바꿀 수
        있어요 (1칸). {POINT.name}로 바꿔 받은 칩은 <b className="text-white/85">칩 업적에 들어가지 않아요</b>.
      </p>
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-[0.6em]">
          <b className="text-[1.05em]">칩 → {POINT.name}</b>
          <span className="text-[0.8em] text-white/45">바꾼 뒤에도 칩 {fmtEok(X.keepChips)}은 남아야 해요</span>
        </div>
        <Stepper v={Math.min(toP, Math.max(1, maxToP))} set={setToP} max={maxToP} />
        <div className="flex flex-wrap items-center gap-[0.4em] text-[0.9em]">
          칩 <b className="text-[#ffd84a]">{fmtEok(Math.max(1, Math.min(toP, maxToP)) * X.chips)}</b> →
          <PointPrice n={Math.max(1, Math.min(toP, maxToP)) * X.points} />
        </div>
        <button
          type="button"
          disabled={seated || maxToP < 1 || !!busy}
          onClick={() =>
            void run("ex:toPoints", async () => {
              const n = Math.max(1, Math.min(toP, maxToP));
              await exchange("toPoints", n);
              setMsg({ text: `칩 ${fmtEok(n * X.chips)}을(를) ${fmtPoint(n * X.points)}로 바꿨어요.`, ok: true });
            })
          }
          className="pk-btn pk-btn-gold py-[0.55em] text-[0.9em]"
        >
          {seated ? "테이블에서는 못 바꿔요" : maxToP < 1 ? "칩이 모자라요" : busy === "ex:toPoints" ? "바꾸는 중…" : `${POINT.name}로 바꾸기`}
        </button>
      </section>
      <section className={card}>
        <b className="text-[1.05em]">{POINT.name} → 칩</b>
        <Stepper v={Math.min(toC, Math.max(1, maxToC))} set={setToC} max={maxToC} />
        <div className="flex flex-wrap items-center gap-[0.4em] text-[0.9em]">
          <PointPrice n={Math.max(1, Math.min(toC, maxToC)) * X.points} /> → 칩{" "}
          <b className="text-[#ffd84a]">{fmtEok(Math.max(1, Math.min(toC, maxToC)) * X.chips)}</b>
        </div>
        <button
          type="button"
          disabled={seated || maxToC < 1 || !!busy}
          onClick={() =>
            void run("ex:toChips", async () => {
              const n = Math.max(1, Math.min(toC, maxToC));
              await exchange("toChips", n);
              setMsg({ text: `${fmtPoint(n * X.points)}를 칩 ${fmtEok(n * X.chips)}(으)로 바꿨어요.`, ok: true });
            })
          }
          className="pk-btn pk-btn-gold py-[0.55em] text-[0.9em]"
        >
          {seated ? "테이블에서는 못 바꿔요" : maxToC < 1 ? `${POINT.name}가 모자라요` : busy === "ex:toChips" ? "바꾸는 중…" : "칩으로 바꾸기"}
        </button>
      </section>
      <p className="text-[0.78em] leading-snug break-keep text-white/40">
        {POINT.name}는 출석 · 업적으로 모으는 사이트 전용 재화예요. 현금으로 사거나 바꿀 수 없어요.
      </p>
    </div>
  );
}
