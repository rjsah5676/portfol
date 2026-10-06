import {
  DAILY,
  fmt,
  isDietFriendly,
  MACRO_COLORS,
  macroDaily,
  macroRatio,
  NUTRIENTS,
  type Amounts,
} from "@/lib/food";

const MACROS = [
  ["carb", "탄수화물"],
  ["protein", "단백질"],
  ["fat", "지방"],
] as const;

/** 도넛 하나: 조각 비율(합 1) + 가운데 글자 */
function Donut({
  parts,
  size,
  label,
  center,
  unit,
}: {
  parts: Record<"carb" | "protein" | "fat", number> | null;
  size: number;
  label: string;
  center: string;
  unit: string;
}) {
  const R = 15.9155; // 둘레 100
  let acc = 0;
  const segs = parts
    ? MACROS.map(([k]) => {
        const seg = { k, len: parts[k] * 100, off: 25 - acc };
        acc += parts[k] * 100;
        return seg;
      })
    : [];
  return (
    <svg
      viewBox="0 0 42 42"
      style={{ width: `min(${size}px, 30vw)`, height: "auto" }}
      className="shrink-0"
      role="img"
      aria-label={label}
    >
      <circle cx="21" cy="21" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
      {segs.map((s) =>
        s.len <= 0 ? null : (
          <circle
            key={s.k}
            cx="21"
            cy="21"
            r={R}
            fill="none"
            stroke={MACRO_COLORS[s.k]}
            strokeWidth="6"
            strokeDasharray={`${Math.max(0, s.len - 0.6)} ${100 - Math.max(0, s.len - 0.6)}`}
            strokeDashoffset={s.off}
          />
        )
      )}
      <text
        x="21"
        y="20.5"
        textAnchor="middle"
        className="fill-white font-mono"
        fontSize={center.length > 5 ? 5 : 6}
        fontWeight="700"
      >
        {center}
      </text>
      <text x="21" y="26" textAnchor="middle" className="fill-white/45 font-mono" fontSize="3">
        {unit}
      </text>
    </svg>
  );
}

/**
 * 탄·단·지 그래프 두 개 + 다이어트 판정 (서버·클라이언트 공용)
 * - 왼쪽: 열량이 어디서 나오는지 (칼로리 비율)
 * - 오른쪽: 하루 기준치를 얼마나 채우는지 (탄 324g · 단 55g · 지 54g 기준), 조각 크기도 그 %에 비례
 */
export function MacroDonut({ a, size = 120 }: { a: Amounts; size?: number }) {
  const r = macroRatio(a);
  const d = macroDaily(a);
  const dSum = d ? d.carb + d.protein + d.fat : 0;
  const dParts =
    d && dSum > 0 ? { carb: d.carb / dSum, protein: d.protein / dSum, fat: d.fat / dSum } : null;
  const diet = isDietFriendly(a);
  const pct = (v: number) => (v < 0.01 && v > 0 ? "<1%" : `${Math.round(v * 100)}%`);

  const col = (
    title: string,
    donut: React.ReactNode,
    rows: { k: (typeof MACROS)[number][0]; label: string; main: string; sub: string }[]
  ) => (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <p className="font-['Nanum_Gothic',sans-serif] text-[11px] text-white/45">{title}</p>
      {donut}
      <ul className="w-full max-w-[11rem] space-y-1 font-mono text-[11px]">
        {rows.map((x) => (
          <li key={x.k} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ background: MACRO_COLORS[x.k] }}
            />
            <span className="text-white/60">{x.label}</span>
            <span className="ml-auto text-white">{x.main}</span>
            <span className="hidden w-12 text-right text-white/30 min-[400px]:inline">{x.sub}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {col(
          "칼로리 비율",
          <Donut
            parts={r}
            size={size}
            label="탄단지 칼로리 비율"
            center={Math.round(a.kcal).toLocaleString("ko-KR")}
            unit="kcal"
          />,
          MACROS.map(([k, label]) => ({
            k,
            label,
            main: r ? `${Math.round(r[k] * 100)}%` : "-",
            sub: `${fmt(a[k])}g`,
          }))
        )}
        {col(
          "하루 권장량 대비",
          <Donut
            parts={dParts}
            size={size}
            label="하루 권장량 대비 탄단지"
            center={`${Math.round((a.kcal / DAILY.kcal) * 100)}%`}
            unit="하루 열량"
          />,
          MACROS.map(([k, label]) => ({
            k,
            label,
            main: d ? pct(d[k]) : "-",
            sub: `/${DAILY[k]}g`,
          }))
        )}
      </div>
      {diet && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 font-['Nanum_Gothic',sans-serif] text-xs text-emerald-200">
          <span className="text-base">💪</span>
          <span>
            <b className="text-emerald-100">다이어트에 적합한 음식이에요</b>
            <span className="text-emerald-200/70"> · 단백질은 풍부하고 탄수화물은 적어요</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** 영양성분표 + 1일 기준치 대비 % */
export function NutrientTable({ a }: { a: Amounts }) {
  return (
    <table className="w-full font-mono text-xs">
      <tbody>
        {NUTRIENTS.map((n) => {
          const v = a[n.key];
          const pct = v === null ? null : (v / DAILY[n.key]) * 100;
          const sub = n.label.startsWith(" ");
          return (
            <tr key={n.key} className="border-t border-white/5">
              <td className={`py-1.5 ${sub ? "pl-4 text-white/45" : "text-white/75"}`}>
                {n.label.trim()}
              </td>
              <td className="py-1.5 text-right text-white">
                {fmt(v)}
                <span className="ml-0.5 text-white/35">{n.unit}</span>
              </td>
              <td className="w-24 py-1.5 pl-3">
                {pct !== null && (
                  <div className="flex items-center gap-1.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full ${pct > 100 ? "bg-red-400" : "bg-[#6C63FF]"}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-[10px] text-white/40">
                      {Math.round(pct)}%
                    </span>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
