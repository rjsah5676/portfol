"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { asset, liveIdle } from "@/lib/poker/assets";
import { CHARS, lookChar, skinOf, type Look } from "@/lib/poker/rules";
import { hasSound, playVoiceCut } from "@/lib/poker/sfx";

/*
 * 로비의 내 캐릭터.
 *   기본 캐릭터: 대기 영상(char/{id}/idle.webp)이 있으면 그게 반복, 없으면 전신 그림 한 장 (눌러도 아무 일 없음).
 *   라이브 스킨(rules.ts 의 live): 대기 영상(idle.webp, 투명 배경 움직이는 그림)이 계속 반복되고,
 *     누르면 음성. 터치 반응 영상(touch-1~3.webp)이 있으면 그걸 한 번 틀고 대기로 돌아감.
 *   움직이는 그림을 받는 동안은 전신 그림이 보임.
 */

const TOUCH_N = 3;
/** 터치 반응 영상 길이를 못 읽었을 때 쓰는 길이 (보통은 webp 에 적힌 실제 길이, 끝나면 대기로). 끝날 때까지 다시 눌러도 무시 */
const TOUCH_MS = 6000;
/** 터치 영상이 끝나기 이만큼 전에 대기 영상을 처음부터 다시 틀어 둠 (가려진 채로 받아 그릴 여유, 3장쯤) */
const IDLE_LEAD_MS = 200;

/** 움직이는 webp 한 바퀴 길이(ms) — 장면(ANMF)마다 적힌 시간을 더함. 못 읽으면 0 */
async function webpMs(b: Blob): Promise<number> {
  try {
    const v = new DataView(await b.arrayBuffer());
    let ms = 0;
    for (let p = 12; p + 8 <= v.byteLength; ) {
      const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
      const size = v.getUint32(p + 4, true);
      if (id === "ANMF") ms += v.getUint8(p + 20) | (v.getUint8(p + 21) << 8) | (v.getUint8(p + 22) << 16);
      p += 8 + size + (size & 1);
    }
    return ms;
  } catch {
    return 0;
  }
}

export default function LobbyChar({
  look,
  className = "",
  style,
  /** 위쪽만 보이게 잘라 보여 줄 때 (폰 로비의 좁은 칸) */
  bust,
}: {
  look: Look;
  className?: string;
  style?: CSSProperties;
  bust?: boolean;
}) {
  const skin = skinOf(look);
  // 대기 영상: 라이브 스킨 + 영상이 있는 기본 캐릭터. 누르면 반응하는 건 스킨만
  const live = liveIdle(look);
  const touchable = live && !!skin && !skin.noTouch;
  const char = lookChar(look);
  const still = asset.full(look);
  const [idleOk, setIdleOk] = useState(false);
  // 있는 터치 반응 영상 번호들
  const [touches, setTouches] = useState<number[]>([]);
  // 지금 틀고 있는 터치 영상 (재생할 때마다 새로 만든 blob 주소 — 같은 주소면 브라우저가 한 번 끝난 움직이는 그림을 처음부터 다시 안 틀어 줘서 멈춘 것처럼 보임)
  const [touchUrl, setTouchUrl] = useState("");
  // 터치 영상이 그려질 준비가 됐는지 (그 전까지는 대기 그림을 그대로 보여 줘서 깜빡임 없게)
  const [touchReady, setTouchReady] = useState(false);
  const blobs = useRef<Record<number, Blob>>({});
  // 터치 영상마다 실제 길이 (못 읽으면 TOUCH_MS)
  const durs = useRef<Record<number, number>>({});
  const busyUntil = useRef(0);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 터치 영상이 끝날 때 대기 영상을 첫 장면부터 다시 틀기 (터치 영상 끝 = 대기 첫 장면으로 맞춰 둠).
  // 그냥 두면 대기 영상이 뒤에서 계속 돌던 아무 장면으로 튀어서 끊겨 보임. 새 blob 주소라야 처음부터 다시 돎
  const idleBlob = useRef<Blob | null>(null);
  const [idleUrl, setIdleUrl] = useState("");
  const [idleReady, setIdleReady] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 움직이는 그림 미리 받기 (없는 터치 영상은 건너뜀)
  useEffect(() => {
    if (!live) return;
    const im = new Image();
    im.onload = () => setIdleOk(true);
    im.src = asset.idle(look);
    let alive = true;
    if (touchable)
      fetch(asset.idle(look))
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => {
          if (alive) idleBlob.current = b;
        })
        .catch(() => {});
    for (let i = 1; touchable && i <= TOUCH_N; i++) {
      fetch(asset.touch(look, i))
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => {
          if (!alive) return;
          blobs.current[i] = b;
          void webpMs(b).then((ms) => {
            if (ms > 0) durs.current[i] = ms;
          });
          setTouches((p) => (p.includes(i) ? p : [...p, i]));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      clearTimeout(touchTimer.current);
      clearTimeout(idleTimer.current);
    };
  }, [live, touchable, look]);
  // 다 쓴 blob 주소 정리
  useEffect(() => {
    if (!touchUrl) return;
    return () => URL.revokeObjectURL(touchUrl);
  }, [touchUrl]);
  useEffect(() => {
    if (!idleUrl) return;
    return () => URL.revokeObjectURL(idleUrl);
  }, [idleUrl]);

  const lastTouch = useRef(0);
  const poke = () => {
    if (!touchable || Date.now() < busyUntil.current) return;
    // 누르면 나오던 대사(첫 입장 인사 등)를 끊고 바로
    const greet = () => playVoiceCut(look, Math.random() < 0.5 ? "select" : "hello-lobby");
    if (!touches.length) {
      greet();
      busyUntil.current = Date.now() + 1400;
      return;
    }
    // 무작위로 하나 (방금 나온 것은 빼고)
    const pool = touches.length > 1 ? touches.filter((t) => t !== lastTouch.current) : touches;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastTouch.current = pick;
    // 그 동작 전용 대사(voice/{스킨}/{스킨}-touch-N)가 있으면 그것, 없으면 인사 대사
    if (hasSound(`voice/${look}/${look}-touch-${pick}`)) playVoiceCut(look, `touch-${pick}`);
    else greet();
    setTouchReady(false);
    setTouchUrl(URL.createObjectURL(blobs.current[pick]));
    const len = durs.current[pick] || TOUCH_MS;
    busyUntil.current = Date.now() + len;
    clearTimeout(touchTimer.current);
    touchTimer.current = setTimeout(() => setTouchUrl(""), len);
    // 끝나기 조금 전에 (터치 영상 뒤에 가려진 채로) 대기 영상을 처음부터 새로 틀어 둠 — 받아 그리는 시간 여유
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (!idleBlob.current) return;
      setIdleReady(false);
      setIdleUrl(URL.createObjectURL(idleBlob.current));
    }, len - IDLE_LEAD_MS);
  };

  const imgCls = `pk-lobbychar-img ${bust ? "pk-lobbychar-bust" : ""}`;
  // 바탕(대기 영상 · 전신 그림)은 늘 붙여 두고, 터치 영상은 그 위에 얹음 — 갈아 끼우는 순간 빈 화면이 안 생기게
  const base = live && idleOk ? asset.idle(look) : still;
  const body = (
    <span className={`pk-lobbychar-body ${bust ? "overflow-hidden" : ""}`}>
      {}
      <img
        key={base}
        src={base}
        alt=""
        draggable={false}
        className={imgCls}
        style={(touchUrl && touchReady) || (idleUrl && idleReady) ? { visibility: "hidden" } : undefined}
      />
      {/* 처음부터 다시 튼 대기 영상 — 다 받아 그려질 때까지는 숨기고 원래 대기 그림이 대신 보임 */}
      {live && idleOk && idleUrl && (
        <img
          key={idleUrl}
          src={idleUrl}
          alt=""
          draggable={false}
          className={imgCls}
          style={idleReady && !(touchUrl && touchReady) ? undefined : { visibility: "hidden" }}
          onLoad={() => setIdleReady(true)}
        />
      )}
      {touchUrl && (
        <img
          key={touchUrl}
          src={touchUrl}
          alt=""
          draggable={false}
          className={imgCls}
          style={touchReady ? undefined : { visibility: "hidden" }}
          onLoad={() => setTouchReady(true)}
        />
      )}
    </span>
  );
  if (!touchable)
    return (
      <div className={`pk-lobbychar ${className}`} style={style} aria-hidden>
        {body}
      </div>
    );
  return (
    <button
      type="button"
      onClick={poke}
      aria-label={`${CHARS[char].name} 쓰다듬기`}
      className={`pk-lobbychar cursor-pointer ${className}`}
      style={style}
    >
      {body}
    </button>
  );
}
