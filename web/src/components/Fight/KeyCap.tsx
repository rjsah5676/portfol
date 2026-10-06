/**
 * 키보드 키 모양 (J·K·L·I 등) — 설명 글 안에서 글자 크기에 맞춰 커짐(em 단위)
 * keyText: 문장 속 단독 J·K·L·I 글자를 키 모양으로 바꿔 줌 ("K.O." 같은 건 그대로)
 */
import type { CSSProperties, ReactNode } from "react";

export function KeyCap({ k, style }: { k: string; style?: CSSProperties }) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "1.55em",
        height: "1.55em",
        padding: "0 0.3em",
        margin: "0 0.12em",
        verticalAlign: "0.05em",
        borderRadius: "0.3em",
        border: "1px solid rgba(255,255,255,0.55)",
        borderBottomWidth: "0.22em",
        borderBottomColor: "rgba(120,120,150,0.9)",
        background: "linear-gradient(180deg, #FFFFFF 0%, #E4E6F0 60%, #C9CCDB 100%)",
        boxShadow: "0 0.1em 0.25em rgba(0,0,0,0.45)",
        color: "#1A1530",
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 800,
        fontSize: "0.82em",
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {k}
    </kbd>
  );
}

const KEY_RE = /(?<![A-Za-z.])([JKLI])(?![A-Za-z.])/g;

/** 문장 속 J·K·L·I를 키 모양으로 */
export function keyText(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(KEY_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(<KeyCap key={i} k={m[1]} />);
    last = i + 1;
  }
  if (last === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}
