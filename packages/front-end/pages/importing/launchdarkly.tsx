import React, { useEffect } from "react";
import { NextPage } from "next";
import ImportFromLaunchDarkly from "@/components/importing/ImportFromLaunchDarkly/ImportFromLaunchDarkly";
import track from "@/services/track";
import SettingsPage from "@/components/Layout/SettingsPage";

const ImportFromLaunchDarklyPage: NextPage = () => {
  useEffect(() => {
    track("Import from LaunchDarkly clicked", { service: "launchdarkly" });
  }, []);

  return (
    <SettingsPage
      title="LaunchDarkly Importer"
      description="Import your existing projects, environments, and feature flags from the LaunchDarkly API."
      section="import"
      parent={{ display: "Import Your Data", href: "/importing" }}
    >
      <ImportFromLaunchDarkly />
    </SettingsPage>
  );
};

export default ImportFromLaunchDarklyPage;
