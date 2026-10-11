import Link from "next/link";
import gitImg from "../img/footer/github.png";
import FooterWidgets from "./FooterWidgets";
import ContactButton from "./ContactButton";
import InquiryButton from "./InquiryButton";

export default function Footer() {
  return (
    <footer id="site-footer" className="mt-32 flex flex-col gap-10 border-t border-white/5 pt-10 pb-10">
      <FooterWidgets />
      {/* 포트폴리오·소개·기록·방명록 (상단에는 로그인만 둠) */}
      <nav
        aria-label="사이트"
        className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 font-mono text-sm text-white/60"
      >
        <Link href="/portfolio" className="transition-colors hover:text-white">
          portfolio
        </Link>
        <Link href="/about" className="transition-colors hover:text-white">
          about
        </Link>
        <Link href="/archive" className="transition-colors hover:text-white">
          archive
        </Link>
        <Link href="/guest" className="transition-colors hover:text-white">
          guest box
        </Link>
      </nav>
      <div className="flex items-center justify-center gap-2 font-mono text-xs text-white/40">
        {/* 모바일에서 오른쪽 아래 플로팅 버튼에 가리지 않게 맨 앞에 둠 */}
        <ContactButton />
        <span className="text-white/20">·</span>
        <InquiryButton />
        <span className="text-white/20">·</span>
        <a
          href="https://github.com/rjsah5676"
          className="opacity-60 transition-opacity hover:opacity-100"
        >
          <img src={gitImg.src} alt="GitHub" className="h-4 w-auto" />
        </a>
        <span>© 2026 Gunmo Lee</span>
        <span className="text-white/20">·</span>
        <Link href="/privacy/" className="font-['Nanum_Gothic',sans-serif] transition-colors hover:text-white">
          개인정보 처리방침
        </Link>
      </div>
    </footer>
  );
}
