import React from "react";
import { NextPage } from "next";
import { ImportYourData } from "@/components/importing/ImportYourData/ImportYourData";
import SettingsPage from "@/components/Layout/SettingsPage";

/**
 * A page to host all "Import from X" sections. To start, since we only have one,
 * it will be ok to add them here as we make them, but as we have more,
 * it may make sense to nest each service on its own page.
 */
const ImportingFromExternalServicesPage: NextPage = () => {
  return (
    <SettingsPage
      title="Import Your Data"
      section="import"
      description="Bring features, experiments, and metrics over from another feature flag or experimentation tool."
    >
      <ImportYourData />
    </SettingsPage>
  );
};

export default ImportingFromExternalServicesPage;
