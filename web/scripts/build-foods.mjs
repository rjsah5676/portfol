/**
 * 식약처 "전국통합식품영양성분정보" 표준데이터 CSV → public/data/foods.json
 *
 *   npm run foods            (data/raw/*.csv 전부)
 *   node scripts/build-foods.mjs a.csv b.csv
 *
 * - 공공데이터포털 CSV는 EUC-KR(CP949)인 경우가 많아서 인코딩을 자동으로 판별한다.
 * - 컬럼 순서·이름이 버전마다 조금씩 달라서 이름 패턴으로 찾는다.
 * - 모든 영양소는 "100g(또는 100ml)당"으로 맞춰 저장한다.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.join("public", "data", "foods.json");
// 인자가 없으면 data/raw/ 안의 CSV 전부 (원본 CSV는 용량이 커서 git에는 안 올림)
const RAW = path.join("data", "raw");
const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : fs.existsSync(RAW)
      ? fs
          .readdirSync(RAW)
          .filter((f) => /\.csv$/i.test(f))
          .map((f) => path.join(RAW, f))
      : [];
if (!files.length) {
  console.error("data/raw/ 에 식약처 표준데이터 CSV를 넣고 다시 실행하세요. (npm run foods)");
  process.exit(1);
}

function decode(buf) {
  const utf8 = new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("euc-kr").decode(buf);
}

/** 따옴표·줄바꿈 들어간 CSV까지 처리 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') ((cell += '"'), i++);
        else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((x) => x.trim() !== "")) rows.push(row);
  }
  return rows;
}

const norm = (s) => s.replace(/\s+/g, "").replace(/[()（）\[\]]/g, "");
/** 헤더에서 패턴에 맞는 첫 컬럼 번호 */
function col(header, ...patterns) {
  const h = header.map(norm);
  for (const p of patterns) {
    const i = h.findIndex((x) => p.test(x));
    if (i >= 0) return i;
  }
  return -1;
}

/** "1,234.5" → 1234.5, "-"·""·"N/A" → null, "tr"(미량) → 0 */
function num(v) {
  if (v === undefined) return null;
  const s = String(v).trim().replace(/,/g, "");
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return null;
  if (/^tr$/i.test(s)) return 0;
  const m = /^-?\d+(\.\d+)?/.exec(s);
  return m ? Number(m[0]) : null;
}
/** "100g", "250 ml", "1인분(400g)" → 그램/ml 숫자 */
function amount(v) {
  if (!v) return null;
  const s = String(v).replace(/,/g, "");
  const m = /(\d+(?:\.\d+)?)\s*(g|ml|mL|그램)/.exec(s) || /^(\d+(?:\.\d+)?)$/.exec(s.trim());
  return m ? Number(m[1]) : null;
}
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

// ───────────────────────── 이름 다듬기 ─────────────────────────
// 표준데이터 식품명은 "대분류_세부" 형식 ("김치찌개_돼지고기", "감자_수미_생것", "커피_카페 라떼 핫(HOT)")
const NOISE = new Set(["대표", "평균", "전체"]);
function displayName(raw, kind, maker) {
  const parts = raw
    .split("_")
    .map((p) => p.trim())
    .filter((p) => p && !NOISE.has(p));
  if (parts.length <= 1) return maker ? `${maker} ${parts[0] ?? raw}` : (parts[0] ?? raw);
  const [head, ...rest] = parts;
  if (kind === "원재료") return `${head} (${rest.join(", ")})`;
  // 브랜드 제품: 뒤쪽이 곧 상품명 → "도미노피자 슈퍼디럭스 피자"
  if (maker) {
    const product = rest.join(" ");
    return product.startsWith(maker) ? product : `${maker} ${product}`;
  }
  // 일반 음식: "돼지고기 김치찌개", 뒤에 이미 대분류가 들어있으면 그대로 ("짬뽕라면")
  // "짬뽕라면", "불고기버거"처럼 뒤에 이미 대분류(또는 끝 두 글자)가 들어있으면 그대로
  const tailOfHead = head.length >= 3 ? head.slice(-2) : head;
  return rest[0].includes(head) || rest[0].includes(tailOfHead)
    ? rest.join(" ")
    : `${rest.join(" ")} ${head}`;
}

// 음식별 정적 페이지는 수백 개로 제한 (페이지마다 공통 레이아웃이 ~150KB라 전부 만들면 배포가 수백 MB)
// - 일반 음식: 여러 조사에 3번 이상 나온 흔한 요리 + 꼭 넣을 인기 음식
// - 원재료: 자주 찾는 분류에서 대표 1개씩 ("감자_생것" 같은 기본형)
const PAGE_MIN_SURVEYS = 3;
const PAGE_MUST = new Set([
  "햄버거",
  "피자",
  "라면",
  "김치찌개",
  "된장찌개",
  "비빔밥",
  "김밥",
  "떡볶이",
  "짜장면",
  "짬뽕",
  "돈가스",
  "삼겹살구이",
  "쌀밥",
  "우유",
  "치킨",
  "후라이드치킨",
  "양념치킨",
  "탕수육",
  "냉면",
  "제육볶음",
  "불고기",
  "순두부찌개",
  "부대찌개",
  "잡채",
  "만두",
  "샌드위치",
  "토스트",
]);
const PAGE_RAW_CATS = /과일|감자|난류|우유|견과/;

const PRIORITY = [1, 3, 2, 5, 6, 4, 7, 8, 9];
const priority = (code) => {
  const m = /^D(\d)/.exec(code);
  return m ? PRIORITY.indexOf(Number(m[1])) : 50;
};

const byKey = new Map();
const surveys = new Map();
let total = 0;
for (const file of files) {
  const rows = parseCsv(decode(fs.readFileSync(file)));
  const header = rows[0];
  const C = {
    code: col(header, /^식품코드/),
    name: col(header, /^식품명/),
    kind: col(header, /^데이터구분명/, /^데이터구분/),
    cat: col(header, /^식품대분류명/, /^식품대분류/, /^대표식품명/),
    maker: col(header, /^업체명/, /^제조사명/),
    base: col(header, /^영양성분함량기준량/, /^영양성분기준량/),
    serving: col(header, /^1회섭취참고량/, /^1회제공량/, /^1인분량/, /^식품중량/),
    kcal: col(header, /^에너지kcal/, /^에너지/, /^열량/),
    carb: col(header, /^탄수화물g/, /^탄수화물/),
    protein: col(header, /^단백질g/, /^단백질/),
    fat: col(header, /^지방g/, /^지방$/),
    sugar: col(header, /^당류g/, /^당류/, /^총당류/),
    fiber: col(header, /^식이섬유g/, /^총식이섬유/, /^식이섬유/),
    sodium: col(header, /^나트륨mg/, /^나트륨/),
    satfat: col(header, /^포화지방산g/, /^포화지방/),
    chol: col(header, /^콜레스테롤mg/, /^콜레스테롤/),
  };
  for (const k of ["code", "name", "kcal", "carb", "protein", "fat"])
    if (C[k] < 0)
      throw new Error(`${file}: '${k}' 컬럼을 찾지 못했습니다. 헤더: ${header.join(" | ")}`);

  const kindFromFile = /원재료/.test(file) ? "원재료" : /가공/.test(file) ? "가공식품" : "음식";
  for (const r of rows.slice(1)) {
    const rawName = (r[C.name] ?? "").trim().replace(/\s+/g, " ");
    const kcal = num(r[C.kcal]);
    if (!rawName || kcal === null) continue;
    const base = (C.base >= 0 && amount(r[C.base])) || 100;
    const per100 = (v) => (v === null ? null : (v * 100) / base);
    const code = String(r[C.code])
      .trim()
      .replace(/[^A-Za-z0-9-]/g, "");
    if (!code) continue;
    const kindRaw = C.kind >= 0 ? (r[C.kind] ?? "").trim() : "";
    const kind = /원재료/.test(kindRaw)
      ? "원재료"
      : /가공/.test(kindRaw)
        ? "가공식품"
        : kindRaw
          ? "음식"
          : kindFromFile;
    const makerRaw = C.maker >= 0 ? (r[C.maker] ?? "").trim() : "";
    const maker = /^(해당\s*없음|없음|-)?$/.test(makerRaw) ? "" : makerRaw;
    const cat = C.cat >= 0 ? (r[C.cat] ?? "").trim() : "";
    const serving = C.serving >= 0 ? amount(r[C.serving]) : null;
    const item = {
      id: code,
      name: displayName(rawName, kind, maker),
      cat,
      kind,
      maker,
      // 기준량(100g)과 같으면 의미 없으니 뺌
      serving: serving && serving !== base ? serving : null,
      kcal: r1(per100(kcal)),
      carb: r1(per100(num(r[C.carb]))),
      protein: r1(per100(num(r[C.protein]))),
      fat: r1(per100(num(r[C.fat]))),
      sugar: C.sugar >= 0 ? r1(per100(num(r[C.sugar]))) : null,
      fiber: C.fiber >= 0 ? r1(per100(num(r[C.fiber]))) : null,
      sodium: C.sodium >= 0 ? r1(per100(num(r[C.sodium]))) : null,
      satfat: C.satfat >= 0 ? r1(per100(num(r[C.satfat]))) : null,
      chol: C.chol >= 0 ? r1(per100(num(r[C.chol]))) : null,
      page: 0,
      _raw: rawName,
    };
    total++;
    surveys.set(`${kind}|${rawName}`, (surveys.get(`${kind}|${rawName}`) ?? 0) + 1);
    // 같은 이름이 여러 조사에서 나오면 대표 DB 쪽을 고름
    // (음식 코드 D1xx 대표 DB > D3xx > D2xx > 나머지 급식·조리 조사 순)
    const key = `${item.kind}|${item.name}`;
    const prev = byKey.get(key);
    if (!prev || priority(item.id) < priority(prev.id)) byKey.set(key, item);
  }
}

const items = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));

// 페이지 만들 음식 고르기
const rawHeadDone = new Set();
const rawRank = (it) =>
  !it._raw.includes("_") || it._raw === `${it._raw.split("_")[0]}_생것`
    ? 0
    : /생것$/.test(it._raw)
      ? 1
      : 2;
for (const it of [...items].sort((a, b) => rawRank(a) - rawRank(b))) {
  if (it.maker) continue;
  if (it.kind === "음식") {
    const plain = !it._raw.includes("_");
    const n = surveys.get(`${it.kind}|${it._raw}`) ?? 0;
    if (PAGE_MUST.has(it._raw) || (plain && n >= PAGE_MIN_SURVEYS)) it.page = 1;
  } else if (it.kind === "원재료" && PAGE_RAW_CATS.test(it.cat) && rawRank(it) < 2) {
    const head = it._raw.split("_")[0];
    if (!rawHeadDone.has(head)) {
      rawHeadDone.add(head);
      it.page = 1;
    }
  }
}
// 식품코드가 겹치는 행이 있어서 페이지 주소가 충돌하지 않게 뒤에 번호를 붙임
const seen = new Map();
for (const it of items) {
  const n = seen.get(it.id) ?? 0;
  seen.set(it.id, n + 1);
  if (n) it.id = `${it.id}-${n + 1}`;
}
// 용량 줄이려고 배열로 저장 (순서는 FIELDS)
const FIELDS = [
  "id",
  "name",
  "cat",
  "kind",
  "maker",
  "serving",
  "kcal",
  "carb",
  "protein",
  "fat",
  "sugar",
  "fiber",
  "sodium",
  "satfat",
  "chol",
  "page",
];
const out = {
  source: "식품의약품안전처 전국통합식품영양성분정보 표준데이터",
  builtAt: new Date().toISOString().slice(0, 10),
  fields: FIELDS,
  items: items.map((it) => FIELDS.map((f) => it[f])),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
const pages = items.filter((it) => it.page).length;
console.log(
  `읽은 행 ${total} → 저장 ${items.length}개, 음식별 페이지 ${pages}개 (${kb} KB) → ${OUT}`
);
