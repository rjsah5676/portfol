"use client";

import Faded from "@/components/Faded";
import SuspectApp from "@/components/Suspect/SuspectApp";
import "@/css/suspect.css";

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center px-3 pt-6 pb-12 sm:px-6">
      <Faded style={{ width: "100%" }}>
        <SuspectApp />
      </Faded>
    </div>
  );
}
