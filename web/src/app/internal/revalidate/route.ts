import { revalidateTag } from "next/cache";
import { STUDY_POSTS_TAG } from "@/firestore/studyPosts";

// 백엔드(Express)가 글이 바뀌었을 때 부르는 주소: POST /internal/revalidate/
// 받아둔 글 목록·글 캐시를 비워서 다음 요청부터 새 내용이 보이게 함.
// 서버끼리만 쓰는 주소라 공유 비밀값(REVALIDATE_SECRET)이 맞아야 하고, 값이 설정돼 있지 않으면 꺼져 있음
// (그때도 캐시는 60초마다 스스로 갱신됨).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || req.headers.get("x-revalidate-secret") !== secret)
    return Response.json({ ok: false }, { status: 404 });
  // expire: 0 → 옛 내용을 한 번 더 보여주지 않고 바로 버림
  revalidateTag(STUDY_POSTS_TAG, { expire: 0 });
  return Response.json({ ok: true });
}
