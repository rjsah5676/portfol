/*
 * VIRUS IDLE GP 상점 — 디펜스(lib/defense/progress.ts 의 GP_STORE · GP_SELL · GP_PACKS)와 같은 모델.
 * 서버(server/src/http/virus.ts)와 화면이 같이 씀.
 *
 *  - 데이터 · 루트 권한 · 조각 · 키는 스테이지에 따라 값이 수십 자릿수로 바뀌어서 GP와 고정 교환을 하지 않음.
 *    GP로 오가는 건 어느 단계에서나 가치가 같은 것만: 커널 코어 · 시간 가속(자리 비움 시뮬레이션 N시간) · 편의성 해금
 *  - 산 것은 서버가 「받을 물건」(users.virusShop.pending) 에 쌓고, 게임이 받아 가서 저장본에 넣음
 *    (편의성은 계정 보유 목록 inv.virus 에 바로 — 새 게임 · 다른 기기에서도 열림)
 */

/** 오가는 것 */
export interface VGoods {
  /** 커널 코어 */
  cores?: number;
  /** 시간 가속 (시간) — 받으면 자리 비움 시뮬레이션으로 그만큼 진행 (100% 효율) */
  warpH?: number;
  /** 편의성 해금 (루트 상점 util 의 key — inv.virus) */
  utils?: string[];
  /** 꾸미기 (스킨 `skin.<id>` — inv.virus, 이득 % 셈에서 뺌) */
  items?: string[];
}

/**
 * GP 기준값 — 재화샵 값 (= 100%). 패키지 이득 % 는 이 값으로 셈.
 * 커널 코어 1,000GP (1000스테이지까지 9개 남짓 · 커널 패치는 갈수록 비쌈) · 시간 가속 1시간 500GP (최적으로 1000까지 약 8시간)
 */
export const VGP_VALUE = { cores: 1000, warpH: 500 } as const;

/** 편의성 GP 가격 (lib/points.ts SHOP 의 virus.util.* 와 같게) */
export const VUTIL_GP: Record<string, number> = {
  profiler: 500,
  cron: 1000,
  daemon: 3000,
  kprof: 1500,
  autoc: 2000,
  kalloc: 1500,
};

export const vgoodsGp = (g: VGoods) =>
  (g.cores ?? 0) * VGP_VALUE.cores +
  (g.warpH ?? 0) * VGP_VALUE.warpH +
  (g.utils ?? []).reduce((a, k) => a + (VUTIL_GP[k] ?? 0), 0);

export interface VStoreItem {
  id: string;
  name: string;
  gp: number;
  give: VGoods;
}
/** 재화샵: GP → 게임 재화 (기준값 그대로 — 효율 낮음, 급할 때 · 남는 GP 용) · 횟수 제한 없음 */
export const VGP_STORE: VStoreItem[] = [
  { id: "s_core", name: "커널 코어 1", gp: 1000, give: { cores: 1 } },
  { id: "s_warp1", name: "시간 가속 1시간", gp: 500, give: { warpH: 1 } },
];

export interface VSellItem {
  id: string;
  name: string;
  /** 내는 커널 코어 */
  cores: number;
  gp: number;
  perWeek: number;
}
/** 재화 → GP: 기준값의 절반 · 주 한도 */
export const VGP_SELL: VSellItem[] = [
  { id: "x_core", name: "커널 코어 1 → GP", cores: 1, gp: 500, perWeek: 2 },
];

export interface VPackDef {
  id: string;
  name: string;
  desc: string;
  gp: number;
  give: VGoods;
  /** 한 번만 (계정) */
  once?: boolean;
  /** 하루마다 (한국 시간 0시) */
  perDay?: number;
  /** 주마다 (once · perDay 가 아니면) */
  perWeek?: number;
  /** 이 스테이지를 넘어야 보임 (서버 기록 stats.virus.best) */
  needBest?: number;
}
/** 패키지: GP 로만, 기준값의 3~6배 (이득 % = vgoodsGp ÷ gp) */
export const VGP_PACKS: VPackDef[] = [
  {
    id: "p_daily",
    name: "일일 보급",
    desc: "매일 — 시간 가속 2시간",
    gp: 300,
    perDay: 1,
    give: { warpH: 2 },
  },
  {
    id: "p_start",
    name: "신입 해커 꾸러미",
    desc: "처음 한 번 — 크론 데몬 + 시간 가속 3시간",
    gp: 1000,
    once: true,
    give: { utils: ["daemon"], warpH: 3 },
  },
  {
    id: "p_week",
    name: "주간 보급",
    desc: "매주 — 시간 가속 8시간 · 커널 코어 2",
    gp: 1500,
    perWeek: 1,
    give: { warpH: 8, cores: 2 },
  },
  {
    id: "p_kernel",
    name: "커널 꾸러미",
    desc: "매주 — 커널 코어 10",
    gp: 2000,
    perWeek: 1,
    give: { cores: 10 },
  },
  {
    id: "p_void",
    name: "보이드 꾸러미",
    desc: "한 번 — 스킨 「보이드」(패키지 전용) + 시간 가속 6시간 · 커널 코어 2",
    gp: 4000,
    once: true,
    give: { items: ["skin.void"], warpH: 6, cores: 2 },
  },
  {
    id: "p_dark",
    name: "다크웹 개척 꾸러미",
    desc: "스테이지 500을 넘긴 뒤 한 번",
    gp: 3000,
    once: true,
    needBest: 500,
    give: { cores: 10, warpH: 10 },
  },
  {
    id: "p_core",
    name: "글로벌 코어 꾸러미",
    desc: "스테이지 1000을 넘긴 뒤 한 번",
    gp: 5000,
    once: true,
    needBest: 1000,
    give: { cores: 20, warpH: 20 },
  },
];
export const VPACK: Record<string, VPackDef> = Object.fromEntries(VGP_PACKS.map((x) => [x.id, x]));
/** 패키지 이득 % (재화샵 값 대비) */
export const vpackPct = (pk: VPackDef) => Math.round((vgoodsGp(pk.give) / pk.gp) * 100);

/** 게임이 받아 가는 물건 · 화면에 내려가는 상점 상태 */
export interface VShopState {
  pending: { cores: number; warpH: number };
  /** 이번 주 · 오늘 산 횟수 (상품 id), 한 번짜리로 산 것 */
  week: Record<string, number>;
  day: Record<string, number>;
  once: string[];
  /** 서버 기록의 넘은 최고 스테이지 (패키지 조건) */
  best: number;
}

/** 시간 가속 한 번에 받는 최대 (시간) — 너무 길면 나눠서 */
export const WARP_MAX_H = 48;
