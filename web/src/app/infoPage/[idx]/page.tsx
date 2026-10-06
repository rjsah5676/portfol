import Faded from "@/components/Faded";
import type { Metadata } from "next";
import InfoContents from "@/components/Info/InfoContents";
import { detailProjects, getProjectByIdx } from "@/data/projects";
import { pageMeta } from "@/lib/seo";

// 프로젝트 목록(data/projects) 기준으로 빌드 때 미리 생성 — 목록에 없는 번호는 404
export const dynamicParams = false;

export function generateStaticParams() {
  return detailProjects.map((p) => ({ idx: String(p.idx) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ idx: string }>;
}): Promise<Metadata> {
  const { idx } = await params;
  const project = getProjectByIdx(Number(idx));
  const meta = pageMeta({
    title: project?.title ?? "프로젝트",
    description: project ? `${project.desc} 사용 기술: ${project.tech.join(", ")}` : undefined,
    path: `/infoPage/${idx}/`,
  });
  if (project) {
    const image = {
      url: project.imgLink.src,
      width: project.imgLink.width,
      height: project.imgLink.height,
    };
    meta.openGraph = { ...meta.openGraph, images: [image] };
    meta.twitter = { ...meta.twitter, images: [image.url] };
  }
  return meta;
}

export default async function InfoPageRoute({ params }: { params: Promise<{ idx: string }> }) {
  const { idx } = await params;

  return (
    <Faded>
      <div className="px-6 pt-16 pb-24">
        <InfoContents idx={Number(idx)} />
      </div>
    </Faded>
  );
}
