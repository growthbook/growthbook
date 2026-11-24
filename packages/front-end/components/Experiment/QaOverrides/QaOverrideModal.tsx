import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
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
  QaOverrideFilterKind,
  QaOverrideTargetingMode,
  qaOverrideFiltersFromForm,
} from "@/services/qaOverrides";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import { Select, SelectItem } from "@/ui/Select";
import RadioGroup from "@/ui/RadioGroup";
import Collapse from "@/ui/Collapse";
import Link from "@/ui/Link";
import MultiSelectField from "@/ui/MultiSelectField";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import VariationLabel from "@/ui/VariationLabel";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import QaOverrideAudience, {
  useQaOverrideNameLookups,
} from "./QaOverrideAudience";
import QaOverrideExperimentTargeting from "./QaOverrideExperimentTargeting";
import { QaOverrideWaitingBanner } from "./QaOverrideWaitingMessages";
import useQaOverridePermissions from "./useQaOverridePermissions";
import useQaOverrideForm, {
  QA_OVERRIDE_FILTER_META,
} from "./useQaOverrideForm";

const WHERE_FILTERS: QaOverrideFilterKind[] = ["sdkConnections", "projects"];
const WHO_FILTERS = ["condition", "savedGroups"] as const;
const WHO_LINK_LABELS: Record<(typeof WHO_FILTERS)[number], string> = {
  condition: "Target by attribute",
  savedGroups: "Target by Saved Group",
};

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

const STALE_CONNECTION_LABELS = {
  deleted: "deleted",
  archived: "archived",
  "other-environment": "in another environment",
} as const;

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
  // Names for the connections `existing` lists, including ones that no
  // longer serve its environment.
  sdkConnections?: { id: string; name: string }[];
  close: () => void;
  onSaved: () => Promise<unknown> | void;
}) {
  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();
  const { projects } = useDefinitions();
  const { data: connectionData } = useSDKConnections();
  const lookups = useQaOverrideNameLookups(sdkConnections);
  const [justAdded, setJustAdded] = useState<QaOverrideFilterKind | null>(null);
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
    setEnvironment,
    availableFilters,
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

  // The forced variation was removed from the experiment since this override
  // was saved. The select starts empty and one has to be picked.
  const savedVariationId =
    existing?.assignment.type === "forced"
      ? existing.assignment.variationId
      : undefined;
  const variationDeleted =
    savedVariationId !== undefined &&
    !variations.some((v) => v.id === savedVariationId);

  // Connections the override still lists but that no longer receive it. They
  // stay in the field so they can be seen and removed.
  const staleConnectionOptions = (existing?.staleSdkConnections ?? []).map(
    (c) => ({
      value: c.id,
      label:
        c.reason === "deleted"
          ? "Deleted SDK Connection"
          : `${lookups.sdkConnectionName(c.id)} (${STALE_CONNECTION_LABELS[c.reason]})`,
    }),
  );
  const staleConnectionIds = new Set(
    staleConnectionOptions.map((o) => o.value),
  );

  const liveConnectionOptions = useMemo(
    () =>
      (connectionData?.connections ?? [])
        .filter((c) => c.environment === values.environment)
        .map((c) => ({ value: c.id, label: c.name })),
    [connectionData, values.environment],
  );
  const connectionOptions = [
    ...liveConnectionOptions.filter((o) => !staleConnectionIds.has(o.value)),
    ...staleConnectionOptions,
  ];
  const hasStaleConnection = values.sdkConnections.some((id) =>
    staleConnectionIds.has(id),
  );
  // Visual Editor changes and URL Redirects are sent by the experiment's own
  // Project, so a Projects filter only matters for Feature Flags.
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
  const testing = values.assignmentType === "random";

  // Targeting is on when its field has a value; empty means no filter.
  const setFilterActive = (kind: QaOverrideFilterKind, active: boolean) => {
    const current = form.getValues("filters");
    if (active === current.includes(kind)) return;
    form.setValue(
      "filters",
      active ? [...current, kind] : current.filter((k) => k !== kind),
    );
  };

  const whereFields = values.filters
    .filter((k) => WHERE_FILTERS.includes(k))
    .map((kind) => {
      const field = kind as "sdkConnections" | "projects";
      const { label } = QA_OVERRIDE_FILTER_META[kind];
      return (
        // Clearing the field, or leaving it empty, removes it.
        <Box
          key={kind}
          onBlur={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null))
              return;
            if (form.getValues(field).length === 0) removeFilter(kind);
          }}
        >
          <MultiSelectField
            legacyLabelFormatting={false}
            label={label}
            containerClassName="mb-0"
            value={values[field]}
            onChange={(v, action) => {
              if (action === "clear") removeFilter(kind);
              else form.setValue(field, v);
            }}
            options={
              field === "sdkConnections" ? connectionOptions : projectOptions
            }
            placeholder={
              field === "sdkConnections"
                ? "Select SDK Connections…"
                : "Select Projects…"
            }
            autoFocus={justAdded === kind}
          />
          {field === "sdkConnections" && hasStaleConnection ? (
            <HelperText status="warning" size="sm" mt="1">
              An SDK Connection that was deleted, archived or moved no longer
              receives this override.
            </HelperText>
          ) : null}
          {field === "projects" && projectsNote ? (
            <HelperText status={projectsNote} size="sm" mt="1">
              Project filters only apply to Feature Flags. Visual changes and
              redirects reach SDK Connections through the experiment&apos;s
              Project.
            </HelperText>
          ) : null}
        </Box>
      );
    });
  const whereAvailable = availableFilters.filter((k) =>
    WHERE_FILTERS.includes(k),
  );
  const whoAvailable = WHO_FILTERS.filter((k) => !values.filters.includes(k));

  // Adding opens one step at a time. Editing shows them all.
  const showEnvironment =
    !!existing || testing || (forced && !!values.forcedVariationId);

  const audienceFilters = qaOverrideFiltersFromForm(values);
  const targetingFields = (
    <Flex direction="column" gap="5">
      {values.filters.includes("condition") && (
        <ConditionInput
          slimMode
          label="Attributes"
          defaultValue={values.condition}
          onChange={(v) => {
            form.setValue("condition", v);
            setFilterActive("condition", !!v && v !== "{}");
          }}
          project={experiment.project || ""}
        />
      )}
      {values.filters.includes("savedGroups") && (
        <SavedGroupTargetingField
          slimMode
          label="Saved Groups"
          value={values.savedGroups}
          setValue={(v) => {
            form.setValue("savedGroups", v);
            setFilterActive("savedGroups", v.length > 0);
          }}
          project={experiment.project || ""}
        />
      )}
      {whoAvailable.length > 0 && (
        <Flex gap="4">
          {whoAvailable.map((kind) => (
            <Link key={kind} onClick={() => addFilter(kind)}>
              <Flex align="center" gap="1">
                <PiPlus />
                {WHO_LINK_LABELS[kind]}
              </Flex>
            </Link>
          ))}
        </Flex>
      )}
    </Flex>
  );
  const showAudience = showEnvironment && !!values.environment;

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
      size="md"
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
      {/* Collapse always renders a wrapper, so spacing sits inside each one. */}
      <Flex direction="column">
        <Flex direction="column" gap="4">
          <SectionLabel>What do you want to QA?</SectionLabel>
          <RadioGroup
            gap="2"
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

        <Collapse open={forced}>
          <Box pt="4">
            <Select
              label="Variation"
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
        </Collapse>

        <Collapse open={showEnvironment}>
          <Box pt="6">
            <Flex direction="column" gap="2">
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
                <>
                  <Select
                    label="Environment"
                    value={values.environment}
                    setValue={setEnvironment}
                    placeholder="Select an environment…"
                  >
                    {environmentOptions.map((e) => (
                      <SelectItem
                        key={e.id}
                        value={e.id}
                        disabled={e.isProduction}
                      >
                        {e.id}
                      </SelectItem>
                    ))}
                  </Select>
                  <Text as="div" size="sm" color="text-low">
                    Non-production environments only.
                  </Text>
                </>
              )}
              {whereFields}
              {!!values.environment && whereAvailable.length > 0 && (
                <Flex gap="4" mt="1">
                  {whereAvailable.map((kind) => (
                    <Link
                      key={kind}
                      onClick={() => {
                        addFilter(kind);
                        setJustAdded(kind);
                      }}
                    >
                      <Flex align="center" gap="1">
                        <PiPlus />
                        {QA_OVERRIDE_FILTER_META[kind].label}
                      </Flex>
                    </Link>
                  ))}
                </Flex>
              )}
            </Flex>
          </Box>
        </Collapse>

        <Collapse open={showAudience}>
          <Box pt="6">
            <Flex direction="column" gap="2">
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
                          phase={
                            experiment.phases[experiment.phases.length - 1]
                          }
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
                      // The filter fields can't sit inside the radio's label.
                      renderOutsideItem: true,
                      renderOnSelect: (
                        <Box ml="5" mt="2">
                          {targetingFields}
                        </Box>
                      ),
                    },
                  ]}
                />
              )}
            </Flex>
          </Box>
        </Collapse>
      </Flex>
    </ModalStandard>
  );
}
