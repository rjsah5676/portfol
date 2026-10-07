import { isIP } from "node:net";

/*
 * 클라우드(데이터센터) IP 대역 → 업체 이름.
 * 사람이 아니라 서버에서 돌아가는 봇·크롤러가 진짜 Chrome 처럼 들어오는 걸 표시하려고 씀 (isbot 이 못 거르는 것).
 * 업체들이 공개하는 대역 목록을 하루에 한 번 받아서 DB(traffic_meta)에 저장해 둠 → 재시작해도 바로 씀.
 */

export type CloudSource = { name: string; url: string | (() => Promise<string>); parse: (body: string) => string[] };

/** 업체별 공개 대역 목록 */
export const CLOUD_SOURCES: CloudSource[] = [
  {
    name: "AWS",
    url: "https://ip-ranges.amazonaws.com/ip-ranges.json",
    parse(body) {
      const j = JSON.parse(body) as { prefixes?: { ip_prefix?: string }[]; ipv6_prefixes?: { ipv6_prefix?: string }[] };
      return [...(j.prefixes ?? []).map((p) => p.ip_prefix), ...(j.ipv6_prefixes ?? []).map((p) => p.ipv6_prefix)].filter(
        (x): x is string => !!x
      );
    },
  },
  {
    name: "GCP",
    url: "https://www.gstatic.com/ipranges/cloud.json",
    parse(body) {
      const j = JSON.parse(body) as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] };
      return (j.prefixes ?? []).map((p) => p.ipv4Prefix ?? p.ipv6Prefix).filter((x): x is string => !!x);
    },
  },
  {
    name: "Azure",
    // 파일 주소가 매주 바뀌어서 안내 페이지에서 찾음
    url: async () => {
      const page = await fetchText("https://www.microsoft.com/en-us/download/details.aspx?id=56519");
      const m = /https:\/\/download\.microsoft\.com\/download\/[^"'\s]+?ServiceTags_Public_\d+\.json/.exec(page);
      if (!m) throw new Error("Azure 대역 파일 주소를 못 찾음");
      return fetchText(m[0]);
    },
    parse(body) {
      const j = JSON.parse(body) as { values?: { name?: string; properties?: { addressPrefixes?: string[] } }[] };
      return j.values?.find((v) => v.name === "AzureCloud")?.properties?.addressPrefixes ?? [];
    },
  },
  {
    name: "Oracle",
    url: "https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json",
    parse(body) {
      const j = JSON.parse(body) as { regions?: { cidrs?: { cidr?: string }[] }[] };
      return (j.regions ?? []).flatMap((r) => (r.cidrs ?? []).map((c) => c.cidr)).filter((x): x is string => !!x);
    },
  },
  {
    name: "DigitalOcean",
    url: "https://digitalocean.com/geo/google.csv",
    parse: (body) =>
      body
        .split(/\r?\n/)
        .map((l) => l.split(",")[0]?.trim())
        .filter((x) => !!x && x.includes("/")),
  },
];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "gunmo.my traffic (cloud ranges)" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

// ───────────── 대역 → 숫자 구간 ─────────────

type Range = [start: bigint, end: bigint, provider: number];

function ipToBig(ip: string): { v: 4 | 6; n: bigint } | null {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ip.split(".").map(Number);
    return { v: 4, n: BigInt(((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) };
  }
  if (kind === 6) {
    // "::ffff:1.2.3.4" 같은 IPv4 섞인 표기
    const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    let s = ip;
    if (v4) {
      const n = ipToBig(v4[2])!.n;
      s = `${v4[1]}${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
    }
    const [head, tail] = s.split("::");
    const h = head ? head.split(":") : [];
    const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
    const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
    if (groups.length !== 8) return null;
    return { v: 6, n: groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g || "0", 16)), 0n) };
  }
  return null;
}

function cidrToRange(cidr: string): { v: 4 | 6; start: bigint; end: bigint } | null {
  const [ip, bitsStr] = cidr.trim().split("/");
  const a = ipToBig(ip);
  if (!a) return null;
  const total = a.v === 4 ? 32 : 128;
  const bits = bitsStr === undefined ? total : Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > total) return null;
  const host = (1n << BigInt(total - bits)) - 1n;
  const start = a.n & ~host & ((1n << BigInt(total)) - 1n);
  return { v: a.v, start, end: start | host };
}

/** 시작점 순으로 정렬하고 겹치거나 붙은 구간을 합침 (겹치면 앞 구간의 업체로) */
function merge(list: Range[]): Range[] {
  list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out: Range[] = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1n && (r[2] === last[2] || r[0] <= last[1])) {
      if (r[1] > last[1]) {
        if (r[2] === last[2]) last[1] = r[1];
        // 다른 업체가 걸쳐 있으면 겹치지 않는 뒷부분만 따로
        else out.push([last[1] + 1n, r[1], r[2]]);
      }
    } else out.push([...r] as Range);
  }
  return out;
}

export interface CloudIps {
  /** 그 IP 가 속한 클라우드 업체 이름 (아니면 "", 목록을 아직 못 받았으면 null) */
  lookup(ip: string): string | null;
  /** 업체 → CIDR 목록으로 새로 채움 */
  set(lists: Record<string, string[]>): void;
  loaded(): boolean;
  counts(): Record<string, number>;
}

export function createCloudIps(): CloudIps {
  let names: string[] = [];
  let v4: Range[] = [];
  let v6: Range[] = [];
  let counts: Record<string, number> = {};
  let ready = false;

  const find = (list: Range[], n: bigint): string => {
    // 겹치지 않게 합친 구간에서 시작 <= n 인 마지막 구간
    let lo = 0,
      hi = list.length - 1,
      at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= n) {
        at = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return at >= 0 && list[at][1] >= n ? names[list[at][2]] : "";
  };

  return {
    lookup(ip) {
      if (!ready) return null;
      const a = ipToBig(ip);
      if (!a) return "";
      return find(a.v === 4 ? v4 : v6, a.n);
    },
    set(lists) {
      const nextNames = Object.keys(lists);
      const n4: Range[] = [];
      const n6: Range[] = [];
      const c: Record<string, number> = {};
      nextNames.forEach((name, i) => {
        c[name] = 0;
        for (const cidr of lists[name]) {
          const r = cidrToRange(cidr);
          if (!r) continue;
          (r.v === 4 ? n4 : n6).push([r.start, r.end, i]);
          c[name]++;
        }
      });
      names = nextNames;
      v4 = merge(n4);
      v6 = merge(n6);
      counts = c;
      ready = true;
    },
    loaded: () => ready,
    counts: () => ({ ...counts }),
  };
}

/** 전부 받아 옴. 실패한 업체는 빠지고 이유를 errors 에 */
export async function fetchCloudLists(sources = CLOUD_SOURCES): Promise<{ lists: Record<string, string[]>; errors: string[] }> {
  const lists: Record<string, string[]> = {};
  const errors: string[] = [];
  await Promise.all(
    sources.map(async (s) => {
      try {
        const body = typeof s.url === "string" ? await fetchText(s.url) : await s.url();
        const cidrs = s.parse(body);
        if (!cidrs.length) throw new Error("빈 목록");
        lists[s.name] = cidrs;
      } catch (e) {
        errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );
  return { lists, errors };
}
