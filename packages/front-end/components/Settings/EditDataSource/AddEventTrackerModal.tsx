import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DataSourceInterfaceWithParams,
  DataSourceSettings,
} from "shared/types/datasource";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  createInitialResources,
  DatasourceTemplate,
  InitialDatasourceResources,
  getDatasourceTemplate,
  getDatasourceTemplateResources,
  getDatasourceTemplateSettings,
  getDatasourceTemplatesForDatasource,
} from "@/services/initial-resources";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import track from "@/services/track";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import { TextField } from "@/ui/TextField";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

function plural(count: number, singular: string, pluralForm?: string) {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

// Everything that will be added, so nothing lands on the Data Source
// unannounced. Empty when there is nothing to add.
function describeChanges({
  datasource,
  updatedSettings,
  resources,
}: {
  datasource: DataSourceInterfaceWithParams;
  updatedSettings: DataSourceSettings;
  resources: InitialDatasourceResources;
}): string[] {
  const factTables = resources.factTables;
  const filters = factTables.reduce((n, f) => n + f.filters.length, 0);
  const metrics = factTables.reduce((n, f) => n + f.metrics.length, 0);
  const newIdentifierTypes =
    (updatedSettings.userIdTypes?.length ?? 0) -
    (datasource.settings.userIdTypes?.length ?? 0);
  const newAssignmentQueries =
    (updatedSettings.queries?.exposure?.length ?? 0) -
    (datasource.settings.queries?.exposure?.length ?? 0);
  const newJoins =
    (updatedSettings.queries?.identityJoins?.length ?? 0) -
    (datasource.settings.queries?.identityJoins?.length ?? 0);

  return [
    factTables.length > 0
      ? `${plural(factTables.length, "fact table")} (${factTables
          .map((f) => f.factTable.name)
          .join(", ")})`
      : null,
    filters > 0 ? plural(filters, "filter") : null,
    metrics > 0 ? plural(metrics, "Fact Metric") : null,
    newIdentifierTypes > 0
      ? plural(newIdentifierTypes, "identifier type")
      : null,
    newAssignmentQueries > 0
      ? plural(newAssignmentQueries, "assignment query", "assignment queries")
      : null,
    newJoins > 0 ? plural(newJoins, "identifier join") : null,
  ].filter((p): p is string => p !== null);
}

function joinList(parts: string[]) {
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
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

  const templates = getDatasourceTemplatesForDatasource(datasource);
  const [template, setTemplate] = useState<DatasourceTemplate>(templates[0]);
  const [schemaOptions, setSchemaOptions] = useState<Record<string, string>>(
    {},
  );
  const [includeAssignmentQueries, setIncludeAssignmentQueries] = useState(
    getDatasourceTemplate(templates[0]).includeAssignmentQueriesByDefault,
  );
  const [progress, setProgress] = useState<number | null>(null);

  const { label, options, hasFactTables } = getDatasourceTemplate(template);
  // Without fact tables, assignment queries are all the tracker adds.
  const addAssignmentQueries = !hasFactTables || includeAssignmentQueries;

  // Some trackers read the Data Source's identifier types (GA4), so build
  // the resources from the settings as they will be after saving.
  const { updatedSettings, resources } = useMemo(() => {
    const updatedSettings = getDatasourceTemplateSettings({
      datasource,
      template,
      schemaOptions,
      includeAssignmentQueries: addAssignmentQueries,
    });
    const resources = getDatasourceTemplateResources({
      datasource: { ...datasource, settings: updatedSettings },
      template,
      schemaOptions,
      existingFactTables: factTables,
    });
    return { updatedSettings, resources };
  }, [datasource, template, schemaOptions, addAssignmentQueries, factTables]);

  const changes = describeChanges({ datasource, updatedSettings, resources });

  return (
    <ModalStandard
      open={true}
      header="Add Event Tracker"
      trackingEventModalType="add-event-tracker"
      trackingEventModalSource="datasource-id-page"
      close={close}
      cta="Add to Data Source"
      ctaEnabled={changes.length > 0}
      submit={async () => {
        // Fact tables are validated against the Data Source's identifier
        // types, so those have to be saved first.
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
            options={templates.map((t) => ({
              value: t,
              label: getDatasourceTemplate(t).label,
              avatar: <DataSourceLogo eventTracker={t} showLabel={false} />,
            }))}
            value={template}
            setValue={(v) => {
              const next = v as DatasourceTemplate;
              setTemplate(next);
              setSchemaOptions({});
              setIncludeAssignmentQueries(
                getDatasourceTemplate(next).includeAssignmentQueriesByDefault,
              );
            }}
            columns="2"
            width="100%"
          />
        </Box>

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

        {hasFactTables && (
          <Checkbox
            label="Add assignment queries"
            description={`Adds ${label}'s queries for who saw which variation. Leave this off if this Data Source already records experiment exposures and you will use those instead.`}
            value={includeAssignmentQueries}
            setValue={setIncludeAssignmentQueries}
          />
        )}

        {changes.length > 0 ? (
          <Text as="p">
            Creates {joinList(changes)}.
            {!hasFactTables &&
              ` ${label} has no starter fact tables or Fact Metrics.`}
          </Text>
        ) : (
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
