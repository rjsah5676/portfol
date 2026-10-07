"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getTraffic, type TrafficDim, type TrafficReport, type TrafficSource } from "@/firestore/adminData";

/*
 * 유입 분석: 사람들이 어디서 · 어떤 환경으로 들어왔는지.
 * 기간을 고르면 서버가 날짜별 집계를 합쳐서 줌 (지난 날짜는 저장된 집계, 오늘은 그때그때).
 * "유입" = 탭 하나에서 처음 연 페이지(세션), "페이지" = 본 페이지 수, "순방문자" = 날짜별 합.
 * "클라우드 IP 빼기"(기본 켬): AWS·GCP 등 데이터센터 IP 에서 온 건 사람이 아닌 봇으로 보고 숫자에서 뺌.
 */

const HUMAN_KEY = "admin.traffic.human";

const KR = "font-['Nanum_Gothic',sans-serif]";
const panel = "rounded-2xl border border-white/10 bg-[#1C1E24] p-5";
const heading = "mb-4 font-mono text-xs text-[#8B84FF]";
const n = (v: number) => v.toLocaleString();
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

export const SOURCE: Record<TrafficSource, { label: string; color: string }> = {
  search: { label: "검색", color: "#2DD4BF" },
  social: { label: "SNS·메신저", color: "#F472B6" },
  ai: { label: "AI", color: "#A78BFA" },
  referral: { label: "다른 사이트", color: "#60A5FA" },
  campaign: { label: "캠페인(UTM)", color: "#FBBF24" },
  legacy: { label: "옛 주소", color: "#FB923C" },
  internal: { label: "사이트 안(새 탭)", color: "#94A3B8" },
  direct: { label: "직접 접속", color: "#64748B" },
};

/** 유입처 이름 ("" = 직접 접속) */
export const siteLabel = (k: string) => k || "직접 접속";

const DIM_TITLE: Partial<Record<TrafficDim, string>> = {
  cloud: "클라우드 IP (봇 의심)",
  site: "유입처",
  term: "검색어",
  campaign: "캠페인 (utm_campaign)",
  landing: "처음 들어온 페이지",
  page: "많이 본 페이지",
  device: "기기",
  os: "OS",
  browser: "브라우저",
  inapp: "인앱 브라우저",
  width: "화면 너비",
  country: "국가",
  region: "지역",
  lang: "언어",
};
const DEVICE: Record<string, string> = { mobile: "모바일", tablet: "태블릿", desktop: "데스크톱", other: "기타" };
const label = (dim: TrafficDim, k: string) =>
  dim === "site" ? siteLabel(k) : dim === "device" ? (DEVICE[k] ?? k) : k || "(알 수 없음)";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const DAY = 86_400_000;
const kstDate = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);

type Preset = "today" | "7" | "30" | "90" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "7", label: "7일" },
  { key: "30", label: "30일" },
  { key: "90", label: "90일" },
  { key: "custom", label: "직접" },
];
function rangeOf(p: Exclude<Preset, "custom">): [string, string] {
  const now = Date.now();
  const days = p === "today" ? 1 : Number(p);
  return [kstDate(now - (days - 1) * DAY), kstDate(now)];
}

function Kpi({ label: l, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="min-w-0">
      <div className={`text-xs text-white/45 ${KR}`}>{l}</div>
      <div className="mt-1 font-mono text-2xl font-bold text-white tabular-nums">{value}</div>
      {note && <div className={`mt-0.5 text-[11px] text-white/30 ${KR}`}>{note}</div>}
    </div>
  );
}

/** 막대 목록 */
function Bars({
  rows,
  total,
  color = "#6C63FF",
  render,
  empty = "아직 없어요.",
  limit = 10,
}: {
  rows: [string, number][];
  total: number;
  color?: string;
  render: (k: string) => ReactNode;
  empty?: string;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className={`py-4 text-center text-sm text-white/30 ${KR}`}>{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div>
      <ul className="flex flex-col gap-2">
        {shown.map(([k, c]) => (
          <li key={k} className="relative flex items-center gap-3 py-0.5">
            <span
              className="absolute inset-y-0 left-0 rounded"
              style={{ width: `${(c / max) * 100}%`, background: `${color}26` }}
            />
            <span className={`relative min-w-0 flex-1 truncate pl-2 text-xs text-white/80 ${KR}`} title={k}>
              {render(k)}
            </span>
            <span className="relative font-mono text-xs text-white/85 tabular-nums">{n(c)}</span>
            <span className="relative w-9 text-right font-mono text-[11px] text-white/35 tabular-nums">
              {pct(c, total)}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className={`mt-3 cursor-pointer text-xs text-white/40 transition-colors hover:text-white ${KR}`}
        >
          {all ? "접기" : `${rows.length - limit}개 더 보기`}
        </button>
      )}
    </div>
  );
}

function DimPanel({ dim, data, color }: { dim: TrafficDim; data: TrafficReport; color?: string }) {
  const rows = data.dims[dim] ?? [];
  const total = dim === "page" ? data.total.hits : data.total.entries;
  return (
    <section className={panel}>
      <div className={heading}>{DIM_TITLE[dim] ?? dim}</div>
      <Bars rows={rows} total={total} color={color} render={(k) => label(dim, k)} />
    </section>
  );
}

function ago(at: number) {
  const d = new Date(at);
  const today = kstDate(Date.now()) === kstDate(at);
  const hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
  return today ? hm : `${kstDate(at).slice(5).replace("-", ".")} ${hm}`;
}

export default function Traffic() {
  const [preset, setPreset] = useState<Preset>("7");
  const [custom, setCustom] = useState<[string, string]>(() => rangeOf("30"));
  const [todayKey] = useState(() => kstDate(Date.now()));
  const [human, setHuman] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장해 둔 선택(마운트 1회)
      if (localStorage.getItem(HUMAN_KEY) === "0") setHuman(false);
    } catch {
      // 저장소 막힘 → 기본값
    }
  }, []);
  const toggleHuman = () =>
    setHuman((v) => {
      try {
        localStorage.setItem(HUMAN_KEY, v ? "0" : "1");
      } catch {
        // 무시
      }
      return !v;
    });
  const [data, setData] = useState<TrafficReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [from, to] = preset === "custom" ? custom : rangeOf(preset);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getTraffic(from, to, human));
      setError("");
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [from, to, human]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 기간이 바뀔 때마다 조회
    load();
  }, [load]);

  const t = data?.total;
  const heatMax = data ? Math.max(1, ...data.heat.flat()) : 1;
  const dayMax = data ? Math.max(1, ...data.days.map((d) => d.entries)) : 1;

  return (
    <div className="flex flex-col gap-4">
      {/* 기간 */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPreset(p.key)}
            aria-pressed={preset === p.key}
            className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-xs transition-colors ${KR} ${
              preset === p.key
                ? "border-[#6C63FF] bg-[#6C63FF]/20 text-white"
                : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-white/60">
            <input
              type="date"
              value={custom[0]}
              max={custom[1]}
              onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])}
              className="rounded-md border border-white/15 bg-transparent px-2 py-1 text-white [color-scheme:dark]"
            />
            ~
            <input
              type="date"
              value={custom[1]}
              min={custom[0]}
              max={todayKey}
              onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])}
              className="rounded-md border border-white/15 bg-transparent px-2 py-1 text-white [color-scheme:dark]"
            />
          </span>
        )}
        <label className={`ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-white/60 select-none ${KR}`}>
          <input type="checkbox" checked={human} onChange={toggleHuman} className="accent-[#6C63FF]" />
          클라우드 IP 빼기
        </label>
        <span className="ml-auto font-mono text-[11px] text-white/30">
          {from === to ? from : `${from} ~ ${to}`}
          {loading && " · 불러오는 중…"}
        </span>
        <button
          type="button"
          onClick={load}
          className={`cursor-pointer rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition-colors hover:text-white ${KR}`}
        >
          새로고침
        </button>
      </div>

      {data && (
        <p className={`-mt-1 text-[11px] text-white/35 ${KR}`}>
          {data.cloud.loaded ? (
            <>
              클라우드 IP 유입 <span className="font-mono text-white/70">{n(data.cloud.entries)}</span>건
              {human ? " 뺐어요" : " 포함"}
              <span className="text-white/25">
                {" · 대역 "}
                {Object.entries(data.cloud.counts)
                  .map(([k, c]) => `${k} ${n(c)}`)
                  .join(" · ")}
                {data.cloud.updatedAt && ` · ${ago(data.cloud.updatedAt)} 갱신`}
                {data.cloud.errors.length > 0 && ` · 실패: ${data.cloud.errors.map((e) => e.split(":")[0]).join(", ")}`}
              </span>
            </>
          ) : (
            "클라우드 대역 목록을 아직 못 받았어요 (서버가 켜지고 1분 뒤 받아요). 그 전 기록은 받은 뒤에 표시돼요."
          )}
        </p>
      )}

      {error && <p className={`rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200 ${KR}`}>{error}</p>}

      {!data ? (
        !error && <p className="py-16 text-center font-mono text-sm text-white/35">불러오는 중…</p>
      ) : (
        <>
          {/* 숫자 */}
          <section className={`${panel} grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-6`}>
            <Kpi label="유입 (세션)" value={n(t!.entries)} />
            <Kpi label="순방문자" value={n(t!.uniques)} note={data.days.length > 1 ? "날짜별 합" : undefined} />
            <Kpi label="페이지 본 수" value={n(t!.hits)} note={`세션당 ${t!.entries ? (t!.hits / t!.entries).toFixed(1) : "-"}쪽`} />
            <Kpi label="한 쪽만 보고 나감" value={pct(t!.bounces, t!.entries)} />
            <Kpi label="다시 온 브라우저" value={pct(t!.returning, t!.entries)} />
            <Kpi label="회원으로 들어옴" value={pct(t!.members, t!.entries)} />
          </section>

          {/* 날짜별 */}
          {data.days.length > 1 && (
            <section className={panel}>
              <div className={heading}>날짜별 유입</div>
              <div className="flex h-32 items-end gap-[2px] sm:gap-1">
                {data.days.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date} · 유입 ${n(d.entries)} · 순방문자 ${n(d.uniques)} · 페이지 ${n(d.hits)}`}
                    className="group flex h-full min-w-0 flex-1 flex-col justify-end"
                  >
                    <span
                      className="w-full rounded-t-sm bg-[#6C63FF]/45 transition-colors group-hover:bg-[#8B84FF]"
                      style={{ height: `${Math.max(2, (d.entries / dayMax) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between font-mono text-[10px] text-white/30">
                <span>{data.days[0].date.slice(5).replace("-", ".")}</span>
                <span>{data.days[data.days.length - 1].date.slice(5).replace("-", ".")}</span>
              </div>
            </section>
          )}

          {/* 유입 경로 */}
          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <section className={panel}>
              <div className={heading}>유입 경로</div>
              {t!.entries > 0 && (
                <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                  {data.dims.source.map(([k, c]) => (
                    <span
                      key={k}
                      title={`${SOURCE[k as TrafficSource]?.label ?? k} ${n(c)}`}
                      style={{ width: `${(c / t!.entries) * 100}%`, background: SOURCE[k as TrafficSource]?.color ?? "#888" }}
                    />
                  ))}
                </div>
              )}
              <Bars
                rows={data.dims.source}
                total={t!.entries}
                color="#2DD4BF"
                render={(k) => (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SOURCE[k as TrafficSource]?.color ?? "#888" }} />
                    {SOURCE[k as TrafficSource]?.label ?? k}
                  </span>
                )}
              />
            </section>
            <DimPanel dim="site" data={data} color="#2DD4BF" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className={panel}>
              <div className={heading}>검색어</div>
              <Bars
                rows={data.dims.term}
                total={data.dims.source.find(([k]) => k === "search")?.[1] ?? 0}
                color="#2DD4BF"
                render={(k) => k}
                empty="네이버 · 다음 · 빙은 리퍼러에 검색어가 남을 때만 보여요."
              />
              <p className={`mt-4 text-[11px] text-white/30 ${KR}`}>
                구글은 검색어를 넘겨주지 않아요 → Search Console의 실적 보고서에서 확인.
              </p>
            </section>
            <DimPanel dim="campaign" data={data} color="#FBBF24" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <DimPanel dim="landing" data={data} />
            <DimPanel dim="page" data={data} />
          </div>

          {/* 환경 */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <DimPanel dim="device" data={data} color="#F472B6" />
            <DimPanel dim="os" data={data} color="#F472B6" />
            <DimPanel dim="browser" data={data} color="#F472B6" />
            <DimPanel dim="inapp" data={data} color="#F472B6" />
            <DimPanel dim="width" data={data} color="#F472B6" />
            <DimPanel dim="lang" data={data} color="#F472B6" />
          </div>

          {/* 위치 */}
          <div className={`grid gap-4 ${human ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
            <DimPanel dim="country" data={data} color="#60A5FA" />
            <DimPanel dim="region" data={data} color="#60A5FA" />
            {!human && <DimPanel dim="cloud" data={data} color="#FB923C" />}
          </div>

          {/* 요일 × 시간 */}
          <section className={panel}>
            <div className={heading}>요일 · 시간대별 유입 (한국 시간)</div>
            <div className="overflow-x-auto">
              <div className="grid min-w-[560px] grid-cols-[1.5rem_repeat(24,minmax(0,1fr))] gap-[3px]">
                <span />
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="text-center font-mono text-[9px] text-white/30">
                    {h % 3 === 0 ? h : ""}
                  </span>
                ))}
                {data.heat.map((row, wd) => (
                  <div key={wd} className="contents">
                    <span className={`text-[10px] leading-5 text-white/40 ${KR}`}>{WEEK[wd]}</span>
                    {row.map((c, h) => (
                      <span
                        key={h}
                        title={`${WEEK[wd]} ${h}시 · ${n(c)}`}
                        className="h-5 rounded-[3px]"
                        style={{ background: c ? `rgba(139,132,255,${0.12 + (c / heatMax) * 0.88})` : "rgba(255,255,255,0.04)" }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* 최근 유입 */}
          <section className={panel}>
            <div className={heading}>최근 유입 {data.recent.length ? `(${data.recent.length})` : ""}</div>
            {data.recent.length === 0 ? (
              <p className={`py-6 text-center text-sm text-white/30 ${KR}`}>이 기간의 기록이 없어요.</p>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className={`w-full min-w-[860px] text-left text-xs ${KR}`}>
                  <thead className="text-white/35">
                    <tr className="border-b border-white/10">
                      <th className="py-2 pr-3 font-normal">시각</th>
                      <th className="py-2 pr-3 font-normal">유입</th>
                      <th className="py-2 pr-3 font-normal">첫 페이지</th>
                      <th className="py-2 pr-3 text-right font-normal">쪽</th>
                      <th className="py-2 pr-3 font-normal">환경</th>
                      <th className="py-2 pr-3 font-normal">위치</th>
                      <th className="py-2 font-normal">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r, i) => {
                      const src = SOURCE[r.source] ?? SOURCE.direct;
                      const extra = r.term || r.campaign;
                      return (
                        <tr key={i} className="border-b border-white/[0.06] align-top last:border-0">
                          <td className="py-2 pr-3 font-mono whitespace-nowrap text-white/45">{ago(r.at)}</td>
                          <td className="max-w-[240px] py-2 pr-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: src.color }} />
                              <span className="text-white/85">{r.source === "direct" ? src.label : r.site || src.label}</span>
                              {r.member && (
                                <span className="rounded bg-[#8B84FF]/20 px-1 text-[10px] text-[#B8B3FF]" title="로그인한 회원">
                                  {r.nick || "회원"}
                                </span>
                              )}
                              {r.returning && <span className="text-[10px] text-white/35">재방문</span>}
                              {r.cloud && (
                                <span className="rounded bg-[#FB923C]/20 px-1 text-[10px] text-[#FDBA74]" title="클라우드(데이터센터) IP — 봇 의심">
                                  {r.cloud}
                                </span>
                              )}
                            </span>
                            {extra && <div className="truncate text-white/45">“{extra}”</div>}
                            {r.ref && (
                              <div className="truncate font-mono text-[10px] text-white/25" title={r.ref}>
                                {r.ref}
                              </div>
                            )}
                          </td>
                          <td className="max-w-[180px] truncate py-2 pr-3 font-mono text-white/70" title={r.path}>
                            {r.path}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-white/70">{r.pages}</td>
                          <td className="py-2 pr-3 whitespace-nowrap text-white/60">
                            {DEVICE[r.device] ?? r.device} · {r.os || "?"} · {r.browser || "?"}
                            {r.inapp && <span className="text-[#F472B6]/80"> · {r.inapp}</span>}
                            {r.screen && <div className="font-mono text-[10px] text-white/25">{r.screen}</div>}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap text-white/60">
                            {[r.country, r.region, r.city].filter(Boolean).join(" · ") || "-"}
                          </td>
                          <td className="py-2 font-mono whitespace-nowrap text-white/45">{r.ip || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className={`text-[11px] leading-relaxed text-white/30 ${KR}`}>
            봇(브라우저 정보로 판별) · 관리자 로그인 · 관리자 화면은 세지 않아요. 진짜 브라우저처럼 들어오는 봇은 클라우드 IP(AWS · GCP · Azure ·
            Oracle · DigitalOcean 공개 대역, 하루 한 번 갱신)로 표시해요. 원본 IP는 30일, 방문 기록은 180일 뒤 지워지고 날짜별 집계만 남아요. 위치는
            IP로 추정한 값이라 모바일 통신사 IP는 지역이 비는 경우가 많아요. This product includes GeoLite2 data created by MaxMind,
            available from https://www.maxmind.com.
          </p>
        </>
      )}
    </div>
  );
}
