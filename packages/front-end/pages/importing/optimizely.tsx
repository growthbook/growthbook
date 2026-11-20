import React, { useEffect } from "react";
import { NextPage } from "next";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import ImportFromOptimizely from "@/components/importing/ImportFromOptimizely/ImportFromOptimizely";
import { OPTIMIZELY_IMPORTER_FLAG } from "@/components/importing/ImportYourData/ImportYourData";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import SettingsPage from "@/components/Layout/SettingsPage";

const ImportFromOptimizelyPage: NextPage = () => {
  const enabled = useFeatureIsOn(OPTIMIZELY_IMPORTER_FLAG);
  useEffect(() => {
    if (enabled) {
      track("Import from Optimizely clicked", { service: "optimizely" });
    }
  }, [enabled]);

  return (
    <SettingsPage
      title="Optimizely Importer"
      section="import"
      parent={{ display: "Import Your Data", href: "/importing" }}
    >
      {enabled ? (
        <ImportFromOptimizely />
      ) : (
        <Callout status="info">
          The Optimizely importer isn&apos;t available on this account yet.{" "}
          <Link href="/importing">Request it from the import page.</Link>
        </Callout>
      )}
    </SettingsPage>
  );
};

export default ImportFromOptimizelyPage;
