/**
 * 필살기 컷인 — 필살기를 쓰는 순간(화면이 멈추는 0.6초) 쓴 쪽에서 비스듬한 띠가 들어오며 캐릭터 얼굴 · 필살기 이름.
 * 그림: public/fight/cutin/<id>.webp 가 있으면 그것(가로로 긴 컷인 그림), 없으면 전신 그림(art)의 윗부분을 잘라 씀. 2P 쪽은 좌우를 뒤집음.
 */
import { useState } from "react";
import { CHARS } from "@/lib/fight/chars";
import { artUrl, cutinUrl } from "@/lib/fight/skins";

const KR = "font-['Black_Han_Sans','Nanum_Gothic',sans-serif]";

export interface CutInCfg {
  ch: number;
  right: boolean;
  key: number;
  skin?: string | null;
}

export default function CutIn({ cfg }: { cfg: CutInCfg }) {
  const c = CHARS[cfg.ch];
  const [own, setOwn] = useState(true);
  if (!c) return null;
  const r = cfg.right;
  return (
    <div key={cfg.key} className="pointer-events-none absolute inset-0 z-20 overflow-hidden [animation:cutin-fade_600ms_linear_forwards]">
      <style>{`
@keyframes cutin-fade{0%{opacity:0}8%{opacity:1}82%{opacity:1}100%{opacity:0}}
@keyframes cutin-band-l{0%{transform:translateX(-110%) skewY(-6deg)}18%{transform:translateX(0) skewY(-6deg)}100%{transform:translateX(3%) skewY(-6deg)}}
@keyframes cutin-band-r{0%{transform:translateX(110%) skewY(6deg)}18%{transform:translateX(0) skewY(6deg)}100%{transform:translateX(-3%) skewY(6deg)}}
@keyframes cutin-art{0%{transform:translateX(var(--from)) scale(1.15)}22%{transform:translateX(0) scale(1)}100%{transform:translateX(var(--drift)) scale(1.04)}}
@keyframes cutin-name{0%{opacity:0;letter-spacing:0.6em}25%{opacity:1;letter-spacing:0.08em}100%{opacity:1;letter-spacing:0.12em}}
`}</style>
      <div
        className="absolute inset-x-0 top-[24%] h-[34%]"
        style={{
          animation: `${r ? "cutin-band-r" : "cutin-band-l"} 600ms cubic-bezier(.2,.9,.2,1) forwards`,
          background: `linear-gradient(${r ? 270 : 90}deg, ${c.color}EE 0%, ${c.color}AA 45%, rgba(10,6,20,0.85) 100%)`,
          boxShadow: `0 0 0 0.3cqw #fff, 0 0 3cqw ${c.color}`,
        }}
      >
        {/* 속도선 */}
        <div
          className="absolute inset-0 opacity-40"
          style={{ background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.35) 0 0.15cqw, transparent 0.15cqw 1.4cqw)" }}
        />
        <div className={`absolute inset-y-0 ${r ? "right-0 scale-x-[-1]" : "left-0"} w-[46%] overflow-hidden`}>
          <img
            src={own ? cutinUrl(cfg.ch, cfg.skin) : artUrl(cfg.ch, cfg.skin)}
            alt=""
            onError={() => setOwn(false)}
            className={`absolute h-full w-full object-cover ${own ? "" : "object-top"}`}
            style={
              {
                "--from": "-30%",
                "--drift": "2%",
                animation: "cutin-art 600ms cubic-bezier(.2,.9,.2,1) forwards",
                ...(own ? {} : { height: "300%", top: "-8%" }),
              } as React.CSSProperties
            }
          />
        </div>
        <div className={`absolute inset-y-0 ${r ? "left-[6%] items-start" : "right-[6%] items-end"} flex flex-col justify-center`}>
          <div className="font-mono text-[1.4cqw] font-black tracking-[0.3em] text-white/80 italic">ULTIMATE</div>
          <div
            className={`${KR} text-[5.2cqw] leading-none text-white [animation:cutin-name_600ms_ease-out_forwards]`}
            style={{ textShadow: `0 0.3cqw 0 #000, 0 0 1.6cqw ${c.color}` }}
          >
            {c.ultName}
          </div>
          <div className="mt-[0.4cqw] font-['Nanum_Gothic',sans-serif] text-[1.5cqw] font-bold text-white/85">{c.name}</div>
        </div>
      </div>
    </div>
  );
}
