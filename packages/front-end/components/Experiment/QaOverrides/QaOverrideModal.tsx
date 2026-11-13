import { Fragment, useMemo } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiCaretDownBold, PiLockBold, PiPlusBold } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { date } from "shared/dates";
import { isProductionEnvironment } from "shared/util";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import {
  QaOverrideFilterKind,
  completeQaOverrideFilters,
} from "@/services/qaOverrides";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import ConditionInput from "@/components/Features/ConditionInput";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import { Select, SelectItem } from "@/ui/Select";
import RadioGroup from "@/ui/RadioGroup";
import MultiSelectField from "@/ui/MultiSelectField";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import VariationLabel from "@/ui/VariationLabel";
import QaOverrideAudience, {
  QaOverrideAnd,
  useQaOverrideNameLookups,
} from "./QaOverrideAudience";
import { QaOverrideWaitingNote } from "./QaOverrideWaitingMessages";
import useQaOverridePermissions from "./useQaOverridePermissions";
import useQaOverrideForm, {
  QA_OVERRIDE_FILTER_META,
} from "./useQaOverrideForm";

export type QaOverrideModalExperiment = Pick<
  ExperimentInterfaceStringDates,
  "id" | "name" | "project" | "hashAttribute" | "variations" | "phases"
>;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading as="h3" size="sm" mb="0">
      {children}
    </Heading>
  );
}

const CARD_STYLE = {
  backgroundColor: "var(--gray-a2)",
  border: "1px solid var(--gray-a3)",
  borderRadius: "var(--radius-3)",
} as const;

// Between cards under "Who sees it": every one of them has to match.
function AndDivider() {
  const line = (
    <Box flexGrow="1" style={{ height: 1, background: "var(--gray-a4)" }} />
  );
  return (
    <Flex align="center" gap="2" aria-hidden>
      {line}
      <QaOverrideAnd />
      {line}
    </Flex>
  );
}

const percent = (n: number) => `${+(n * 100).toFixed(1)}%`;

/**
 * Read-only: what "Test the experiment as configured" takes from the
 * experiment itself. Filters added below it only narrow this audience.
 */
function ExperimentTargetingCard({
  experiment,
}: {
  experiment: QaOverrideModalExperiment;
}) {
  const phase = experiment.phases[experiment.phases.length - 1];
  const variations = getLatestPhaseVariations(experiment);
  const hasTargeting =
    (!!phase?.condition && phase.condition !== "{}") ||
    !!phase?.savedGroups?.length ||
    !!phase?.prerequisites?.length;
  const rows: [string, React.ReactNode][] = [
    [
      "Targeting",
      hasTargeting ? (
        <ConditionDisplay
          condition={phase?.condition}
          savedGroups={phase?.savedGroups}
          prerequisites={phase?.prerequisites}
        />
      ) : (
        "Everyone"
      ),
    ],
    ["Traffic", percent(phase?.coverage ?? 1)],
    [
      "Split",
      variations
        .map(
          (v, i) => `${v.name} (${percent(phase?.variationWeights?.[i] ?? 0)})`,
        )
        .join(" · "),
    ],
  ];
  return (
    <Box
      role="group"
      aria-label="From the experiment (read-only)"
      style={{ ...CARD_STYLE, padding: "10px 12px 12px" }}
    >
      <Flex align="center" gap="2" mb="2">
        <Text weight="semibold">From the experiment</Text>
        <PiLockBold size={12} color="var(--color-text-mid)" />
      </Flex>
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: "90px 1fr",
          rowGap: 6,
          alignItems: "baseline",
        }}
      >
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <Text size="sm" color="text-mid">
              {label}
            </Text>
            <Text as="div" size="sm">
              {value}
            </Text>
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}

function RemoveFilterButton({
  kind,
  onClick,
}: {
  kind: QaOverrideFilterKind;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      color="gray"
      size="sm"
      aria-label={`Remove ${QA_OVERRIDE_FILTER_META[kind].label} filter`}
      onClick={onClick}
    >
      Remove
    </Button>
  );
}

export default function QaOverrideModal({
  experiment,
  linkedFeatures,
  existing,
  close,
  onSaved,
}: {
  experiment: QaOverrideModalExperiment;
  linkedFeatures?: LinkedFeatureInfo[];
  existing?: ExperimentQaOverrideInterface;
  close: () => void;
  onSaved: () => Promise<unknown> | void;
}) {
  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();
  const { projects } = useDefinitions();
  const { data: connectionData } = useSDKConnections();
  const lookups = useQaOverrideNameLookups();
  const { environments, eligibleEnvironments, canEditIn } =
    useQaOverridePermissions(experiment);

  const variations = getLatestPhaseVariations(experiment);
  // Production stays listed, disabled, so people learn why it's missing;
  // environments the user can't run experiments in are left out since the
  // server would refuse them anyway.
  const environmentOptions = useMemo(
    () =>
      environments
        .map((e) => ({ id: e.id, isProduction: isProductionEnvironment(e) }))
        .filter((e) => e.isProduction || canEditIn(e.id))
        // Selectable ones first; otherwise the org's environment order.
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
    linkedFeatures: linkedFeatures ?? [],
  });

  const connectionOptions = useMemo(
    () =>
      (connectionData?.connections ?? [])
        .filter((c) => c.environment === values.environment)
        .map((c) => ({ value: c.id, label: c.name })),
    [connectionData, values.environment],
  );
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  const addFilterMenu = (
    <DropdownMenu
      trigger={
        <Button variant="outline" size="sm" icon={<PiPlusBold />}>
          Add Filter <PiCaretDownBold size={10} />
        </Button>
      }
      menuPlacement="end"
      menuWidth={280}
      variant="soft"
      disabled={availableFilters.length === 0}
    >
      {availableFilters.map((kind) => {
        const needsEnvironment =
          kind === "sdkConnections" && !values.environment;
        return (
          <DropdownMenuItem
            key={kind}
            // Two lines: menu items are one line tall unless told otherwise.
            className="multiline-item"
            onClick={() => addFilter(kind)}
            disabled={needsEnvironment}
            tooltip={
              needsEnvironment ? "Select an environment first" : undefined
            }
          >
            <Flex direction="column" style={{ gap: 2 }}>
              <Text>{QA_OVERRIDE_FILTER_META[kind].label}</Text>
              <Text size="sm" color="text-mid">
                {QA_OVERRIDE_FILTER_META[kind].description}
              </Text>
            </Flex>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenu>
  );

  const filterCard = (kind: QaOverrideFilterKind) => {
    const remove = (
      <RemoveFilterButton kind={kind} onClick={() => removeFilter(kind)} />
    );
    const header = (
      <Flex align="center" justify="between" mb="1">
        <Text weight="semibold">{QA_OVERRIDE_FILTER_META[kind].label}</Text>
        {remove}
      </Flex>
    );
    return (
      <Box key={kind} style={{ ...CARD_STYLE, padding: "10px 12px 14px" }}>
        {kind === "condition" && (
          <ConditionInput
            label={QA_OVERRIDE_FILTER_META.condition.label}
            labelActions={remove}
            defaultValue={values.condition}
            onChange={(v) => form.setValue("condition", v)}
            project={experiment.project || ""}
            emptyText=""
          />
        )}
        {kind === "savedGroups" && (
          <SavedGroupTargetingField
            label={QA_OVERRIDE_FILTER_META.savedGroups.label}
            labelActions={remove}
            value={values.savedGroups}
            setValue={(v) => form.setValue("savedGroups", v)}
            project={experiment.project || ""}
          />
        )}
        {kind === "sdkConnections" && (
          <>
            {header}
            <MultiSelectField
              aria-label={QA_OVERRIDE_FILTER_META.sdkConnections.label}
              value={values.sdkConnections}
              onChange={(v) => form.setValue("sdkConnections", v)}
              options={connectionOptions}
              placeholder="Select SDK connections…"
              autoFocus
            />
          </>
        )}
        {kind === "projects" && (
          <>
            {header}
            <MultiSelectField
              aria-label={QA_OVERRIDE_FILTER_META.projects.label}
              value={values.projects}
              onChange={(v) => form.setValue("projects", v)}
              options={projectOptions}
              placeholder="Select projects…"
              autoFocus
            />
          </>
        )}
      </Box>
    );
  };

  const testing = values.assignmentType === "random";

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
      cta={existing ? "Apply" : "Add Override"}
      ctaEnabled={canSave}
      size="lg"
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
        <Flex direction="column" gap="2">
          <SectionHeading>What do you want to do?</SectionHeading>
          <RadioGroup
            gap="3"
            value={values.assignmentType}
            setValue={(v) =>
              form.setValue("assignmentType", v as "random" | "forced")
            }
            options={[
              {
                value: "forced",
                label: "Force a variation",
                description:
                  "Show one variation to people you choose. Ignores the experiment\u2019s targeting.",
                // A dropdown can't sit inside the radio's label.
                renderOutsideItem: true,
                renderOnSelect: (
                  <Box ml="5">
                    <Select
                      aria-label="Variation"
                      style={{ width: 280 }}
                      value={values.forcedVariationId || undefined}
                      setValue={(v) => form.setValue("forcedVariationId", v)}
                      placeholder="Select a variation…"
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
                label: "Test the experiment as configured",
                description:
                  "Run it in this environment with its own targeting and split.",
              },
            ]}
          />
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2" align="start">
          <SectionHeading>Environment</SectionHeading>
          {existing ? (
            <Badge label={existing.environment} color="gray" variant="soft" />
          ) : (
            <>
              <Select
                aria-label="Environment"
                style={{ width: 280 }}
                value={values.environment}
                setValue={setEnvironment}
                placeholder="Select an environment…"
              >
                {environmentOptions.map((e) => (
                  <SelectItem key={e.id} value={e.id} disabled={e.isProduction}>
                    {e.id}
                  </SelectItem>
                ))}
              </Select>
              <Text size="sm" color="text-low">
                Only non-production environments are selectable.
              </Text>
            </>
          )}
          {waitingFeatures.length > 0 && (
            <Callout status="warning" size="sm" mt="1">
              <QaOverrideWaitingNote
                waitingOn={waitingFeatures}
                environment={values.environment}
              />
            </Callout>
          )}
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <SectionHeading>Who sees it</SectionHeading>
            <Box flexGrow="1" />
            {availableFilters.length === 0 ? (
              <Tooltip content="Every filter type has been added.">
                <span>{addFilterMenu}</span>
              </Tooltip>
            ) : (
              addFilterMenu
            )}
          </Flex>
          <QaOverrideAudience
            variant="sentence"
            filters={completeQaOverrideFilters(values)}
            order={values.filters}
            environment={values.environment}
            usesExperimentTargeting={testing}
            lookups={lookups}
          />
          {(testing || values.filters.length > 0) && (
            <Flex direction="column" gap="2" mt="1">
              {testing && <ExperimentTargetingCard experiment={experiment} />}
              {values.filters.map((kind, i) => (
                <Fragment key={kind}>
                  {(testing || i > 0) && <AndDivider />}
                  {filterCard(kind)}
                </Fragment>
              ))}
            </Flex>
          )}
        </Flex>
      </Flex>
    </ModalStandard>
  );
}
