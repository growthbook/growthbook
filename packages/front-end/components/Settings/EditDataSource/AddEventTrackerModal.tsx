import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DataSourceInterfaceWithParams,
  SchemaOption,
} from "shared/types/datasource";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  createInitialResources,
  getDatasourceTemplateResources,
  getDatasourceTemplateSettings,
} from "@/services/initial-resources";
import { hasEventTrackerSql } from "@/services/datasources";
import { eventSchemas } from "@/services/eventSchema";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import track from "@/services/track";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import { TextField } from "@/ui/TextField";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export function getAddableEventTrackers(
  datasource: Pick<DataSourceInterfaceWithParams, "type" | "settings">,
) {
  return eventSchemas.filter(
    (s) =>
      !!s.types?.includes(datasource.type) &&
      hasEventTrackerSql(s.value) &&
      s.value !== datasource.settings?.schemaFormat,
  );
}

// Like the wizard; Matomo's SQL relies on these defaults.
function getDefaultOptions(tracker: { options?: SchemaOption[] }) {
  return Object.fromEntries(
    (tracker.options ?? []).map((o) => [o.name, String(o.defaultValue ?? "")]),
  );
}

export default function AddEventTrackerModal({
  datasource,
  close,
}: {
  datasource: DataSourceInterfaceWithParams;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const { factTables, mutateDefinitions } = useDefinitions();
  const settings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const trackers = getAddableEventTrackers(datasource);
  const [tracker, setTracker] = useState(trackers[0]);
  const template = tracker.value;
  const { label, options = [] } = tracker;
  const [schemaOptions, setSchemaOptions] = useState<Record<string, string>>(
    () => getDefaultOptions(trackers[0]),
  );
  const [progress, setProgress] = useState<number | null>(null);

  // GA4 reads identifier types, so build resources from the updated settings.
  const { updatedSettings, resources } = useMemo(() => {
    const updatedSettings = getDatasourceTemplateSettings({
      datasource,
      template,
      schemaOptions,
    });
    const resources = getDatasourceTemplateResources({
      datasource: { ...datasource, settings: updatedSettings },
      template,
      schemaOptions,
      existingFactTables: factTables,
    });
    return { updatedSettings, resources };
  }, [datasource, template, schemaOptions, factTables]);

  const alreadyAdded =
    resources.factTables.length === 0 &&
    JSON.stringify(updatedSettings) === JSON.stringify(datasource.settings);

  return (
    <ModalStandard
      open={true}
      header="Add Event Tracker"
      trackingEventModalType="add-event-tracker"
      trackingEventModalSource="datasource-id-page"
      close={close}
      cta="Add to Data Source"
      ctaEnabled={!alreadyAdded}
      submit={async () => {
        // Fact tables are validated against the saved identifier types.
        await apiCall(`/datasource/${datasource.id}`, {
          method: "PUT",
          body: JSON.stringify({ settings: updatedSettings }),
        });

        let errors = 0;
        if (resources.factTables.length > 0) {
          setProgress(0);
          ({ errors } = await createInitialResources({
            datasource: { ...datasource, settings: updatedSettings },
            resources,
            apiCall,
            metricDefaults,
            settings,
            onProgress: setProgress,
          }));
        }
        await mutateDefinitions();
        track("Add Event Tracker", {
          template,
          type: datasource.type,
          errors,
        });
        if (errors > 0) {
          setProgress(null);
          throw new Error(
            `${errors} resource${errors === 1 ? "" : "s"} could not be created. Check the browser console for details.`,
          );
        }
      }}
    >
      <Flex direction="column" gap="4">
        <Text as="p">
          Add another event tracker&apos;s queries, fact tables, and Fact
          Metrics to this Data Source, so they can sit alongside your existing
          ones in the same experiments. Nothing already on this Data Source is
          changed.
        </Text>

        <Box>
          <Text as="p" weight="semibold" mb="2">
            Event tracker
          </Text>
          <RadioCards
            options={trackers.map((t) => ({
              value: t.value,
              label: t.label,
              avatar: (
                <DataSourceLogo eventTracker={t.value} showLabel={false} />
              ),
            }))}
            value={template}
            setValue={(v) => {
              const next = trackers.find((t) => t.value === v);
              if (!next) return;
              setTracker(next);
              setSchemaOptions(getDefaultOptions(next));
            }}
            columns="2"
            width="100%"
          />
        </Box>

        {options.length > 0 && (
          <Text as="p">
            Below are the typical defaults for {label}.{" "}
            {options.length === 1 ? "The value is" : "These values are"} used to
            generate the queries, which you can adjust as needed at any time.
          </Text>
        )}

        {options.map((option) => (
          <TextField
            key={option.name}
            label={option.label}
            helpText={option.helpText}
            value={schemaOptions[option.name] ?? ""}
            onChange={(e) =>
              setSchemaOptions({
                ...schemaOptions,
                [option.name]: e.target.value,
              })
            }
          />
        ))}

        {alreadyAdded && (
          <Callout status="info">
            Everything {label} adds is already on this Data Source.
          </Callout>
        )}

        {progress !== null && (
          <Text as="p">Creating… {Math.floor(progress * 100)}%</Text>
        )}
      </Flex>
    </ModalStandard>
  );
}
