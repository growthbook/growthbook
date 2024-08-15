import React from "react";
import { NextPage } from "next";
import ImportFromLaunchDarkly from "@front-end/components/importing/ImportFromLaunchDarkly/ImportFromLaunchDarkly";
import { useFeatureDisabledRedirect } from "@front-end/hooks/useFeatureDisabledRedirect";

const ImportFromLaunchDarklyPage: NextPage = () => {
  const { shouldRender } = useFeatureDisabledRedirect("import-from-x");

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
