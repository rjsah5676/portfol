"use client";

import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { playSfx } from "@/lib/sketch/sfx";
import { COLORS, WIDTHS, type CanvasApi, type Tool } from "./SketchCanvas";
import { Icon } from "./Art";

/** 그리는 도구 상태 (색 · 굵기 · 펜/채우기/지우개) */
export function useTools() {
  const [tool, setToolRaw] = useState<Tool>("pen");
  const [color, setColorRaw] = useState(COLORS[0]);
  const [width, setWidthRaw] = useState(WIDTHS[1]);
  const setTool = (t: Tool) => {
    playSfx("sfx-tool");
    setToolRaw(t);
  };
  const setColor = (c: string) => {
    playSfx("sfx-color");
    setColorRaw(c);
    if (tool === "eraser") setToolRaw("pen");
  };
  const setWidth = (w: number) => {
    playSfx("sfx-tool");
    setWidthRaw(w);
    if (tool === "fill") setToolRaw("pen");
  };
  const resetTool = useCallback(() => setToolRaw("pen"), []);
  return { tool, color, width, setTool, setColor, setWidth, resetTool };
}
export type Tools = ReturnType<typeof useTools>;

/**
 * 도구 모음. 막을 것만 넘김:
 *  colors   쓸 수 있는 색 (없으면 16색)
 *  noFill · noEraser · noUndo  해당 도구 숨김
 *  extra    오른쪽 끝에 붙일 것 (「다 그렸어요」 버튼 등)
 */
export default function Toolbar({
  compact,
  t,
  apiRef,
  colors = COLORS,
  noFill,
  noEraser,
  noUndo,
  extra,
}: {
  compact: boolean;
  t: Tools;
  apiRef: RefObject<CanvasApi | null>;
  colors?: string[];
  noFill?: boolean;
  noEraser?: boolean;
  noUndo?: boolean;
  extra?: ReactNode;
}) {
  const { tool, color, width } = t;
  const tools = (
    [
      ["pen", "펜", "pen", "B"],
      ["fill", "채우기", "fill", "F"],
      ["eraser", "지우개", "eraser", "E"],
    ] as const
  ).filter(([k]) => !(k === "fill" && noFill) && !(k === "eraser" && noEraser));
  return (
    <div
      className={`sk-card-soft flex items-center ${compact ? "flex-col gap-2 px-2 py-2" : "gap-3 px-3 py-2"}`}
    >
      {colors.length > 1 && (
        <div
          className={
            compact
              ? "grid w-full grid-cols-8 justify-items-center gap-y-1.5"
              : "grid grid-cols-8 gap-1.5"
          }
        >
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`색 ${c}`}
              data-on={color === c && tool !== "eraser"}
              onClick={() => t.setColor(c)}
              className="sk-swatch shrink-0"
              style={{ backgroundColor: c, width: compact ? 25 : 22, height: compact ? 25 : 22 }}
            />
          ))}
        </div>
      )}
      <div
        className={`flex items-center ${compact ? "w-full justify-between gap-1" : "flex-1 gap-3"}`}
      >
        <div className="flex items-center gap-0.5">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`굵기 ${w}`}
              onClick={() => t.setWidth(w)}
              className={`flex h-9 w-7 cursor-pointer items-center justify-center rounded-lg ${width === w ? "bg-[var(--ink)]/10 ring-2 ring-[var(--ink)]" : "hover:bg-[var(--ink)]/5"}`}
            >
              <span
                className="rounded-full"
                style={{
                  width: Math.max(4, Math.min(24, w * 0.6)),
                  height: Math.max(4, Math.min(24, w * 0.6)),
                  background:
                    tool === "eraser" ? "#9a9db3" : color === "#FFFFFF" ? "#C9CED6" : color,
                }}
              />
            </button>
          ))}
        </div>
        {tools.length > 1 && (
          <div className="flex items-center gap-1">
            {tools.map(([k, label, icon, key]) => (
              <button
                key={k}
                type="button"
                data-on={tool === k}
                onClick={() => t.setTool(k)}
                title={`${label} (${key})`}
                className={`sk-tool ${compact ? "h-10 w-10 text-[10.5px]" : "h-12 w-12 text-[13px]"}`}
              >
                <Icon name={icon} size={compact ? 18 : 20} />
                {label}
              </button>
            ))}
          </div>
        )}
        {!noUndo && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => apiRef.current?.undo()}
              title="되돌리기 (Ctrl+Z)"
              className={`sk-tool ${compact ? "h-10 w-10 text-[10.5px]" : "h-12 w-12 text-[13px]"}`}
            >
              <Icon name="undo" size={compact ? 18 : 20} />
              되돌리기
            </button>
            <ClearButton compact={compact} onClear={() => apiRef.current?.clear()} />
          </div>
        )}
        {extra}
      </div>
    </div>
  );
}

/** 전체 지우기 — 한 번 더 눌러야 */
function ClearButton({ compact, onClear }: { compact: boolean; onClear: () => void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 2500);
    return () => clearTimeout(t);
  }, [sure]);
  return (
    <button
      type="button"
      onClick={() => {
        if (sure) {
          setSure(false);
          onClear();
        } else {
          playSfx("sfx-click");
          setSure(true);
        }
      }}
      title="전체 지우기"
      data-on={sure}
      className={`sk-tool ${compact ? "h-10 w-10 text-[10.5px]" : "h-12 w-12 text-[13px]"} ${sure ? "!bg-[var(--coral)] !text-white" : ""}`}
    >
      <Icon name="trash" size={compact ? 18 : 20} />
      {sure ? "정말?" : "다 지움"}
    </button>
  );
}
