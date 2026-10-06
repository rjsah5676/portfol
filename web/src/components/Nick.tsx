/*
 * 사람 이름 표시. 회원(별명)은 그대로, 비회원이 적은 이름은 앞에 GUEST 표시를 붙여 구분함.
 *
 * 비회원인지는 두 가지 방식으로 옴
 *   - 온라인 게임(방·채팅): 서버가 이름 앞에 "◦" 를 붙여서 보냄 → 이름만 넘기면 됨
 *   - 랭킹·방명록: 기록에 member 표시가 따로 있음 → guest={!row.member} 로 넘김
 */

/** 서버가 비회원 이름 앞에 붙이는 표시 (server/src/users.ts 의 GUEST_MARK) */
export const GUEST_MARK = "◦";

export const isGuestName = (name: string) => name.startsWith(GUEST_MARK);
/** 표시를 뗀 이름 */
export const plainName = (name: string) =>
  isGuestName(name) ? name.slice(GUEST_MARK.length) : name;

/** 바탕색에 맞춘 표시 색: dark = 어두운 화면(기본), paper = 밝은 종이(방명록 메모 등) */
type Tone = "dark" | "paper";
const TONE: Record<Tone, string> = {
  dark: "border-[#FDBA74]/60 text-[#FDBA74]/90",
  paper: "border-black/40 text-black/55",
};

export function GuestTag({ tone = "dark" }: { tone?: Tone }) {
  return (
    <span
      title="로그인하지 않은 사람이 적은 이름"
      className={`mr-1 inline-block shrink-0 rounded-[0.3em] border border-dashed px-[0.35em] align-[0.08em] font-mono text-[0.68em] leading-[1.35] font-semibold tracking-wide ${TONE[tone]}`}
    >
      GUEST
    </span>
  );
}

export default function Nick({
  name,
  guest,
  tone,
  className,
}: {
  name: string;
  /** 비회원 여부를 따로 알 때 (안 주면 이름 앞의 표시로 판단) */
  guest?: boolean;
  tone?: Tone;
  className?: string;
}) {
  const g = guest ?? isGuestName(name);
  return (
    <span className={className}>
      {g && <GuestTag tone={tone} />}
      {plainName(name)}
    </span>
  );
}
