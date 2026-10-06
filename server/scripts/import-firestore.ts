import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AnyBulkWriteOperation, Db } from "mongodb";
import { loadConfig, loadDotEnv } from "../src/config";
import { connectDatabase, RANK_COLLECTIONS, type Doc } from "../src/db";

/*
 * 기존 Firebase 프로젝트의 Firestore 데이터를 MongoDB로 복사.
 *
 *   npm run import:firestore                       # 전부
 *   npm run import:firestore -- --dry-run          # DB에 쓰지 않고 개수만 확인
 *   npm run import:firestore -- --only score,guest # 일부만
 *
 * - Firestore REST API로 읽음 (공개 읽기가 열려 있는 컬렉션은 로그인·서비스 계정 없이 됨)
 * - 문서 id를 그대로 _id로 쓰고 덮어쓰기(upsert) → 여러 번 실행해도 중복이 생기지 않음
 * - 옮기는 것: 랭킹 전부, 리듬게임 랭킹, 방명록, 방문자 수, 글(개인 공부·회고), 예전 스케치 퀴즈 데이터
 *   문의(inquiries)는 관리자만 읽을 수 있어서 --admin-email/--admin-password 를 줬을 때만
 * - 안 옮기는 것: 진행 중인 대국방(체스·장기·오목)과 Realtime Database의 스케치·격투 방 (일시적인 데이터)
 */

const DEFAULT_PROJECT = "gunmo-portfolio";
// web/src/firebase.ts 의 공개 웹 설정값
const DEFAULT_API_KEY = "AIzaSyC-833NLKJyKbNAuIj07ZqO9lt2GYHD5UM";
const DIFFS = ["easy", "normal", "hard", "expert", "nightmare"];
/** 그대로 옮기는 컬렉션 (필드 그대로) */
const PLAIN_COLLECTIONS = ["guest", "siteStats", "studyPosts", "sketch_user", "sketch_user_room", "sketch_user_chat"];

export interface ImportOptions {
  project?: string;
  apiKey?: string;
  /** 일부만 옮길 때: 컬렉션 이름 (리듬게임은 "rhythm_rankings", 문의는 "inquiries") */
  only?: string[];
  /** 리듬게임 차트(곡id_난이도) 목록 */
  charts?: string[];
  adminEmail?: string;
  adminPassword?: string;
  dryRun?: boolean;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface ImportResult {
  /** 컬렉션별 옮긴 문서 수 */
  counts: Record<string, number>;
  /** 실패한 것 (컬렉션 → 이유) */
  errors: Record<string, string>;
  skipped: string[];
}

// ───────────── Firestore REST 값 → JS 값 ─────────────

type FsValue = Record<string, unknown>;
interface FsDocument {
  name: string;
  fields?: Record<string, FsValue>;
  createTime?: string;
  updateTime?: string;
}

export function fromFirestoreValue(v: FsValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return new Date(String(v.timestampValue));
  if ("mapValue" in v) return fromFirestoreFields((v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {});
  if ("arrayValue" in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(fromFirestoreValue);
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  if ("bytesValue" in v) return v.bytesValue;
  return null;
}
export const fromFirestoreFields = (fields: Record<string, FsValue>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromFirestoreValue(v)]));

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** 리듬게임 곡 id: 프론트의 채보 파일 이름과 같음 (web/src/data/rhythm/<곡id>.json) */
export function defaultCharts(): string[] {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/src/data/rhythm");
  let songs: string[] = [];
  try {
    songs = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    // 프론트 폴더 없이 실행한 경우 → --charts 로 지정
  }
  return songs.flatMap((s) => DIFFS.map((d) => `${s}_${d}`));
}

export async function importFirestore(db: Db, opts: ImportOptions = {}): Promise<ImportResult> {
  const project = opts.project ?? DEFAULT_PROJECT;
  const apiKey = opts.apiKey ?? DEFAULT_API_KEY;
  const fetchFn = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const result: ImportResult = { counts: {}, errors: {}, skipped: [] };
  const wanted = (name: string) => !opts.only?.length || opts.only.includes(name);

  /** 컬렉션(경로)의 문서를 끝까지 읽음 */
  async function listAll(collectionPath: string, token?: string): Promise<FsDocument[]> {
    const docs: FsDocument[] = [];
    let pageToken = "";
    do {
      const url = `${base}/${collectionPath}?pageSize=300&key=${apiKey}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const res = await fetchFn(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new HttpError(res.status, `HTTP ${res.status} ${body.slice(0, 200).replace(/\s+/g, " ")}`);
      }
      const json = (await res.json()) as { documents?: FsDocument[]; nextPageToken?: string };
      docs.push(...(json.documents ?? []));
      pageToken = json.nextPageToken ?? "";
    } while (pageToken);
    return docs;
  }

  async function save(collection: string, docs: Doc<Record<string, unknown>>[]) {
    result.counts[collection] = (result.counts[collection] ?? 0) + docs.length;
    if (opts.dryRun || !docs.length) return;
    const ops: AnyBulkWriteOperation<Doc<Record<string, unknown>>>[] = docs.map((d) => ({
      replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true },
    }));
    for (let i = 0; i < ops.length; i += 500)
      await db.collection<Doc<Record<string, unknown>>>(collection).bulkWrite(ops.slice(i, i + 500), { ordered: false });
  }

  const toDoc = (d: FsDocument, extra: Record<string, unknown> = {}): Doc<Record<string, unknown>> => ({
    _id: d.name.split("/").pop()!,
    ...fromFirestoreFields(d.fields ?? {}),
    ...extra,
  });
  /** 랭킹: 날짜 필드가 생기기 전의 예전 기록은 문서가 만들어진 시각으로 채움 */
  const toRankDoc = (d: FsDocument, extra: Record<string, unknown> = {}) => {
    const doc = toDoc(d, extra);
    if (!(doc.createdAt instanceof Date) && d.createTime) doc.createdAt = new Date(d.createTime);
    return doc;
  };

  async function step(name: string, run: () => Promise<void>) {
    if (!wanted(name)) return;
    try {
      await run();
      log(`  ${name}: ${result.counts[name] ?? 0}개`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors[name] = msg;
      log(`  ${name}: 실패 — ${msg}`);
    }
  }

  for (const c of RANK_COLLECTIONS)
    await step(c, async () => save(c, (await listAll(c)).map((d) => toRankDoc(d))));

  // 리듬게임: rhythm_rankings/{곡id_난이도}/scores/{id} → rhythm_rankings 컬렉션에 chart 필드로 구분
  await step("rhythm_rankings", async () => {
    result.counts.rhythm_rankings = 0;
    for (const chart of opts.charts ?? defaultCharts()) {
      const docs = await listAll(`rhythm_rankings/${chart}/scores`);
      await save(
        "rhythm_rankings",
        docs.map((d) => toRankDoc(d, { chart }))
      );
    }
  });

  for (const c of PLAIN_COLLECTIONS) await step(c, async () => save(c, (await listAll(c)).map((d) => toDoc(d))));

  // 문의는 관리자만 읽을 수 있음 → 관리자 계정으로 로그인해서 받은 토큰으로 조회
  if (wanted("inquiries")) {
    if (!opts.adminEmail || !opts.adminPassword) {
      result.skipped.push("inquiries");
      log("  inquiries: 건너뜀 (관리자만 읽을 수 있음 → --admin-email, --admin-password 를 주면 옮김)");
    } else {
      await step("inquiries", async () => {
        const res = await fetchFn(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: opts.adminEmail, password: opts.adminPassword, returnSecureToken: true }),
        });
        if (!res.ok) throw new HttpError(res.status, `관리자 로그인 실패 (HTTP ${res.status})`);
        const { idToken } = (await res.json()) as { idToken: string };
        await save("inquiries", (await listAll("inquiries", idToken)).map((d) => toDoc(d)));
      });
    }
  }

  return result;
}

// ───────────── 명령줄 ─────────────

function parseArgs(argv: string[]) {
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [key, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
    else flags[key] = true;
  }
  return flags;
}
const csv = (v: string | true | undefined) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const str = (v: string | true | undefined) => (typeof v === "string" ? v : undefined);

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(
      [
        "사용: npm run import:firestore -- [옵션]",
        "  --dry-run                DB에 쓰지 않고 개수만 확인",
        "  --only a,b               일부 컬렉션만 (예: score,guest,studyPosts,rhythm_rankings,inquiries)",
        "  --charts a_easy,b_hard   리듬게임 차트를 직접 지정 (기본: web/src/data/rhythm 의 곡 × 난이도 5개)",
        "  --admin-email, --admin-password   문의(inquiries)까지 옮길 때 (환경변수 ADMIN_EMAIL, ADMIN_PASSWORD 도 가능)",
        "  --project, --api-key     다른 Firebase 프로젝트에서 가져올 때",
        "MongoDB 주소는 서버와 같은 환경변수(MONGODB_URI, MONGODB_DB)를 씀. 없으면 내장 MongoDB.",
      ].join("\n")
    );
    return;
  }
  const dryRun = flags["dry-run"] === true;
  loadDotEnv();
  const cfg = loadConfig();
  if (!cfg.mongoUri && !dryRun)
    console.log("MONGODB_URI 가 없어 내장 MongoDB에 넣습니다. 서버(npm run dev)가 켜져 있으면 먼저 꺼주세요.");
  const database = dryRun ? null : await connectDatabase(cfg);
  console.log(`Firestore → MongoDB${dryRun ? " (dry-run: 쓰지 않음)" : ` (${cfg.mongoDb})`}`);
  try {
    const result = await importFirestore(database?.db as Db, {
      project: str(flags.project),
      apiKey: str(flags["api-key"]),
      only: csv(flags.only),
      charts: csv(flags.charts),
      adminEmail: str(flags["admin-email"]) ?? process.env.ADMIN_EMAIL,
      adminPassword: str(flags["admin-password"]) ?? process.env.ADMIN_PASSWORD,
      dryRun,
      log: (l) => console.log(l),
    });
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    console.log(`합계 ${total}개${dryRun ? " (쓰지 않음)" : " 옮김"}`);
    const failed = Object.keys(result.errors);
    if (failed.length) {
      console.error(`실패한 컬렉션: ${failed.join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    await database?.close();
  }
}

// 이 파일을 직접 실행했을 때만 (테스트에서 import 할 때는 실행하지 않음)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
