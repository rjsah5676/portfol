// 보스 · 상위 보스 고유 그림 (SVG, 120×120 기준 · 가운데 60,60)
// 바이러스마다 실제 정체를 살린 실루엣 — 작게 봐도 구별되게. 공통 표시(경고 고리 · 맞을 때 번쩍)는 VirusSprite · ApexSprite 가 그림

import type { ReactNode } from "react";

const DARK = "#1a0709";
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 화난 눈 한 쌍 (가운데 x, 높이 y, 간격 gap) — 적 바이러스 공통 표시 */
function AngryEyes({
  x = 60,
  y = 52,
  gap = 10,
  s = 1,
}: {
  x?: number;
  y?: number;
  gap?: number;
  s?: number;
}) {
  const L = x - gap;
  const R = x + gap;
  return (
    <>
      <polygon
        points={`${L - 6 * s},${y - 3 * s} ${L + 5 * s},${y + 1 * s} ${L + 4 * s},${y + 5 * s} ${L - 5 * s},${y + 3 * s}`}
        fill="#f87171"
      />
      <polygon
        points={`${R + 6 * s},${y - 3 * s} ${R - 5 * s},${y + 1 * s} ${R - 4 * s},${y + 5 * s} ${R + 5 * s},${y + 3 * s}`}
        fill="#f87171"
      />
    </>
  );
}

/** 감시하는 눈 (상위 보스 공통) */
function WatchEye({
  x = 60,
  y = 62,
  rx = 16,
  ry = 10,
  color,
}: {
  x?: number;
  y?: number;
  rx?: number;
  ry?: number;
  color: string;
}) {
  return (
    <>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#020617" stroke={color} strokeWidth={2} />
      <circle cx={x} cy={y} r={ry * 0.7} fill={color} />
      <circle cx={x} cy={y} r={ry * 0.32} fill="#020617" />
      <circle cx={x - ry * 0.3} cy={y - ry * 0.3} r={ry * 0.14} fill="#fff" />
    </>
  );
}

/** 바이러스 보스 몸 (id 별) — 없으면 null (예전 무늬로) */
export function virusBody(id: string, color: string): ReactNode | null {
  const st = { stroke: color, strokeWidth: 2.6, strokeLinejoin: "round" as const };
  switch (id) {
    // 1971 — 꿈틀대며 옮겨 다닌 첫 자기 복제 프로그램: 유령 같은 덩어리 · 픽셀 눈 · 지나간 자국
    case "creeper":
      return (
        <>
          {[0, 1, 2].map((k) => (
            <rect
              key={k}
              x={20 - k * 7}
              y={88 + k * 4}
              width={6 - k}
              height={6 - k}
              fill={color}
              opacity={0.6 - k * 0.18}
            />
          ))}
          <path
            d="M32 72 Q32 32 60 32 Q88 32 88 72 L88 88 Q83 82 78 88 Q73 94 68 88 Q63 82 58 88 Q53 94 48 88 Q43 82 38 88 Q35 92 32 88 Z"
            fill={DARK}
            {...st}
          />
          <rect x={46} y={50} width={7} height={9} fill={color} />
          <rect x={67} y={50} width={7} height={9} fill={color} />
          <rect x={53} y={66} width={14} height={4} fill="#f87171" />
        </>
      );
    // 1982 — 애플 II 플로피로 퍼진 장난 바이러스: 플로피 디스크 + 엘크 뿔
    case "elkcloner":
      return (
        <>
          <path
            d="M40 40 L34 22 L24 18 M34 22 L36 10 M37 31 L27 30"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M80 40 L86 22 L96 18 M86 22 L84 10 M83 31 L93 30"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
          <rect x={34} y={38} width={52} height={56} rx={4} fill={DARK} {...st} />
          <rect x={46} y={38} width={26} height={16} fill={color} opacity={0.55} />
          <rect x={64} y={41} width={5} height={10} fill={DARK} />
          <rect
            x={41}
            y={66}
            width={38}
            height={24}
            rx={2}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
          />
          <AngryEyes y={74} gap={9} s={0.9} />
        </>
      );
    // 1986 — 부트 섹터를 차지한 Brain: 두 반구 뇌
    case "brain":
      return (
        <>
          <path
            d="M58 30 C42 24 26 34 28 50 C20 60 26 78 42 80 C48 90 58 88 58 82 Z"
            fill={DARK}
            {...st}
          />
          <path
            d="M62 30 C78 24 94 34 92 50 C100 60 94 78 78 80 C72 90 62 88 62 82 Z"
            fill={DARK}
            {...st}
          />
          <path
            d="M36 46 q8 -4 12 4 M34 64 q8 -6 14 2 M44 74 q4 -6 10 -2 M84 46 q-8 -4 -12 4 M86 64 q-8 -6 -14 2 M76 74 q-4 -6 -10 -2"
            stroke={color}
            strokeWidth={1.6}
            fill="none"
            strokeLinecap="round"
          />
          <AngryEyes y={56} gap={13} s={0.85} />
        </>
      );
    // 1988 — 스스로 복제하며 퍼진 첫 인터넷 웜: 똬리 튼 마디 웜
    case "morris": {
      const segs = Array.from({ length: 11 }, (_, k) => {
        const a = 0.6 + k * 0.62;
        const r = 30 - k * 1.9;
        return { x: r2(60 + Math.cos(a) * r), y: r2(62 + Math.sin(a) * r), rad: r2(10 - k * 0.5) };
      });
      return (
        <>
          {segs
            .slice()
            .reverse()
            .map((p, k) => (
              <circle
                key={k}
                cx={p.x}
                cy={p.y}
                r={p.rad}
                fill={DARK}
                stroke={color}
                strokeWidth={2.2}
              />
            ))}
          <AngryEyes x={segs[0].x} y={segs[0].y - 2} gap={4} s={0.5} />
        </>
      );
    }
    // 1998 — BIOS 를 지운 체르노빌: 불타는 BIOS 칩
    case "cih":
      return (
        <>
          {[0, 1, 2, 3, 4].map((k) => (
            <g key={k} fill={color}>
              <rect x={40 + k * 9} y={32} width={4} height={8} />
              <rect x={40 + k * 9} y={88} width={4} height={8} />
              <rect x={28} y={46 + k * 9} width={8} height={4} />
              <rect x={84} y={46 + k * 9} width={8} height={4} />
            </g>
          ))}
          <rect x={36} y={40} width={48} height={48} rx={4} fill={DARK} {...st} />
          <path
            d="M60 6 Q48 20 55 30 Q50 18 61 18 Q72 28 64 36 Q76 28 70 14 Q67 22 60 6 Z"
            fill="#f97316"
            stroke="#fbbf24"
            strokeWidth={1}
          />
          <AngryEyes y={58} gap={10} s={0.9} />
          <path d="M48 74 h24" stroke={color} strokeWidth={2} />
        </>
      );
    // 1999 — 워드 매크로 바이러스: 접힌 문서 + 매크로 톱니
    case "melissa":
      return (
        <>
          <path d="M34 22 H70 L86 38 V98 H34 Z" fill={DARK} {...st} />
          <path d="M70 22 V38 H86" fill="none" stroke={color} strokeWidth={2} />
          <path
            d="M42 70 h28 M42 78 h20 M42 86 h24"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <g transform="translate(80 86)">
            {Array.from({ length: 8 }, (_, k) => (
              <rect
                key={k}
                x={-2}
                y={-13}
                width={4}
                height={6}
                fill={color}
                transform={`rotate(${k * 45})`}
              />
            ))}
            <circle r={9} fill={DARK} stroke={color} strokeWidth={2.2} />
            <circle r={3} fill={color} />
          </g>
          <AngryEyes y={50} gap={10} s={0.9} />
        </>
      );
    // 2000 — 러브레터 웜: 하트 편지봉투
    case "iloveyou":
      return (
        <>
          <path d="M22 30 q3 -5 6 0 q3 5 -3 9 q-6 -4 -3 -9 Z" fill={color} opacity={0.6} />
          <path d="M92 22 q3 -5 6 0 q3 5 -3 9 q-6 -4 -3 -9 Z" fill={color} opacity={0.6} />
          <path
            d="M60 96 C28 74 20 52 30 38 C40 24 56 28 60 42 C64 28 80 24 90 38 C100 52 92 74 60 96 Z"
            fill={DARK}
            {...st}
          />
          <path
            d="M38 48 L60 66 L82 48"
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <AngryEyes y={54} gap={13} s={0.85} />
        </>
      );
    // 2004 — DDoS 봇넷: 가운데 핵에 연결된 감염 PC 들
    case "mydoom": {
      const nodes = Array.from({ length: 7 }, (_, k) => {
        const a = -Math.PI / 2 + (k / 7) * Math.PI * 2;
        return { x: r2(60 + Math.cos(a) * 40), y: r2(60 + Math.sin(a) * 40) };
      });
      return (
        <>
          {nodes.map((n, k) => (
            <line
              key={`l${k}`}
              x1={60}
              y1={60}
              x2={n.x}
              y2={n.y}
              stroke={color}
              strokeWidth={1.6}
              strokeDasharray="3 2"
            />
          ))}
          {nodes.map((n, k) => (
            <rect
              key={`n${k}`}
              x={n.x - 6}
              y={n.y - 5}
              width={12}
              height={10}
              rx={2}
              fill={DARK}
              stroke={color}
              strokeWidth={2}
            />
          ))}
          <circle cx={60} cy={60} r={20} fill={DARK} {...st} />
          <AngryEyes y={58} gap={7} s={0.7} />
        </>
      );
    }
    // 2007 — 은행 트로이 Zeus: 금화 + 번개 왕관
    case "zeus":
      return (
        <>
          {[-34, -12, 12, 34].map((dx, k) => (
            <path
              key={k}
              d={`M${60 + dx} ${18 + Math.abs(dx) * 0.3} l-5 12 h6 l-4 12 l11 -15 h-6 l4 -9 Z`}
              fill="#facc15"
              stroke="#78350f"
              strokeWidth={0.8}
            />
          ))}
          <circle cx={60} cy={68} r={28} fill={DARK} {...st} />
          <circle
            cx={60}
            cy={68}
            r={22}
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            strokeDasharray="2 3"
          />
          <AngryEyes y={62} gap={10} s={0.85} />
          <path d="M52 78 q8 6 16 0" stroke={color} strokeWidth={2} fill="none" />
        </>
      );
    // 2010 — 원심분리기를 노린 Stuxnet: 원심분리기 + 회전 날개
    case "stuxnet":
      return (
        <>
          <ellipse cx={60} cy={94} rx={22} ry={6} fill={DARK} stroke={color} strokeWidth={2} />
          <rect x={38} y={30} width={44} height={64} fill={DARK} stroke={color} strokeWidth={2.6} />
          <ellipse cx={60} cy={30} rx={22} ry={7} fill={DARK} stroke={color} strokeWidth={2.6} />
          <g
            className="vm-spin"
            style={{ animationDuration: "1.6s", transformOrigin: "60px 74px" }}
          >
            {[0, 1, 2, 3].map((k) => (
              <path
                key={k}
                d="M60 74 L60 60 Q66 64 62 74 Z"
                fill={color}
                transform={`rotate(${k * 90} 60 74)`}
              />
            ))}
          </g>
          <circle cx={60} cy={74} r={3} fill="#f87171" />
          <AngryEyes y={46} gap={9} s={0.85} />
        </>
      );
    // 2008 — 비밀번호를 무작위로 대입한 Conficker: 열쇠 구멍 핵 + 촉수
    case "conficker":
      return (
        <>
          {Array.from({ length: 8 }, (_, k) => {
            const a = (k / 8) * Math.PI * 2;
            const x1 = 60 + Math.cos(a) * 20;
            const y1 = 60 + Math.sin(a) * 20;
            const cx = 60 + Math.cos(a + 0.5) * 36;
            const cy = 60 + Math.sin(a + 0.5) * 36;
            const x2 = 60 + Math.cos(a + 0.2) * 48;
            const y2 = 60 + Math.sin(a + 0.2) * 48;
            return (
              <g key={k}>
                <path
                  d={`M${r2(x1)} ${r2(y1)} Q${r2(cx)} ${r2(cy)} ${r2(x2)} ${r2(y2)}`}
                  stroke={color}
                  strokeWidth={3}
                  fill="none"
                  strokeLinecap="round"
                />
                <circle cx={r2(x2)} cy={r2(y2)} r={3} fill={color} />
              </g>
            );
          })}
          <circle cx={60} cy={60} r={22} fill={DARK} {...st} />
          <circle cx={60} cy={63} r={5} fill={color} />
          <path d="M57 66 L55 76 H65 L63 66 Z" fill={color} />
          <AngryEyes y={50} gap={9} s={0.7} />
        </>
      );
    // 2017 — 랜섬웨어 WannaCry: 자물쇠 + 우는 눈
    case "wannacry":
      return (
        <>
          <path d="M42 50 V36 a18 18 0 0 1 36 0 V50" fill="none" stroke={color} strokeWidth={6} />
          <rect x={30} y={48} width={60} height={48} rx={6} fill={DARK} {...st} />
          <path
            d="M42 60 l10 4 M78 60 l-10 4"
            stroke="#f87171"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <path d="M46 68 q-2 6 0 8 q2 -2 0 -8 Z M74 68 q-2 6 0 8 q2 -2 0 -8 Z" fill="#60a5fa" />
          <circle cx={60} cy={80} r={4} fill={color} />
          <path d="M58 82 L57 90 H63 L62 82 Z" fill={color} />
        </>
      );
    default:
      return null;
  }
}

/** 상위 보스 (보안 시스템) 몸 — index 0~9 = APEX, 10 = KILLSWITCH */
export function apexBody(index: number, color: string): ReactNode {
  const st = { stroke: color, strokeWidth: 3, strokeLinejoin: "round" as const };
  switch (index) {
    // Sentinel 백신: 십자 방패
    case 0:
      return (
        <>
          <path
            d="M60 8 L100 22 L96 68 Q90 98 60 112 Q30 98 24 68 L20 22 Z"
            fill="#0b0f1a"
            {...st}
          />
          <path d="M60 22 v20 M50 32 h20" stroke={color} strokeWidth={5} strokeLinecap="round" />
          <WatchEye y={70} color={color} />
        </>
      );
    // Bastion 방화벽: 불붙은 성벽 망루
    case 1:
      return (
        <>
          <path
            d="M44 14 Q38 24 46 30 Q42 20 52 20 Q58 28 52 34 Q64 28 58 16 Q56 22 50 16 Z M72 14 Q66 24 74 30 Q70 20 80 20 Q86 28 80 34 Q92 28 86 16 Q84 22 78 16 Z"
            fill="#f97316"
          />
          <path
            d="M24 34 h12 v8 h10 v-8 h12 v8 h10 v-8 h12 v8 h10 v-8 h12 V108 H24 Z"
            fill="#0b0f1a"
            {...st}
          />
          <path
            d="M24 56 H96 M24 76 H96 M24 96 H96 M42 42 V56 M78 42 V56 M34 56 V76 M60 56 V76 M86 56 V76 M46 76 V96 M74 76 V96"
            stroke={color}
            strokeWidth={1.2}
            strokeOpacity={0.6}
          />
          <WatchEye y={66} rx={14} ry={9} color={color} />
        </>
      );
    // Argus 침입 탐지: 눈이 가득한 구체
    case 2:
      return (
        <>
          <circle cx={60} cy={60} r={44} fill="#0b0f1a" {...st} />
          {[
            [36, 36],
            [84, 36],
            [28, 64],
            [92, 64],
            [42, 90],
            [78, 90],
            [60, 26],
          ].map(([x, y], k) => (
            <g key={k}>
              <ellipse
                cx={x}
                cy={y}
                rx={7}
                ry={4.5}
                fill="#020617"
                stroke={color}
                strokeWidth={1.4}
              />
              <circle cx={x} cy={y} r={2.4} fill={color} />
            </g>
          ))}
          <WatchEye y={62} rx={17} ry={11} color={color} />
        </>
      );
    // Hydra 스팸 필터: 머리 셋 달린 뱀
    case 3:
      return (
        <>
          <path
            d="M60 104 Q30 90 30 54 Q30 36 26 26"
            fill="none"
            stroke={color}
            strokeWidth={9}
            strokeLinecap="round"
          />
          <path
            d="M60 104 Q90 90 90 54 Q90 36 94 26"
            fill="none"
            stroke={color}
            strokeWidth={9}
            strokeLinecap="round"
          />
          <path d="M60 104 V30" fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
          <ellipse cx={60} cy={106} rx={26} ry={8} fill="#0b0f1a" stroke={color} strokeWidth={2} />
          {[
            [26, 22],
            [60, 22],
            [94, 22],
          ].map(([x, y], k) => (
            <g key={k}>
              <ellipse
                cx={x}
                cy={y}
                rx={11}
                ry={8}
                fill="#0b0f1a"
                stroke={color}
                strokeWidth={2.4}
              />
              <circle cx={x} cy={y - 1} r={3} fill="#f87171" />
              <path
                d={`M${x} ${y + 8} l-2 6 M${x} ${y + 8} l2 6`}
                stroke="#f87171"
                strokeWidth={1.4}
              />
            </g>
          ))}
        </>
      );
    // Warden 샌드박스: 창살 우리 + 자물쇠
    case 4:
      return (
        <>
          <rect x={22} y={22} width={76} height={80} rx={8} fill="#0b0f1a" {...st} />
          <WatchEye y={62} rx={18} ry={11} color={color} />
          {[34, 47, 60, 73, 86].map((x) => (
            <line key={x} x1={x} y1={24} x2={x} y2={100} stroke={color} strokeWidth={3} />
          ))}
          <path d="M22 40 H98 M22 86 H98" stroke={color} strokeWidth={2} />
          <path d="M52 104 v-6 a8 8 0 0 1 16 0 v6" fill="none" stroke={color} strokeWidth={3} />
          <rect x={48} y={104} width={24} height={14} rx={2} fill={color} />
        </>
      );
    // SOC 관제 센터: 레이더를 얹은 기둥 건물
    case 5:
      return (
        <>
          <path d="M60 6 v12" stroke={color} strokeWidth={2} />
          <path d="M44 22 Q60 4 76 22 Z" fill="#0b0f1a" stroke={color} strokeWidth={2.4} />
          <path d="M18 44 L60 22 L102 44 Z" fill="#0b0f1a" {...st} />
          <rect x={18} y={44} width={84} height={8} fill={color} opacity={0.5} />
          {[28, 46, 74, 92].map((x) => (
            <rect
              key={x}
              x={x - 4}
              y={52}
              width={8}
              height={44}
              fill="#0b0f1a"
              stroke={color}
              strokeWidth={2}
            />
          ))}
          <rect x={14} y={96} width={92} height={10} fill="#0b0f1a" {...st} />
          <WatchEye y={72} rx={11} ry={8} color={color} />
        </>
      );
    // Tracker EDR: 조준경 + 레이더 스윕
    case 6:
      return (
        <>
          <circle cx={60} cy={60} r={46} fill="#0b0f1a" {...st} />
          <circle
            cx={60}
            cy={60}
            r={30}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            strokeOpacity={0.6}
          />
          <g className="vm-spin" style={{ animationDuration: "3s", transformOrigin: "60px 60px" }}>
            <path d="M60 60 L60 14 A46 46 0 0 1 96 32 Z" fill={color} opacity={0.25} />
          </g>
          <path d="M60 8 V30 M60 90 V112 M8 60 H30 M90 60 H112" stroke={color} strokeWidth={3} />
          <circle cx={82} cy={38} r={3} fill="#f87171" />
          <WatchEye y={60} rx={13} ry={9} color={color} />
        </>
      );
    // Mimic 허니팟: 이빨 달린 보물상자
    case 7:
      return (
        <>
          <path d="M22 44 Q22 18 60 18 Q98 18 98 44 Z" fill="#0b0f1a" {...st} />
          <path
            d="M22 44 L30 54 L38 44 L46 54 L54 44 L62 54 L70 44 L78 54 L86 44 L94 54 L98 44"
            fill="#f1f5f9"
            stroke="#0b0f1a"
            strokeWidth={1}
          />
          <path
            d="M22 60 L30 52 L38 60 L46 52 L54 60 L62 52 L70 60 L78 52 L86 60 L94 52 L98 60 V100 H22 Z"
            fill="#0b0f1a"
            {...st}
          />
          <path d="M50 70 q10 12 20 0" fill="#f87171" />
          <rect x={54} y={80} width={12} height={12} rx={2} fill={color} />
          <circle cx={44} cy={32} r={4} fill="#f87171" />
          <circle cx={76} cy={32} r={4} fill="#f87171" />
          <path d="M22 44 H98" stroke={color} strokeWidth={2} />
        </>
      );
    // Leviathan 패킷 검사: 바다뱀 + 물결
    case 8:
      return (
        <>
          <path
            d="M14 84 Q30 40 50 70 Q66 94 80 58 Q88 38 98 34"
            fill="none"
            stroke={color}
            strokeWidth={14}
            strokeLinecap="round"
          />
          <path
            d="M44 62 l-6 -12 l10 6 M74 66 l2 -14 l6 10"
            fill={color}
            stroke={color}
            strokeWidth={2}
          />
          <ellipse
            cx={100}
            cy={30}
            rx={14}
            ry={10}
            fill="#0b0f1a"
            stroke={color}
            strokeWidth={2.6}
          />
          <circle cx={104} cy={27} r={3.4} fill="#f87171" />
          <path
            d="M10 100 q8 -6 16 0 t16 0 t16 0 t16 0 t16 0 t16 0"
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeOpacity={0.7}
          />
          <path
            d="M18 110 q8 -6 16 0 t16 0 t16 0 t16 0 t16 0"
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeOpacity={0.45}
          />
        </>
      );
    // Oracle AI: 모든 것을 보는 피라미드 + 신경망
    case 9:
      return (
        <>
          {[
            [16, 30],
            [104, 30],
            [12, 74],
            [108, 74],
            [30, 104],
            [90, 104],
          ].map(([x, y], k) => (
            <g key={k}>
              <line
                x1={60}
                y1={66}
                x2={x}
                y2={y}
                stroke={color}
                strokeWidth={1}
                strokeOpacity={0.6}
              />
              <circle cx={x} cy={y} r={4} fill="#0b0f1a" stroke={color} strokeWidth={1.6} />
            </g>
          ))}
          <path d="M60 10 L104 96 H16 Z" fill="#0b0f1a" {...st} />
          <path
            d="M60 26 L92 88 H28 Z"
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            strokeOpacity={0.5}
          />
          <WatchEye y={66} rx={15} ry={9} color={color} />
        </>
      );
    // KILLSWITCH: 방사능 마크가 박힌 거대한 차단 레버
    default:
      return (
        <>
          <rect x={18} y={34} width={84} height={74} rx={8} fill="#0b0f1a" {...st} />
          <path d="M18 46 H102" stroke="#fbbf24" strokeWidth={4} strokeDasharray="8 6" />
          <path d="M60 34 L84 8" stroke={color} strokeWidth={7} strokeLinecap="round" />
          <circle cx={86} cy={7} r={8} fill="#ef4444" stroke="#7f1d1d" strokeWidth={2} />
          <g transform="translate(60 78)">
            <circle r={22} fill="#facc15" />
            {[0, 120, 240].map((r) => (
              <path
                key={r}
                d="M0 0 L-8 -17 A19 19 0 0 1 8 -17 Z"
                fill="#0b0f1a"
                transform={`rotate(${r})`}
              />
            ))}
            <circle r={5} fill="#0b0f1a" />
            <circle r={3} fill="#facc15" />
          </g>
        </>
      );
  }
}
