/*
 * 캔버스 글씨가 깨지지 않게 — 한글 글꼴은 글자 묶음(unicode-range)마다 따로 받아서,
 * 처음 그릴 때 아직 안 받은 글자는 다른 글꼴로 나옴 (예: 「우리 집」의 「리」만 굵게).
 * 그릴 때 쓴 글꼴 · 글자를 모아 두고, 다 받은 뒤 한 번 더 그려서 텍스처를 새로 올림.
 */
type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export function drawWithFonts(c: HTMLCanvasElement, draw: Draw, onRedraw: () => void) {
  const g = c.getContext("2d")!;
  const need: [string, string][] = [];
  const fill = g.fillText.bind(g),
    stroke = g.strokeText.bind(g);
  const note = (text: string) => {
    const f = g.font;
    if (typeof document !== "undefined" && document.fonts && !document.fonts.check(f, text)) need.push([f, text]);
  };
  g.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    note(text);
    if (maxWidth === undefined) fill(text, x, y);
    else fill(text, x, y, maxWidth);
  };
  g.strokeText = (text: string, x: number, y: number, maxWidth?: number) => {
    note(text);
    if (maxWidth === undefined) stroke(text, x, y);
    else stroke(text, x, y, maxWidth);
  };
  draw(g, c.width, c.height);
  // 다음부터는 원래 함수 (다시 그릴 때 또 모으지 않게)
  delete (g as unknown as Record<string, unknown>).fillText;
  delete (g as unknown as Record<string, unknown>).strokeText;
  if (!need.length) return;
  void Promise.all(need.map(([f, t]) => document.fonts.load(f, t).catch(() => []))).then(() => {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.filter = "none";
    g.clearRect(0, 0, c.width, c.height);
    g.restore();
    g.save();
    draw(g, c.width, c.height);
    g.restore();
    onRedraw();
  });
}
