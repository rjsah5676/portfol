/**
 * 격투 대전 HUD — 위: 얼굴·체력·이름 / 가운데 시계·라운드 승수 / 아래: 필살기 게이지·아이덴티티 대기
 * 그리고 라운드·FIGHT·K.O.·승리 배너, 콤보 수, 최종 승리 대사.
 * 그림 파일 없이 CSS로만 그림 (금테 + 짙은 보라 판, 비스듬한 모양). 크기는 전부 cqw(판 너비 기준).
 */
import type { CSSProperties, ReactNode } from "react";
import { CHARS } from "@/lib/fight/chars";
import { METER_MAX, ROUND_SEC, WINS_NEEDED } from "@/lib/fight/sim";
import { KeyCap } from "./KeyCap";

export const HUD_FONT = "'Black Han Sans', 'Nanum Gothic', sans-serif";
const MONO = "'JetBrains Mono', monospace";

export const GOLD = "linear-gradient(180deg, #FFF4C2 0%, #F2C35B 45%, #9A6A1E 100%)";
export const PANEL = "linear-gradient(180deg, #2B1840 0%, #140A22 100%)";
export const INK = "#12081F";

/** 애니메이션 (전역 CSS 안 건드리고 HUD 안에서만) */
export const HUD_CSS = `
@keyframes hud-band { from { transform: scaleY(0); opacity: 0 } to { transform: scaleY(1); opacity: 1 } }
@keyframes hud-word { 0% { transform: scale(2.2) skewX(-8deg); opacity: 0; filter: blur(0.6cqw) }
  60% { transform: scale(0.94) skewX(-8deg); opacity: 1; filter: blur(0) } 100% { transform: scale(1) skewX(-8deg) } }
@keyframes hud-shake { 0%,100% { translate: 0 0 } 20% { translate: -0.6cqw 0.3cqw } 40% { translate: 0.5cqw -0.3cqw }
  60% { translate: -0.3cqw 0.2cqw } 80% { translate: 0.2cqw 0 } }
@keyframes hud-sweep { from { left: -40% } to { left: 110% } }
@keyframes hud-pulse { 50% { opacity: 0.55 } }
@keyframes hud-pop { 0% { transform: scale(1.6) skewX(-10deg); opacity: 0 } 100% { transform: scale(1) skewX(-10deg); opacity: 1 } }
@keyframes hud-rise { from { opacity: 0; transform: translateY(1.5cqw) } }
`;

/** 금테 두른 모양: 바깥은 금색, 안쪽은 같은 모양으로 한 겹 안 */
export function Trim({
  clip,
  pad = "0.22cqw",
  style,
  inner,
  children,
}: {
  clip: string;
  pad?: string;
  style?: CSSProperties;
  inner?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        clipPath: clip,
        background: GOLD,
        padding: pad,
        filter: "drop-shadow(0 0.3cqw 0 rgba(0,0,0,0.55))",
        ...style,
      }}
    >
      <div
        style={{
          clipPath: clip,
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          ...inner,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 글자: 그라데이션 채움 + 짙은 테두리 + 아래 그림자 */
export function Gtext({
  children,
  grad,
  size,
  stroke = "0.22cqw",
  shadow = "0.35cqw",
  style,
}: {
  children: ReactNode;
  grad: string;
  size: string;
  stroke?: string;
  shadow?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: HUD_FONT,
        fontSize: size,
        lineHeight: 1,
        backgroundImage: grad,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextStroke: `${stroke} ${INK}`,
        paintOrder: "stroke fill",
        filter: `drop-shadow(0 ${shadow} 0 ${INK})`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

const hpFill = (hp: number) =>
  hp > 0.5
    ? "linear-gradient(180deg, #FFF7B0 0%, #FFD23F 40%, #F59E0B 75%, #C2610C 100%)"
    : hp > 0.25
      ? "linear-gradient(180deg, #FFE0A0 0%, #FF9F2E 45%, #E0560F 100%)"
      : "linear-gradient(180deg, #FFB3C0 0%, #FF3B5C 45%, #A3082A 100%)";

/** 위쪽 한 선수: 얼굴(비스듬한 금테) · 체력 막대 · 이름판. right면 거울처럼 */
export function PlayerTop({
  ch,
  hp,
  tag,
  right,
}: {
  ch: number;
  hp: number;
  tag: string;
  right?: boolean;
}) {
  const c = CHARS[ch];
  const mir: CSSProperties = right ? { transform: "scaleX(-1)" } : {};
  const barClip = "polygon(0 0, 100% 0, calc(100% - 1.6cqw) 100%, 0 100%)";
  const faceClip = "polygon(0 0, 100% 0, 82% 100%, 0 100%)";
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0, height: "8.4cqw", ...mir }}>
      {/* 체력 막대 (얼굴 오른쪽 아래에서 시계 쪽으로) */}
      <Trim
        clip={barClip}
        style={{ position: "absolute", left: "6.2cqw", right: 0, top: "0.9cqw", height: "3.4cqw" }}
        inner={{ background: "linear-gradient(180deg, #0C0614, #2A1030)" }}
      >
        {/* 깎인 만큼 남는 붉은 잔상 (천천히 줄어듦) */}
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: `${hp * 100}%`,
            background: "linear-gradient(180deg, #FFD0D8, #E11D48)",
            transition: "width 800ms ease-in 300ms",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: `${hp * 100}%`,
            background: hpFill(hp),
            animation: hp <= 0.25 && hp > 0 ? "hud-pulse 0.7s ease-in-out infinite" : undefined,
          }}
        />
        {/* 윗면 광택 */}
        <div
          style={{
            position: "absolute",
            inset: "0 0 58% 0",
            background: "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.08))",
          }}
        />
      </Trim>
      {/* 이름판 */}
      <div
        style={{
          position: "absolute",
          left: "6.6cqw",
          top: "4.75cqw",
          display: "flex",
          alignItems: "center",
          gap: "0.8cqw",
          padding: "0.35cqw 2.2cqw 0.35cqw 1.6cqw",
          clipPath: "polygon(0 0, 100% 0, calc(100% - 1cqw) 100%, 0 100%)",
          background: `linear-gradient(90deg, ${c.color}CC 0 0.45cqw, rgba(18,8,31,0.88) 0.45cqw 70%, rgba(18,8,31,0))`,
        }}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: "0.8cqw", ...mir }}>
          <Gtext
            grad={`linear-gradient(180deg, #FFFFFF 30%, ${c.color})`}
            size="2cqw"
            stroke="0.16cqw"
            shadow="0.18cqw"
          >
            {c.name}
          </Gtext>
          <span
            style={{
              fontFamily: MONO,
              fontSize: "1cqw",
              fontWeight: 700,
              color: "rgba(255,255,255,0.6)",
              letterSpacing: "0.1em",
            }}
          >
            {tag}
          </span>
        </span>
      </div>
      {/* 얼굴 */}
      <Trim
        clip={faceClip}
        pad="0.28cqw"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "8cqw",
          height: "7.4cqw",
          zIndex: 1,
        }}
        inner={{ background: `radial-gradient(circle at 40% 35%, ${c.color}, #1A0B2A 75%)` }}
      >
        <img
          src={`/fight/art/${c.id}-face.webp`}
          alt={c.name}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            imageRendering: "pixelated",
            ...mir,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(160deg, rgba(255,255,255,0.25), transparent 40%)",
          }}
        />
      </Trim>
    </div>
  );
}

/** 가운데: 남은 시간 + 라운드 + 양쪽 승수 보석 */
export function TimerBox({
  sec,
  round,
  wins,
  hurry,
}: {
  sec: number;
  round: number;
  wins: [number, number];
  hurry: boolean;
}) {
  const clip = "polygon(18% 0, 82% 0, 100% 22%, 100% 70%, 50% 100%, 0 70%, 0 22%)";
  const gem = (on: boolean, k: number) => (
    <span
      key={k}
      style={{
        width: "1.15cqw",
        height: "1.15cqw",
        transform: "rotate(45deg)",
        border: "0.16cqw solid #F2C35B",
        background: on
          ? "radial-gradient(circle at 35% 35%, #FFF8D6, #FFC93C 55%, #B7791F)"
          : "rgba(18,8,31,0.8)",
        boxShadow: on ? "0 0 0.8cqw rgba(255,201,60,0.9)" : "none",
      }}
    />
  );
  return (
    <div
      style={{
        width: "8.4cqw",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5cqw",
      }}
    >
      <Trim
        clip={clip}
        pad="0.26cqw"
        style={{ width: "8.4cqw", height: "7.2cqw" }}
        inner={{ background: PANEL }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: "0.7cqw",
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: "0.85cqw",
              fontWeight: 800,
              letterSpacing: "0.25em",
              color: "#F2C35B",
            }}
          >
            ROUND {round}
          </span>
          <Gtext
            grad={
              hurry
                ? "linear-gradient(180deg, #FFE4E8, #FF3B5C)"
                : "linear-gradient(180deg, #FFFFFF 35%, #FFD98A)"
            }
            size="3.7cqw"
            stroke="0.18cqw"
            shadow="0.25cqw"
            style={{
              marginTop: "0.2cqw",
              animation: hurry ? "hud-pulse 1s steps(2) infinite" : undefined,
            }}
          >
            {Math.min(ROUND_SEC, sec)}
          </Gtext>
        </div>
      </Trim>
      <div style={{ display: "flex", gap: "1.6cqw" }}>
        <span style={{ display: "flex", gap: "0.55cqw" }}>
          {Array.from({ length: WINS_NEEDED }, (_, i) => gem(i < wins[0], i))}
        </span>
        <span style={{ display: "flex", gap: "0.55cqw", flexDirection: "row-reverse" }}>
          {Array.from({ length: WINS_NEEDED }, (_, i) => gem(i < wins[1], i))}
        </span>
      </div>
    </div>
  );
}

/** 아래 한 선수: 아이덴티티(L) 대기 + 필살기(I) 게이지 */
export function PlayerBottom({
  ch,
  meter,
  cd,
  right,
}: {
  ch: number;
  meter: number;
  cd: number;
  right?: boolean;
}) {
  const c = CHARS[ch];
  const full = meter >= METER_MAX;
  const cdLeft = cd * (c.cd / 60);
  const ready = cdLeft < 0.05;
  const mir: CSSProperties = right ? { transform: "scaleX(-1)" } : {};
  const clip = "polygon(0 0, 100% 0, calc(100% - 1cqw) 100%, 0 100%)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "1cqw",
        flexDirection: right ? "row-reverse" : "row",
      }}
    >
      {/* 아이덴티티(L): 기술 아이콘 — 대기 중엔 어둡게 + 남은 만큼 가림 + 남은 초 */}
      <div
        style={{
          position: "relative",
          width: "4.4cqw",
          height: "4.4cqw",
          borderRadius: "0.7cqw",
          padding: "0.22cqw",
          background: ready ? GOLD : "linear-gradient(180deg, #6B5A80, #2B1E3A)",
          boxShadow: ready ? `0 0 1.2cqw ${c.color}` : "0 0.25cqw 0 rgba(0,0,0,0.5)",
        }}
        title={`아이덴티티 · ${c.idName}`}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: "0.5cqw",
            overflow: "hidden",
            background: `radial-gradient(circle at 40% 35%, ${c.color}, #1A0B2A 80%)`,
          }}
        >
          <img
            src={`/fight/icon/${c.id}-S.webp`}
            alt={c.idName}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: ready ? "none" : "grayscale(0.7) brightness(0.6)",
            }}
          />
          {!ready && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `conic-gradient(transparent ${(1 - cd) * 360}deg, rgba(12,6,22,0.7) 0)`,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontWeight: 800,
                  fontSize: "1.2cqw",
                  color: "#fff",
                  textShadow: `0 0.12cqw 0 ${INK}, 0 0 0.4cqw ${INK}`,
                }}
              >
                {cdLeft.toFixed(1)}
              </span>
            </div>
          )}
        </div>
        <KeyCap
          k="L"
          style={{
            position: "absolute",
            bottom: "-0.5cqw",
            [right ? "left" : "right"]: "-0.6cqw",
            fontSize: "0.9cqw",
            margin: 0,
            opacity: ready ? 1 : 0.6,
          }}
        />
      </div>
      {/* 필살기 게이지 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.35cqw",
          alignItems: right ? "flex-end" : "flex-start",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6cqw",
            flexDirection: right ? "row-reverse" : "row",
            padding: right ? "0.25cqw 0.4cqw 0.25cqw 2.4cqw" : "0.25cqw 2.4cqw 0.25cqw 0.4cqw",
            background: `linear-gradient(${right ? 270 : 90}deg, rgba(12,6,22,0.85) 60%, rgba(12,6,22,0))`,
          }}
        >
          <span
            style={{
              fontFamily: HUD_FONT,
              fontSize: "1.15cqw",
              color: ready ? "#FFE9A8" : "rgba(255,255,255,0.7)",
              textShadow: `0 0.12cqw 0 ${INK}`,
              whiteSpace: "nowrap",
            }}
          >
            {c.idName}
          </span>
          <span style={{ width: "0.15cqw", height: "1cqw", background: "rgba(255,255,255,0.3)" }} />
          {full ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4cqw",
                fontFamily: HUD_FONT,
                fontSize: "1.3cqw",
                color: "#CFFAFE",
                textShadow: `0 0 0.8cqw #22D3EE, 0 0.12cqw 0 ${INK}`,
                whiteSpace: "nowrap",
                animation: "hud-pulse 0.9s ease-in-out infinite",
              }}
            >
              {c.ultName} <KeyCap k="I" style={{ fontSize: "1cqw" }} />
            </span>
          ) : (
            <span
              style={{
                fontFamily: MONO,
                fontSize: "1.05cqw",
                fontWeight: 800,
                color: "rgba(255,255,255,0.8)",
                textShadow: `0 0.1cqw 0 ${INK}`,
              }}
            >
              SUPER {meter}%
            </span>
          )}
        </div>
        <div style={mir}>
          <Trim
            clip={clip}
            pad="0.18cqw"
            style={{
              width: "22cqw",
              height: "1.7cqw",
              background: full ? "linear-gradient(180deg, #E0FFFF, #22D3EE 50%, #0E7490)" : GOLD,
              filter: full
                ? "drop-shadow(0 0 0.9cqw rgba(34,211,238,0.95))"
                : "drop-shadow(0 0.25cqw 0 rgba(0,0,0,0.55))",
            }}
            inner={{ background: "linear-gradient(180deg, #0C0614, #1E1035)" }}
          >
            <div
              style={{
                position: "absolute",
                inset: "0 auto 0 0",
                width: `${Math.min(100, meter)}%`,
                background: full
                  ? "linear-gradient(90deg, #0EA5E9, #A5F3FC 50%, #22D3EE)"
                  : "linear-gradient(180deg, #93C5FD 0%, #3B82F6 50%, #1E40AF 100%)",
                transition: "width 150ms linear",
              }}
            />
            {full && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  width: "35%",
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)",
                  animation: "hud-sweep 1.1s linear infinite",
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                inset: "0 0 55% 0",
                background: "rgba(255,255,255,0.22)",
              }}
            />
          </Trim>
        </div>
      </div>
    </div>
  );
}

export type BannerKind = "round" | "fight" | "ko" | "timeup" | "roundWin" | "draw" | "win" | "lose";

const BANNER_GRAD: Record<BannerKind, string> = {
  round: "linear-gradient(180deg, #FFFFFF 30%, #C7B8FF)",
  fight: "linear-gradient(180deg, #FFF6C8 0%, #FFB347 50%, #FF4F8B 100%)",
  ko: "linear-gradient(180deg, #FFE1E6 0%, #FF3B5C 50%, #8E0A24 100%)",
  timeup: "linear-gradient(180deg, #FFF1C2 0%, #FF9F2E 60%, #B45309 100%)",
  roundWin: "linear-gradient(180deg, #FFF6C8 0%, #FFD23F 55%, #E08A12 100%)",
  draw: "linear-gradient(180deg, #FFFFFF 20%, #A8B3C7)",
  win: "linear-gradient(180deg, #FFF6C8 0%, #FFD23F 50%, #FF8A1F 100%)",
  lose: "linear-gradient(180deg, #E6E9F5 0%, #8C93B8 60%, #4A4F72 100%)",
};
const BANNER_LINE: Record<BannerKind, string> = {
  round: "#C7B8FF",
  fight: "#FFB347",
  ko: "#FF3B5C",
  timeup: "#FF9F2E",
  roundWin: "#FFD23F",
  draw: "#A8B3C7",
  win: "#FFD23F",
  lose: "#8C93B8",
};

/** 화면 가운데 띠 + 큰 글자. name이 있으면 "이름 + 글자" (이름은 캐릭터 색) */
export function Banner({
  kind,
  text,
  name,
  nameColor,
  top = "33%",
}: {
  kind: BannerKind;
  text: string;
  name?: string;
  nameColor?: string;
  /** 띠 위치 (결과 화면에선 위로 올림) */
  top?: string;
}) {
  const line = BANNER_LINE[kind];
  const big = kind === "ko" ? "10cqw" : kind === "round" ? "6.4cqw" : "7.6cqw";
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        height: "13cqw",
        transition: "top 300ms ease-out",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        key={`band-${kind}-${text}`}
        style={{
          position: "absolute",
          inset: "1.5cqw 0",
          background:
            "linear-gradient(90deg, transparent, rgba(12,6,22,0.82) 18%, rgba(12,6,22,0.82) 82%, transparent)",
          animation: "hud-band 160ms ease-out both",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: "0.2cqw",
            background: `linear-gradient(90deg, transparent, ${line}, transparent)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "0.2cqw",
            background: `linear-gradient(90deg, transparent, ${line}, transparent)`,
          }}
        />
      </div>
      <div
        key={`word-${kind}-${text}`}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "baseline",
          gap: "1.6cqw",
          animation: `hud-word 320ms cubic-bezier(.2,.9,.3,1.2) both${kind === "ko" ? ", hud-shake 320ms 320ms both" : ""}`,
        }}
      >
        {name && (
          <Gtext
            grad={`linear-gradient(180deg, #FFFFFF 25%, ${nameColor ?? "#fff"})`}
            size={big}
            stroke="0.3cqw"
            shadow="0.45cqw"
          >
            {name}
          </Gtext>
        )}
        <Gtext
          grad={BANNER_GRAD[kind]}
          size={big}
          stroke="0.3cqw"
          shadow="0.45cqw"
          style={{ letterSpacing: kind === "round" ? "0.06em" : "0.02em" }}
        >
          {text}
        </Gtext>
      </div>
    </div>
  );
}

/** 콤보 수 (때린 쪽 화면 가장자리) */
export function Combo({ n, right }: { n: number; right?: boolean }) {
  return (
    <div
      key={n}
      style={{
        position: "absolute",
        top: "24%",
        [right ? "right" : "left"]: "3%",
        display: "flex",
        alignItems: "baseline",
        gap: "0.5cqw",
        transform: "skewX(-10deg)",
        animation: "hud-pop 140ms ease-out both",
      }}
    >
      <Gtext
        grad="linear-gradient(180deg, #FFF6C8 0%, #FFD23F 50%, #FF7A1F 100%)"
        size="5.2cqw"
        stroke="0.24cqw"
        shadow="0.35cqw"
      >
        {n}
      </Gtext>
      <Gtext
        grad="linear-gradient(180deg, #FFFFFF, #C7B8FF)"
        size="2.2cqw"
        stroke="0.16cqw"
        shadow="0.2cqw"
      >
        HITS
      </Gtext>
    </div>
  );
}

/** 최종 승리: 이긴 캐릭터 얼굴 + 도발 대사 */
export function WinQuote({ ch, right }: { ch: number; right?: boolean }) {
  const c = CHARS[ch];
  return (
    <div
      style={{
        position: "absolute",
        top: "58%",
        [right ? "right" : "left"]: "4%",
        display: "flex",
        flexDirection: right ? "row-reverse" : "row",
        alignItems: "center",
        gap: "1.2cqw",
        animation: "hud-rise 350ms ease-out both",
      }}
    >
      <Trim
        clip="polygon(0 0, 100% 0, 84% 100%, 0 100%)"
        pad="0.3cqw"
        style={{ width: "10cqw", height: "9.4cqw" }}
        inner={{ background: `radial-gradient(circle at 40% 35%, ${c.color}, #1A0B2A 75%)` }}
      >
        <img
          src={`/fight/art/${c.id}-face.webp`}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </Trim>
      <div
        style={{
          maxWidth: "34cqw",
          padding: "1cqw 2.4cqw 1.1cqw 1.6cqw",
          clipPath: "polygon(0 0, 100% 0, calc(100% - 1.4cqw) 100%, 0 100%)",
          background: `linear-gradient(90deg, ${c.color} 0 0.5cqw, rgba(12,6,22,0.9) 0.5cqw)`,
        }}
      >
        <Gtext
          grad={`linear-gradient(180deg, #FFFFFF 25%, ${c.color})`}
          size="1.6cqw"
          stroke="0.12cqw"
          shadow="0.15cqw"
        >
          {c.name}
        </Gtext>
        <div
          style={{
            marginTop: "0.5cqw",
            fontFamily: "'Nanum Gothic', sans-serif",
            fontWeight: 800,
            fontSize: "1.7cqw",
            lineHeight: 1.4,
            color: "#fff",
          }}
        >
          “{c.winQuote}”
        </div>
      </div>
    </div>
  );
}
