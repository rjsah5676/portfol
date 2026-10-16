import Link from "next/link";
import type { ReactNode } from "react";
import { pageMeta } from "@/lib/seo";
import {
  ACHIEVEMENTS,
  ATTEND_POINTS,
  POINT,
  POINT_GAMES,
  POINT_NOTICE,
  POKER_EXCHANGE,
  SHOP,
  fmtPoint,
} from "@/lib/points";

export const metadata = pageMeta({
  title: "자주 묻는 질문",
  description: `${POINT.name} · 업적 · 회원 · 게임 랭킹 등 자주 묻는 질문을 모았습니다.`,
  path: "/faq/",
});

const KR = "font-['Nanum_Gothic',sans-serif]";
const EOK = 100_000_000;
const MAN = 10_000;
const chips = (n: number) =>
  n >= EOK ? `${n / EOK}억` : `${(n / MAN).toLocaleString()}만`;

function Q({
  q,
  children,
  open,
}: {
  q: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details
      open={open}
      className="group rounded-xl border border-white/10 bg-[#1C1E24] open:border-white/20"
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 text-[15px] font-bold break-keep text-white [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 font-mono text-sm text-[#8B84FF]">Q</span>
        <span className="flex-1">{q}</span>
        <span
          className="mt-0.5 text-white/35 transition-transform group-open:rotate-180"
          aria-hidden
        >
          ⌄
        </span>
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-4 pl-10 text-sm leading-7 break-keep text-white/70">
        {children}
      </div>
    </details>
  );
}

function Group({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="mb-3 font-mono text-sm text-[#8B84FF]">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export default function FaqPage() {
  const achCount = ACHIEVEMENTS.length;
  return (
    <div
      className={`mx-auto flex max-w-2xl flex-col gap-10 px-5 pt-16 pb-24 sm:px-6 ${KR}`}
    >
      <div>
        <div className="font-mono text-sm text-[#8B84FF]">faq</div>
        <h1 className="mt-1 text-3xl font-bold text-white">자주 묻는 질문</h1>
        <p className="mt-2 text-sm break-keep text-white/50">
          찾는 답이 없으면 아래쪽 「문의하기」로 물어봐 주세요.
        </p>
      </div>

      <Group id="points" title={`${POINT.name} (${POINT.unit})`}>
        <Q q={`${POINT.name}가 뭔가요?`} open>
          <p>
            이 사이트의 게임에서 함께 쓰는{" "}
            <b className="text-white">무료 재화</b>예요. 출석과 게임 업적으로
            모으고, 게임 안 캐릭터 · 스킨 같은 상품을 사는 데 써요.
          </p>
          <ul className="list-disc pl-5">
            {POINT_NOTICE.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Q>
        <Q q="어떻게 모으나요?">
          <ul className="list-disc pl-5">
            <li>
              <b className="text-white">출석</b>: 로그인한 채로 하루 처음
              들어오면 {fmtPoint(ATTEND_POINTS)} (한국 시간 자정에 바뀌어요)
            </li>
            <li>
              <b className="text-white">업적</b>: 게임 화면 위의 🏅 업적
              버튼에서 확인하고, 달성하면 「받기」를 눌러 받아요. 지금 업적은{" "}
              {achCount}개예요.
            </li>
            <li>
              <b className="text-white">환전</b>: ANIME POKER 상점의 「환전」
              탭에서 칩을 {POINT.name}로 바꿀 수 있어요.
            </li>
          </ul>
          <p className="text-white/50">
            {POINT.name}는 로그인한 회원만 모을 수 있어요.
          </p>
        </Q>
        <Q q="어디에 쓰나요?">
          <p>지금은 ANIME POKER 상점에서 쓸 수 있어요.</p>
          <ul className="list-disc pl-5">
            {SHOP.map((s) => (
              <li key={s.id}>
                {POINT_GAMES[s.game]} · {s.name} — {fmtPoint(s.price)}
              </li>
            ))}
          </ul>
          <p className="text-white/50">
            PIXEL Rhythm Up · PIXEL FIGHT · PIXEL LUCKY DEFENSE · DOODLE PARTY에도
            상점이 차례로 열릴 예정이에요.
          </p>
        </Q>
        <Q q="포커 칩과 바꿀 수 있나요?">
          <p>
            네. ANIME POKER 상점의 「환전」 탭에서 칩{" "}
            {chips(POKER_EXCHANGE.chips)} = {fmtPoint(POKER_EXCHANGE.points)}로
            서로 바꿀 수 있어요.
          </p>
          <ul className="list-disc pl-5">
            <li>테이블에 앉아 있는 동안에는 바꿀 수 없어요.</li>
            <li>
              칩을 {POINT.name}로 바꾼 뒤에도 칩{" "}
              {chips(POKER_EXCHANGE.keepChips)}은 남아 있어야 해요.
            </li>
            <li>
              {POINT.name}로 바꿔 받은 칩은 「칩 모으기」 업적에 들어가지
              않아요.
            </li>
          </ul>
        </Q>
        <Q q="업적 랭킹은 어떻게 정해지나요?">
          <p>
            각 게임 랭킹 창의 「업적 랭킹」 탭은 그 게임 업적으로 받은{" "}
            {POINT.name}의 합으로 순서를 정해요. 같으면 먼저 모은 사람이 위예요.
          </p>
        </Q>
        <Q q={`${POINT.name}가 사라졌거나 이상해요`}>
          <p>
            마이페이지의 「최근 내역」에서 언제 얼마나 들어오고 나갔는지 볼 수
            있어요. 그래도 이상하면 문의해 주세요.
          </p>
        </Q>
      </Group>

      <Group id="account" title="회원 · 로그인">
        <Q q="꼭 가입해야 하나요?">
          <p>
            대부분의 게임은 로그인 없이 할 수 있어요. Google로 로그인하고 별명을
            정하면 랭킹에 별명이 남고, {POINT.name} · 업적 · 포커 · 랭크전처럼
            기록이 이어지는 기능을 쓸 수 있어요.
          </p>
        </Q>
        <Q q="별명이나 프로필 사진을 바꾸고 싶어요">
          <p>
            <Link
              href="/me"
              className="text-[#8B84FF] underline underline-offset-2"
            >
              마이페이지
            </Link>
            에서 바꿀 수 있어요. 별명을 바꾸면 랭킹 · 방명록의 이름도 같이
            바뀌어요.
          </p>
        </Q>
        <Q q="내 정보를 지우고 싶어요">
          <p>
            <Link
              href="/privacy/"
              className="text-[#8B84FF] underline underline-offset-2"
            >
              개인정보 처리방침
            </Link>
            에 지우는 방법이 있어요.
          </p>
        </Q>
      </Group>

      <Group id="games" title="게임 · 랭킹">
        <Q q="랭킹에 기록이 안 올라가요">
          <p>
            게임을 끝까지 마친 판만 올라가요. 브라우저에서 점수를 계산하는
            게임은 말이 안 되는 기록을 서버가 걸러서, 너무 빠르거나 이상한
            기록은 올라가지 않을 수 있어요.
          </p>
        </Q>
        <Q q="소리가 너무 크거나 작아요">
          <p>
            각 게임의 설정(⚙)에서 배경음 · 효과음 크기를 따로 조절할 수 있어요.
          </p>
        </Q>
      </Group>
    </div>
  );
}
