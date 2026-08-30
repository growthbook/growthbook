import React, { useEffect } from "react";
import { NextPage } from "next";
import ImportFromLaunchDarkly from "@/components/importing/ImportFromLaunchDarkly/ImportFromLaunchDarkly";
import track from "@/services/track";

const ImportFromLaunchDarklyPage: NextPage = () => {
  useEffect(() => {
    track("Import from LaunchDarkly clicked", { service: "launchdarkly" });
  }, []);

  return (
    <div className="contents container pagecontents">
      <ImportFromLaunchDarkly />
    </div>
  );
};

export default ImportFromLaunchDarklyPage;
