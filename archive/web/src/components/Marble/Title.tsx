"use client";

import { useState } from "react";
import NickForm from "@/components/Account/NickForm";
import { sfx } from "./audio";

/*
 * 로그인 전 · 별명 전 타이틀 화면 (애니메 포커 Intro 처럼): 큰 배경 그림 · 위 로고 · 아래 시작 칸 · 걸어 다니는 도트 친구들.
 */

export default function Title({ account, onLogin }: { account: boolean; onLogin(): Promise<unknown> | void }) {
  const [err, setErr] = useState("");
  return (
    <div className="mbx absolute inset-0 overflow-hidden bg-[#1b1650]">
      <img src="/marble/art/title.webp" alt="" className="mbx-title-bg absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(20,14,60,0.55), rgba(20,14,60,0) 30%, rgba(20,14,60,0) 62%, rgba(14,10,44,0.8))" }} />

      {/* 로고 */}
      <div className="absolute top-[30px] left-1/2 flex -translate-x-1/2 flex-col items-center">
        <span className="mb-1 rounded-full bg-black/35 px-3 text-[11px] leading-[20px] font-black tracking-[0.3em] text-[#ffe08a] ring-1 ring-[#ffe08a]/40 backdrop-blur">PIXEL FIGHT 세계관 · BOARD GAME</span>
        <h1 className="mbx-title-logo text-[92px] leading-[96px] font-black tracking-[-0.02em]">
          DICE TOWN
        </h1>
        <span className="mt-1 rounded-full bg-[rgba(20,14,60,0.72)] px-4 text-[15px] leading-[30px] font-bold text-white ring-1 ring-white/15 backdrop-blur-sm">
          주사위를 굴려 땅을 사고 · 짓고 · 인수하는 2~4인 보드게임
        </span>
      </div>

      {/* 시작 칸 */}
      <div className="absolute bottom-[28px] left-1/2 w-[360px] -translate-x-1/2">
        <div className="mbx-modal flex flex-col items-center px-6 pt-4 pb-5 text-center">
          {!account ? (
            <>
              <b className="mb-title mb-1 text-[20px]">오늘 마을의 주인은 너야!</b>
              <p className="mb-3 text-[12.5px] text-white/70">회원 전용 · 처음이면 캐릭터 10연차 티켓을 드려요</p>
              <button
                type="button"
                onClick={() => {
                  sfx("click");
                  setErr("");
                  void Promise.resolve(onLogin()).catch(() => setErr("로그인하지 못했어요. 잠시 후 다시 시도해 주세요."));
                }}
                className="mbx-sheen relative flex h-[50px] w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full text-[16px] font-black text-[#3a2500] transition hover:scale-[1.02]"
                style={{ background: "linear-gradient(180deg,#ffe48a,#ffb92e)", boxShadow: "0 4px 0 #b9741a, 0 0 0 2px #fff, 0 0 22px rgba(255,210,90,0.45)" }}
              >
                <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
                    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
                    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
                    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
                    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
                  </svg>
                </span>
                Google로 시작하기
              </button>
              <p className="mt-2 text-[11px] text-white/45">실제 돈이 오가지 않는 게임이에요.</p>
              {err && <p className="mt-1 text-[12px] text-[#ffb3b5]">{err}</p>}
            </>
          ) : (
            <>
              <b className="mb-title mb-1 text-[18px]">별명을 정하면 시작할 수 있어요</b>
              <p className="mb-3 text-[12px] text-white/65">마을 사람들에게 보일 이름이에요</p>
              <div className="w-full text-left">
                <NickForm submitLabel="시작하기" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
