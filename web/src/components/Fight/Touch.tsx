/**
 * 휴대폰 조작 — 화면 위에 겹쳐 그리는 터치 버튼 (전체화면에서도 누를 수 있게 .fs-screen 안에 그림).
 * 이동은 두 가지: 스틱(왼쪽 아무 데나 대고 끌기) / 키(◀ ▼ ▶ 버튼). 오른쪽엔 점프·J·K·L·I·잡기.
 * 크기는 cqw(판 너비 기준)라서 전체화면·작은 화면 모두 같은 비율.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { IN } from "@/lib/fight/sim";
import type { FightInput } from "./input";

export type MoveMode = "stick" | "keys";
const MODE_KEY = "fight:touch-mode";

export function loadMoveMode(): MoveMode {
  try {
    return localStorage.getItem(MODE_KEY) === "keys" ? "keys" : "stick";
  } catch {
    return "stick";
  }
}
export function saveMoveMode(m: MoveMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {}
}

/** 손가락(pointer)마다 누른 비트를 모아서 input에 넘김 */
function useTouchBits(input: FightInput) {
  const held = useRef(new Map<number, number>());
  const set = useCallback(
    (pointer: number, bits: number) => {
      if (bits) held.current.set(pointer, bits);
      else held.current.delete(pointer);
      let v = 0;
      held.current.forEach((b) => (v |= b));
      input.setTouch(v);
    },
    [input]
  );
  useEffect(
    () => () => {
      held.current.clear();
      input.setTouch(0);
    },
    [input]
  );
  return set;
}

const BTN: CSSProperties = {
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
  border: "0.25cqw solid rgba(255,255,255,0.45)",
  color: "#fff",
  fontFamily: "'Black Han Sans', 'Nanum Gothic', sans-serif",
  lineHeight: 1,
  userSelect: "none",
  WebkitUserSelect: "none",
  touchAction: "none",
  pointerEvents: "auto",
  WebkitTapHighlightColor: "transparent",
};

function Btn({
  bits,
  onBits,
  style,
  color = "255,255,255",
  children,
  sub,
  fontSize = "2.4cqw",
}: {
  bits: number;
  onBits: (pointer: number, bits: number) => void;
  style: CSSProperties;
  color?: string;
  children: ReactNode;
  sub?: string;
  fontSize?: string;
}) {
  const [down, setDown] = useState(false);
  const up = (e: React.PointerEvent) => {
    setDown(false);
    onBits(e.pointerId, 0);
  };
  return (
    <div
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDown(true);
        onBits(e.pointerId, bits);
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        ...BTN,
        background: down ? `rgba(${color},0.55)` : `rgba(${color},0.16)`,
        borderColor: down ? "#fff" : `rgba(${color},0.6)`,
        transform: down ? "scale(0.94)" : undefined,
        boxShadow: "0 0.3cqw 0.8cqw rgba(0,0,0,0.45)",
        ...style,
      }}
    >
      <span style={{ fontSize, textShadow: "0 0.15cqw 0 #000" }}>{children}</span>
      {sub && (
        <span style={{ marginTop: "0.3cqw", fontSize: "1.05cqw", opacity: 0.85 }}>{sub}</span>
      )}
    </div>
  );
}

/** 스틱: 왼쪽 영역 아무 데나 대면 거기가 중심, 끄는 방향으로 이동(아래 = 가드, 위 = 점프) */
function Stick({ onBits }: { onBits: (pointer: number, bits: number) => void }) {
  const zone = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<{
    id: number;
    cx: number;
    cy: number;
    dx: number;
    dy: number;
  } | null>(null);
  const R = 0.075; // 반지름 (판 너비 비율)
  const calc = (id: number, cx: number, cy: number, x: number, y: number) => {
    const w = zone.current?.parentElement?.clientWidth ?? 800;
    const r = w * R;
    let dx = (x - cx) / r;
    let dy = (y - cy) / r;
    const len = Math.hypot(dx, dy);
    if (len > 1) ((dx /= len), (dy /= len));
    let b = 0;
    if (dx > 0.4) b |= IN.R;
    else if (dx < -0.4) b |= IN.L;
    if (dy < -0.6) b |= IN.U;
    else if (dy > 0.6) b |= IN.D;
    onBits(id, b);
    setSt({ id, cx, cy, dx, dy });
  };
  const local = (e: React.PointerEvent) => {
    const r = zone.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const end = (e: React.PointerEvent) => {
    if (st && e.pointerId !== st.id) return;
    onBits(e.pointerId, 0);
    setSt(null);
  };
  return (
    <div
      ref={zone}
      onPointerDown={(e) => {
        if (st) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const [x, y] = local(e);
        calc(e.pointerId, x, y, x, y);
      }}
      onPointerMove={(e) => {
        if (!st || e.pointerId !== st.id) return;
        const [x, y] = local(e);
        calc(st.id, st.cx, st.cy, x, y);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width: "38%",
        height: "62%",
        touchAction: "none",
        pointerEvents: "auto",
      }}
    >
      {(() => {
        // 손을 안 대고 있을 땐 기본 자리에 흐리게
        const base: CSSProperties = st ? { left: st.cx, top: st.cy } : { left: "34%", top: "66%" };
        return (
          <div
            style={{
              position: "absolute",
              ...base,
              width: `${R * 200}cqw`,
              height: `${R * 200}cqw`,
              transform: "translate(-50%,-50%)",
              borderRadius: "50%",
              border: "0.25cqw solid rgba(255,255,255,0.4)",
              background: "radial-gradient(circle, rgba(255,255,255,0.08), rgba(0,0,0,0.25))",
              opacity: st ? 1 : 0.6,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: `${50 + (st?.dx ?? 0) * 50}%`,
                top: `${50 + (st?.dy ?? 0) * 50}%`,
                width: "44%",
                height: "44%",
                transform: "translate(-50%,-50%)",
                borderRadius: "50%",
                background: "radial-gradient(circle at 40% 35%, #fff, #B9B4FF 60%, #6C63FF)",
                boxShadow: "0 0.3cqw 0.8cqw rgba(0,0,0,0.5)",
              }}
            />
          </div>
        );
      })()}
    </div>
  );
}

export default function TouchControls({
  input,
  mode,
  onMode,
  onPause,
}: {
  input: FightInput;
  mode: MoveMode;
  onMode: (m: MoveMode) => void;
  onPause: () => void;
}) {
  const onBits = useTouchBits(input);
  const s = (x: number) => `${x}cqw`;
  const sq = (size: number, extra: CSSProperties): CSSProperties => ({
    width: s(size),
    height: s(size),
    ...extra,
  });
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" }}>
      {/* 왼쪽: 이동 */}
      {mode === "stick" ? (
        <Stick onBits={onBits} />
      ) : (
        <>
          <Btn
            bits={IN.L}
            onBits={onBits}
            style={sq(10, { left: s(2.5), bottom: s(7), borderRadius: "1.6cqw" })}
          >
            ◀
          </Btn>
          <Btn
            bits={IN.R}
            onBits={onBits}
            style={sq(10, { left: s(23.5), bottom: s(7), borderRadius: "1.6cqw" })}
          >
            ▶
          </Btn>
          <Btn
            bits={IN.D}
            onBits={onBits}
            style={sq(8, { left: s(14), bottom: s(1.5), borderRadius: "1.6cqw" })}
            sub="가드"
          >
            ▼
          </Btn>
          <Btn
            bits={IN.U}
            onBits={onBits}
            style={sq(8, { left: s(14), bottom: s(13.5), borderRadius: "1.6cqw" })}
          >
            ▲
          </Btn>
        </>
      )}
      {/* 오른쪽: 점프 + 공격 */}
      <Btn
        bits={IN.J}
        onBits={onBits}
        color="108,99,255"
        style={sq(11.5, { right: s(2.5), bottom: s(3) })}
        sub="점프"
      >
        ⤒
      </Btn>
      <Btn bits={IN.A} onBits={onBits} style={sq(8.5, { right: s(15.5), bottom: s(2) })} sub="약">
        J
      </Btn>
      <Btn
        bits={IN.B}
        onBits={onBits}
        style={sq(8.5, { right: s(14), bottom: s(12) })}
        sub="발차기"
      >
        K
      </Btn>
      <Btn
        bits={IN.C}
        onBits={onBits}
        color="253,224,71"
        style={sq(8.5, { right: s(3.5), bottom: s(16) })}
        sub="아이덴티티"
      >
        L
      </Btn>
      <Btn
        bits={IN.X}
        onBits={onBits}
        color="34,211,238"
        style={sq(7, { right: s(24.5), bottom: s(11.5) })}
        sub="필살기"
      >
        I
      </Btn>
      <Btn
        bits={IN.A | IN.B}
        onBits={onBits}
        style={sq(6.5, { right: s(25.5), bottom: s(2) })}
        sub="잡기"
        fontSize="1.6cqw"
      >
        J+K
      </Btn>
      {/* 위 가운데 아래: 일시정지 · 이동 방식 바꾸기 */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: s(1.2),
          transform: "translateX(-50%)",
          display: "flex",
          gap: s(0.8),
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          onClick={onPause}
          style={{
            cursor: "pointer",
            border: 0,
            borderRadius: s(0.8),
            padding: `${s(0.5)} ${s(1.2)}`,
            background: "rgba(0,0,0,0.55)",
            color: "rgba(255,255,255,0.85)",
            fontSize: s(1.5),
          }}
        >
          ⏸
        </button>
        <button
          type="button"
          onClick={() => onMode(mode === "stick" ? "keys" : "stick")}
          style={{
            cursor: "pointer",
            border: 0,
            borderRadius: s(0.8),
            padding: `${s(0.5)} ${s(1.2)}`,
            background: "rgba(0,0,0,0.55)",
            color: "rgba(255,255,255,0.85)",
            fontSize: s(1.3),
            fontFamily: "'Nanum Gothic', sans-serif",
            fontWeight: 800,
          }}
        >
          {mode === "stick" ? "🕹 스틱 → 키" : "⌨ 키 → 스틱"}
        </button>
      </div>
    </div>
  );
}
