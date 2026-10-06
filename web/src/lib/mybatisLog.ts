/**
 * MyBatis 로그(Preparing / Parameters) → 파라미터가 채워진 실행 가능한 SQL.
 *
 *   DEBUG c.e.mapper.UserMapper.selectById - ==>  Preparing: SELECT * FROM user WHERE id = ? AND name = ?
 *   DEBUG c.e.mapper.UserMapper.selectById - ==> Parameters: 1(Long), 건모(String)
 *   DEBUG c.e.mapper.UserMapper.selectById - <==      Total: 1
 */

export type Dialect = "mysql" | "mariadb" | "postgresql" | "oracle";

export interface Param {
  /** null이면 SQL NULL */
  value: string | null;
  /** Java 클래스 단순 이름 (String, Long, Timestamp ...) */
  type: string | null;
}

export interface Statement {
  mapper: string | null;
  sql: string;
  params: Param[];
  placeholders: number;
  /** 파라미터를 채운 SQL (포맷 전) */
  filled: string;
  /** <== Total: n / Updates: n */
  result: string | null;
  warnings: string[];
}

// 따옴표 없이 그대로 넣는 타입
const NUMERIC = new Set([
  "Integer",
  "Long",
  "Short",
  "Byte",
  "Double",
  "Float",
  "BigDecimal",
  "BigInteger",
  "int",
  "long",
  "short",
  "byte",
  "double",
  "float",
  "AtomicInteger",
  "AtomicLong",
]);
const BOOLEAN = new Set(["Boolean", "boolean"]);

/**
 * "1(Long), a, b(String), null, 2024-01-01 00:00:00.0(Timestamp)" 파싱.
 * 값 안에 ", "가 들어갈 수 있어서 단순 split 대신 "(타입)" 뒤의 ", " 를 구분자로 본다.
 */
export function parseParams(line: string): Param[] {
  const s = line.replace(/\s+$/, "");
  const out: Param[] = [];
  const typeRe = /\(([A-Za-z_$[][\w.$[\];]*)\)(?=, |$)/g;
  let p = 0;
  while (p < s.length) {
    // null 값은 타입 없이 찍힘
    if (s.startsWith("null", p) && (s.length === p + 4 || s.startsWith(", ", p + 4))) {
      out.push({ value: null, type: null });
      p += 6;
      continue;
    }
    typeRe.lastIndex = p;
    const m = typeRe.exec(s);
    if (!m) {
      // 타입 표기가 없는 나머지 (잘린 로그 등) → 문자열로 취급
      out.push({ value: s.slice(p), type: null });
      break;
    }
    out.push({ value: s.slice(p, m.index), type: m[1].split(".").pop()! });
    p = m.index + m[0].length + 2; // ", " 건너뜀
  }
  return out;
}

export function toLiteral(param: Param, dialect: Dialect): string {
  if (param.value === null) return "NULL";
  const { value, type } = param;
  if (type && NUMERIC.has(type) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return value;
  if (type && BOOLEAN.has(type) && /^(true|false)$/.test(value)) {
    return dialect === "oracle" ? (value === "true" ? "1" : "0") : value.toUpperCase();
  }
  // Oracle은 날짜 문자열을 NLS 설정에 따라 해석하므로 형식을 명시
  if (dialect === "oracle" && type) {
    if (
      /^(Timestamp|LocalDateTime)$/.test(type) &&
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    )
      return `TO_TIMESTAMP('${value.replace("T", " ")}', 'YYYY-MM-DD HH24:MI:SS.FF')`;
    if (/^(Date|LocalDate)$/.test(type) && /^\d{4}-\d{2}-\d{2}$/.test(value))
      return `TO_DATE('${value}', 'YYYY-MM-DD')`;
  }
  let v = value.replace(/'/g, "''");
  // MySQL/MariaDB는 문자열 안의 \ 를 이스케이프 문자로 해석함
  if (dialect === "mysql" || dialect === "mariadb") v = v.replace(/\\/g, "\\\\");
  return `'${v}'`;
}

/** 문자열·주석 밖의 ? 위치들 */
export function findPlaceholders(sql: string): number[] {
  const pos: number[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < sql.length) {
        if (sql[i] === c) {
          if (sql[i + 1] === c)
            i += 2; // '' 이스케이프
          else break;
        } else if (sql[i] === "\\" && c !== "`") i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (c === "?") pos.push(i);
    i++;
  }
  return pos;
}

export function fillSql(sql: string, params: Param[], dialect: Dialect) {
  const pos = findPlaceholders(sql);
  let out = "";
  let last = 0;
  pos.forEach((p, k) => {
    out += sql.slice(last, p) + (k < params.length ? toLiteral(params[k], dialect) : "?");
    last = p + 1;
  });
  return { filled: out + sql.slice(last), placeholders: pos.length };
}

// 로그 한 줄에서 "==>" / "<==" 앞부분(시간·레벨·스레드·매퍼 이름) 분리
const ARROW = /(==>|<==)\s*/;
const mapperOf = (prefix: string) => {
  const m = /([\w$]+(?:\.[\w$]+)+)\s*[-:|]*\s*$/.exec(prefix.trim());
  return m ? m[1] : null;
};
// 새 로그 줄의 시작처럼 보이는지 (날짜·시간·레벨·화살표)
const looksLikeLogLine = (l: string) =>
  ARROW.test(l) ||
  /^\s*(\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|\[?(TRACE|DEBUG|INFO|WARN|ERROR)\b)/.test(l);

/** 로그 전체 → 문장 목록 */
export function parseLog(text: string, dialect: Dialect): Statement[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const stmts: Statement[] = [];
  let cur: Statement | null = null;

  const finish = () => {
    if (!cur) return;
    const { filled, placeholders } = fillSql(cur.sql, cur.params, dialect);
    cur.filled = filled;
    cur.placeholders = placeholders;
    if (placeholders !== cur.params.length)
      cur.warnings.push(
        `? 는 ${placeholders}개인데 파라미터는 ${cur.params.length}개입니다. 로그가 잘렸거나 다른 쿼리와 섞였는지 확인해주세요.`
      );
    if (cur.params.some((p) => p.type?.startsWith("[")))
      cur.warnings.push("바이너리(byte[]) 값은 로그에 내용이 찍히지 않아 그대로 넣을 수 없습니다.");
    stmts.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prep = /Preparing:\s?(.*)$/.exec(line);
    if (prep) {
      finish();
      let sql = prep[1];
      // 콘솔 줄바꿈 등으로 SQL이 여러 줄로 이어진 경우
      while (i + 1 < lines.length && lines[i + 1].trim() && !looksLikeLogLine(lines[i + 1])) {
        sql += "\n" + lines[++i];
      }
      const [prefix] = line.split(ARROW);
      cur = {
        mapper: mapperOf(prefix ?? ""),
        sql: sql.trim(),
        params: [],
        placeholders: 0,
        filled: "",
        result: null,
        warnings: [],
      };
      continue;
    }
    const par = /Parameters:\s?(.*)$/.exec(line);
    if (par && cur) {
      cur.params = par[1].trim() ? parseParams(par[1]) : [];
      continue;
    }
    const res = /<==\s*(Total|Updates):\s*(\d+)/.exec(line);
    if (res && cur) {
      cur.result = `${res[1]}: ${res[2]}`;
      finish();
    }
  }
  finish();
  return stmts;
}
