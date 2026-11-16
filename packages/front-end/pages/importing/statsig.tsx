import React, { useEffect } from "react";
import { NextPage } from "next";
import ImportFromStatsig from "@/components/importing/ImportFromStatsig/ImportFromStatsig";
import track from "@/services/track";
import SettingsPage from "@/components/Layout/SettingsPage";

const ImportFromStatsigPage: NextPage = () => {
  useEffect(() => {
    track("Import from Statsig clicked", { service: "statsig" });
  }, []);

  return (
    <SettingsPage
      title="Statsig Importer"
      section="import"
      parent={{ display: "Import Your Data", href: "/importing" }}
    >
      <ImportFromStatsig />
    </SettingsPage>
  );
};

export default ImportFromStatsigPage;
