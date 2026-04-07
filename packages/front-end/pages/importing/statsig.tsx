import React, { useEffect } from "react";
import { NextPage } from "next";
import ImportFromStatsig from "@/components/importing/ImportFromStatsig/ImportFromStatsig";
import track from "@/services/track";

const ImportFromStatsigPage: NextPage = () => {
  useEffect(() => {
    track("Import from Statsig clicked", { service: "statsig" });
  }, []);

  return (
    <div className="contents container pagecontents">
      <ImportFromStatsig />
    </div>
  );
};

export default ImportFromStatsigPage;
