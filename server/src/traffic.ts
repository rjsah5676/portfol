import { createHmac, randomBytes } from "node:crypto";
import { isbot } from "isbot";
import UAParser from "ua-parser-js";
import { createCloudIps, fetchCloudLists, type CloudIps } from "./cloudIps";
import type { Database } from "./db";
import { newId } from "./ids";

/*
 * 유입 분석 (어디서 · 어떤 환경으로 들어왔는지).
 *
 *   traffic_hits   페이지를 볼 때마다 한 줄. 180일 뒤 자동 삭제(TTL), 원본 IP 는 30일 뒤 지움
 *   traffic_daily  날짜별 집계 (오래 보관). 지난 날짜는 처음 볼 때 · 매시간 작업에서 만들어 둠
 *   traffic_meta   순방문자 해시에 쓰는 비밀값 · 클라우드 IP 대역 목록(하루 한 번 갱신)
 *
 * 세션 = 브라우저 탭 하나(sessionStorage id). 세션의 첫 페이지가 "유입"(entry).
 * 순방문자 = 하루 단위로 IP+브라우저를 해시한 값 (날짜가 바뀌면 같은 사람도 다른 값).
 * 기존 방문자 수(siteStats)와는 따로 셈.
 * 클라우드(AWS·GCP·Azure 등) IP 에서 온 건 cloud 에 업체 이름을 적어 두고, 집계는 전체 · 사람(클라우드 뺀 것) 두 벌.
 */

export const HITS = "traffic_hits";
export const DAILY = "traffic_daily";
const META = "traffic_meta";

export const HIT_TTL_DAYS = 180;
export const IP_KEEP_DAYS = 30;
const DAY = 86_400_000;
/** 집계 형식이 바뀌면 올림 → 원본이 남아 있는 날짜는 다시 집계 */
const SUMMARY_V = 2;
/** 클라우드 대역 목록을 다시 받는 간격 */
const CLOUD_REFRESH_MS = DAY;
/** 날짜별 집계에 남기는 항목 수 (항목마다) */
const KEEP_TOP = 100;

/** 한국 시간 기준 날짜·시 */
export const kstDate = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
const kstHour = (t: number) => new Date(t + 9 * 3600_000).getUTCHours();

// ───────────── 유입 경로 분류 ─────────────

export type Source = "campaign" | "search" | "ai" | "social" | "referral" | "legacy" | "internal" | "direct";

/** [호스트 패턴, 이름, 검색어 파라미터] — 위에서부터 먼저 맞는 것 */
const AI: [RegExp, string][] = [
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/^gemini\.google\.com$/, "Gemini"],
  [/(^|\.)claude\.ai$/, "Claude"],
  [/(^|\.)copilot\.microsoft\.com$/, "Copilot"],
];
const SEARCH: [RegExp, string, string][] = [
  [/(^|\.)google\.[a-z.]+$/, "Google", "q"],
  [/(^|\.)search\.naver\.com$/, "Naver", "query"],
  [/(^|\.)search\.daum\.net$/, "Daum", "q"],
  [/(^|\.)bing\.com$/, "Bing", "q"],
  [/(^|\.)search\.yahoo\.[a-z.]+$/, "Yahoo", "p"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo", "q"],
  [/(^|\.)search\.zum\.com$/, "ZUM", "query"],
  [/(^|\.)yandex\.[a-z.]+$/, "Yandex", "text"],
  [/(^|\.)ecosia\.org$/, "Ecosia", "q"],
];
const SOCIAL: [RegExp, string][] = [
  [/^(t\.co|x\.com|(.+\.)?twitter\.com)$/, "X"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$|^fb\.me$/, "Facebook"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)kakao\.com$/, "Kakao"],
  [/(^|\.)band\.us$/, "BAND"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)discord(app)?\.com$/, "Discord"],
  [/(^|\.)slack\.com$/, "Slack"],
];
/** 옛 주소 (GitHub Pages · Firebase Hosting) → 표시 이름 */
const LEGACY: [RegExp, string][] = [
  [/^rjsah5676\.github\.io$/, "github.io"],
  [/^gunmo-portfolio\.(firebaseapp\.com|web\.app)$/, "firebase"],
];
const LEGACY_FIREBASE = /^gunmo-portfolio\.(firebaseapp\.com|web\.app)$/;

/** 인앱 브라우저 (UA 안의 표시) */
const INAPP: [RegExp, string][] = [
  [/KAKAOTALK/i, "카카오톡"],
  [/NAVER\(inapp/i, "네이버 앱"],
  [/DaumApps/i, "다음 앱"],
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB/, "Facebook"],
  [/\bLine\//, "LINE"],
  [/BAND\//, "BAND"],
  [/everytimeApp/i, "에브리타임"],
  [/; wv\)/, "기타 앱"],
];
/** 리퍼러 없이 이 앱에서 열렸으면 그 SNS 로 봄 */
const INAPP_SOCIAL: Record<string, string> = {
  카카오톡: "KakaoTalk",
  Instagram: "Instagram",
  Facebook: "Facebook",
  LINE: "LINE",
  BAND: "BAND",
  에브리타임: "에브리타임",
};

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface Channel {
  source: Source;
  /** 구체적인 곳: Google · Naver · 블로그 주소 · utm_source … (직접 접속은 "") */
  site: string;
  refHost: string;
  /** 검색어 (리퍼러에 남아 있을 때만. 구글은 안 넘겨줌) */
  term?: string;
}

const hostOf = (url: string): string => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
};
const bare = (host: string) => host.replace(/^(www|m)\./, "");

export function classify(ref: string, utm: Utm, ownHosts: string[], inapp: string): Channel {
  const refHost = hostOf(ref);
  if (utm.source) return { source: "campaign", site: utm.source.toLowerCase(), refHost };
  if (!refHost) {
    const social = INAPP_SOCIAL[inapp];
    return social ? { source: "social", site: social, refHost } : { source: "direct", site: "", refHost };
  }
  if (ownHosts.includes(refHost)) return { source: "internal", site: "", refHost };
  for (const [re, name] of LEGACY) if (re.test(refHost)) return { source: "legacy", site: name, refHost };
  for (const [re, name] of AI) if (re.test(refHost)) return { source: "ai", site: name, refHost };
  for (const [re, name, param] of SEARCH)
    if (re.test(refHost)) {
      let term: string | undefined;
      try {
        term = new URL(ref).searchParams.get(param)?.trim().slice(0, 100) || undefined;
      } catch {
        // 깨진 주소 → 검색어 없음
      }
      return { source: "search", site: name, refHost, ...(term ? { term } : {}) };
    }
  for (const [re, name] of SOCIAL) if (re.test(refHost)) return { source: "social", site: name, refHost };
  return { source: "referral", site: bare(refHost), refHost };
}

// ───────────── 기기 · 브라우저 ─────────────

export interface Env {
  device: "mobile" | "tablet" | "desktop" | "other";
  os: string;
  browser: string;
  inapp: string;
}

const BROWSER_NAME: Record<string, string> = {
  "Mobile Safari": "Safari",
  "Mobile Chrome": "Chrome",
  "Mobile Firefox": "Firefox",
  "Chrome WebView": "WebView",
  "Chrome Headless": "Headless",
  "Samsung Browser": "Samsung Internet",
  "Mac OS": "macOS",
};

export function envOf(ua: string): Env {
  const r = new UAParser(ua).getResult();
  const t = r.device.type;
  const device = t === "mobile" || t === "tablet" ? t : t === undefined ? "desktop" : "other";
  const inapp = INAPP.find(([re]) => re.test(ua))?.[1] ?? "";
  const os = r.os.name ?? "";
  const browser = r.browser.name ?? "";
  return { device, os: BROWSER_NAME[os] ?? os, browser: BROWSER_NAME[browser] ?? browser, inapp };
}

export const isBotUa = (ua: string) => !ua || isbot(ua);

/** 화면 너비 구간 */
export function widthBucket(w: number): string {
  if (!w) return "";
  for (const max of [480, 768, 1024, 1440, 1920]) if (w <= max) return `~${max}`;
  return "1920~";
}

// ───────────── 위치 (geoip-lite, 처음 쓸 때 불러옴 · 메모리 약 100MB) ─────────────

export interface Geo {
  country: string;
  region: string;
  city: string;
}
type GeoFn = (ip: string) => Geo | null;
let geoLoad: Promise<GeoFn> | null = null;

function loadGeo(): Promise<GeoFn> {
  geoLoad ??= import("geoip-lite")
    .then((m) => {
      const g = (m as unknown as { default?: typeof m }).default ?? m;
      return (ip: string) => {
        const r = g.lookup(ip);
        return r ? { country: r.country || "", region: r.region || "", city: r.city || "" } : null;
      };
    })
    .catch((e) => {
      console.warn("[traffic] geoip-lite 를 불러오지 못해 위치는 비워 둠", e);
      return () => null;
    });
  return geoLoad;
}

/** 한국 시·도 (ISO 3166-2:KR) */
const KR_REGION: Record<string, string> = {
  "11": "서울",
  "26": "부산",
  "27": "대구",
  "28": "인천",
  "29": "광주",
  "30": "대전",
  "31": "울산",
  "41": "경기",
  "42": "강원",
  "51": "강원",
  "43": "충북",
  "44": "충남",
  "45": "전북",
  "52": "전북",
  "46": "전남",
  "47": "경북",
  "48": "경남",
  "49": "제주",
  "50": "세종",
};
/** 지역 표시: 한국은 시·도 이름, 그 밖은 "국가-코드" */
export const regionLabel = (country: string, region: string) =>
  !country ? "" : country === "KR" ? (region ? (KR_REGION[region] ?? `KR-${region}`) : "") : region ? `${country}-${region}` : "";

/** "::ffff:1.2.3.4" → "1.2.3.4" */
export const cleanIp = (ip: string | undefined) => (ip ?? "").replace(/^::ffff:/, "");

// ───────────── 기록 ─────────────

export interface HitInput {
  sid: string;
  path: string;
  entry: boolean;
  returning: boolean;
  ref?: string;
  utm?: Utm;
  screen?: { w: number; h: number };
  lang?: string;
  tz?: string;
}

export interface HitDoc {
  _id: string;
  at: Date;
  day: string;
  hour: number;
  sid: string;
  entry: boolean;
  returning: boolean;
  path: string;
  ref?: string;
  refHost?: string;
  source?: Source;
  site?: string;
  term?: string;
  utm?: Utm;
  device: Env["device"];
  os: string;
  browser: string;
  inapp: string;
  screen?: string;
  sw: string;
  lang: string;
  tz: string;
  country: string;
  region: string;
  city: string;
  member: boolean;
  /** 회원 uid (회원을 지우면 같이 지움) */
  uid?: string;
  /** 클라우드 업체 이름 (아니면 "", 대역 목록이 없어 못 본 건 필드 없음) */
  cloud?: string;
  /** 하루 단위 순방문자 해시 */
  vh: string;
  /** 원본 IP — IP_KEEP_DAYS 뒤 지움 */
  ip?: string;
  ua: string;
}

export interface RecordCtx {
  ip: string;
  ua: string;
  member: boolean;
  uid?: string;
  ownHosts: string[];
}

export interface Traffic {
  record(input: HitInput, ctx: RecordCtx): Promise<boolean>;
  summary(day: string): Promise<DaySummary>;
  range(from: string, to: string, opts?: { human?: boolean }): Promise<RangeReport>;
  today(): Promise<{ entries: number; uniques: number; hits: number; top: [string, number][] }>;
  /** 오래된 원본 IP 지우기 + 어제 집계 만들어 두기 */
  maintain(now?: number): Promise<void>;
}

export function createTraffic(
  db: Database,
  opts: { geo: boolean; cloud?: boolean; cloudIps?: CloudIps; fetchLists?: typeof fetchCloudLists }
): Traffic {
  const hits = db.col<Omit<HitDoc, "_id">>(HITS);
  const daily = db.col<Omit<DaySummary, "_id">>(DAILY);
  const meta = db.col<{ at: Date; lists: Record<string, string[]>; errors?: string[] }>(META);

  // 클라우드 대역: 저장해 둔 목록을 먼저 읽고, 하루 지나면 maintain 에서 새로 받음
  const cloud = opts.cloudIps ?? (opts.cloud ? createCloudIps() : null);
  let cloudAt = 0;
  let cloudErrors: string[] = [];
  const cloudLoad = cloud
    ? meta
        .findOne({ _id: "cloud" })
        .then((d) => {
          if (d?.lists && !cloud.loaded()) {
            cloud.set(d.lists);
            cloudAt = d.at.getTime();
            cloudErrors = d.errors ?? [];
          }
        })
        .catch((e) => console.warn("[traffic] 클라우드 대역 읽기 실패", e))
    : Promise.resolve();

  let secret: Promise<string> | null = null;
  const getSecret = () =>
    (secret ??= (async () => {
      const meta = db.col<{ v: string }>(META);
      await meta.updateOne({ _id: "secret" }, { $setOnInsert: { v: randomBytes(32).toString("hex") } }, { upsert: true });
      return (await meta.findOne({ _id: "secret" }))!.v;
    })().catch((e) => {
      secret = null;
      throw e;
    }));

  async function record(input: HitInput, ctx: RecordCtx) {
    if (isBotUa(ctx.ua)) return false;
    await cloudLoad;
    const now = Date.now();
    const day = kstDate(now);
    const env = envOf(ctx.ua);
    const geo = opts.geo && ctx.ip ? await (await loadGeo())(ctx.ip) : null;
    const vh = createHmac("sha256", await getSecret())
      .update(`${day}|${ctx.ip}|${ctx.ua}`)
      .digest("hex")
      .slice(0, 20);
    const cloudOf = cloud && ctx.ip ? cloud.lookup(ctx.ip) : null;
    const channel = input.entry ? classify(input.ref ?? "", input.utm ?? {}, ctx.ownHosts, env.inapp) : null;
    const doc: HitDoc = {
      _id: newId(),
      at: new Date(now),
      day,
      hour: kstHour(now),
      sid: input.sid,
      entry: input.entry,
      returning: input.returning,
      path: input.path,
      ...(input.entry && input.ref ? { ref: input.ref } : {}),
      ...(channel
        ? {
            refHost: channel.refHost,
            source: channel.source,
            site: channel.site,
            ...(channel.term ? { term: channel.term } : {}),
            ...(input.utm && Object.keys(input.utm).length ? { utm: input.utm } : {}),
          }
        : {}),
      ...env,
      ...(input.screen ? { screen: `${input.screen.w}x${input.screen.h}` } : {}),
      sw: widthBucket(input.screen?.w ?? 0),
      lang: (input.lang ?? "").slice(0, 35),
      tz: (input.tz ?? "").slice(0, 64),
      country: geo?.country ?? "",
      region: geo?.region ?? "",
      city: geo?.city ?? "",
      member: ctx.member,
      ...(ctx.member && ctx.uid ? { uid: ctx.uid } : {}),
      ...(cloudOf !== null ? { cloud: cloudOf } : {}),
      vh,
      ...(ctx.ip ? { ip: ctx.ip } : {}),
      ua: ctx.ua.slice(0, 400),
    };
    await hits.insertOne(doc);
    return true;
  }

  async function summary(day: string, now = Date.now()): Promise<DaySummary> {
    const today = kstDate(now);
    if (day < today) {
      const saved = await daily.findOne({ _id: day });
      if (saved && saved.v === SUMMARY_V) return saved as DaySummary;
      // 원본이 이미 지워진 날짜는 예전 집계를 그대로 씀
      if (saved && !(await hits.findOne({ day }, { projection: { _id: 1 } }))) return saved as DaySummary;
    }
    const docs = (await hits
      .find({ day }, { projection: { ip: 0, ua: 0, ref: 0 } })
      .toArray()) as unknown as HitDoc[];
    const s = summarize(day, docs);
    if (day < today) {
      const { _id, ...rest } = s;
      await daily.replaceOne({ _id }, rest, { upsert: true });
    }
    return s;
  }

  async function range(from: string, to: string, { human = false } = {}): Promise<RangeReport> {
    const days = daysBetween(from, to);
    const full = await Promise.all(days.map((d) => summary(d)));
    // 사람만: 날짜마다 클라우드를 뺀 집계 (예전 형식이라 없으면 전체)
    const sums = human ? full.map((s) => ({ ...s, ...(s.human ?? {}) })) : full;
    const merged = mergeSummaries(sums);
    const cloudEntries = full.reduce((a, s) => a + s.entries - (s.human?.entries ?? s.entries), 0);

    // 최근 유입 (원본이 남아 있는 것) + 세션별 본 페이지 수
    const recentDocs = (await hits
      .find({ day: { $gte: from, $lte: to }, entry: true, ...(human ? { $or: [{ cloud: { $exists: false } }, { cloud: "" }] } : {}) })
      .sort({ at: -1 })
      .limit(100)
      .toArray()) as unknown as HitDoc[];
    const sids = [...new Set(recentDocs.map((d) => d.sid))];
    const pageCounts = sids.length
      ? await hits.aggregate<{ _id: string; n: number }>([{ $match: { sid: { $in: sids } } }, { $group: { _id: "$sid", n: { $sum: 1 } } }]).toArray()
      : [];
    const pagesOf = new Map(pageCounts.map((p) => [p._id, p.n]));
    // 회원은 지금 별명으로
    const uids = [...new Set(recentDocs.map((d) => d.uid).filter((u): u is string => !!u))];
    const nicks = uids.length
      ? new Map(
          (await db.col<{ nick?: string }>("users").find({ _id: { $in: uids } }, { projection: { nick: 1 } }).toArray()).map((u) => [
            u._id,
            u.nick ?? "",
          ])
        )
      : new Map<string, string>();

    return {
      from,
      to,
      days: sums.map((s) => ({ date: s._id, hits: s.hits, entries: s.entries, uniques: s.uniques, members: s.members })),
      total: merged.total,
      dims: Object.fromEntries(Object.entries(merged.dims).map(([k, v]) => [k, v.slice(0, 30)])) as RangeReport["dims"],
      heat: merged.heat,
      cloud: {
        entries: cloudEntries,
        loaded: !!cloud?.loaded(),
        updatedAt: cloudAt || null,
        counts: cloud?.counts() ?? {},
        errors: cloudErrors,
      },
      recent: recentDocs.map((d) => ({
        at: d.at.getTime(),
        source: d.source ?? "direct",
        site: d.site ?? "",
        term: d.term ?? "",
        campaign: d.utm?.campaign ?? "",
        ref: d.ref ?? "",
        path: d.path,
        pages: pagesOf.get(d.sid) ?? 1,
        device: d.device,
        os: d.os,
        browser: d.browser,
        inapp: d.inapp,
        screen: d.screen ?? "",
        country: d.country,
        region: regionLabel(d.country, d.region),
        city: d.city,
        ip: d.ip ?? "",
        member: d.member,
        nick: d.uid ? (nicks.get(d.uid) ?? "") : "",
        returning: d.returning,
        cloud: d.cloud ?? "",
      })),
    };
  }

  /** 오늘 (클라우드 뺀 사람 기준) */
  async function today() {
    const all = await summary(kstDate(Date.now()));
    const s = all.human ?? all;
    return { entries: s.entries, uniques: s.uniques, hits: s.hits, top: s.dims.site.slice(0, 3) };
  }

  /** 클라우드 대역을 새로 받고, 그동안 못 본 기록(원본 IP 가 남은 것)에 표시 */
  async function refreshCloud(now: number) {
    if (!cloud) return;
    await cloudLoad;
    if (cloud.loaded() && now - cloudAt < CLOUD_REFRESH_MS) return;
    const { lists, errors } = await (opts.fetchLists ?? fetchCloudLists)();
    if (!Object.keys(lists).length) {
      cloudErrors = errors;
      console.warn("[traffic] 클라우드 대역을 하나도 못 받음", errors);
      return;
    }
    // 이번에 못 받은 업체는 예전 목록 유지
    const prev = (await meta.findOne({ _id: "cloud" }))?.lists ?? {};
    const merged = { ...prev, ...lists };
    cloud.set(merged);
    cloudAt = now;
    cloudErrors = errors;
    if (errors.length) console.warn("[traffic] 클라우드 대역 일부 실패", errors);
    await meta.replaceOne({ _id: "cloud" }, { at: new Date(now), lists: merged, errors }, { upsert: true });
  }

  /** 대역 목록이 없을 때 들어온 기록에 클라우드 표시 → 바뀐 날짜는 집계를 다시 */
  async function backfillCloud() {
    if (!cloud?.loaded()) return;
    const docs = await hits
      .find({ cloud: { $exists: false }, ip: { $exists: true } }, { projection: { ip: 1, day: 1 } })
      .limit(20_000)
      .toArray();
    if (!docs.length) return;
    const days = new Set<string>();
    const ops = docs.map((d) => {
      const c = cloud.lookup(String(d.ip)) ?? "";
      if (c) days.add(d.day);
      return { updateOne: { filter: { _id: d._id }, update: { $set: { cloud: c } } } };
    });
    await hits.bulkWrite(ops, { ordered: false });
    if (days.size) await daily.deleteMany({ _id: { $in: [...days] } });
  }

  /** 옛 Firebase 주소에서 온 걸 "다른 사이트"로 적어 둔 기록 → 옛 주소 */
  async function fixLegacy() {
    const old = await hits.find({ source: "referral", refHost: LEGACY_FIREBASE }, { projection: { day: 1 } }).toArray();
    if (!old.length) return;
    await hits.updateMany({ source: "referral", refHost: LEGACY_FIREBASE }, { $set: { source: "legacy", site: "firebase" } });
    await daily.deleteMany({ _id: { $in: [...new Set(old.map((d) => d.day))] } });
  }

  async function maintain(now = Date.now()) {
    await refreshCloud(now).catch((e) => console.warn("[traffic] 클라우드 대역", e));
    await backfillCloud();
    await fixLegacy();
    await hits.updateMany(
      { at: { $lt: new Date(now - IP_KEEP_DAYS * DAY) }, ip: { $exists: true } },
      { $unset: { ip: "" } }
    );
    await summary(kstDate(now - DAY), now);
  }

  return { record, summary: (d) => summary(d), range, today, maintain };
}

// ───────────── 집계 ─────────────

export const DIMS = [
  "source",
  "cloud",
  "site",
  "term",
  "campaign",
  "landing",
  "page",
  "device",
  "os",
  "browser",
  "inapp",
  "width",
  "country",
  "region",
  "lang",
] as const;
export type Dim = (typeof DIMS)[number];

export interface DaySummary extends DayCore {
  _id: string;
  v: number;
  /** 클라우드 IP 를 뺀 집계 */
  human?: DayCore;
}

export interface DayCore {
  /** 페이지 본 수 */
  hits: number;
  /** 유입(세션) 수 */
  entries: number;
  /** 순방문자 (그날 해시 수) */
  uniques: number;
  /** 회원으로 들어온 유입 */
  members: number;
  /** 전에 와 본 브라우저 */
  returning: number;
  /** 한 페이지만 보고 나간 유입 */
  bounces: number;
  /** 시간대별 유입 (0~23시, 한국 시간) */
  hours: number[];
  /** 항목별 [값, 수] (많은 순). landing·page 외에는 유입 기준, page 는 페이지 본 수 기준 */
  dims: Record<Dim, [string, number][]>;
}

export interface RangeReport {
  from: string;
  to: string;
  days: { date: string; hits: number; entries: number; uniques: number; members: number }[];
  total: Omit<DaySummary, "_id" | "v" | "dims" | "hours">;
  dims: Record<Dim, [string, number][]>;
  /** 요일(0=일) × 시(0~23) 유입 수 */
  heat: number[][];
  /** 클라우드 IP 유입 수(기간 전체) · 대역 목록 상태 */
  cloud: { entries: number; loaded: boolean; updatedAt: number | null; counts: Record<string, number>; errors: string[] };
  recent: {
    at: number;
    source: Source;
    site: string;
    term: string;
    campaign: string;
    ref: string;
    path: string;
    pages: number;
    device: string;
    os: string;
    browser: string;
    inapp: string;
    screen: string;
    country: string;
    region: string;
    city: string;
    ip: string;
    member: boolean;
    /** 회원 별명 (지금 이름, 지워진 회원은 "") */
    nick: string;
    returning: boolean;
    /** 클라우드 업체 ("" = 아님) */
    cloud: string;
  }[];
}

const top = (m: Map<string, number>, n = KEEP_TOP): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const add = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

export function summarize(day: string, docs: HitDoc[]): DaySummary {
  return { _id: day, v: SUMMARY_V, ...core(docs), human: core(docs.filter((h) => !h.cloud)) };
}

function core(docs: HitDoc[]): DayCore {
  const maps = Object.fromEntries(DIMS.map((d) => [d, new Map<string, number>()])) as Record<Dim, Map<string, number>>;
  const hours = Array<number>(24).fill(0);
  const perSession = new Map<string, number>();
  const vhs = new Set<string>();
  let entries = 0,
    members = 0,
    returning = 0;

  for (const h of docs) {
    vhs.add(h.vh);
    perSession.set(h.sid, (perSession.get(h.sid) ?? 0) + 1);
    add(maps.page, h.path);
    if (!h.entry) continue;
    entries++;
    if (h.member) members++;
    if (h.returning) returning++;
    hours[h.hour] = (hours[h.hour] ?? 0) + 1;
    add(maps.source, h.source ?? "direct");
    if (h.cloud) add(maps.cloud, h.cloud);
    add(maps.site, h.source === "direct" || !h.source ? "" : h.site || h.source);
    if (h.term) add(maps.term, h.term);
    if (h.utm?.campaign) add(maps.campaign, h.utm.campaign);
    add(maps.landing, h.path);
    add(maps.device, h.device);
    add(maps.os, h.os);
    add(maps.browser, h.browser);
    if (h.inapp) add(maps.inapp, h.inapp);
    add(maps.width, h.sw);
    add(maps.country, h.country);
    add(maps.region, regionLabel(h.country, h.region));
    add(maps.lang, (h.lang || "").split("-")[0].toLowerCase());
  }
  const entrySids = new Set(docs.filter((h) => h.entry).map((h) => h.sid));
  let bounces = 0;
  for (const sid of entrySids) if (perSession.get(sid) === 1) bounces++;

  return {
    hits: docs.length,
    entries,
    uniques: vhs.size,
    members,
    returning,
    bounces,
    hours,
    dims: Object.fromEntries(DIMS.map((d) => [d, top(maps[d])])) as Record<Dim, [string, number][]>,
  };
}

export function mergeSummaries(list: (DayCore & { _id: string })[]) {
  const maps = Object.fromEntries(DIMS.map((d) => [d, new Map<string, number>()])) as Record<Dim, Map<string, number>>;
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const total = { hits: 0, entries: 0, uniques: 0, members: 0, returning: 0, bounces: 0 };
  for (const s of list) {
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += s[k] ?? 0;
    for (const d of DIMS) for (const [k, n] of s.dims?.[d] ?? []) add(maps[d], k, n);
    const wd = new Date(`${s._id}T00:00:00Z`).getUTCDay();
    s.hours?.forEach((n, h) => (heat[wd][h] += n));
  }
  return { total, heat, dims: Object.fromEntries(DIMS.map((d) => [d, top(maps[d])])) as Record<Dim, [string, number][]> };
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
