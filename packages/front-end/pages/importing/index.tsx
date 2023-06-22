import React from "react";
import { NextPage } from "next";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { ImportFromLaunchDarklyContainer } from "@/components/importing/ImportFromLaunchDarkly/ImportFromLaunchDarkly";
import { AppFeatures } from "@/types/app-features";

/**
 * A page to host all "Import from X" sections. To start, since we only have one,
 * it will be ok to add them here as we make them, but as we have more,
 * it may make sense to nest each service on its own page.
 */
const ImportingFromExternalServicesPage: NextPage = () => {
  const growthbook = useGrowthBook<AppFeatures>();
  const shouldRender =
    growthbook?.getFeatureValue("import-from-x", false) || false;

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="contents container pagecontents">
      <ImportFromLaunchDarklyContainer />
    </div>
  );
};

export default ImportingFromExternalServicesPage;
