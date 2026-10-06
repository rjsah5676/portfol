/**
 * CREATE TABLE(DDL) → Java DTO / MyBatis resultMap / Mapper XML,
 * 그리고 camelCase ↔ snake_case 이름 변환.
 * MySQL·MariaDB·PostgreSQL·Oracle DDL을 대충 섞어 넣어도 읽히도록 느슨하게 파싱한다.
 */

// ───────────────────────── 이름 변환 ─────────────────────────

/** "member_id", "memberId", "MEMBER_ID", "member-id", "Member Id" → ["member", "id"] */
export function words(name: string): string[] {
  let s = name.trim();
  // 전부 대문자(+숫자·구분자)면 Oracle 식 컬럼명으로 보고 소문자로
  if (!/[a-z]/.test(s)) s = s.toLowerCase();
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
export const toCamel = (n: string) =>
  words(n)
    .map((w, i) => (i ? cap(w) : w))
    .join("");
export const toPascal = (n: string) => words(n).map(cap).join("");
export const toSnake = (n: string) => words(n).join("_");
export const toUpperSnake = (n: string) => toSnake(n).toUpperCase();
export const toKebab = (n: string) => words(n).join("-");

// ───────────────────────── DDL 파싱 ─────────────────────────

export interface Column {
  name: string;
  /** 소문자 기본 타입 (varchar, bigint, timestamp with time zone ...) */
  type: string;
  /** 괄호 안 숫자들 (varchar(50) → [50], decimal(10,2) → [10, 2]) */
  args: number[];
  unsigned: boolean;
  nullable: boolean;
  pk: boolean;
  autoIncrement: boolean;
  /** DEFAULT CURRENT_TIMESTAMP / now() / sysdate 등 → INSERT에서 뺌 */
  defaultNow: boolean;
  /** ON UPDATE CURRENT_TIMESTAMP → UPDATE에서 뺌 */
  onUpdateNow: boolean;
  comment: string | null;
}

export interface Table {
  /** 스키마 뺀 원래 테이블 이름 */
  name: string;
  comment: string | null;
  columns: Column[];
}

const unquote = (s: string) => s.trim().replace(/^[`"[]|[`"\]]$/g, "");
const unescapeSql = (s: string) => s.replace(/''/g, "'").replace(/\\'/g, "'");

/** 문자열 밖의 -- , # , /* *\/ 주석 제거 */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\\" && c === "'") j += 2;
        else if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if ((c === "-" && sql[i + 1] === "-") || c === "#") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** open 위치의 '(' 와 짝이 맞는 ')' 위치 (문자열 안 괄호 무시) */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === "\\" && c === "'") i++;
        i++;
      }
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/** 최상위(괄호·따옴표 밖) 쉼표로 나누기 */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === "\\" && c === "'") i++;
        i++;
      }
    } else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(s.slice(last));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const TYPE_MODIFIER =
  /^(varying|precision|unsigned|zerofill|with(?:out)?\s+(?:local\s+)?time\s+zone)\b/i;
const NOW_DEFAULT =
  /^(current_timestamp|now|sysdate|systimestamp|localtimestamp|current_date|getdate)\b/i;
const CONSTRAINT_LINE =
  /^(constraint|primary\s+key|unique|key|index|fulltext|spatial|foreign\s+key|check|exclude)\b/i;

function parseColumn(def: string): Column | null {
  const nameM = /^(`[^`]+`|"[^"]+"|\[[^\]]+\]|[\w$가-힣]+)\s*/.exec(def);
  if (!nameM) return null;
  let rest = def.slice(nameM[0].length);

  // 타입: 기본 단어 + (인자) + 수식어들
  const baseM = /^([a-z_][\w]*)/i.exec(rest);
  if (!baseM) return null;
  let type = baseM[1].toLowerCase();
  rest = rest.slice(baseM[0].length);
  let args: number[] = [];
  for (;;) {
    const ws = rest.length - rest.trimStart().length;
    const r = rest.trimStart();
    if (r.startsWith("(") && args.length === 0) {
      const end = matchParen(r, 0);
      if (end < 0) break;
      args = r
        .slice(1, end)
        .split(",")
        .map((a) => parseInt(a, 10))
        .filter((n) => !Number.isNaN(n));
      rest = r.slice(end + 1);
      continue;
    }
    if (r.startsWith("[]")) {
      type += "[]";
      rest = r.slice(2);
      continue;
    }
    const mod = TYPE_MODIFIER.exec(r);
    if (mod && ws > 0) {
      type += " " + mod[1].toLowerCase().replace(/\s+/g, " ");
      rest = r.slice(mod[0].length);
      continue;
    }
    break;
  }
  const unsigned = /\bunsigned\b/.test(type);
  type = type.replace(/\s*\b(unsigned|zerofill)\b/g, "").trim();

  const commentM = /\bcomment\s+'((?:[^'\\]|''|\\.)*)'/i.exec(rest);
  const comment = commentM ? unescapeSql(commentM[1]) : null;
  // 이후 키워드 검사는 문자열을 지운 상태에서
  const flags = rest.replace(/'(?:[^'\\]|''|\\.)*'/g, "''");
  const defM = /\bdefault\s+\(?\s*([\w.]+)/i.exec(flags);

  return {
    name: unquote(nameM[1]),
    type,
    args,
    unsigned,
    nullable: !/\bnot\s+null\b/i.test(flags) && !/\bprimary\s+key\b/i.test(flags),
    pk: /\bprimary\s+key\b/i.test(flags),
    autoIncrement:
      /\b(auto_increment|autoincrement|identity)\b/i.test(flags) ||
      /^(small|big)?serial\d?$/.test(type),
    defaultNow: !!defM && NOW_DEFAULT.test(defM[1]),
    onUpdateNow: /\bon\s+update\s+(current_timestamp|now)\b/i.test(flags),
    comment: comment || null,
  };
}

const CREATE_RE =
  /create\s+(?:or\s+replace\s+)?(?:(?:global|local)\s+)?(?:(?:temporary|temp)\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[\w$]+)\s*\.\s*)*(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[\w$가-힣]+))\s*\(/gi;

const lastPart = (qualified: string) =>
  unquote(qualified.split(/\s*\.\s*(?=[`"[\w$])/).pop() ?? "");

export function parseDdl(input: string): Table[] {
  const sql = stripComments(input);
  const tables: Table[] = [];
  CREATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CREATE_RE.exec(sql))) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) break;
    const body = sql.slice(open + 1, close);
    const columns: Column[] = [];
    const pkNames = new Set<string>();

    for (const item of splitTop(body)) {
      if (CONSTRAINT_LINE.test(item)) {
        const pk = /primary\s+key\s*\(([^)]*)\)/i.exec(item);
        if (pk)
          pk[1]
            .split(",")
            .forEach((c) => pkNames.add(unquote(c.replace(/\(\d+\)/, "")).toLowerCase()));
        continue;
      }
      const col = parseColumn(item);
      if (col) columns.push(col);
    }
    for (const c of columns)
      if (pkNames.has(c.name.toLowerCase())) ((c.pk = true), (c.nullable = false));

    // 괄호 뒤 테이블 옵션: COMMENT='...' (MySQL)
    const tail = sql.slice(
      close + 1,
      sql.indexOf(";", close) < 0 ? undefined : sql.indexOf(";", close)
    );
    const tcm = /\bcomment\s*=?\s*'((?:[^'\\]|''|\\.)*)'/i.exec(tail);
    tables.push({ name: lastPart(m[1]), comment: tcm ? unescapeSql(tcm[1]) : null, columns });
    CREATE_RE.lastIndex = close + 1;
  }

  // COMMENT ON TABLE / COLUMN (PostgreSQL·Oracle)
  const onRe = /comment\s+on\s+(table|column)\s+([\w$."`[\]가-힣]+)\s+is\s+'((?:[^']|'')*)'/gi;
  while ((m = onRe.exec(sql))) {
    const parts = m[2].split(".").map(unquote);
    const text = unescapeSql(m[3]);
    if (m[1].toLowerCase() === "table") {
      const t = tables.find((t) => t.name.toLowerCase() === parts[parts.length - 1].toLowerCase());
      if (t) t.comment = text;
    } else if (parts.length >= 2) {
      const t = tables.find((t) => t.name.toLowerCase() === parts[parts.length - 2].toLowerCase());
      const c = t?.columns.find(
        (c) => c.name.toLowerCase() === parts[parts.length - 1].toLowerCase()
      );
      if (c) c.comment = text;
    }
  }
  return tables.filter((t) => t.columns.length > 0);
}

export const looksLikeDdl = (s: string) => /create\s+(?:\w+\s+)*table\b/i.test(s);

// ───────────────────────── 타입 매핑 ─────────────────────────

export type DateStyle = "time" | "legacy";

export interface JavaType {
  /** 코드에 쓰는 단순 이름 */
  name: string;
  /** 필요한 import (없으면 null) */
  import: string | null;
}

const T = (name: string, imp: string | null = null): JavaType => ({ name, import: imp });

/** Oracle 전용 타입이 보이면 DATE를 날짜+시간으로 본다 */
export const isOracle = (tables: Table[]) =>
  tables.some((t) =>
    t.columns.some((c) =>
      /^(varchar2|nvarchar2|number|clob|nclob|raw|long raw|binary_double|binary_float)$/.test(
        c.type
      )
    )
  );

export function javaType(c: Column, dates: DateStyle, oracle: boolean): JavaType {
  const t = c.type.replace(/\[\]$/, "");
  const [p, s] = c.args;
  const date = (modern: JavaType) => (dates === "legacy" ? T("Date", "java.util.Date") : modern);

  if (c.type.endsWith("[]")) return T("List<Object>", "java.util.List"); // PG 배열: 대충이라도
  if (/^(bool|boolean)$/.test(t) || (t === "tinyint" && p === 1) || (t === "bit" && (p ?? 1) === 1))
    return T("Boolean");
  if (
    /^(tinyint|smallint|mediumint|int|integer|int2|int4|smallserial|serial|serial4|year)$/.test(t)
  )
    return c.unsigned && /^(int|integer)$/.test(t) ? T("Long") : T("Integer");
  // BIGINT UNSIGNED도 실무에선 대부분 Long으로 받음
  if (/^(bigint|int8|bigserial|serial8)$/.test(t)) return T("Long");
  if (t === "number") {
    // NUMBER(p) / NUMBER(p,0) 은 정수. NUMBER(19)는 보통 Long ID
    if (p !== undefined && !s)
      return p <= 9 ? T("Integer") : p <= 19 ? T("Long") : T("BigDecimal", "java.math.BigDecimal");
    return T("BigDecimal", "java.math.BigDecimal");
  }
  if (/^(decimal|numeric|dec|money|smallmoney)$/.test(t))
    return T("BigDecimal", "java.math.BigDecimal");
  if (/^(float|real|float4|binary_float)$/.test(t)) return T("Float");
  if (/^(double|double precision|float8|binary_double)$/.test(t)) return T("Double");
  if (t === "date")
    return oracle
      ? date(T("LocalDateTime", "java.time.LocalDateTime"))
      : date(T("LocalDate", "java.time.LocalDate"));
  if (
    /^(timestamptz|timestamp with time zone|timestamp with local time zone|datetimeoffset)$/.test(t)
  )
    return date(T("OffsetDateTime", "java.time.OffsetDateTime"));
  if (/^(datetime|datetime2|smalldatetime|timestamp|timestamp without time zone)$/.test(t))
    return date(T("LocalDateTime", "java.time.LocalDateTime"));
  if (/^(time|timetz|time without time zone|time with time zone)$/.test(t))
    return date(T("LocalTime", "java.time.LocalTime"));
  if (/^(blob|tinyblob|mediumblob|longblob|bytea|binary|varbinary|raw|long raw|image|bit)$/.test(t))
    return T("byte[]");
  return T("String");
}

export function jdbcType(c: Column, oracle: boolean): string {
  const t = c.type.replace(/\[\]$/, "");
  const p = c.args[0];
  if (c.type.endsWith("[]")) return "ARRAY";
  if (/^(bool|boolean)$/.test(t)) return "BOOLEAN";
  if (t === "bit") return p === 1 || p === undefined ? "BIT" : "BINARY";
  if (t === "tinyint") return p === 1 ? "BOOLEAN" : "TINYINT";
  if (/^(smallint|int2|smallserial|year)$/.test(t)) return "SMALLINT";
  if (/^(mediumint|int|integer|int4|serial|serial4)$/.test(t)) return "INTEGER";
  if (/^(bigint|int8|bigserial|serial8)$/.test(t)) return "BIGINT";
  if (/^(decimal|dec|money|smallmoney)$/.test(t)) return "DECIMAL";
  if (/^(numeric|number)$/.test(t)) return "NUMERIC";
  if (/^(float|float4|binary_float)$/.test(t)) return "FLOAT";
  if (t === "real") return "REAL";
  if (/^(double|double precision|float8|binary_double)$/.test(t)) return "DOUBLE";
  if (/^(char|nchar|character|bpchar)$/.test(t)) return "CHAR";
  if (/^(clob|nclob)$/.test(t)) return "CLOB";
  if (/^(tinytext|text|mediumtext|longtext|long)$/.test(t)) return "LONGVARCHAR";
  if (t === "date") return oracle ? "TIMESTAMP" : "DATE";
  if (/^(time|timetz|time without time zone|time with time zone)$/.test(t)) return "TIME";
  if (
    /^(timestamptz|timestamp with time zone|timestamp with local time zone|datetimeoffset)$/.test(t)
  )
    return "TIMESTAMP_WITH_TIMEZONE";
  if (/^(datetime|datetime2|smalldatetime|timestamp|timestamp without time zone)$/.test(t))
    return "TIMESTAMP";
  if (/^(blob|tinyblob|mediumblob|longblob|image)$/.test(t)) return "BLOB";
  if (/^(binary)$/.test(t)) return "BINARY";
  if (/^(varbinary|bytea|raw|long raw)$/.test(t)) return "VARBINARY";
  if (/^(nvarchar|nvarchar2)$/.test(t)) return "NVARCHAR";
  return "VARCHAR";
}

// ───────────────────────── 코드 생성 ─────────────────────────

export type Suffix = "" | "Dto" | "VO" | "Entity";

export interface GenOptions {
  pkg: string;
  suffix: Suffix;
  /** tb_ / tbl_ / t_ 접두어 떼기 */
  stripPrefix: boolean;
  lombok: boolean;
  dates: DateStyle;
  /** resultMap·#{} 에 jdbcType 표기 */
  withJdbcType: boolean;
}

const baseName = (table: string, strip: boolean) =>
  strip ? table.replace(/^(tb|tbl|t)_/i, "") : table;
export const className = (t: Table, o: GenOptions) =>
  toPascal(baseName(t.name, o.stripPrefix)) + o.suffix;
const entityName = (t: Table, o: GenOptions) => toPascal(baseName(t.name, o.stripPrefix));
const typeRef = (t: Table, o: GenOptions) =>
  o.pkg.trim() ? `${o.pkg.trim()}.${className(t, o)}` : className(t, o);
const oneLine = (s: string) => s.replace(/\s+/g, " ").replace(/\*\//g, "*\\/").trim();

export function genDto(t: Table, o: GenOptions, oracle: boolean): string {
  const cls = className(t, o);
  const fields = t.columns.map((c) => ({
    c,
    name: toCamel(c.name),
    type: javaType(c, o.dates, oracle),
  }));
  const imports = new Set(fields.map((f) => f.type.import).filter((x): x is string => !!x));
  if (o.lombok)
    ["lombok.Getter", "lombok.NoArgsConstructor", "lombok.Setter", "lombok.ToString"].forEach((i) =>
      imports.add(i)
    );

  const lines: string[] = [];
  if (o.pkg.trim()) lines.push(`package ${o.pkg.trim()};`, "");
  if (imports.size) {
    const sorted = [...imports].sort((a, b) => {
      const g = (x: string) => (x.startsWith("java.") ? 0 : 1);
      return g(a) - g(b) || a.localeCompare(b);
    });
    let prev = -1;
    for (const i of sorted) {
      const g = i.startsWith("java.") ? 0 : 1;
      if (prev !== -1 && g !== prev) lines.push("");
      lines.push(`import ${i};`);
      prev = g;
    }
    lines.push("");
  }
  if (t.comment) lines.push(`/** ${oneLine(t.comment)} */`);
  if (o.lombok) lines.push("@Getter", "@Setter", "@NoArgsConstructor", "@ToString");
  lines.push(`public class ${cls} {`);
  fields.forEach(({ c, name, type }, i) => {
    if (i) lines.push("");
    if (c.comment) lines.push(`    /** ${oneLine(c.comment)} */`);
    lines.push(`    private ${type.name} ${name};`);
  });
  if (!o.lombok) {
    for (const { name, type } of fields) {
      const up = name.charAt(0).toUpperCase() + name.slice(1);
      const getter = type.name === "boolean" ? `is${up}` : `get${up}`;
      lines.push(
        "",
        `    public ${type.name} ${getter}() {`,
        `        return ${name};`,
        "    }",
        "",
        `    public void set${up}(${type.name} ${name}) {`,
        `        this.${name} = ${name};`,
        "    }"
      );
    }
  }
  lines.push("}");
  return lines.join("\n");
}

export const resultMapId = (t: Table, o: GenOptions) =>
  toCamel(baseName(t.name, o.stripPrefix)) + "ResultMap";

export function genResultMap(t: Table, o: GenOptions, oracle: boolean): string {
  const jt = (c: Column) => (o.withJdbcType ? ` jdbcType="${jdbcType(c, oracle)}"` : "");
  const lines = [`<resultMap id="${resultMapId(t, o)}" type="${typeRef(t, o)}">`];
  for (const c of t.columns) {
    const tag = c.pk ? "id" : "result";
    lines.push(`    <${tag} property="${toCamel(c.name)}" column="${c.name}"${jt(c)}/>`);
  }
  lines.push("</resultMap>");
  return lines.join("\n");
}

export function genMapper(t: Table, o: GenOptions, oracle: boolean): string {
  const ent = entityName(t, o);
  const colsId = toCamel(baseName(t.name, o.stripPrefix)) + "Columns";
  const param = (c: Column) =>
    o.withJdbcType
      ? `#{${toCamel(c.name)}, jdbcType=${jdbcType(c, oracle)}}`
      : `#{${toCamel(c.name)}}`;
  const pks = t.columns.filter((c) => c.pk);
  const where = pks.map((c, i) => `${i ? "  AND " : "WHERE "}${c.name} = ${param(c)}`);
  const insertCols = t.columns.filter((c) => !c.autoIncrement && !c.defaultNow);
  // 등록일(DEFAULT now)·수정일(ON UPDATE now)은 DB에 맡김
  const updateCols = t.columns.filter(
    (c) => !c.pk && !c.onUpdateNow && !c.defaultNow && !c.autoIncrement
  );
  const gen = t.columns.find((c) => c.autoIncrement);
  const type = typeRef(t, o);

  // 컬럼 목록: 한 줄이 너무 길어지지 않게 적당히 줄바꿈
  const wrap = (items: string[], indent: string) => {
    const rows: string[] = [];
    let cur = "";
    for (const it of items) {
      const next = cur ? `${cur}, ${it}` : it;
      if (cur && next.length > 80) {
        rows.push(cur + ",");
        cur = it;
      } else cur = next;
    }
    if (cur) rows.push(cur);
    return rows.map((r) => indent + r).join("\n");
  };

  const out: string[] = [];
  out.push(
    `<sql id="${colsId}">`,
    wrap(
      t.columns.map((c) => c.name),
      "    "
    ),
    "</sql>",
    ""
  );

  if (pks.length) {
    out.push(
      `<select id="select${ent}" resultMap="${resultMapId(t, o)}">`,
      `    SELECT <include refid="${colsId}"/>`,
      `    FROM ${t.name}`,
      ...where.map((w) => "    " + w),
      "</select>",
      ""
    );
  }
  out.push(
    `<select id="select${ent}List" resultMap="${resultMapId(t, o)}">`,
    `    SELECT <include refid="${colsId}"/>`,
    `    FROM ${t.name}`,
    ...(pks.length ? [`    ORDER BY ${pks.map((c) => `${c.name} DESC`).join(", ")}`] : []),
    "</select>",
    ""
  );

  const keyAttr =
    gen && !oracle ? ` useGeneratedKeys="true" keyProperty="${toCamel(gen.name)}"` : "";
  out.push(
    `<insert id="insert${ent}" parameterType="${type}"${keyAttr}>`,
    `    INSERT INTO ${t.name} (`,
    wrap(
      insertCols.map((c) => c.name),
      "        "
    ),
    "    ) VALUES (",
    wrap(insertCols.map(param), "        "),
    "    )",
    "</insert>"
  );

  if (pks.length && updateCols.length) {
    out.push(
      "",
      `<update id="update${ent}" parameterType="${type}">`,
      `    UPDATE ${t.name}`,
      "    <set>",
      ...updateCols.map(
        (c) => `        <if test="${toCamel(c.name)} != null">${c.name} = ${param(c)},</if>`
      ),
      "    </set>",
      ...where.map((w) => "    " + w),
      "</update>",
      "",
      `<delete id="delete${ent}">`,
      `    DELETE FROM ${t.name}`,
      ...where.map((w) => "    " + w),
      "</delete>"
    );
  }
  return out.join("\n");
}
