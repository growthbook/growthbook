import { useMemo } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiCaretDownBold, PiPlusBold } from "react-icons/pi";
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
import { QaOverrideFilterKind } from "@/services/qaOverrides";
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
import QaOverrideWaitingMessages from "./QaOverrideWaitingMessages";
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
      <Box
        key={kind}
        style={{
          backgroundColor: "var(--gray-a2)",
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-3)",
          padding: "10px 12px 14px",
        }}
      >
        {kind === "condition" && (
          <ConditionInput
            label={QA_OVERRIDE_FILTER_META.condition.label}
            labelActions={remove}
            defaultValue={values.condition}
            onChange={(v) => form.setValue("condition", v)}
            project={experiment.project || ""}
            emptyText=""
            identifiersOnly
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
                {environmentOptions.map((e) =>
                  e.isProduction ? (
                    <Tooltip
                      key={e.id}
                      content="QA overrides can't run in production environments."
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
              <Text size="sm" color="text-low">
                Only non-production environments are selectable.
              </Text>
            </>
          )}
          {waitingFeatures.length > 0 && (
            <Callout status="warning" size="sm" mt="1">
              <QaOverrideWaitingMessages
                waitingOn={waitingFeatures}
                environment={values.environment}
              />
            </Callout>
          )}
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <SectionHeading>Filters</SectionHeading>
            <Text size="sm" color="text-low">
              Optional
            </Text>
            <Box flexGrow="1" />
            {availableFilters.length === 0 ? (
              <Tooltip content="Every filter type has been added.">
                <span>{addFilterMenu}</span>
              </Tooltip>
            ) : (
              addFilterMenu
            )}
          </Flex>
          {values.filters.length === 0 ? (
            <Box
              py="3"
              px="4"
              style={{
                border: "1px solid var(--gray-a4)",
                borderRadius: "var(--radius-2)",
              }}
            >
              <Text as="p" size="sm" color="text-low" align="center" mb="0">
                No filters. Everyone in the selected environment gets this
                override.
              </Text>
            </Box>
          ) : (
            <Flex direction="column" gap="2">
              {values.filters.map(filterCard)}
            </Flex>
          )}
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2">
          <SectionHeading>Variation</SectionHeading>
          <RadioGroup
            gap="3"
            value={values.assignmentType}
            setValue={(v) =>
              form.setValue("assignmentType", v as "random" | "forced")
            }
            options={[
              {
                value: "random",
                label: "Random",
                description:
                  "Split like the live experiment, using its targeting and traffic.",
              },
              {
                value: "forced",
                label: "Force a variation",
                description:
                  "Everyone who matches your filters sees the variation you pick.",
                renderOnSelect: (
                  <Box mt="1">
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
            ]}
          />
        </Flex>
      </Flex>
    </ModalStandard>
  );
}
