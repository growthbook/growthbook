import Link from "next/link";
import { OrganizationSettings } from "shared/types/organization";
import { FaUpload } from "react-icons/fa";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "@/types/app-features";
import { DocLink } from "@/components/DocLink";
import BackupConfigYamlButton from "@/components/Settings/BackupConfigYamlButton";
import RestoreConfigYamlButton from "@/components/Settings/RestoreConfigYamlButton";

export default function ImportSettings({
  hasFileConfig,
  isCloud,
  settings,
  refreshOrg,
}: {
  hasFileConfig: boolean;
  isCloud: boolean;
  settings: OrganizationSettings;
  refreshOrg: () => Promise<void>;
}) {
  const growthbook = useGrowthBook<AppFeatures>();
  return (
    <>
      {hasFileConfig && (
        <div className="alert alert-info my-3">
          The below settings are controlled through your <code>config.yml</code>{" "}
          file and cannot be changed through the web UI.{" "}
          <DocLink
            docSection="config_organization_settings"
            className="font-weight-bold"
          >
            View Documentation
          </DocLink>
          .
        </div>
      )}

      {!hasFileConfig && (
        <div className="alert alert-info my-3">
          <h3>Import/Export config.yml</h3>
          <p>
            {isCloud ? "GrowthBook Cloud stores" : "You are currently storing"}{" "}
            all organization settings, data sources, metrics, and dimensions in
            a database.
          </p>
          <p>
            You can import/export these settings to a <code>config.yml</code>{" "}
            file to more easily move between GrowthBook Cloud accounts and/or
            self-hosted environments.{" "}
            <DocLink docSection="config_yml" className="font-weight-bold">
              Learn More
            </DocLink>
          </p>
          <div className="row mb-3">
            <div className="col-auto">
              <BackupConfigYamlButton settings={settings} />
            </div>
            <div className="col-auto">
              <RestoreConfigYamlButton
                settings={settings}
                mutate={refreshOrg}
              />
            </div>
          </div>
          <div className="text-muted">
            <strong>Note:</strong> For security reasons, the exported file does
            not include data source connection secrets such as passwords. You
            must edit the file and add these yourself.
          </div>
        </div>
      )}

      {growthbook?.getFeatureValue("import-from-x", false) && (
        <div className="bg-white p-3 border position-relative my-3">
          <h3>Import from another service</h3>
          <p>
            Import your data from another feature flag and/or experimentation
            service.
          </p>
          <Link href="/importing" className="btn btn-primary">
            <FaUpload className="mr-1" /> Import from another service
          </Link>
        </div>
      )}
    </>
  );
}
