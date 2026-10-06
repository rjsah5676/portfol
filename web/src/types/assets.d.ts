// Turbopack asset 규칙(next.config.ts)으로 mp3 import 시 URL 문자열이 들어옴
declare module "*.mp3" {
  const src: string;
  export default src;
}
