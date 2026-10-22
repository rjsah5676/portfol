import type { ReactNode } from "react";
import { pageMeta, SITE_HOST } from "@/lib/seo";

export const metadata = pageMeta({
  title: "개인정보 처리방침",
  description: `${SITE_HOST}가 어떤 정보를 왜 모으고 얼마 동안 보관하는지, 지우고 싶을 때 어떻게 하면 되는지 안내합니다.`,
  path: "/privacy/",
});

const EFFECTIVE = "2026년 10월 23일";
const CONTACT = "rjsah5676@gmail.com";

const KR = "font-['Nanum_Gothic',sans-serif]";

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/10 py-8">
      <h2 className="mb-4 text-lg font-bold text-white">
        <span className="mr-2 font-mono text-sm text-[#8B84FF]">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-[15px] leading-7 text-white/70">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-white/[0.04] text-white/50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/[0.07] align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-3 ${j === 0 ? "whitespace-nowrap text-white/85" : "text-white/65"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <main className={`mx-auto max-w-3xl px-4 pt-16 pb-8 sm:px-6 ${KR}`}>
      <p className="font-mono text-xs text-[#8B84FF]">privacy</p>
      <h1 className="mt-2 text-3xl font-bold text-white">개인정보 처리방침</h1>
      <p className="mt-4 text-[15px] leading-7 text-white/60">
        {SITE_HOST}(이하 &ldquo;사이트&rdquo;)는 개인이 운영하는 포트폴리오 사이트입니다. 사이트를 운영하는 데 필요한 만큼만 정보를
        모으고, 아래에 적은 목적 밖으로는 쓰지 않으며, 다른 사람에게 팔거나 넘기지 않습니다.
      </p>

      <Section n={1} title="모으는 정보">
        <Table
          head={["구분", "항목", "모으는 방법"]}
          rows={[
            [
              "방문 기록",
              "IP 주소, 브라우저·기기 정보(User-Agent), 들어온 경로(이전 페이지 주소, 광고 추적 파라미터 utm_*), 본 페이지와 시각, 화면 크기, 언어, 시간대, IP로 추정한 국가·지역, 회원 여부(회원이면 어느 회원인지)",
              "페이지를 열 때 자동으로",
            ],
            ["회원", "Google 계정 이메일, 별명, 직접 올린 프로필 사진, 게임 기록", "Google 로그인 · 직접 입력"],
            ["문의", "이름, 이메일, 연락처, 문의 내용", "문의하기에서 직접 입력"],
            ["방명록 · 랭킹", "적은 이름과 내용, 게임 점수", "직접 입력"],
            [
              "친구 · 메시지",
              "친구 목록과 요청, 주고받은 메시지와 읽음 여부, 접속 상태와 지금 보고 있는 화면(친구에게만 보임)",
              "회원이 직접 입력 · 사이트를 쓰는 동안 자동으로",
            ],
            ["신고", "신고한 회원과 대상 회원, 사유와 내용, 신고한 화면, 두 사람이 주고받은 최근 메시지", "신고하기에서 직접 입력"],
          ]}
        />
      </Section>

      <Section n={2} title="쓰는 곳">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>방문 통계: 사람들이 어디서, 어떤 기기·브라우저로 들어오는지 보고 사이트를 고치는 데 씁니다.</li>
          <li>부정 이용 막기: 도배 · 랭킹 조작 같은 비정상적인 요청을 걸러내는 데 씁니다.</li>
          <li>회원 기능: 로그인, 별명 · 프로필 사진 표시, 랭킹과 게임 기록.</li>
          <li>문의 답변: 남겨 주신 연락처로 답장합니다.</li>
          <li>친구 · 메시지: 친구 맺기, 메시지 전달, 친구에게 접속 중인지 보여 주기.</li>
          <li>신고 처리: 신고된 내용을 확인하고 이용 정지 같은 조치를 하는 데 씁니다.</li>
        </ul>
      </Section>

      <Section n={3} title="보관 기간">
        <Table
          head={["항목", "보관 기간"]}
          rows={[
            ["방문 기록의 IP 주소", "30일. 지나면 IP만 지웁니다."],
            ["방문 기록 (IP 외)", "180일. 지나면 자동으로 지웁니다. 회원을 지우면 방문 기록에서 그 회원 표시도 지웁니다."],
            [
              "방문 통계",
              "날짜별 숫자(유입 경로별 방문 수, 기기 종류별 수 등)로만 계속 보관합니다. 이 숫자로는 누가 방문했는지 알 수 없습니다.",
            ],
            ["회원 정보 · 게임 기록", "탈퇴(삭제 요청)할 때까지"],
            ["문의", "답변을 마치고 필요가 없어지면 지웁니다. 요청하면 바로 지웁니다."],
            ["방명록 · 랭킹", "직접 지우거나 삭제를 요청할 때까지"],
            ["메시지", "보낸 지 180일이 지나면 자동으로 지웁니다."],
            ["친구 목록", "친구를 끊거나 탈퇴(삭제 요청)할 때까지"],
            ["신고", "처리 기록으로 보관합니다. 삭제를 요청하면 확인한 뒤 지웁니다."],
          ]}
        />
        <p>
          하루 단위 방문자 수는 IP와 브라우저 정보를 그날만 쓰는 값으로 섞어 만든 해시로 셉니다. 해시는 날마다 달라져서 서로 다른 날의
          방문을 같은 사람으로 이어 볼 수 없습니다.
        </p>
      </Section>

      <Section n={4} title="맡기는 곳과 국외 이전">
        <Table
          head={["받는 곳", "하는 일", "위치"]}
          rows={[
            ["Amazon Web Services (Lightsail)", "사이트 서버와 데이터베이스", "대한민국(서울 리전)"],
            ["Google (Firebase Authentication)", "Google 계정 로그인", "미국 등 Google 데이터센터"],
            ["Google (Google Fonts)", "글꼴 파일 제공 (브라우저가 글꼴을 받을 때 IP가 전달됨)", "미국 등 Google 데이터센터"],
            [
              "Cloudflare (Turnstile)",
              "로그인하지 않고 랭킹 · 방명록 · 문의를 남길 때 사람인지 확인 (브라우저 · 기기 정보와 IP가 전달됨)",
              "미국 등 Cloudflare 데이터센터",
            ],
          ]}
        />
        <p>
          IP로 국가·지역을 추정할 때는 서버 안에 있는 데이터베이스(MaxMind GeoLite2)를 쓰고, IP를 바깥 서비스로 보내지 않습니다.
        </p>
      </Section>

      <Section n={5} title="쿠키와 브라우저 저장소">
        <p>
          사이트는 광고·추적용 쿠키를 쓰지 않습니다. 대신 브라우저 저장소에 다음을 남깁니다: 탭 하나를 한 번의 방문으로 묶는 임의의
          값(sessionStorage, 탭을 닫으면 사라짐), 전에 와 본 적이 있는지 표시, 게임 설정과 기록(localStorage). 브라우저 설정에서
          사이트 데이터를 지우면 함께 지워집니다.
        </p>
      </Section>

      <Section n={6} title="열람 · 정정 · 삭제 요청">
        <p>
          내 정보를 보고 싶거나, 고치거나, 지우고 싶으면 아래 이메일로 알려 주세요. 본인인지 확인한 뒤 바로 처리합니다. 회원 별명과 프로필
          사진은 내 정보 화면에서 직접 바꿀 수 있습니다.
        </p>
      </Section>

      <Section n={7} title="개인정보 보호책임자">
        <p>
          이건모 · <a href={`mailto:${CONTACT}`} className="text-[#B8B3FF] underline-offset-4 hover:underline">{CONTACT}</a>
        </p>
        <p className="text-sm text-white/45">
          개인정보 침해에 대한 신고나 상담은 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118)에서도 받습니다.
        </p>
      </Section>

      <Section n={8} title="바뀔 때">
        <p>이 방침이 바뀌면 이 페이지에 바뀐 내용과 날짜를 적습니다.</p>
        <p className="text-sm text-white/45">2026년 10월 23일: 친구 · 메시지 · 신고 항목을 더했습니다.</p>
        <p className="text-sm text-white/45">시행일: {EFFECTIVE}</p>
      </Section>
    </main>
  );
}
