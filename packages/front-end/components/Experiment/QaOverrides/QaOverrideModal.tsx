import { Fragment, useMemo, useState } from "react";
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
import {
  QaOverrideFilterKind,
  qaOverrideFiltersFromForm,
} from "@/services/qaOverrides";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import { Select, SelectItem } from "@/ui/Select";
import RadioGroup from "@/ui/RadioGroup";
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
import QaOverrideExperimentCard from "./QaOverrideExperimentCard";
import QaOverrideFilterCard from "./QaOverrideFilterCard";
import { QaOverrideWaitingNote } from "./QaOverrideWaitingMessages";
import useQaOverridePermissions from "./useQaOverridePermissions";
import useQaOverrideForm, {
  QA_OVERRIDE_FILTER_META,
} from "./useQaOverrideForm";
import styles from "./QaOverrides.module.scss";

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

function AndDivider() {
  const line = <Box className={styles.andLine} />;
  return (
    <Flex align="center" gap="2" aria-hidden>
      {line}
      <QaOverrideAnd />
      {line}
    </Flex>
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
        <Button
          variant="outline"
          size="sm"
          icon={<PiPlusBold size={12} />}
          style={{ height: 28, fontSize: 13, paddingInline: 10, gap: 6 }}
        >
          <Flex as="span" align="center" style={{ gap: 6 }}>
            Add Filter <PiCaretDownBold size={12} />
          </Flex>
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
            className="multiline-item"
            onClick={() => {
              addFilter(kind);
              setJustAdded(kind);
            }}
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
            filters={qaOverrideFiltersFromForm(values)}
            order={values.filters}
            environment={values.environment}
            usesExperimentTargeting={testing}
            lookups={lookups}
          />
          {(testing || values.filters.length > 0) && (
            <Flex direction="column" gap="2" mt="1">
              {testing && <QaOverrideExperimentCard experiment={experiment} />}
              {values.filters.map((kind, i) => (
                <Fragment key={kind}>
                  {(testing || i > 0) && <AndDivider />}
                  <QaOverrideFilterCard
                    kind={kind}
                    form={form}
                    project={experiment.project || ""}
                    connectionOptions={connectionOptions}
                    projectOptions={projectOptions}
                    autoFocus={justAdded === kind}
                    onRemove={() => removeFilter(kind)}
                  />
                </Fragment>
              ))}
            </Flex>
          )}
        </Flex>
      </Flex>
    </ModalStandard>
  );
}
