import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { date } from "shared/dates";
import {
  isProductionEnvironment,
  qaOverrideHasOwnTargeting,
} from "shared/util";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import {
  QaOverrideTargetingMode,
  qaOverrideFiltersFromForm,
  withStaleSdkConnections,
} from "@/services/qaOverrides";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import { Select, SelectItem } from "@/ui/Select";
import RadioGroup from "@/ui/RadioGroup";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import QaOverrideAudience from "./QaOverrideAudience";
import useQaOverrideNameLookups from "./useQaOverrideNameLookups";
import QaOverrideExperimentTargeting from "./QaOverrideExperimentTargeting";
import {
  QaOverrideTargetingFields,
  QaOverrideWhereFields,
} from "./QaOverrideFilterFields";
import { QaOverrideWaitingBanner } from "./QaOverrideProblems";
import useQaOverridePermissions from "./useQaOverridePermissions";
import useQaOverrideForm from "./useQaOverrideForm";

export type QaOverrideModalExperiment = Pick<
  ExperimentInterfaceStringDates,
  | "id"
  | "name"
  | "project"
  | "hashAttribute"
  | "variations"
  | "phases"
  | "hasVisualChangesets"
  | "hasURLRedirects"
>;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text as="div" size="lg" weight="semibold">
      {children}
    </Text>
  );
}

export default function QaOverrideModal({
  experiment,
  linkedFeatures,
  existing,
  sdkConnections,
  close,
  onSaved,
}: {
  experiment: QaOverrideModalExperiment;
  linkedFeatures?: LinkedFeatureInfo[];
  existing?: ExperimentQaOverrideWithStatus;
  // Names for the connections `existing` lists, stale ones included.
  sdkConnections?: { id: string; name: string }[];
  close: () => void;
  onSaved: () => Promise<unknown> | void;
}) {
  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();
  const { projects } = useDefinitions();
  const { data: connectionData } = useSDKConnections();
  const staleSdkConnections = existing?.staleSdkConnections ?? [];
  const lookups = withStaleSdkConnections(
    useQaOverrideNameLookups(sdkConnections),
    staleSdkConnections,
  );
  const { environments, eligibleEnvironments, canEditIn } =
    useQaOverridePermissions(experiment);

  const variations = getLatestPhaseVariations(experiment);
  const environmentOptions = useMemo(
    () =>
      environments
        .map((e) => ({ id: e.id, isProduction: isProductionEnvironment(e) }))
        .filter((e) => e.isProduction || canEditIn(e.id))
        .sort((a, b) => Number(a.isProduction) - Number(b.isProduction)),
    [environments, canEditIn],
  );
  const editable = eligibleEnvironments.filter((e) => canEditIn(e.id));

  const {
    form,
    values,
    addFilter,
    removeFilter,
    setFilterActive,
    setEnvironment,
    waitingFeatures,
    body,
    canSave,
  } = useQaOverrideForm({
    existing,
    defaultEnvironment: editable.length === 1 ? editable[0].id : "",
    hashAttribute: experiment.hashAttribute || "id",
    variationIds: variations.map((v) => v.id),
    linkedFeatures: linkedFeatures ?? [],
  });

  const savedVariationId =
    existing?.assignment.type === "forced"
      ? existing.assignment.variationId
      : undefined;
  const variationDeleted =
    savedVariationId !== undefined &&
    !variations.some((v) => v.id === savedVariationId);

  // Kept as options so they can be seen and removed.
  const staleConnectionIds = new Set(staleSdkConnections.map((c) => c.id));

  const liveConnectionOptions = useMemo(
    () =>
      (connectionData?.connections ?? [])
        .filter((c) => c.environment === values.environment)
        .map((c) => ({ value: c.id, label: c.name })),
    [connectionData, values.environment],
  );
  const connectionOptions = [
    ...liveConnectionOptions.filter((o) => !staleConnectionIds.has(o.value)),
    ...[...staleConnectionIds].map((id) => ({
      value: id,
      label: lookups.sdkConnectionName(id),
    })),
  ];
  const hasStaleConnection = values.sdkConnections.some((id) =>
    staleConnectionIds.has(id),
  );
  // Visual changes and redirects are sent by the experiment's own Project.
  const projectsNote =
    experiment.hasVisualChangesets || experiment.hasURLRedirects
      ? linkedFeatures?.length
        ? "neutral"
        : "warning"
      : null;
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  const forced = values.assignmentType === "forced";

  const audienceFilters = qaOverrideFiltersFromForm(values);
  const targetingFields = (
    <QaOverrideTargetingFields
      form={form}
      project={experiment.project || ""}
      addFilter={addFilter}
      setFilterActive={setFilterActive}
    />
  );

  return (
    <ModalStandard
      open={true}
      close={close}
      header={existing ? "Edit QA Override" : "Add QA Override"}
      subheader={
        existing ? (
          <Text size="sm" color="text-mid">
            {getUserDisplay(existing.createdBy, true)} ·{" "}
            {date(existing.dateCreated)}
          </Text>
        ) : undefined
      }
      cta={existing ? "Apply" : "Add override"}
      ctaEnabled={canSave}
      size="lg"
      aboveFooterContent={
        waitingFeatures.length > 0 ? (
          <QaOverrideWaitingBanner
            waitingOn={waitingFeatures}
            environment={values.environment}
          />
        ) : undefined
      }
      trackingEventModalType="experiment-qa-override"
      submit={validatedSubmit(form, async () => {
        if (!body) return;
        if (existing) {
          await apiCall(`/qa-overrides/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(body),
          });
        } else {
          await apiCall(`/qa-overrides/experiment/${experiment.id}`, {
            method: "POST",
            body: JSON.stringify({ environment: values.environment, ...body }),
          });
        }
        await onSaved();
      })}
    >
      <Flex direction="column" gap="5">
        <Flex direction="column" gap="3">
          <SectionLabel>What do you want to QA?</SectionLabel>
          <RadioGroup
            gap="3"
            value={values.assignmentType}
            setValue={(v) =>
              form.setValue("assignmentType", v as "random" | "forced")
            }
            options={[
              {
                value: "forced",
                label: "Force a specific variation",
                description:
                  "Show one variation to people you choose. Ignores the experiment\u2019s targeting.",
                // A select can't sit inside the radio's label.
                renderOutsideItem: true,
                // Pulled up under its option, closer than the next option is.
                renderOnSelect: (
                  <Box ml="5" mt="-1">
                    <Select
                      aria-label="Variation"
                      value={values.forcedVariationId || undefined}
                      setValue={(v) => form.setValue("forcedVariationId", v)}
                      placeholder="Select a variation…"
                      error={
                        variationDeleted && !values.forcedVariationId
                          ? "The variation this override forced was deleted. Pick another."
                          : undefined
                      }
                    >
                      {variations.map((v, i) => (
                        <SelectItem key={v.id} value={v.id} textValue={v.name}>
                          <VariationLabel number={i} name={v.name} />
                        </SelectItem>
                      ))}
                    </Select>
                  </Box>
                ),
              },
              {
                value: "random",
                label: "Experiment configuration",
                description:
                  "Uses the experiment\u2019s split. Uses its targeting unless you add your own.",
              },
            ]}
          />
        </Flex>

        <Flex direction="column" gap="3">
          <SectionLabel>Where should the override apply?</SectionLabel>
          {existing ? (
            <>
              <Text as="div" size="md" weight="semibold">
                Environment
              </Text>
              <Box>
                <Badge
                  label={existing.environment}
                  color="gray"
                  variant="soft"
                />
              </Box>
            </>
          ) : (
            <Box maxWidth="280px">
              <Select
                label="Environment"
                value={values.environment}
                setValue={setEnvironment}
                placeholder="Select an environment…"
              >
                {environmentOptions.map((e) =>
                  e.isProduction ? (
                    <Tooltip
                      key={e.id}
                      content="QA overrides can\u2019t run in production environments."
                      side="right"
                      maxWidth="260px"
                    >
                      <SelectItem value={e.id} disabled>
                        {e.id}
                      </SelectItem>
                    </Tooltip>
                  ) : (
                    <SelectItem key={e.id} value={e.id}>
                      {e.id}
                    </SelectItem>
                  ),
                )}
              </Select>
            </Box>
          )}
          <QaOverrideWhereFields
            form={form}
            addFilter={addFilter}
            removeFilter={removeFilter}
            connectionOptions={connectionOptions}
            projectOptions={projectOptions}
            hasStaleConnection={hasStaleConnection}
            projectsNote={projectsNote}
          />
        </Flex>

        <Flex direction="column" gap="3">
          <SectionLabel>Who sees it?</SectionLabel>
          {forced ? (
            <>
              <QaOverrideAudience
                variant="sentence"
                filters={audienceFilters}
                order={values.filters}
                environment={values.environment}
                lookups={lookups}
              />
              <Box mt="2">{targetingFields}</Box>
            </>
          ) : (
            <RadioGroup
              gap="2"
              value={values.targetingMode}
              setValue={(v) =>
                form.setValue("targetingMode", v as QaOverrideTargetingMode)
              }
              options={[
                {
                  value: "experiment",
                  label: "Experiment\u2019s targeting",
                  description: (
                    <QaOverrideExperimentTargeting
                      phase={experiment.phases[experiment.phases.length - 1]}
                    />
                  ),
                },
                {
                  value: "custom",
                  label: "Custom targeting",
                  description:
                    values.targetingMode === "custom" &&
                    qaOverrideHasOwnTargeting(audienceFilters) ? (
                      <QaOverrideAudience
                        variant="sentence"
                        filters={audienceFilters}
                        order={values.filters}
                        environment={values.environment}
                        lookups={lookups}
                      />
                    ) : (
                      "Replaces the experiment\u2019s targeting while testing"
                    ),
                  renderOutsideItem: true,
                  renderOnSelect: <Box ml="5">{targetingFields}</Box>,
                },
              ]}
            />
          )}
        </Flex>
      </Flex>
    </ModalStandard>
  );
}
