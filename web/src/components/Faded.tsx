import type { ComponentPropsWithoutRef } from "react";

type FadedProps = ComponentPropsWithoutRef<"div"> & {
  duration?: number;
  delay?: number;
};

export default function Faded({ duration = 1200, delay = 0, children, style, ...rest }: FadedProps) {
  return (
    <div
      className="faded-wrapper"
      style={{
        ...style,
        animationDuration: duration + "ms",
        animationDelay: delay + "ms",
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
