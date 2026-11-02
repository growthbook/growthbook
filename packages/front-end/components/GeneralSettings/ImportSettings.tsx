import { OrganizationSettings } from "shared/types/organization";
import { PiUploadSimple } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { DocLink } from "@/components/DocLink";
import BackupConfigYamlButton from "@/components/Settings/BackupConfigYamlButton";
import RestoreConfigYamlButton from "@/components/Settings/RestoreConfigYamlButton";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import LinkButton from "@/ui/LinkButton";
import { SettingsGroup } from "./SettingsGroup";

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
  return (
    <>
      <SettingsGroup
        id="ie-config"
        title="config.yml"
        description={
          <>
            Organization settings, Data Sources, metrics, and dimensions can be
            exported to a config.yml file and imported into another GrowthBook
            Cloud account or self-hosted instance.{" "}
            <DocLink docSection="config_yml">View docs</DocLink>
          </>
        }
        keywords="yaml config export import backup restore self-hosted"
      >
        {hasFileConfig ? (
          <Callout status="info">
            The settings on this page are controlled through your{" "}
            <code>config.yml</code> file and cannot be changed through the web
            UI.{" "}
            <DocLink docSection="config_organization_settings">
              View docs
            </DocLink>
          </Callout>
        ) : (
          <>
            <Text as="p" color="text-mid">
              {isCloud
                ? "GrowthBook Cloud stores"
                : "You are currently storing"}{" "}
              all organization settings, Data Sources, metrics, and dimensions
              in a database.
            </Text>
            <Flex gap="3" wrap="wrap">
              <BackupConfigYamlButton settings={settings} />
              <RestoreConfigYamlButton
                settings={settings}
                mutate={refreshOrg}
              />
            </Flex>
            <Callout status="info">
              Exported files don&apos;t include Data Source connection secrets
              such as passwords. Add them to the file before importing.
            </Callout>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup
        id="ie-service"
        title="Import from Another Service"
        description="Bring in data from another feature flag or experimentation service."
        keywords="migrate launchdarkly optimizely import"
      >
        <div>
          <LinkButton
            href="/importing"
            variant="outline"
            icon={<PiUploadSimple />}
          >
            Import from another service
          </LinkButton>
        </div>
      </SettingsGroup>
    </>
  );
}
