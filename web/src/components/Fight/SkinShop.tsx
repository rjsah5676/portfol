"use client";

/**
 * PIXEL FIGHT 상점 · 보관함 — 스킨을 GP로 사고(상점) 캐릭터마다 하나씩 착용(보관함).
 * 스킨 목록은 lib/fight/skins, 가격은 lib/points SHOP, 산 것 · 착용은 서버(fight.skins · fight.wearSkin).
 * 착용한 스킨은 AI전 · 연습 · 온라인(상대도 보임) 어디서나 그림 · 효과 · 기술 소리가 바뀜 (기술 · 판정은 그대로).
 */
import { useEffect, useState } from "react";
import { CHARS } from "@/lib/fight/chars";
import { FIGHT_SKINS, artUrl, faceUrl, skinItem, type FightSkin } from "@/lib/fight/skins";
import { reloadMySkins, useMySkins, wearMySkin } from "@/lib/fight/mySkins";
import { shopItem } from "@/lib/points";
import { buyItem } from "@/lib/api/points";
import { useAuth } from "@/lib/AuthContext";
import { sfxUi } from "@/lib/fight/sfx";
import { GoldFrame } from "./Settings";
import PixelPreview from "./PixelPreview";

const TITLE = "font-['Black_Han_Sans',sans-serif]";
const PX = "[image-rendering:pixelated]";

export type ShopTab = "shop" | "inv";

/** 상점 미리보기 캐릭터 뒤 오라 그림 (검정 배경 · 밝게 겹쳐 그림) */
const AURA: Record<string, string> = {
  "soyoung-bunny": "/fight/shop/soyoung-bunny-aura.webp",
  "kai-tkd": "/fight/shop/kai-tkd-aura.webp",
};

const chIndex = (s: FightSkin) => CHARS.findIndex((c) => c.id === s.ch);
const gp = (n: number) => n.toLocaleString("ko-KR");

export default function SkinShop({ initial = "shop", onClose }: { initial?: ShopTab; onClose: () => void }) {
  const { profile, points, setPoints, login } = useAuth();
  const member = !!profile;
  const mine = useMySkins(profile?.nick ?? "");
  const [tab, setTab] = useState<ShopTab>(initial);
  const [pick, setPick] = useState(FIGHT_SKINS[0]?.id ?? "");
  /** 구매 확인 중인 스킨 (한 번 더 누르면 삼) */
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 열린 동안엔 키 입력을 메뉴로 안 보냄 (Esc = 닫기)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.code === "Escape" || e.code === "Backspace") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const skin = FIGHT_SKINS.find((s) => s.id === pick) ?? FIGHT_SKINS[0];
  const item = skin ? shopItem(skinItem(skin.id)) : undefined;
  const owned = (id: string) => mine.owned.includes(id);
  const worn = (s: FightSkin) => mine.wear[s.ch] === s.id && owned(s.id);

  const buy = async (s: FightSkin) => {
    const it = shopItem(skinItem(s.id));
    if (!it || busy) return;
    if (confirm !== s.id) {
      sfxUi("move");
      setConfirm(s.id);
      setMsg(null);
      return;
    }
    setBusy(true);
    try {
      const r = await buyItem(it.id);
      setPoints(r.points);
      await reloadMySkins();
      sfxUi("ready");
      setMsg({ ok: true, text: `${s.name} 획득! 바로 착용했어요 — 보관함에서 바꿀 수 있어요.` });
    } catch (e) {
      sfxUi("back");
      setMsg({ ok: false, text: (e as Error).message || "사지 못했어요." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const wear = async (chId: string, id: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await wearMySkin(chId, id);
      sfxUi("ok");
      setMsg(null);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || "바꾸지 못했어요." });
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (t: ShopTab, label: string) => (
    <button
      type="button"
      onClick={() => {
        sfxUi("move");
        setTab(t);
        setMsg(null);
        setConfirm(null);
      }}
      className={`cursor-pointer rounded-full px-[1.4cqw] py-[0.35cqw] text-[1.25cqw] font-bold transition-colors ${
        tab === t ? "bg-[#F2C35B] text-[#2B1840]" : "bg-white/10 text-white/70 hover:bg-white/20"
      }`}
    >
      {label}
    </button>
  );

  // 보관함: 산 스킨이 있는 캐릭터만
  const invChars = CHARS.map((c, i) => ({ c, i, list: FIGHT_SKINS.filter((s) => s.ch === c.id && owned(s.id)) })).filter(
    (x) => x.list.length > 0
  );

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 backdrop-blur-[2px] [animation:modal-fade_150ms_ease-out]"
      onClick={onClose}
    >
      <GoldFrame className="h-[44cqw] w-[78cqw]">
        {/* 머리: 탭 · 내 GP · 닫기 */}
        <div className="flex items-center gap-[1cqw] border-b border-[#F2C35B]/30 px-[2cqw] py-[1cqw]">
          <span className={`${TITLE} mr-[0.6cqw] text-[2.3cqw] tracking-wide text-[#FFE9A8] [text-shadow:0_0.2cqw_0_#12081F]`}>
            {tab === "shop" ? "상점" : "보관함"}
          </span>
          {tabBtn("shop", "🛒 상점")}
          {tabBtn("inv", "🎒 보관함")}
          <span className="flex-1" />
          {member ? (
            <span className="rounded-full bg-black/40 px-[1.2cqw] py-[0.35cqw] font-mono text-[1.25cqw] font-bold text-[#FDE047] tabular-nums">
              {gp(points ?? 0)} GP
            </span>
          ) : (
            <span className="text-[1.1cqw] text-white/55">회원만 살 수 있어요</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full bg-white/10 px-[1.2cqw] py-[0.3cqw] text-[1.2cqw] text-white/75 hover:bg-white/20"
          >
            닫기 ✕
          </button>
        </div>

        {tab === "shop" && skin && (
          <div className="flex min-h-0 flex-1 gap-[1.6cqw] p-[1.6cqw]">
            {/* 왼쪽: 스킨 목록 */}
            <div className="flex w-[17cqw] flex-col gap-[0.8cqw] overflow-y-auto">
              {FIGHT_SKINS.map((s) => {
                const on = s.id === skin.id;
                const it = shopItem(skinItem(s.id));
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      sfxUi("move");
                      setPick(s.id);
                      setConfirm(null);
                      setMsg(null);
                    }}
                    className={`flex cursor-pointer items-center gap-[0.8cqw] rounded-[0.7cqw] border-[0.2cqw] p-[0.5cqw] text-left transition-colors ${
                      on ? "bg-white/10" : "border-transparent bg-white/[0.04] hover:bg-white/[0.08]"
                    }`}
                    style={on ? { borderColor: s.color } : undefined}
                  >
                    <img src={faceUrl(chIndex(s), s.id)} alt="" className={`h-[4.6cqw] w-[4.6cqw] rounded-[0.5cqw] object-cover ${PX}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-[1.2cqw] font-bold text-white">{s.name}</span>
                      <span className="block text-[1cqw] text-white/55">
                        {owned(s.id) ? "보유 중" : it ? `${gp(it.price)} GP` : "판매 안 함"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 가운데: 전신 그림 + 게임 속 도트 */}
            <div
              className="relative flex-1 overflow-hidden rounded-[0.9cqw]"
              style={{ background: `radial-gradient(ellipse at 50% 30%, ${skin.color}55, #120820 70%)` }}
            >
              {skin.id === "igna-fw" && <FireworksBg color={skin.color} />}
              {AURA[skin.id] && (
                <img
                  key={`aura-${skin.id}`}
                  src={AURA[skin.id]}
                  alt=""
                  className="pointer-events-none absolute bottom-0 left-[38%] h-full -translate-x-1/2 object-contain object-bottom mix-blend-screen [animation:shop-aura_3.2s_ease-in-out_infinite_alternate]"
                />
              )}
              <style>{`@keyframes shop-aura{from{opacity:.7;filter:brightness(.9)}to{opacity:1;filter:brightness(1.15)}}`}</style>
              <img
                key={skin.id}
                src={artUrl(chIndex(skin), skin.id)}
                alt={skin.name}
                className={`absolute bottom-0 left-[38%] h-[96%] -translate-x-1/2 object-contain object-bottom [animation:modal-fade_300ms_ease-out]`}
              />
              <div className="absolute right-[3%] bottom-[4%] flex flex-col items-center rounded-[0.8cqw] bg-black/35 px-[0.6cqw] pt-[0.4cqw]">
                <span className="font-mono text-[0.85cqw] tracking-widest text-white/50">IN GAME</span>
                <PixelPreview key={skin.id} id={skin.id} className="h-[13cqw] w-[11cqw]" />
              </div>
            </div>

            {/* 오른쪽: 설명 · 구매 */}
            <div className="flex w-[22cqw] flex-col">
              <span className="font-mono text-[1cqw] font-bold tracking-[0.25em]" style={{ color: skin.color }}>
                {skin.tag}
              </span>
              <span className={`${TITLE} text-[2.4cqw] leading-tight text-white`}>{skin.name}</span>
              <span className="mt-[0.3cqw] text-[1.05cqw] text-white/55">{CHARS[chIndex(skin)]?.name} 스킨 · 그림 · 효과 · 기술 소리 변경</span>
              <p className="mt-[1cqw] text-[1.15cqw] leading-relaxed text-white/80">{skin.desc}</p>
              <p className="mt-[0.6cqw] text-[1cqw] leading-relaxed text-white/45">
                기술 · 판정은 기본과 똑같아요. 온라인 대전에선 상대에게도 이 모습으로 보여요.
              </p>
              <span className="flex-1" />
              {msg && (
                <div className={`mb-[0.8cqw] rounded-[0.6cqw] px-[1cqw] py-[0.6cqw] text-[1.1cqw] ${msg.ok ? "bg-[#22C55E]/20 text-[#86EFAC]" : "bg-[#E8344E]/20 text-[#FCA5A5]"}`}>
                  {msg.text}
                </div>
              )}
              {!member ? (
                <button
                  type="button"
                  onClick={() => void login()}
                  className="cursor-pointer rounded-[0.8cqw] bg-white/15 py-[0.9cqw] text-[1.4cqw] font-bold text-white hover:bg-white/25"
                >
                  로그인하고 사기
                </button>
              ) : owned(skin.id) ? (
                <button
                  type="button"
                  disabled={busy || worn(skin)}
                  onClick={() => void wear(skin.ch, skin.id)}
                  className="cursor-pointer rounded-[0.8cqw] bg-white/15 py-[0.9cqw] text-[1.4cqw] font-bold text-white hover:bg-white/25 disabled:cursor-default disabled:opacity-60"
                >
                  {worn(skin) ? "✓ 착용 중" : "착용하기"}
                </button>
              ) : item ? (
                <button
                  type="button"
                  disabled={busy || (points ?? 0) < item.price}
                  onClick={() => void buy(skin)}
                  className="cursor-pointer rounded-[0.8cqw] py-[0.9cqw] text-[1.4cqw] font-bold text-[#1A0B2A] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100"
                  style={{ background: confirm === skin.id ? "#FDE047" : `linear-gradient(180deg, #FFD27A, ${skin.color})` }}
                >
                  {busy
                    ? "사는 중…"
                    : (points ?? 0) < item.price
                      ? `GP 부족 (${gp(item.price)} GP)`
                      : confirm === skin.id
                        ? `한 번 더 누르면 구매 (−${gp(item.price)} GP)`
                        : `🛒 ${gp(item.price)} GP 구매`}
                </button>
              ) : null}
            </div>
          </div>
        )}

        {tab === "inv" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-[1.6cqw]">
            {!member ? (
              <Empty text="로그인하면 산 스킨을 여기서 착용할 수 있어요." />
            ) : invChars.length === 0 ? (
              <Empty text="아직 가진 스킨이 없어요 — 상점에서 구경해 보세요!" action={() => setTab("shop")} />
            ) : (
              <div className="flex flex-col gap-[1.4cqw]">
                {invChars.map(({ c, i, list }) => {
                  const cur = mine.wear[c.id];
                  const opts: { id: string | null; name: string; color: string }[] = [
                    { id: null, name: "기본", color: c.color },
                    ...list.map((s) => ({ id: s.id, name: s.name, color: s.color })),
                  ];
                  return (
                    <div key={c.id}>
                      <div className="mb-[0.6cqw] text-[1.3cqw] font-bold" style={{ color: c.color }}>
                        {c.name}
                      </div>
                      <div className="flex flex-wrap gap-[1cqw]">
                        {opts.map((o) => {
                          const on = (o.id ?? null) === (cur && owned(cur) ? cur : null);
                          return (
                            <button
                              key={o.id ?? "base"}
                              type="button"
                              disabled={busy || on}
                              onClick={() => void wear(c.id, o.id)}
                              className={`relative flex w-[13cqw] cursor-pointer flex-col items-center overflow-hidden rounded-[0.8cqw] border-[0.25cqw] bg-white/[0.05] pb-[0.6cqw] transition-transform hover:scale-[1.03] disabled:cursor-default disabled:hover:scale-100 ${
                                on ? "" : "border-white/10"
                              }`}
                              style={on ? { borderColor: o.color, boxShadow: `0 0 1.2cqw ${o.color}88` } : undefined}
                            >
                              <img src={faceUrl(i, o.id)} alt="" className={`h-[11cqw] w-full object-cover ${PX}`} />
                              <span className="mt-[0.4cqw] text-[1.15cqw] font-bold text-white">{o.name}</span>
                              <span className={`text-[0.95cqw] ${on ? "text-[#FDE047]" : "text-white/45"}`}>{on ? "✓ 착용 중" : "눌러서 착용"}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {msg && !msg.ok && <div className="mt-[1cqw] text-[1.1cqw] text-[#FCA5A5]">{msg.text}</div>}
          </div>
        )}
      </GoldFrame>
    </div>
  );
}

function Empty({ text, action }: { text: string; action?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[1.2cqw] text-[1.3cqw] text-white/60">
      {text}
      {action && (
        <button type="button" onClick={action} className="cursor-pointer rounded-full bg-[#F2C35B] px-[1.6cqw] py-[0.4cqw] text-[1.2cqw] font-bold text-[#2B1840]">
          🛒 상점 가기
        </button>
      )}
    </div>
  );
}

/** 상점 미리보기 뒤 불꽃 터지는 배경 (CSS만) */
function FireworksBg({ color }: { color: string }) {
  const bursts = [
    [18, 22, 0],
    [70, 14, 0.7],
    [44, 34, 1.4],
    [84, 40, 2.1],
  ];
  return (
    <div className="pointer-events-none absolute inset-0">
      <style>{`@keyframes shop-burst{0%{transform:scale(0.1);opacity:0}15%{opacity:1}70%{opacity:0.7}100%{transform:scale(1);opacity:0}}`}</style>
      {bursts.map(([x, y, d], k) => (
        <div
          key={k}
          className="absolute h-[9cqw] w-[9cqw] rounded-full"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            marginLeft: "-4.5cqw",
            marginTop: "-4.5cqw",
            background: `repeating-conic-gradient(from 0deg, ${k % 2 ? "#FFE9A8" : color} 0deg 3deg, transparent 3deg 22.5deg)`,
            maskImage: "radial-gradient(circle, transparent 30%, #000 34%, #000 60%, transparent 72%)",
            WebkitMaskImage: "radial-gradient(circle, transparent 30%, #000 34%, #000 60%, transparent 72%)",
            animation: `shop-burst 2.8s ease-out ${d}s infinite both`,
          }}
        />
      ))}
    </div>
  );
}
