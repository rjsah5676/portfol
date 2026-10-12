"use client";

/**
 * 보스 등장 · 격퇴 연출 (전투 화면 위에 겹침). 시간은 효과음에 맞춘 CSS(virus.css 의 vb-*, vd-*)가 정함.
 *   등장: 경보(빨간 테두리 · 경고 띠) → 암전 → 쿵 (보스가 쾅 나타나는 건 VirusGame 의 vb-slam)
 *   격퇴: 번쩍 · 「격퇴」 도장 (보스가 깨지고 조각이 튀는 건 VirusGame 의 vd-boss · BossShards)
 *   실패: 보스가 달려들며 붉은 코드 5발 → 내 바이러스가 맞고 녹아 사라짐 → 지직 → 다시 부팅
 *         (보스 돌진 vf-boss · 내 바이러스 소멸 vf-me · 조각은 VirusGame, 공격 · 띠 · 지직은 여기)
 */

export interface Cinema {
  id: number;
  kind: "appear" | "down" | "fail";
  seed: string;
  color: string;
  name: string;
  /** performance.now() 기준으로 끝나는 시각 */
  until: number;
}

const KR = "font-['Nanum_Gothic',sans-serif]";

export default function BossCinema({ c }: { c: Cinema }) {
  if (c.kind === "appear")
    return (
      <div key={c.id} className="pointer-events-none absolute inset-0 z-20" aria-hidden>
        <div className="vb-alarm absolute inset-0" />
        <div className="vb-banner absolute inset-x-0 top-[14%] py-1">
          <div
            className={`mx-auto w-fit bg-black/85 px-4 py-1.5 text-center ${KR}`}
            style={{ boxShadow: `0 0 24px ${c.color}66` }}
          >
            <div className="virus-blink font-mono vt-base font-black tracking-[0.3em] text-rose-400 sm:text-base">
              ⚠ WARNING · 침입 감지
            </div>
            <div className="mt-0.5 vt-sm text-white/80 sm:text-sm">
              이 네트워크를 장악한 바이러스 · <b style={{ color: c.color }}>{c.name}</b>
            </div>
          </div>
        </div>
        <div className="vb-black absolute inset-0 flex items-center justify-center">
          <span className="virus-blink font-mono vt-sm tracking-[0.4em] text-white/75">
            ANALYZING…
          </span>
        </div>
        <div className="vb-flash absolute inset-0" />
      </div>
    );
  if (c.kind === "fail")
    return (
      <div key={c.id} className="pointer-events-none absolute inset-0 z-20" aria-hidden>
        <div className="vf-red absolute inset-0" />
        {/* 보스 → 내 바이러스로 날아가는 붉은 공격 코드 */}
        {["kill", "0xDEAD", "rm -rf", "deny", "kill -9"].map((g, i) => (
          <span
            key={g}
            className="vf-shot absolute font-mono vt-base font-black whitespace-nowrap"
            style={{
              top: `calc(42% + ${[-14, 10, -4, 16, -10][i]}px)`,
              animationDelay: `${i * 0.1}s`,
              color: c.color,
              textShadow: `0 0 10px #ef4444, 0 0 4px ${c.color}`,
            }}
          >
            {g}
          </span>
        ))}
        <div className="vf-banner absolute inset-x-0 top-[12%] text-center">
          <div
            className={`mx-auto w-fit border-y-2 border-rose-500 bg-black/85 px-5 py-1.5 ${KR}`}
            style={{ boxShadow: "0 0 28px rgba(239,68,68,0.45)" }}
          >
            <div className="font-mono vt-base font-black tracking-[0.3em] text-rose-400 sm:text-base">
              ✖ ACCESS DENIED
            </div>
            <div className="mt-0.5 vt-sm text-white/80">
              <b style={{ color: c.color }}>{c.name}</b>에게 차단당했어요 · me.exe 소멸
            </div>
          </div>
        </div>
        <div className="vf-static absolute inset-0" />
      </div>
    );
  return (
    <div key={c.id} className="pointer-events-none absolute inset-0 z-20" aria-hidden>
      <div className="vd-flash absolute inset-0" />
      <div
        className={`vd-stamp absolute top-[42%] left-[75%] rounded-md border-4 px-3 py-1 text-center ${KR}`}
        style={{ borderColor: c.color, color: c.color, textShadow: `0 0 12px ${c.color}` }}
      >
        <div className="font-mono text-2xl font-black tracking-[0.15em] sm:text-3xl">
          TERMINATED
        </div>
        <div className="vt-sm font-bold">{c.name} 격퇴</div>
      </div>
    </div>
  );
}

/** id로 정해지는 조각 배치 (같은 연출 동안 모양이 안 바뀌게 — 렌더 중 Math.random 대신) */
function makeShards(id: number) {
  let h = (id * 2654435761) >>> 0 || 1;
  const rnd = () => {
    h = (h ^ (h << 13)) >>> 0;
    h = (h ^ (h >>> 17)) >>> 0;
    h = (h ^ (h << 5)) >>> 0;
    return h / 4294967296;
  };
  return Array.from({ length: 28 }, (_, i) => {
    const ang = (i / 28) * Math.PI * 2 + rnd() * 0.5;
    const dist = 70 + rnd() * 110;
    return {
      x: (rnd() - 0.5) * 70,
      y: (rnd() - 0.5) * 70,
      size: 6 + Math.floor(rnd() * 9),
      dx: Math.cos(ang) * dist,
      dy: Math.sin(ang) * dist + 30,
      rot: (rnd() - 0.5) * 540,
      light: rnd() < 0.3,
    };
  });
}

/** 격퇴할 때 보스가 깨져 튀는 픽셀 조각 — 보스 그림 가운데에 겹쳐 그림 */
export function BossShards({
  c,
  color = c.color,
  className = "vd-frag",
}: {
  c: Cinema;
  color?: string;
  /** vd-frag: 격퇴 때 사방으로 튐 · vf-frag: 실패 때 내 바이러스가 녹아 위로 흩어짐 */
  className?: string;
}) {
  const shards = makeShards(c.id);
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 h-0 w-0" aria-hidden>
      {shards.map((p, i) => (
        <span
          key={i}
          className={`${className} absolute rounded-[2px]`}
          style={
            {
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
              background: p.light ? "#fff" : color,
              boxShadow: `0 0 8px ${color}`,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              "--rot": `${p.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
