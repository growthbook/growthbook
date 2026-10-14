import React, { useEffect } from "react";
import { NextPage } from "next";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import ImportFromEppo from "@/components/importing/ImportFromEppo/ImportFromEppo";
import { EPPO_IMPORTER_FLAG } from "@/components/importing/ImportYourData/ImportYourData";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

const ImportFromEppoPage: NextPage = () => {
  const enabled = useFeatureIsOn(EPPO_IMPORTER_FLAG);
  useEffect(() => {
    if (enabled) track("Import from Eppo clicked", { service: "eppo" });
  }, [enabled]);

  return (
    <div className="contents container pagecontents">
      {enabled ? (
        <ImportFromEppo />
      ) : (
        <Callout status="info">
          The Eppo importer isn&apos;t available on this account yet.{" "}
          <Link href="/importing">Request it from the import page.</Link>
        </Callout>
      )}
    </div>
  );
};

export default ImportFromEppoPage;
