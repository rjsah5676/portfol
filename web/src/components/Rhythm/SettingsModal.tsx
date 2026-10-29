"use client";

import { canWear } from "@/lib/rhythm/myItems";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { LEVEL } from "@/lib/soundLevel";
import {
  drawHead,
  HIT_SOUNDS,
  laneColors,
  hitSoundBuffer,
  NOTE_SIZES,
  setNoteSize,
  SKINS,
  type HitSound,
  type NoteSize,
  type Skin,
} from "@/lib/rhythm/fx";
import { audio, sfx } from "@/lib/rhythm/sfx";
import HoldButton from "./HoldButton";
import SyncCalibrate from "./SyncCalibrate";
import {
  BG_MODES,
  COVERS_OPT,
  FIELD_POS,
  FPS_MODES,
  KEY_CODES,
  KEY_RESERVED,
  keyLabel,
  type BgMode,
  type Cover,
  type FieldPos,
  type FpsMode,
} from "./Stage";

export type LaneMod = "none" | "mirror" | "random";
export const LANE_MODS: { key: LaneMod; label: string; desc: string }[] = [
  { key: "none", label: "기본", desc: "" },
  { key: "mirror", label: "미러", desc: "좌우 반전 — 같은 채보를 반대 손으로" },
  { key: "random", label: "랜덤", desc: "판마다 레인을 섞어요 — 외워서 치는 걸 막아줘요" },
];

export interface Settings {
  speed: number;
  /**
   * 수동 싱크(ms): 노트 화면+판정을 같이 옮김 — 소리가 화면보다 늦게 들리면 +.
   * 자동 싱크(치는 동안 시스템이 알아서 맞추는 값, 화면엔 안 보임)와는 별개로 그 위에 더해짐
   */
  sync: number;
  /** 타격음 볼륨 0~1 */
  hit: number;
  /** 음악 볼륨 0~1 */
  music: number;
  /** 효과음(메뉴·판정 연출) 볼륨 0~1 */
  sfx: number;
  hitSound: HitSound;
  skin: Skin;
  /** 노트 두께 */
  noteSize: NoteSize;
  /** 레인 배치: 미러(좌우 반전) / 랜덤(판마다 레인 섞기) */
  lanes: LaneMod;
  /** 노트 가림: 페이드 / 서든 */
  cover: Cover;
  /** 레인 위치: 화면 왼쪽·가운데·오른쪽 */
  field: FieldPos;
  /** 플레이 배경: 커버·뮤비 / 무대 */
  bg: BgMode;
  /** 프레임: 60 / 최대 */
  fps: FpsMode;
  /** 레인 키 4개 (e.code — 한글 자판이어도 물리 키 기준), 기본 D F J K */
  keys: string[];
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 타격음 미리 듣기 (종류별로 한 번만 만들어 둠)
const hitCache = new Map<HitSound, AudioBuffer>();
async function previewHit(kind: HitSound, volume: number) {
  if (volume <= 0) return;
  try {
    const ctx = await audio();
    if (!hitCache.has(kind)) hitCache.set(kind, await hitSoundBuffer(ctx, kind));
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume * 0.9 * LEVEL.rhythm.hit;
    src.buffer = hitCache.get(kind)!;
    src.connect(gain).connect(ctx.destination);
    src.start();
  } catch {}
}

type Tab = "play" | "sync" | "sound";
const TABS: { key: Tab; label: string; en: string }[] = [
  { key: "play", label: "게임플레이", en: "GAMEPLAY" },
  { key: "sync", label: "싱크", en: "SYNC" },
  { key: "sound", label: "사운드", en: "SOUND" },
];

const chip = (on: boolean) =>
  `pru-btn cursor-pointer px-[1.1cqw] py-[0.4cqw] text-[1.1cqw] font-bold whitespace-nowrap ${
    on ? "pru-on [--a:#7b62c4]" : "text-white/70 [--c:#221a40]"
  }`;
const stepBtn =
  "pru-btn h-[2.4cqw] w-[2.4cqw] shrink-0 cursor-pointer text-[1.3cqw] text-white disabled:cursor-not-allowed disabled:opacity-30";
const range = "min-w-0 flex-1 accent-[#A78BFA] disabled:opacity-40";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[13cqw_1fr] items-center gap-x-[1.4cqw] border-b border-white/[0.06] py-[0.9cqw] last:border-b-0">
      <div>
        <div className=" text-[1.3cqw] font-bold text-white/85">{label}</div>
        {hint && (
          <div className="mt-[0.2cqw] text-[0.95cqw] leading-snug text-white/35">{hint}</div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function SettingsModal({
  settings,
  setSettings,
  color,
  onClose,
  onResetAuto,
  owned = [],
  onShop,
  onCalibrate,
}: {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  color: string;
  onClose: () => void;
  /** 상점에서 산 물건 (테마 스킨 ref) — 안 산 스킨은 자물쇠, 누르면 상점으로 */
  owned?: string[];
  onShop?: () => void;
  /** 싱크 맞추기 켜짐/꺼짐 — 그동안 메뉴 배경음·미리 듣기를 멈추게 */
  onCalibrate?: (on: boolean) => void;
  /** 자동 싱크(치는 동안 쌓인 값)를 지움 */
  onResetAuto?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("play");
  const [autoCleared, setAutoCleared] = useState(false);
  // 싱크 탭: 들으면서 맞추기 (박자 소리 + 떨어지는 노트)
  const [calibrate, setCalibrate] = useState(false);
  const set = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));
  const close = () => {
    sfx("ui-back", 0.7);
    onClose();
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  // 싱크 맞추기 오버레이가 떠 있을 때의 키: Esc·S는 오버레이만 닫고, ← →는 싱크 ±5ms
  const calRef = useRef(calibrate);
  useEffect(() => {
    calRef.current = calibrate;
  }, [calibrate]);
  const onCalRef = useRef(onCalibrate);
  useEffect(() => {
    onCalRef.current = onCalibrate;
  });
  useEffect(() => {
    onCalRef.current?.(calibrate);
  }, [calibrate]);
  // 설정 창이 닫히면(싱크 맞추기 중이었어도) 배경음 다시
  useEffect(() => () => onCalRef.current?.(false), []);
  // 키 바꾸기: 레인 칸을 누르면 다음에 누른 키가 그 레인 키 (Esc 취소, 이미 쓰는 키면 두 레인을 맞바꿈)
  const [bind, setBind] = useState<number | null>(null);
  const bindRef = useRef(bind);
  useEffect(() => {
    bindRef.current = tab === "play" ? bind : null;
  }, [bind, tab]);
  useEffect(() => {
    sfx("ui-open", 0.7);
    const onKey = (e: KeyboardEvent) => {
      const b = bindRef.current;
      if (b !== null) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        if (e.code === "Escape") {
          setBind(null);
          sfx("ui-back", 0.6);
          return;
        }
        if (!e.code || KEY_RESERVED.has(e.code)) return;
        setSettings((st) => {
          const keys = [...st.keys];
          const other = keys.indexOf(e.code);
          if (other >= 0) keys[other] = keys[b];
          keys[b] = e.code;
          return { ...st, keys };
        });
        setBind(null);
        // 스페이스 · 엔터로 정했을 때 눌린 버튼이 다시 눌리지 않게
        (document.activeElement as HTMLElement | null)?.blur?.();
        sfx("ui-move", 0.6);
        return;
      }
      if ((e.target as HTMLElement)?.closest?.("input[type=text], textarea")) return;
      if (calRef.current) {
        if (e.code === "Escape" || e.code === "KeyS") {
          e.preventDefault();
          e.stopPropagation();
          setCalibrate(false);
          sfx("ui-back", 0.7);
        } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          const d = e.code === "ArrowLeft" ? -5 : 5;
          setSettings((st) => ({ ...st, sync: Math.max(-400, Math.min(400, st.sync + d)) }));
        }
        return;
      }
      if (e.code === "Escape" || e.code === "KeyS") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.code === "Tab" || e.code === "ArrowLeft" || e.code === "ArrowRight") {
        if ((e.target as HTMLElement)?.closest?.("input[type=range]")) return;
        e.preventDefault();
        const dir = e.code === "ArrowLeft" || (e.code === "Tab" && e.shiftKey) ? -1 : 1;
        setTab(
          (t) => TABS[(TABS.findIndex((x) => x.key === t) + dir + TABS.length) % TABS.length].key
        );
        sfx("ui-move", 0.6);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // setSettings는 부모 useState의 setter라 안 바뀜
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center pru-dither bg-[#0c0718]/60 [animation:modal-fade_180ms_steps(5)]"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className={`${calibrate ? "invisible" : ""} relative flex h-[46cqw] w-[74cqw] flex-col overflow-hidden pru-win [--wf:#150e29f5] [animation:modal-pop_220ms_steps(5)]`}
      >
        <div
          className="absolute top-0 left-[2cqw] h-[0.3cqw] w-[8cqw]"
          style={{ background: color }}
        />
        {/* 머리: 제목 + 탭 */}
        <div className="flex items-end justify-between gap-[2cqw] px-[2.4cqw] pt-[1.8cqw]">
          <div className="pru-t text-[2.6cqw] leading-none font-bold tracking-[0.08em] text-white ">
            SETTINGS
          </div>
          <button
            type="button"
            onClick={close}
            className="pru-btn cursor-pointer px-[1cqw] py-[0.3cqw] text-[1.05cqw] text-white"
          >
            닫기 (Esc)
          </button>
        </div>
        <div className="mt-[1.2cqw] flex gap-[0.4cqw] border-b border-white/10 px-[2.4cqw]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                sfx("ui-move", 0.6);
              }}
              className={`-mb-px cursor-pointer border-b-[0.25cqw] px-[1.4cqw] pb-[0.6cqw] transition-colors ${
                tab === t.key
                  ? "border-[var(--gold)] text-[var(--gold)]"
                  : "border-transparent text-white/40 hover:text-white/75"
              }`}
            >
              <div className="font-mono text-[0.85cqw] tracking-[0.2em]">{t.en}</div>
              <div className=" text-[1.35cqw] font-bold">{t.label}</div>
            </button>
          ))}
        </div>

        <div className="bd-scroll min-h-0 flex-1 overflow-y-auto px-[2.4cqw] py-[0.6cqw]">
          {tab === "play" && (
            <>
              <Row label="노트 속도" hint="플레이 중 ↑ ↓ 로도 바꿀 수 있어요">
                <div className="flex items-center gap-[0.8cqw]">
                  <button
                    type="button"
                    className={stepBtn}
                    onClick={() =>
                      set({ speed: clamp(Math.round((settings.speed - 0.5) * 10) / 10, 1, 8) })
                    }
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    step={0.1}
                    value={settings.speed}
                    onChange={(e) => set({ speed: Number(e.target.value) })}
                    className={range}
                  />
                  <button
                    type="button"
                    className={stepBtn}
                    onClick={() =>
                      set({ speed: clamp(Math.round((settings.speed + 0.5) * 10) / 10, 1, 8) })
                    }
                  >
                    +
                  </button>
                  <span className="w-[5cqw] text-right font-mono text-[1.5cqw] font-bold text-white">
                    x{settings.speed.toFixed(1)}
                  </span>
                </div>
              </Row>
              <Row
                label="키"
                hint={
                  bind !== null
                    ? "바꿀 키를 누르세요 — Esc 는 취소"
                    : "칸을 누르고 원하는 키 입력 · 겹치면 서로 바뀌어요"
                }
              >
                <div className="flex flex-wrap items-center gap-[0.6cqw]">
                  {settings.keys.map((k, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setBind(bind === i ? null : i);
                        sfx("ui-move", 0.5);
                      }}
                      className={`${chip(bind === i)} min-w-[4.6cqw] text-center font-mono`}
                    >
                      {bind === i ? "…" : keyLabel(k)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={chip(false)}
                    disabled={settings.keys.join() === KEY_CODES.join()}
                    onClick={() => {
                      setBind(null);
                      set({ keys: [...KEY_CODES] });
                    }}
                  >
                    기본 (D F J K)
                  </button>
                </div>
              </Row>
              <Row label="레인 위치" hint="치는 화면을 어디에 둘지">
                <div className="flex gap-[1cqw]">
                  {FIELD_POS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => set({ field: f.key })}
                      className={`${chip(settings.field === f.key)} flex flex-col items-center gap-[0.4cqw] px-[0.8cqw] py-[0.6cqw]`}
                    >
                      <FieldIcon pos={f.key} on={settings.field === f.key} />
                      {f.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row
                label="노트 스킨"
                hint={
                  SKINS.some((k) => k.shop)
                    ? "🔒 테마 스킨은 상점에서 — 레인 틀 · 무대까지 바뀌어요"
                    : undefined
                }
              >
                <div className="grid grid-cols-6 gap-[0.7cqw]">
                  {SKINS.map((k) => {
                    const locked = !!k.shop && !owned.includes(k.shop);
                    return (
                      <button
                        key={k.key}
                        type="button"
                        onClick={() => (locked ? onShop?.() : set({ skin: k.key }))}
                        title={locked ? "상점에서 사면 쓸 수 있어요" : undefined}
                        className={`relative cursor-pointer overflow-hidden rounded-[0.6cqw] border transition-colors ${
                          settings.skin === k.key && !locked
                            ? "border-[#A78BFA] bg-[#A78BFA]/15"
                            : k.shop
                              ? "border-[#F5C842]/40 hover:border-[#F5C842]"
                              : "border-white/10 hover:border-white/30"
                        }`}
                      >
                        <SkinPreview skin={k.key} color={color} size={settings.noteSize} />
                        <div
                          className={`truncate px-[0.3cqw] pb-[0.3cqw] font-mono text-[0.95cqw] ${k.shop ? "text-[#FDE68A]" : "text-white/65"}`}
                        >
                          {locked ? "🔒 " : ""}
                          {k.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Row>
              <Row label="노트 두께">
                <div className="flex flex-wrap gap-[0.6cqw]">
                  {NOTE_SIZES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => set({ noteSize: m.key })}
                      className={chip(settings.noteSize === m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row
                label="레인 배치"
                hint={LANE_MODS.find((m) => m.key === settings.lanes)!.desc || undefined}
              >
                <div className="flex flex-wrap gap-[0.6cqw]">
                  {LANE_MODS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => set({ lanes: m.key })}
                      className={chip(settings.lanes === m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row
                label="노트 가림"
                hint={COVERS_OPT.find((m) => m.key === settings.cover)!.desc || undefined}
              >
                <div className="flex flex-wrap gap-[0.6cqw]">
                  {COVERS_OPT.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => set({ cover: m.key })}
                      className={chip(settings.cover === m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row
                label="배경"
                hint={BG_MODES.find((m) => m.key === settings.bg)!.desc || undefined}
              >
                <div className="flex flex-wrap gap-[0.6cqw]">
                  {BG_MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => set({ bg: m.key })}
                      className={chip(settings.bg === m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row
                label="프레임"
                hint={FPS_MODES.find((m) => m.key === settings.fps)!.desc || undefined}
              >
                <div className="flex flex-wrap gap-[0.6cqw]">
                  {FPS_MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => set({ fps: m.key })}
                      className={chip(settings.fps === m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </Row>
            </>
          )}

          {tab === "sync" && (
            <>
              <SyncRow
                label="싱크"
                hint="노트가 소리보다 먼저 오면 +, 늦게 오면 −"
                value={settings.sync}
                disabled={false}
                onChange={(v) => set({ sync: v })}
              />
              <div className="flex items-center justify-between gap-[1cqw] py-[1cqw]">
                <p className=" text-[1cqw] leading-relaxed text-white/40">
                  치는 타이밍은 플레이 중에 시스템이 알아서 맞춰요(자동 싱크). 그래도 노트와 소리가
                  어긋나 보이면 여기서 직접 맞추세요 — 자동 싱크 위에 더해져요.
                </p>
                <button
                  type="button"
                  className={chip(calibrate)}
                  onClick={() => {
                    setCalibrate(!calibrate);
                    sfx("ui-move", 0.5);
                  }}
                >
                  🎧 들으면서 맞추기
                </button>
                <button
                  type="button"
                  className={chip(false)}
                  disabled={settings.sync === 0}
                  onClick={() => set({ sync: 0 })}
                >
                  초기화
                </button>
              </div>
              {onResetAuto && (
                <div className="flex items-center justify-between gap-[1cqw] border-t border-white/[0.06] py-[1cqw]">
                  <p className=" text-[1cqw] leading-relaxed text-white/40">
                    이어폰을 바꿨거나 판정이 예전보다 어긋나는 느낌이면 자동 싱크를 처음부터 다시
                    맞추게 하세요.
                  </p>
                  <button
                    type="button"
                    className={chip(false)}
                    disabled={autoCleared}
                    onClick={() => {
                      onResetAuto();
                      setAutoCleared(true);
                      sfx("ui-move", 0.5);
                    }}
                  >
                    {autoCleared ? "초기화됨" : "자동 싱크 초기화"}
                  </button>
                </div>
              )}
            </>
          )}

          {tab === "sound" && (
            <>
              <VolRow label="음악" value={settings.music} onChange={(v) => set({ music: v })} />
              <VolRow
                label="효과음"
                hint="메뉴·콤보·결과 연출"
                value={settings.sfx}
                onChange={(v) => set({ sfx: v })}
                onCommit={() => sfx("ui-select")}
              />
              <VolRow
                label="타격음"
                hint="키를 누를 때 나는 소리"
                value={settings.hit}
                onChange={(v) => set({ hit: v })}
                onCommit={() => previewHit(settings.hitSound, settings.hit)}
              />
              <Row label="타격음 종류">
                <div className="flex flex-wrap gap-[0.6cqw]">
                  {HIT_SOUNDS.map((h) => (
                    <button
                      key={h.key}
                      type="button"
                      className={chip(settings.hitSound === h.key)}
                      onClick={() => {
                        set({ hitSound: h.key, hit: settings.hit || 1 });
                        previewHit(h.key, settings.hit || 1);
                      }}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </Row>
            </>
          )}
        </div>
        <div className="border-t border-white/10 px-[2.4cqw] py-[0.8cqw] font-mono text-[0.95cqw] text-white/35">
          ← → 탭 · Esc 닫기 · 바꾼 설정은 바로 저장돼요
        </div>
      </div>
      {calibrate && (
        <SyncCalibrate
          sync={settings.sync}
          onSync={(v) => set({ sync: v })}
          onClose={() => {
            setCalibrate(false);
            sfx("ui-back", 0.7);
          }}
          speed={settings.speed}
          skin={canWear(settings.skin, owned) ? settings.skin : "metal"}
        />
      )}
    </div>
  );
}

function SyncRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-[0.8cqw]">
        <HoldButton
          className={stepBtn}
          disabled={disabled}
          onStep={() => onChange(clamp(value - 1, -400, 400))}
        >
          −
        </HoldButton>
        <input
          type="range"
          min={-400}
          max={400}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className={range}
        />
        <HoldButton
          className={stepBtn}
          disabled={disabled}
          onStep={() => onChange(clamp(value + 1, -400, 400))}
        >
          +
        </HoldButton>
        <span className="w-[6cqw] text-right font-mono text-[1.4cqw] font-bold text-white">
          {signed(value)}ms
        </span>
      </div>
    </Row>
  );
}

function VolRow({
  label,
  hint,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-[0.8cqw]">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onCommit}
          className={range}
        />
        <span className="w-[5cqw] text-right font-mono text-[1.4cqw] font-bold text-white">
          {value === 0 ? "끔" : Math.round(value * 100)}
        </span>
      </div>
    </Row>
  );
}

/** 레인 위치 고르기 아이콘: 16:9 화면 안에 레인이 놓이는 자리 */
function FieldIcon({ pos, on }: { pos: FieldPos; on: boolean }) {
  const x = pos === "left" ? 4 : pos === "right" ? 30 : 17;
  return (
    <svg viewBox="0 0 48 27" className="h-[3.4cqw] w-[6cqw]">
      <rect
        x="0.5"
        y="0.5"
        width="47"
        height="26"
        rx="2"
        fill="#0b0a1c"
        stroke="rgba(255,255,255,0.25)"
      />
      <rect
        x={x}
        y="2"
        width="14"
        height="23"
        rx="1"
        fill={on ? "#A78BFA" : "rgba(255,255,255,0.35)"}
      />
      {[1, 2, 3].map((i) => (
        <rect
          key={i}
          x={x + i * 3.5 - 0.25}
          y="2"
          width="0.5"
          height="20"
          fill="#0b0a1c"
          opacity="0.6"
        />
      ))}
      <rect x={x} y="21" width="14" height="1" fill="#fff" opacity="0.8" />
    </svg>
  );
}

/** 설정에서 스킨 고를 때 보이는 작은 미리보기 (레인 4개 + 노트) */
function SkinPreview({ skin, color, size }: { skin: Skin; color: string; size: NoteSize }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = 96;
    const H = 60;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#07061a";
    g.fillRect(0, 0, W, H);
    const lw = W / 4;
    const cols = laneColors(skin, color);
    const judgeY = H - 10;
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillRect(0, judgeY - 0.5, W, 1);
    g.save();
    g.scale(0.5, 0.5);
    const ys = [18, 44, 30, 8];
    setNoteSize(size);
    for (let l = 0; l < 4; l++) drawHead(g, skin, l * lw * 2, ys[l] * 2, lw * 2, cols[l]);
    g.restore();
  }, [skin, color, size]);
  return <canvas ref={ref} className="block h-auto w-full" />;
}
