"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  drawHead,
  HIT_SOUNDS,
  laneColors,
  makeHitSound,
  NOTE_SIZES,
  setNoteSize,
  SKINS,
  type HitSound,
  type NoteSize,
  type Skin,
} from "@/lib/rhythm/fx";
import { audio, sfx } from "@/lib/rhythm/sfx";
import HoldButton from "./HoldButton";
import { COVERS_OPT, FIELD_POS, type Cover, type FieldPos } from "./Stage";

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
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 타격음 미리 듣기 (종류별로 한 번만 만들어 둠)
const hitCache = new Map<HitSound, AudioBuffer>();
async function previewHit(kind: HitSound, volume: number) {
  if (volume <= 0) return;
  try {
    const ctx = await audio();
    if (!hitCache.has(kind)) hitCache.set(kind, makeHitSound(ctx, kind));
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume * 0.9;
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
  `cursor-pointer rounded-[0.6cqw] border px-[1.1cqw] py-[0.45cqw] font-['Nanum_Gothic',sans-serif] text-[1.15cqw] font-bold whitespace-nowrap transition-colors ${
    on
      ? "border-[#A78BFA] bg-[#A78BFA]/25 text-white shadow-[0_0_1cqw_rgba(167,139,250,0.35)]"
      : "border-white/10 bg-white/[0.04] text-white/60 hover:border-white/30 hover:text-white"
  }`;
const stepBtn =
  "h-[2.4cqw] w-[2.4cqw] shrink-0 cursor-pointer rounded-full border border-white/15 font-mono text-[1.3cqw] text-white/75 hover:border-[#A78BFA] hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
const range = "min-w-0 flex-1 accent-[#A78BFA] disabled:opacity-40";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[13cqw_1fr] items-center gap-x-[1.4cqw] border-b border-white/[0.06] py-[0.9cqw] last:border-b-0">
      <div>
        <div className="font-['Nanum_Gothic',sans-serif] text-[1.3cqw] font-bold text-white/85">
          {label}
        </div>
        {hint && (
          <div className="mt-[0.2cqw] font-['Nanum_Gothic',sans-serif] text-[0.95cqw] leading-snug text-white/35">
            {hint}
          </div>
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
}: {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  color: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("play");
  const set = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));
  const close = () => {
    sfx("ui-back", 0.7);
    onClose();
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    sfx("ui-open", 0.7);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input[type=text], textarea")) return;
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
  }, []);

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#05030f]/70 backdrop-blur-[3px] [animation:modal-fade_180ms_ease-out]"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="relative flex h-[46cqw] w-[74cqw] flex-col overflow-hidden rounded-[1.4cqw] border border-white/15 bg-[linear-gradient(160deg,#171431f2,#0b0a1cf5)] shadow-[0_0_4cqw_rgba(108,99,255,0.35)] [animation:modal-pop_220ms_ease-out]">
        <div
          className="absolute top-0 left-[2cqw] h-[0.3cqw] w-[8cqw]"
          style={{ background: color }}
        />
        {/* 머리: 제목 + 탭 */}
        <div className="flex items-end justify-between gap-[2cqw] px-[2.4cqw] pt-[1.8cqw]">
          <div className="font-['Arial_Black','Segoe_UI_Black',sans-serif] text-[2.6cqw] leading-none font-black tracking-[0.08em] text-white italic">
            SETTINGS
          </div>
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-[0.6cqw] border border-white/15 px-[1cqw] py-[0.35cqw] font-mono text-[1.1cqw] text-white/60 hover:border-white/40 hover:text-white"
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
                  ? "border-[#A78BFA] text-white"
                  : "border-transparent text-white/40 hover:text-white/75"
              }`}
            >
              <div className="font-mono text-[0.85cqw] tracking-[0.2em]">{t.en}</div>
              <div className="font-['Nanum_Gothic',sans-serif] text-[1.35cqw] font-bold">
                {t.label}
              </div>
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
              <Row label="노트 스킨">
                <div className="grid grid-cols-5 gap-[0.7cqw]">
                  {SKINS.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => set({ skin: k.key })}
                      className={`cursor-pointer overflow-hidden rounded-[0.6cqw] border transition-colors ${
                        settings.skin === k.key
                          ? "border-[#A78BFA] bg-[#A78BFA]/15"
                          : "border-white/10 hover:border-white/30"
                      }`}
                    >
                      <SkinPreview skin={k.key} color={color} size={settings.noteSize} />
                      <div className="pb-[0.3cqw] font-mono text-[0.95cqw] text-white/65">
                        {k.label}
                      </div>
                    </button>
                  ))}
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
                <p className="font-['Nanum_Gothic',sans-serif] text-[1cqw] leading-relaxed text-white/40">
                  치는 타이밍은 플레이 중에 시스템이 알아서 맞춰요(자동 싱크). 그래도 노트와 소리가
                  어긋나 보이면 여기서 직접 맞추세요 — 자동 싱크 위에 더해져요.
                </p>
                <button
                  type="button"
                  className={chip(false)}
                  disabled={settings.sync === 0}
                  onClick={() => set({ sync: 0 })}
                >
                  초기화
                </button>
              </div>
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
                        set({ hitSound: h.key, hit: settings.hit || 0.3 });
                        previewHit(h.key, settings.hit || 0.3);
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
