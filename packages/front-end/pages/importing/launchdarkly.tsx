import React, { useEffect } from "react";
import { NextPage } from "next";
import ImportFromLaunchDarkly from "@/components/importing/ImportFromLaunchDarkly/ImportFromLaunchDarkly";
import { useFeatureDisabledRedirect } from "@/hooks/useFeatureDisabledRedirect";
import track from "@/services/track";

const ImportFromLaunchDarklyPage: NextPage = () => {
  const { shouldRender } = useFeatureDisabledRedirect("import-from-x");

  useEffect(() => {
    track("Import from LaunchDarkly clicked", { service: "launchdarkly" });
  }, []);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="contents container pagecontents">
      <ImportFromLaunchDarkly />
    </div>
  );
};

export default ImportFromLaunchDarklyPage;
