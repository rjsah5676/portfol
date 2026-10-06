"use client";

import { useEffect, useRef } from "react";

/** 누르면 한 번, 꾹 누르고 있으면 점점 빠르게 반복 (싱크 1ms 단위 조절용) */
export default function HoldButton({
  className,
  onStep,
  children,
  disabled = false,
}: {
  className: string;
  onStep: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(onStep);
  useEffect(() => {
    stepRef.current = onStep;
  }, [onStep]);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const start = () => {
    stop();
    stepRef.current();
    let delay = 380;
    const loop = () => {
      stepRef.current();
      delay = Math.max(30, delay * 0.8);
      timer.current = setTimeout(loop, delay);
    };
    timer.current = setTimeout(loop, delay);
  };
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        if (!disabled) start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!disabled) stepRef.current();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}
