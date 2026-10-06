"use client";

import { useEffect } from "react";

export function getNumberFromPixel(value: string | number | null): number {
  if (value === null || value === "") return 0;
  let px = value + "";
  if (px.indexOf("px") > -1) px = px.replace("px", "");
  if (px.indexOf("PX") > -1) px = px.replace("PX", "");
  const result = parseInt(px, 10);
  return Number.isNaN(result) ? 0 : result;
}

// 푸터 contact로 여는 Contact(명함) 모달을 마우스로 드래그해서 옮길 수 있게 해주는 훅.
export function useDraggableContactModal() {
  useEffect(() => {
    const modal = document.getElementById("contact-container");
    if (!modal) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      modal.style.left = originLeft + (e.clientX - startX) + "px";
      modal.style.top = originTop + (e.clientY - startY) + "px";
    };

    const onMouseUp = () => {
      dragging = false;
      modal.style.cursor = "grab";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originLeft = getNumberFromPixel(modal.style.left);
      originTop = getNumberFromPixel(modal.style.top);
      modal.style.cursor = "grabbing";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    };

    modal.addEventListener("mousedown", onMouseDown);
    return () => modal.removeEventListener("mousedown", onMouseDown);
  }, []);
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;
// Contact의 transition-opacity duration-500과 맞춤
const FADE_MS = 500;

export function openContactModal(open: 0 | 1) {
  const ct = document.getElementById("contact-container");
  if (!ct) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  if (open === 1) {
    ct.style.left = (window.innerWidth - ct.offsetWidth) / 2 + "px";
    ct.style.top = window.innerHeight / 4 + "px";
    // Top(z-50)/Nav(z-30)보다 위에 떠야 함
    ct.style.zIndex = "60";
    ct.style.pointerEvents = "auto";
    ct.style.opacity = "1";
    return;
  }

  // 닫을 때 z-index를 바로 내리면 페이드아웃 도중 헤더/Nav 뒤로 들어가 보임
  // -> 투명해지는 동안은 위에 두고, 다 사라진 뒤에 내림
  ct.style.opacity = "0";
  ct.style.pointerEvents = "none";
  hideTimer = setTimeout(() => {
    ct.style.zIndex = "-1";
    hideTimer = null;
  }, FADE_MS);
}
