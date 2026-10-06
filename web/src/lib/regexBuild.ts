// 정규식 만들기 — 체크박스로 고른 조건을 정규식 + JS/Java 코드로
import { toJavaLiteral } from "@/lib/regexTester";

export const CHAR_GROUPS = [
  { key: "lower", label: "영문 소문자", cls: "a-z" },
  { key: "upper", label: "영문 대문자", cls: "A-Z" },
  { key: "digit", label: "숫자", cls: "0-9" },
  { key: "hangul", label: "한글 (가–힣)", cls: "가-힣" },
  { key: "jamo", label: "한글 낱자 (ㄱ ㅏ)", cls: "ㄱ-ㅎㅏ-ㅣ" },
  { key: "space", label: "공백", cls: " " },
] as const;
export type CharKey = (typeof CHAR_GROUPS)[number]["key"];

export const REQUIRE = [
  { key: "letter", label: "영문", la: "(?=.*[A-Za-z])" },
  { key: "lower", label: "소문자", la: "(?=.*[a-z])" },
  { key: "upper", label: "대문자", la: "(?=.*[A-Z])" },
  { key: "digit", label: "숫자", la: "(?=.*\\d)" },
  { key: "hangul", label: "한글", la: "(?=.*[가-힣])" },
  { key: "special", label: "특수문자", la: "" }, // 고른 특수문자로 만듦
] as const;
export type RequireKey = (typeof REQUIRE)[number]["key"];

export const SPECIAL_PRESETS = [
  { label: "_ - .", chars: "_-." },
  { label: "키보드 특수문자 전부", chars: "~!@#$%^&*()_+-=[]{}|;':\",./<>?`\\" },
  { label: "· (가운뎃점)", chars: "·" },
];

export interface BuildOptions {
  chars: Record<CharKey, boolean>;
  special: string;
  min: string;
  max: string;
  require: Record<RequireKey, boolean>;
  noTriple: boolean;
}

export interface Built {
  error: string | null;
  source: string;
  filter: string;
}

const escClass = (c: string) => ("\\]^-[/".includes(c) ? "\\" + c : c);

export function buildRegex(o: BuildOptions): Built {
  const specials = [...new Set(Array.from(o.special))].filter((c) => !/\s/.test(c));
  const specialCls = specials.map(escClass).join("");
  const body =
    CHAR_GROUPS.filter((g) => o.chars[g.key])
      .map((g) => g.cls)
      .join("") + specialCls;
  if (!body) return { error: "허용할 문자를 하나 이상 고르세요.", source: "", filter: "" };

  const min = o.min.trim() === "" ? 0 : Number(o.min);
  const max = o.max.trim() === "" ? null : Number(o.max);
  if (!Number.isInteger(min) || min < 0 || (max !== null && (!Number.isInteger(max) || max < 1)))
    return { error: "길이는 0 이상의 정수로 넣어 주세요.", source: "", filter: "" };
  if (max !== null && min > max)
    return { error: "최소 길이가 최대 길이보다 커요.", source: "", filter: "" };
  const quant =
    max === null
      ? min === 0
        ? "*"
        : min === 1
          ? "+"
          : `{${min},}`
      : min === max
        ? `{${min}}`
        : `{${min},${max}}`;

  const las: string[] = [];
  for (const r of REQUIRE) {
    if (!o.require[r.key]) continue;
    if (r.key === "special") {
      if (!specialCls)
        return {
          error: "특수문자 포함을 고르려면 허용할 특수문자를 넣어 주세요.",
          source: "",
          filter: "",
        };
      las.push(`(?=.*[${specialCls}])`);
    } else las.push(r.la);
  }
  if (o.noTriple) las.push("(?!.*(.)\\1\\1)");

  return { error: null, source: `^${las.join("")}[${body}]${quant}$`, filter: `[^${body}]` };
}

export interface CodeLine {
  label: string;
  code: string;
}

export function codeFor(source: string, filter: string | null): CodeLine[] {
  const lines: CodeLine[] = [
    { label: "정규식", code: `/${source}/` },
    { label: "JS 검사", code: `/${source}/.test(value)` },
  ];
  if (filter) lines.push({ label: "JS 입력 필터", code: `value.replace(/${filter}/g, "")` });
  lines.push({ label: "Java 검사", code: `value.matches("${toJavaLiteral(source)}")` });
  if (filter)
    lines.push({
      label: "Java 입력 필터",
      code: `value.replaceAll("${toJavaLiteral(filter)}", "")`,
    });
  return lines;
}

// ───────────── 자주 쓰는 형식 ─────────────

export type Hyphen = "required" | "optional" | "none";

export interface FormatDef {
  key: string;
  label: string;
  desc: string;
  /** 하이픈 옵션이 있는 형식은 - 자리에 {-} 를 씀 */
  pattern: string;
  hyphen?: boolean;
  samples: string[];
  note?: string;
}

export const FORMATS: FormatDef[] = [
  {
    key: "mobile",
    label: "휴대폰 번호",
    desc: "010·011·016~019, 가운데 3~4자리",
    pattern: "^01[016789]{-}\\d{3,4}{-}\\d{4}$",
    hyphen: true,
    samples: ["010-1234-5678", "01012345678", "010-123-4567", "02-123-4567", "010-12345-678"],
  },
  {
    key: "tel",
    label: "전화번호 (지역번호)",
    desc: "02, 031~064, 070",
    pattern: "^(02|0[3-6][1-5]|070){-}\\d{3,4}{-}\\d{4}$",
    hyphen: true,
    samples: ["02-123-4567", "031-1234-5678", "070-1234-5678", "010-1234-5678", "1588-1234"],
  },
  {
    key: "email",
    label: "이메일",
    desc: "아이디@도메인.최상위도메인",
    pattern: "^[\\w.+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}$",
    samples: ["gunmo@example.com", "lee+work@corp.co.kr", "user@@test.com", "no-at.com", "a@b.c"],
    note: "실제 메일 주소 규격(RFC 5322)은 훨씬 복잡해서, 형식 체크는 이 정도로 하고 인증 메일로 확인하는 게 보통입니다.",
  },
  {
    key: "biz",
    label: "사업자등록번호",
    desc: "000-00-00000",
    pattern: "^\\d{3}{-}\\d{2}{-}\\d{5}$",
    hyphen: true,
    samples: ["123-45-67890", "1234567890", "123-456-7890"],
    note: "형식만 봅니다. 진짜 번호인지는 마지막 자리 검증 공식이나 국세청 API로 확인해야 해요.",
  },
  {
    key: "zip",
    label: "우편번호",
    desc: "새 우편번호 5자리",
    pattern: "^\\d{5}$",
    samples: ["06236", "123-456", "1234"],
  },
  {
    key: "id",
    label: "아이디",
    desc: "영문으로 시작, 영문·숫자·_ 4~20자",
    pattern: "^[A-Za-z][A-Za-z0-9_]{3,19}$",
    samples: ["gunmo_01", "1gunmo", "abc", "건모123"],
  },
  {
    key: "pw",
    label: "비밀번호",
    desc: "영문+숫자+특수문자 각 1개 이상, 8~16자",
    pattern: "^(?=.*[A-Za-z])(?=.*\\d)(?=.*[!@#$%^&*])[A-Za-z\\d!@#$%^&*]{8,16}$",
    samples: ["abcd1234!", "abcd1234", "12345678!", "ab1!", "abcd 1234!"],
  },
  {
    key: "name",
    label: "한글 이름",
    desc: "완성형 한글 2~5자",
    pattern: "^[가-힣]{2,5}$",
    samples: ["이건모", "건", "ㄱㅁ", "Gunmo"],
  },
  {
    key: "date",
    label: "날짜",
    desc: "YYYY-MM-DD (월 01~12, 일 01~31)",
    pattern: "^\\d{4}{-}(0[1-9]|1[0-2]){-}(0[1-9]|[12]\\d|3[01])$",
    hyphen: true,
    samples: ["2026-10-02", "20261002", "2026-13-01", "2026-02-31"],
    note: "2월 31일 같은 없는 날짜는 정규식으로 막기 어려워요. 형식 확인 후 Date로 한 번 더 검사하세요.",
  },
  {
    key: "time",
    label: "시간",
    desc: "HH:mm (00:00~23:59)",
    pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
    samples: ["09:30", "23:59", "24:00", "9:30"],
  },
  {
    key: "money",
    label: "금액 (콤마)",
    desc: "1,000 / 1,234,567",
    pattern: "^(0|[1-9]\\d{0,2}(,\\d{3})*)$",
    samples: ["1,000", "1,234,567", "1000", "1,00", "01,000"],
  },
  {
    key: "decimal",
    label: "숫자 (소수)",
    desc: "음수·소수점 허용",
    pattern: "^-?\\d+(\\.\\d+)?$",
    samples: ["3.14", "-12", "0.5", ".5", "1."],
  },
  {
    key: "car",
    label: "차량 번호",
    desc: "12가3456 / 123가4567",
    pattern: "^\\d{2,3}[가-힣]\\d{4}$",
    samples: ["12가3456", "123가4567", "서울12가3456"],
  },
  {
    key: "url",
    label: "URL",
    desc: "http(s)://로 시작",
    pattern: "^https?:\\/\\/[\\w-]+(\\.[\\w-]+)+(:\\d+)?(\\/\\S*)?$",
    samples: [
      "https://rjsah5676.github.io/",
      "https://example.com/a?q=1",
      "http://localhost:3000",
      "ftp://a.com",
    ],
    note: "도메인에 점(.)이 있어야 해서 localhost는 걸러집니다.",
  },
  {
    key: "ipv4",
    label: "IPv4",
    desc: "0.0.0.0 ~ 255.255.255.255",
    pattern: "^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$",
    samples: ["192.168.0.1", "255.255.255.255", "256.1.1.1", "1.2.3"],
  },
  {
    key: "color",
    label: "HEX 색상",
    desc: "#fff / #6C63FF",
    pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
    samples: ["#fff", "#6C63FF", "#12345", "6C63FF"],
  },
];

export function formatSource(f: FormatDef, hyphen: Hyphen): string {
  const h = hyphen === "required" ? "-" : hyphen === "optional" ? "-?" : "";
  return f.pattern.replaceAll("{-}", h);
}

/** 하이픈 없음이면 예시도 하이픈 없는 걸 위주로 */
export function formatSamples(f: FormatDef, hyphen: Hyphen): string[] {
  if (!f.hyphen || hyphen !== "none") return f.samples;
  return [...new Set(f.samples.map((s) => s.replaceAll("-", "")).concat(f.samples[0]))];
}
