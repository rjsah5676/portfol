/**
 * JSON(API 응답 등) → Java DTO 클래스.
 * 숫자 표기(1 vs 1.0)를 보존해야 해서 JSON.parse 대신 직접 파싱한다.
 */
import { toCamel, toPascal, words } from "./ddlToJava";

// ───────────────────────── 파싱 ─────────────────────────

type Node =
  | { k: "obj"; entries: [string, Node][] }
  | { k: "arr"; items: Node[] }
  | { k: "str"; v: string }
  | { k: "num"; raw: string }
  | { k: "bool" }
  | { k: "null" };

export class JsonError extends Error {
  line: number;
  col: number;
  constructor(message: string, line: number, col: number) {
    super(message);
    this.line = line;
    this.col = col;
  }
}

export function parseJson(src: string): Node {
  let i = 0;
  const fail = (msg: string): never => {
    const before = src.slice(0, i).split("\n");
    throw new JsonError(msg, before.length, before[before.length - 1].length + 1);
  };
  const ws = () => {
    while (i < src.length && " \t\n\r".includes(src[i])) i++;
  };
  const str = (): string => {
    i++;
    let out = "";
    while (i < src.length && src[i] !== '"') {
      if (src[i] === "\\") {
        const e = src[i + 1];
        if (e === "u") {
          const hex = src.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("잘못된 \\u 이스케이프");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        const map: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (!(e in map)) fail("잘못된 이스케이프 문자");
        out += map[e];
        i += 2;
      } else out += src[i++];
    }
    if (src[i] !== '"') fail("문자열이 닫히지 않았습니다");
    i++;
    return out;
  };
  const value = (): Node => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const entries: [string, Node][] = [];
      ws();
      if (src[i] === "}") return (i++, { k: "obj", entries });
      for (;;) {
        ws();
        if (src[i] === "}" && entries.length)
          fail("마지막 쉼표(trailing comma)는 JSON에서 허용되지 않습니다");
        if (src[i] !== '"') fail("키는 큰따옴표 문자열이어야 합니다");
        const key = str();
        ws();
        if (src[i] !== ":") fail("':'가 필요합니다");
        i++;
        entries.push([key, value()]);
        ws();
        if (src[i] === ",") i++;
        else if (src[i] === "}") return (i++, { k: "obj", entries });
        else fail("',' 또는 '}'가 필요합니다");
      }
    }
    if (c === "[") {
      i++;
      const items: Node[] = [];
      ws();
      if (src[i] === "]") return (i++, { k: "arr", items });
      for (;;) {
        ws();
        if (src[i] === "]" && items.length)
          fail("마지막 쉼표(trailing comma)는 JSON에서 허용되지 않습니다");
        items.push(value());
        ws();
        if (src[i] === ",") i++;
        else if (src[i] === "]") return (i++, { k: "arr", items });
        else fail("',' 또는 ']'가 필요합니다");
      }
    }
    if (c === '"') return { k: "str", v: str() };
    const m = /^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      src.slice(i, i + 400)
    );
    if (!m) fail(i >= src.length ? "JSON이 중간에 끝났습니다" : "알 수 없는 값");
    i += m![0].length;
    const t = m![0];
    if (t === "null") return { k: "null" };
    if (t === "true" || t === "false") return { k: "bool" };
    return { k: "num", raw: t };
  };
  const root = value();
  ws();
  if (i < src.length) fail("JSON 뒤에 불필요한 내용이 있습니다");
  return root;
}

// ───────────────────────── 타입 추론 ─────────────────────────

type DateKind = "date" | "datetime" | "offset" | null;
type Shape =
  | { k: "null" }
  | { k: "bool" }
  | { k: "int"; long: boolean }
  | { k: "dec" }
  | { k: "str"; date: DateKind }
  | { k: "arr"; of: Shape }
  | { k: "obj"; fields: Map<string, Shape> }
  | { k: "any" };

const INT_MAX = 2147483647;

function dateKind(s: string): DateKind {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return "datetime";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s))
    return "offset";
  return null;
}

function shapeOf(n: Node): Shape {
  switch (n.k) {
    case "null":
      return { k: "null" };
    case "bool":
      return { k: "bool" };
    case "str":
      return { k: "str", date: dateKind(n.v) };
    case "num":
      if (/[.eE]/.test(n.raw)) return { k: "dec" };
      return {
        k: "int",
        long: n.raw.replace("-", "").length > 10 || Math.abs(Number(n.raw)) > INT_MAX,
      };
    case "arr":
      return { k: "arr", of: n.items.map(shapeOf).reduce(merge, { k: "null" } as Shape) };
    case "obj": {
      const fields = new Map<string, Shape>();
      for (const [key, v] of n.entries)
        fields.set(key, fields.has(key) ? merge(fields.get(key)!, shapeOf(v)) : shapeOf(v));
      return { k: "obj", fields };
    }
  }
}

/** 배열 원소끼리, 같은 키끼리 타입 합치기 */
function merge(a: Shape, b: Shape): Shape {
  if (a.k === "null") return b;
  if (b.k === "null") return a;
  if (a.k === "int" && b.k === "int") return { k: "int", long: a.long || b.long };
  if ((a.k === "int" || a.k === "dec") && (b.k === "int" || b.k === "dec")) return { k: "dec" };
  if (a.k === "str" && b.k === "str") return { k: "str", date: a.date === b.date ? a.date : null };
  if (a.k === "bool" && b.k === "bool") return a;
  if (a.k === "arr" && b.k === "arr") return { k: "arr", of: merge(a.of, b.of) };
  if (a.k === "obj" && b.k === "obj") {
    const fields = new Map(a.fields);
    for (const [key, v] of b.fields)
      fields.set(key, fields.has(key) ? merge(fields.get(key)!, v) : v);
    return { k: "obj", fields };
  }
  return { k: "any" };
}

// ───────────────────────── 코드 생성 ─────────────────────────

export type Style = "lombok" | "plain" | "record";
export type JsonSuffix = "" | "Dto" | "Response" | "VO";

export interface JsonGenOptions {
  rootName: string;
  suffix: JsonSuffix;
  pkg: string;
  style: Style;
  decimal: "Double" | "BigDecimal";
  /** 2024-01-01T10:00:00 같은 문자열을 LocalDateTime 등으로 */
  dates: boolean;
  /** 필드명이 키와 다르면 @JsonProperty */
  jsonProperty: boolean;
  /** true: 루트 안에 static class로, false: 클래스마다 따로 */
  nested: boolean;
}

interface Field {
  key: string;
  name: string;
  type: string;
}
interface ClassDef {
  name: string;
  fields: Field[];
}

const RESERVED = new Set(
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record var yield".split(
    " "
  )
);

function fieldName(key: string): string {
  let n = toCamel(key).replace(/[^\w$]/g, "");
  if (!n) n = "field";
  if (/^\d/.test(n)) n = "_" + n;
  if (RESERVED.has(n)) n = n === "class" ? "clazz" : n + "_";
  return n;
}

/** orderItems → OrderItem, categories → Category */
function singular(key: string): string {
  const w = words(key);
  if (!w.length) return key;
  const last = w[w.length - 1];
  let s = last;
  if (/ies$/.test(last) && last.length > 4) s = last.slice(0, -3) + "y";
  else if (/(ses|xes|zes|ches|shes)$/.test(last)) s = last.slice(0, -2);
  else if (/[^su]s$/.test(last) && last.length > 3) s = last.slice(0, -1);
  return [...w.slice(0, -1), s].join("_");
}

export interface JsonResult {
  /** 결과 코드 블록들 (nested면 1개) */
  files: { name: string; code: string }[];
  /** 루트가 배열이면 true → List<Root>로 받으라는 안내 */
  rootIsArray: boolean;
  classCount: number;
}

export function jsonToJava(src: string, o: JsonGenOptions): JsonResult {
  const root = shapeOf(parseJson(src));
  const rootIsArray = root.k === "arr";
  let top = root;
  while (top.k === "arr") top = top.of;
  if (top.k !== "obj")
    throw new JsonError("객체({ … }) 또는 객체 배열만 클래스로 만들 수 있습니다", 1, 1);

  const classes: ClassDef[] = [];
  const used = new Map<string, number>();
  const imports = new Set<string>();
  const uniq = (base: string) => {
    let name = toPascal(base).replace(/[^\w$]/g, "") || "Item";
    if (/^\d/.test(name)) name = "N" + name;
    name += o.suffix;
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    return n ? `${name}${n + 1}` : name;
  };

  const javaType = (s: Shape, key: string): string => {
    switch (s.k) {
      case "null":
      case "any":
        return "Object";
      case "bool":
        return "Boolean";
      case "int":
        // id 계열은 값이 작아도 Long
        return s.long || /(^id$|Id$|_id$|ID$|No$|_no$)/.test(key) ? "Long" : "Integer";
      case "dec":
        if (o.decimal === "BigDecimal") imports.add("java.math.BigDecimal");
        return o.decimal;
      case "str":
        if (o.dates && s.date) {
          const t =
            s.date === "date"
              ? "LocalDate"
              : s.date === "datetime"
                ? "LocalDateTime"
                : "OffsetDateTime";
          imports.add(`java.time.${t}`);
          return t;
        }
        return "String";
      case "arr":
        imports.add("java.util.List");
        return `List<${javaType(s.of, singular(key))}>`;
      case "obj":
        return build(s, key);
    }
  };

  const build = (s: Extract<Shape, { k: "obj" }>, base: string): string => {
    const def: ClassDef = { name: uniq(base), fields: [] };
    classes.push(def);
    for (const [key, v] of s.fields)
      def.fields.push({ key, name: fieldName(key), type: javaType(v, key) });
    return def.name;
  };

  const rootBase = o.rootName.trim() || "Root";
  build(top, rootBase);

  const needsProp = (f: Field) => o.jsonProperty && f.key !== f.name;
  if (classes.some((c) => c.fields.some(needsProp)))
    imports.add("com.fasterxml.jackson.annotation.JsonProperty");
  if (o.style === "lombok")
    ["lombok.Getter", "lombok.NoArgsConstructor", "lombok.Setter", "lombok.ToString"].forEach((i) =>
      imports.add(i)
    );

  const header = (imps: Set<string>) => {
    const lines: string[] = [];
    if (o.pkg.trim()) lines.push(`package ${o.pkg.trim()};`, "");
    const sorted = [...imps].sort((a, b) => {
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
    if (sorted.length) lines.push("");
    return lines;
  };

  /** 클래스 하나 → 줄 배열 (indent: 들여쓰기, inner: static 내부 클래스인지) */
  const emit = (c: ClassDef, indent: string, inner: boolean, body: string[] = []): string[] => {
    const I = indent;
    const mod = inner ? "public static " : "public ";
    if (o.style === "record") {
      const params = c.fields.map(
        (f) => `${I}    ${needsProp(f) ? `@JsonProperty("${f.key}") ` : ""}${f.type} ${f.name}`
      );
      const open = `${I}public record ${c.name}(`;
      if (!body.length) return [open, params.join(",\n"), `${I}) {}`];
      return [open, params.join(",\n"), `${I}) {`, ...body, `${I}}`];
    }
    const out: string[] = [];
    if (o.style === "lombok")
      out.push(`${I}@Getter`, `${I}@Setter`, `${I}@NoArgsConstructor`, `${I}@ToString`);
    out.push(`${I}${mod}class ${c.name} {`);
    c.fields.forEach((f, idx) => {
      if (idx) out.push("");
      if (needsProp(f)) out.push(`${I}    @JsonProperty("${f.key}")`);
      out.push(`${I}    private ${f.type} ${f.name};`);
    });
    if (o.style === "plain") {
      for (const f of c.fields) {
        const up = f.name.charAt(0).toUpperCase() + f.name.slice(1);
        out.push(
          "",
          `${I}    public ${f.type} get${up}() {`,
          `${I}        return ${f.name};`,
          `${I}    }`,
          "",
          `${I}    public void set${up}(${f.type} ${f.name}) {`,
          `${I}        this.${f.name} = ${f.name};`,
          `${I}    }`
        );
      }
    }
    if (body.length) out.push("", ...body);
    out.push(`${I}}`);
    return out;
  };

  let files: { name: string; code: string }[];
  if (o.nested || classes.length === 1) {
    const inner: string[] = [];
    classes.slice(1).forEach((c, idx) => {
      if (idx) inner.push("");
      inner.push(...emit(c, "    ", true));
    });
    const code = [...header(imports), ...emit(classes[0], "", false, inner)].join("\n");
    files = [{ name: classes[0].name, code }];
  } else {
    files = classes.map((c) => {
      // 클래스별로 실제 쓰는 import만
      const own = new Set(
        [...imports].filter((i) => {
          const simple = i.split(".").pop()!;
          if (i.startsWith("lombok.")) return true;
          if (simple === "JsonProperty") return c.fields.some(needsProp);
          return c.fields.some((f) => new RegExp(`\\b${simple}\\b`).test(f.type));
        })
      );
      return { name: c.name, code: [...header(own), ...emit(c, "", false)].join("\n") };
    });
  }
  return { files, rootIsArray, classCount: classes.length };
}
