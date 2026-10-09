import React, { useEffect } from "react";
import { NextPage } from "next";
import ImportFromEppo from "@/components/importing/ImportFromEppo/ImportFromEppo";
import track from "@/services/track";

const ImportFromEppoPage: NextPage = () => {
  useEffect(() => {
    track("Import from Eppo clicked", { service: "eppo" });
  }, []);

  return (
    <div className="contents container pagecontents">
      <ImportFromEppo />
    </div>
  );
};

export default ImportFromEppoPage;
