import type { Game } from "@/lib/hangul/game";
import { img, INK, INK_BOSS } from "./assets";

/** 판 그리기: 둘레 길 · 먹물 얼룩 · 쏘는 선 · 효과. pos = 유닛 id → 그 칸 가운데 (필드 좌표) */
export function drawField(
  cx: CanvasRenderingContext2D,
  g: Game,
  W: number,
  H: number,
  pos: Map<number, { x: number; y: number }>
) {
  cx.clearRect(0, 0, W, H);
  const { x, y, w, h } = g.path;
  cx.strokeStyle = "rgba(60,40,20,0.10)";
  cx.lineWidth = 24;
  cx.lineJoin = "round";
  cx.strokeRect(x, y, w, h);
  cx.setLineDash([2, 10]);
  cx.strokeStyle = "rgba(60,40,20,0.25)";
  cx.lineWidth = 1.5;
  cx.strokeRect(x, y, w, h);
  cx.setLineDash([]);

  for (const s of g.shots) {
    const p = pos.get(s.from);
    if (!p) continue;
    const k = s.t / 0.25;
    cx.globalAlpha = 1 - k;
    cx.strokeStyle = s.color;
    cx.lineWidth = 1.5;
    cx.beginPath();
    cx.moveTo(p.x, p.y);
    cx.lineTo(s.to.x, s.to.y);
    cx.stroke();
    if (s.r) {
      cx.beginPath();
      cx.arc(s.to.x, s.to.y, s.r * (0.4 + k * 0.6), 0, Math.PI * 2);
      cx.stroke();
    }
    cx.fillStyle = s.color;
    cx.font = `700 14px "Song Myung", serif`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillText(s.glyph, s.to.x, s.to.y - 14 - k * 8);
    cx.globalAlpha = 1;
  }

  for (const e of g.enemies) {
    const r = e.boss ? 17 : 9;
    // 먹물 괴물 그림 (졸병 3종은 seed 로 고름) — 꿈틀꿈틀 · 통통. 그림이 없으면 예전 먹물 동그라미
    const sp = img(e.boss ? INK_BOSS : INK[Math.floor(e.seed) % INK.length]);
    if (sp) {
      const size = e.boss ? 64 : 30;
      const sq = 1 + 0.08 * Math.sin(g.t * 9 + e.seed);
      const w = size * sq,
        h = size / sq;
      cx.save();
      cx.translate(e.x, e.y);
      cx.rotate(0.12 * Math.sin(g.t * 5 + e.seed));
      if (e.stun > 0 || e.slowT > 0) {
        // 기절은 보라 · 느려짐은 파랑 테두리 빛
        cx.shadowColor = e.stun > 0 ? "#a35bd0" : "#3d7cc0";
        cx.shadowBlur = 10;
      }
      cx.drawImage(sp, -w / 2, -h * 0.55, w, h);
      cx.restore();
    } else {
      cx.fillStyle = e.stun > 0 ? "#7a3b8f" : e.slowT > 0 ? "#2f5e8c" : "#1a1714";
      cx.beginPath();
      for (let k = 0; k <= 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const rr = r * (0.82 + 0.18 * Math.sin(a * 3 + e.seed + g.t * 4));
        cx.lineTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
      }
      cx.fill();
    }
    if (e.hp < e.max) {
      const bw = r * 2;
      const top = sp ? (e.boss ? 64 : 30) * 0.58 + 4 : r + 6;
      cx.fillStyle = "rgba(0,0,0,0.15)";
      cx.fillRect(e.x - bw / 2, e.y - top, bw, 3);
      cx.fillStyle = "#c0392b";
      cx.fillRect(e.x - bw / 2, e.y - top, bw * Math.max(0, e.hp / e.max), 3);
    }
  }

  for (const f of g.fx) {
    const k = f.t / (f.kind === "read" ? 1.2 : 0.6);
    cx.globalAlpha = 1 - k;
    if (f.kind === "die") {
      cx.fillStyle = "rgba(26,23,20,0.35)";
      cx.beginPath();
      cx.arc(f.x, f.y, 8 + k * 14, 0, Math.PI * 2);
      cx.fill();
    } else if (f.kind === "read") {
      cx.strokeStyle = "#c0392b";
      cx.lineWidth = 6 * (1 - k) + 1;
      cx.beginPath();
      cx.arc(f.x, f.y, (f.r ?? 300) * k, 0, Math.PI * 2);
      cx.stroke();
    }
    cx.globalAlpha = 1;
  }
}
