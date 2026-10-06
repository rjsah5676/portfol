/**
 * 경기 끝 결과 판 — HUD와 같은 금테 + 짙은 보라 판. 게임 화면(.fs-screen) 안에 그려서 전체화면에서도 보임.
 * 경기 기록(시간·적중·남은 체력) + AI전 승리면 랭킹 점수·이름 입력·등록 + 다시하기 같은 버튼들.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { addAIRank, type AIRankColl } from "@/firestore/aiRankings";
import { clockLabel, type ScoreResult } from "@/lib/aiScore";
import { GOLD, Gtext, HUD_FONT, INK, PANEL, Trim } from "./Hud";

const KR = "'Nanum Gothic', sans-serif";
const MONO = "'JetBrains Mono', monospace";
/** AIRank.tsx 와 같은 키 (지난번 이름 채우기) */
const NAME_KEY = "ai-rank:name";
const GOLD_TXT = "linear-gradient(180deg, #FFFBE0 10%, #FFD23F 55%, #E08A12)";
const CUT = "1.4cqw";
const PANEL_CLIP = `polygon(${CUT} 0, 100% 0, 100% calc(100% - ${CUT}), calc(100% - ${CUT}) 100%, 0 100%, 0 ${CUT})`;
const BTN_CLIP = "polygon(0.9cqw 0, 100% 0, calc(100% - 0.9cqw) 100%, 0 100%)";

export interface ResultBtn {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface ResultRank {
  coll: AIRankColl;
  score: ScoreResult;
  entry: { opp: string; moves: number; seconds: number; lead: number };
  done: boolean;
  onSaved: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5cqw",
        padding: "0.8cqw 0 0.9cqw",
        background: "rgba(255,255,255,0.05)",
        borderTop: "0.15cqw solid rgba(242,195,91,0.35)",
      }}
    >
      <span
        style={{
          fontFamily: KR,
          fontWeight: 800,
          fontSize: "1.05cqw",
          color: "rgba(255,255,255,0.55)",
        }}
      >
        {label}
      </span>
      <Gtext
        grad="linear-gradient(180deg, #FFFFFF 30%, #D9C8FF)"
        size="2.3cqw"
        stroke="0.14cqw"
        shadow="0.18cqw"
      >
        {value}
      </Gtext>
    </div>
  );
}

function Btn({ b }: { b: ResultBtn }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={b.onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1,
        cursor: "pointer",
        border: 0,
        padding: "0.2cqw",
        clipPath: BTN_CLIP,
        background: b.primary ? GOLD : "linear-gradient(180deg, #8A7AA8, #4A3A66)",
        filter: "drop-shadow(0 0.3cqw 0 rgba(0,0,0,0.55))",
        transform: hov ? "translateY(-0.15cqw)" : undefined,
        transition: "transform 100ms",
      }}
    >
      <span
        style={{
          display: "block",
          clipPath: BTN_CLIP,
          padding: "0.75cqw 1.6cqw 0.85cqw",
          background: b.primary
            ? hov
              ? "linear-gradient(180deg, #FF7FAE, #C2185B)"
              : "linear-gradient(180deg, #FF5C93, #A3124A)"
            : hov
              ? "linear-gradient(180deg, #3D2660, #22123A)"
              : PANEL,
          fontFamily: HUD_FONT,
          fontSize: "1.75cqw",
          lineHeight: 1,
          color: "#fff",
          textShadow: `0 0.18cqw 0 ${INK}`,
          whiteSpace: "nowrap",
        }}
      >
        {b.label}
      </span>
    </button>
  );
}

function RankBox({ r }: { r: ResultRank }) {
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    r.done ? "done" : "idle"
  );
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 지난번 이름 채우기 (마운트 1회)
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
  }, []);
  const submit = async () => {
    const n = name.trim().slice(0, 12);
    if (!n || state === "sending" || state === "done") return;
    setState("sending");
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {}
    try {
      await addAIRank(r.coll, { name: n, score: r.score.score, ...r.entry });
      setState("done");
      r.onSaved();
    } catch {
      setState("error");
    }
  };
  const breakdown = [
    `기본 ${r.score.base.toLocaleString()}`,
    ...r.score.parts.map((p) => `${p.label} ×${p.factor.toFixed(2)}`),
  ].join("  ·  ");
  const field: CSSProperties = {
    minWidth: 0,
    flex: 1,
    height: "3.2cqw",
    padding: "0 1cqw",
    borderRadius: "0.4cqw",
    border: "0.15cqw solid rgba(242,195,91,0.45)",
    background: "#0B0514",
    color: "#fff",
    fontFamily: KR,
    fontWeight: 800,
    fontSize: "1.45cqw",
    outline: "none",
  };
  return (
    <div
      style={{
        marginTop: "1cqw",
        padding: "0.9cqw 1.2cqw 1cqw",
        background: "linear-gradient(90deg, rgba(255,210,63,0.14), rgba(255,210,63,0.04))",
        borderLeft: "0.4cqw solid #F2C35B",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "1cqw",
        }}
      >
        <span
          style={{
            fontFamily: HUD_FONT,
            fontSize: "1.45cqw",
            color: "#FFE9A8",
            letterSpacing: "0.05em",
          }}
        >
          랭킹 점수
        </span>
        <Gtext grad={GOLD_TXT} size="3cqw" stroke="0.16cqw" shadow="0.22cqw">
          {r.score.points.toLocaleString()}
        </Gtext>
      </div>
      <div
        style={{
          marginTop: "0.35cqw",
          fontFamily: MONO,
          fontSize: "0.95cqw",
          color: "rgba(255,255,255,0.45)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {breakdown}
      </div>
      {state === "done" ? (
        <div
          style={{
            marginTop: "0.8cqw",
            fontFamily: HUD_FONT,
            fontSize: "1.6cqw",
            color: "#FFD23F",
          }}
        >
          ✓ 랭킹에 등록했어요!
        </div>
      ) : (
        <div style={{ marginTop: "0.8cqw", display: "flex", gap: "0.8cqw" }}>
          <input
            value={name}
            maxLength={12}
            placeholder="이름 (12자)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") submit();
            }}
            style={field}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || state === "sending"}
            style={{
              cursor: !name.trim() || state === "sending" ? "not-allowed" : "pointer",
              opacity: !name.trim() || state === "sending" ? 0.45 : 1,
              border: 0,
              borderRadius: "0.4cqw",
              padding: "0 1.8cqw",
              background: GOLD,
              color: INK,
              fontFamily: HUD_FONT,
              fontSize: "1.55cqw",
              boxShadow: "0 0.25cqw 0 #6B4512",
              whiteSpace: "nowrap",
            }}
          >
            {state === "sending" ? "…" : state === "error" ? "다시 등록" : "랭킹 등록"}
          </button>
        </div>
      )}
      {state === "error" && (
        <div style={{ marginTop: "0.4cqw", fontFamily: KR, fontSize: "1cqw", color: "#FF8FA8" }}>
          등록에 실패했어요 — 다시 눌러 주세요
        </div>
      )}
    </div>
  );
}

export default function ResultPanel({
  side,
  title,
  seconds,
  hits,
  hp,
  rank,
  buttons,
}: {
  /** 판 위치 — 승리 대사가 없는 쪽 */
  side: "left" | "right" | "center";
  title: string;
  seconds: number;
  /** 없으면 안 보임 (관전) */
  hits?: number;
  hp?: number;
  rank?: ResultRank;
  buttons: ResultBtn[];
}) {
  const pos: CSSProperties =
    side === "center"
      ? { left: "50%", transform: "translateX(-50%)" }
      : side === "left"
        ? { left: "3%" }
        : { right: "3%" };
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "linear-gradient(180deg, transparent 25%, rgba(8,4,16,0.55) 70%, rgba(8,4,16,0.75))",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "42%",
          width: "40cqw",
          ...pos,
        }}
      >
        <div style={{ animation: "hud-rise 350ms ease-out both" }}>
          <Trim clip={PANEL_CLIP} pad="0.25cqw" inner={{ background: PANEL }}>
            <div style={{ padding: "1cqw 1.6cqw 1.4cqw" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1cqw" }}>
                <Gtext
                  grad={GOLD_TXT}
                  size="1.7cqw"
                  stroke="0.12cqw"
                  shadow="0.15cqw"
                  style={{ letterSpacing: "0.12em" }}
                >
                  RESULT
                </Gtext>
                <div
                  style={{
                    flex: 1,
                    height: "0.15cqw",
                    background: "linear-gradient(90deg, #F2C35B, transparent)",
                  }}
                />
                <span
                  style={{
                    fontFamily: HUD_FONT,
                    fontSize: "1.4cqw",
                    color: "rgba(255,255,255,0.8)",
                  }}
                >
                  {title}
                </span>
              </div>
              <div style={{ marginTop: "0.9cqw", display: "flex", gap: "0.5cqw" }}>
                <Stat label="경기 시간" value={clockLabel(seconds)} />
                {hits !== undefined && <Stat label="적중" value={`${hits}회`} />}
                {hp !== undefined && <Stat label="남은 체력" value={`${hp}%`} />}
              </div>
              {rank && <RankBox r={rank} />}
              <div style={{ marginTop: "1.2cqw", display: "flex", gap: "1cqw" }}>
                {buttons.map((b) => (
                  <Btn key={b.label} b={b} />
                ))}
              </div>
            </div>
          </Trim>
        </div>
      </div>
    </>
  );
}
