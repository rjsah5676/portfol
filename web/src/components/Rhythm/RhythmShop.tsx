"use client";

/**
 * PIXEL Rhythm Up 상점 — 테마 스킨을 GP로 사고(서버 inv.rhythm) 바로 착용(설정의 노트 스킨).
 * 스킨 정의는 lib/rhythm/fx.ts (SKINS · SKIN_THEME), 가격은 lib/points SHOP (rhythm.skin.<ref>).
 * 스킨은 겉모습만 — 노트 크기 · 판정선 위치 · 판정은 기본 스킨과 같음.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { buyItem } from "@/lib/api/points";
import { shopFor } from "@/lib/points";
import { SKINS, SKIN_THEME, type Skin } from "@/lib/rhythm/fx";
import { reloadRhythmItems, useRhythmItems } from "@/lib/rhythm/myItems";
import { sfx } from "@/lib/rhythm/sfx";

const DISP = "pru-t";
const KR = "";
const gp = (n: number) => n.toLocaleString("ko-KR");
const GOODS = SKINS.filter((s) => s.shop && SKIN_THEME[s.key]);

export default function RhythmShop({
  wearing,
  onWear,
  onClose,
}: {
  /** 지금 설정의 노트 스킨 */
  wearing: Skin;
  onWear: (skin: Skin) => void;
  onClose: () => void;
}) {
  const { profile, points, setPoints, login } = useAuth();
  const owned = useRhythmItems(profile?.nick ?? "");
  const [pick, setPick] = useState<Skin>(GOODS[0]?.key ?? "bar");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    sfx("ui-open", 0.7);
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.code === "Escape" || e.code === "Backspace") {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const good = GOODS.find((s) => s.key === pick) ?? GOODS[0];
  if (!good) return null;
  const theme = SKIN_THEME[good.key]!;
  const item = shopFor("rhythm", "skin", good.shop!);
  const have = owned.includes(good.shop!);
  const worn = have && wearing === good.key;

  const buy = async () => {
    if (!item || busy) return;
    if (!profile) {
      void login();
      return;
    }
    if (!confirm) {
      sfx("ui-move", 0.6);
      setConfirm(true);
      setMsg(null);
      return;
    }
    setBusy(true);
    try {
      const r = await buyItem(item.id);
      setPoints(r.points);
      await reloadRhythmItems();
      onWear(good.key);
      sfx("ui-select", 0.8);
      setMsg({
        ok: true,
        text: `${good.label} 획득! 바로 착용했어요 — 설정의 노트 스킨에서 바꿀 수 있어요.`,
      });
    } catch (e) {
      sfx("ui-back", 0.7);
      setMsg({ ok: false, text: (e as Error).message || "사지 못했어요." });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center pru-dither bg-[#0c0718]/60 [animation:modal-fade_180ms_steps(5)]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex h-[46cqw] w-[74cqw] flex-col overflow-hidden pru-win [--wf:#150e29f5] [animation:modal-pop_220ms_steps(5)]">
        <div className="absolute top-0 left-[2cqw] h-[0.3cqw] w-[8cqw] bg-[#F5C842]" />
        <div className="flex items-end justify-between gap-[2cqw] px-[2.4cqw] pt-[1.8cqw]">
          <div className={`${DISP} text-[2.6cqw] leading-none tracking-[0.08em] text-white`}>
            SHOP
          </div>
          <div className="flex items-center gap-[1.2cqw]">
            <div className={`${KR} text-[1.25cqw] text-white/70`}>
              {profile ? (
                <>
                  보유 <b className="font-mono text-[#F5C842]">{gp(points ?? 0)} GP</b>
                </>
              ) : (
                "로그인하면 GP로 살 수 있어요"
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="pru-btn cursor-pointer px-[1cqw] py-[0.3cqw] text-[1.05cqw] text-white"
            >
              닫기 (Esc)
            </button>
          </div>
        </div>

        <div className="mt-[1.4cqw] flex min-h-0 flex-1 gap-[1.8cqw] px-[2.4cqw] pb-[2cqw]">
          {/* 왼쪽: 상품 목록 */}
          <div className="flex w-[17cqw] shrink-0 flex-col gap-[0.8cqw]">
            <div className="font-mono text-[0.9cqw] tracking-[0.2em] text-white/40">THEME SKIN</div>
            {GOODS.map((s) => {
              const it = shopFor("rhythm", "skin", s.shop!);
              const mine = owned.includes(s.shop!);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setPick(s.key);
                    setConfirm(false);
                    setMsg(null);
                    sfx("ui-move", 0.6);
                  }}
                  className={`cursor-pointer overflow-hidden rounded-[0.8cqw] border text-left transition-colors ${
                    pick === s.key
                      ? "border-[#F5C842] bg-[#F5C842]/10"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                  <img
                    src={SKIN_THEME[s.key]!.preview}
                    alt=""
                    className="aspect-video w-full object-cover"
                  />
                  <div className="flex items-center justify-between px-[0.8cqw] py-[0.5cqw]">
                    <span className={`${KR} text-[1.15cqw] font-bold text-white`}>{s.label}</span>
                    <span className="font-mono text-[0.95cqw] text-[#F5C842]">
                      {mine ? "보유" : it ? `${gp(it.price)} GP` : ""}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 오른쪽: 미리보기 + 설명 + 사기/착용 */}
          <div className="flex min-w-0 flex-1 flex-col gap-[1cqw]">
            <div className="pru-in relative min-h-0 flex-1 overflow-hidden [--if:#000]">
              <img
                src={theme.preview}
                alt={`${good.label} 미리보기`}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex items-center justify-between gap-[1.6cqw]">
              <div className="min-w-0">
                <div className={`${KR} text-[1.6cqw] font-bold text-white`}>
                  {item?.name ?? good.label}
                </div>
                <div className={`${KR} mt-[0.3cqw] text-[1.05cqw] leading-snug text-white/60`}>
                  {theme.desc}
                </div>
                <div className={`${KR} mt-[0.2cqw] text-[0.95cqw] text-white/40`}>
                  겉모습만 바뀌어요 — 노트 크기 · 판정선 위치 · 판정은 그대로
                </div>
              </div>
              {have ? (
                <button
                  type="button"
                  disabled={worn}
                  onClick={() => {
                    onWear(good.key);
                    sfx("ui-select", 0.8);
                  }}
                  className={`pru-btn shrink-0 px-[2cqw] py-[0.8cqw] ${KR} text-[1.35cqw] font-bold ${
                    worn ? "text-white/45" : "pru-gold cursor-pointer"
                  }`}
                >
                  {worn ? "착용 중" : "착용하기"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void buy()}
                  className={`pru-btn shrink-0 cursor-pointer px-[2cqw] py-[0.8cqw] ${KR} text-[1.35cqw] font-bold ${
                    confirm ? "pru-pink" : "pru-gold"
                  }`}
                >
                  {!profile
                    ? "로그인하고 사기"
                    : busy
                      ? "사는 중…"
                      : confirm
                        ? `${gp(item?.price ?? 0)} GP 쓸까요?`
                        : `${gp(item?.price ?? 0)} GP로 사기`}
                </button>
              )}
            </div>
            {msg && (
              <div
                className={`${KR} text-[1.1cqw] ${msg.ok ? "text-[#86EFAC]" : "text-[#FCA5A5]"}`}
              >
                {msg.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
