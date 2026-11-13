import { useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  createInitialResources,
  getDatasourceTemplateResources,
  getDatasourceTemplateSettings,
} from "@/services/initial-resources";
import {
  getLlmTracingProjectScope,
  getLlmTracingSchema,
  getLlmTracingSchemaOptionValues,
  hasLlmTracingSetup,
  LlmTracingFormat,
} from "@/services/llmTracing";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import track from "@/services/track";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { TextField } from "@/ui/TextField";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export default function AddLlmTracingModal({
  datasource,
  template,
  close,
  onAdded,
}: {
  datasource: DataSourceInterfaceWithParams;
  template: LlmTracingFormat;
  close: () => void;
  onAdded: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const { factTables } = useDefinitions();
  const settings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const tracker = getLlmTracingSchema(template);
  const { label, options = [] } = tracker;
  const [schemaOptions, setSchemaOptions] = useState<Record<string, string>>(
    () =>
      getLlmTracingSchemaOptionValues(
        template,
        datasource.settings?.schemaOptions,
      ),
  );
  const projectScopeLocked = hasLlmTracingSetup({
    datasource,
    tool: template,
    factTables,
  });
  const [progress, setProgress] = useState<number | null>(null);

  // Fact table SQL reads identifier types, so build resources from the
  // settings that are about to be saved.
  const { updatedSettings, resources } = useMemo(() => {
    const updatedSettings = getDatasourceTemplateSettings({
      datasource,
      template,
      schemaOptions,
      factTables,
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
      header={`Add ${label}`}
      trackingEventModalType="add-llm-tracing"
      trackingEventModalSource="datasource-settings"
      close={close}
      cta={`Add ${label}`}
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
        await onAdded();
        track("Add LLM tracing", {
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
          This adds identifier types, assignment queries, and a join on the
          Queries tab, and creates fact tables and starter Fact Metrics under
          Connected Resources. Nothing already on this Data Source is changed.
        </Text>

        {options.map((option) => {
          const value = schemaOptions[option.name] ?? "";
          const scope = getLlmTracingProjectScope(template, schemaOptions);
          return (
            <TextField
              key={option.name}
              label={option.label}
              helpText={
                projectScopeLocked
                  ? `${scope}. Already set for this Data Source and can't be changed. Missing fact tables use the same scope.`
                  : option.helpText
              }
              placeholder={
                projectScopeLocked && !value.trim() ? scope : undefined
              }
              disabled={projectScopeLocked}
              value={value}
              onChange={(e) =>
                setSchemaOptions({
                  ...schemaOptions,
                  [option.name]: e.target.value,
                })
              }
            />
          );
        })}

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
