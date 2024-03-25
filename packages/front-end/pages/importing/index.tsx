import React from "react";
import { NextPage } from "next";
import { ImportYourData } from "@front-end/components/importing/ImportYourData/ImportYourData";
import { useFeatureDisabledRedirect } from "@front-end/hooks/useFeatureDisabledRedirect";

/**
 * A page to host all "Import from X" sections. To start, since we only have one,
 * it will be ok to add them here as we make them, but as we have more,
 * it may make sense to nest each service on its own page.
 */
const ImportingFromExternalServicesPage: NextPage = () => {
  const { shouldRender } = useFeatureDisabledRedirect("import-from-x");

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="contents container pagecontents">
      <ImportYourData />
    </div>
  );
};

export default ImportingFromExternalServicesPage;
