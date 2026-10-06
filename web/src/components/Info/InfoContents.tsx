import type { ComponentType } from "react";
import AirboardProject from "./AirboardProject";
import ArtpartProject from "./ArtpartProject";
import BojProject from "./BojProject";
import DevLifeProject from "./DevLifeProject";
import KickeatProject from "./KickeatProject";
import MimyoProject from "./MimyoProject";
import OhsoriProject from "./OhsoriProject";
import TaxProject from "./TaxProject";
import YorijoriProject from "./YorijoriProject";

// 프로젝트 idx(data/projects.ts) → 상세 페이지 컴포넌트
const PROJECT_PAGES: Record<number, ComponentType> = {
  1: AirboardProject,
  2: TaxProject,
  3: YorijoriProject,
  4: DevLifeProject,
  5: BojProject,
  8: ArtpartProject,
  9: KickeatProject,
  10: MimyoProject,
  11: OhsoriProject,
};

function InfoContents({ idx }: { idx: number }) {
  const Page = PROJECT_PAGES[idx];
  return Page ? <Page /> : null;
}

export default InfoContents;
