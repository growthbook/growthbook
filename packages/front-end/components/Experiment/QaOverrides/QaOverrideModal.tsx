import { useMemo, useState } from "react";
import { PiCaretRightFill } from "react-icons/pi";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  ExperimentQaOverrideAssignment,
  ExperimentQaOverrideInterface,
  QaOverrideAdditionalTargeting,
} from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { isProductionEnvironment } from "shared/util";
import { useAuth } from "@/services/auth";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import useSDKConnections from "@/hooks/useSDKConnections";
import { QaOverrideSdkConnection } from "@/hooks/useExperimentQaOverrides";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MultiSelectField from "@/ui/MultiSelectField";
import RadioCards from "@/ui/RadioCards";
import RadioGroup from "@/ui/RadioGroup";
import Checkbox from "@/ui/Checkbox";
import { Select, SelectItem } from "@/ui/Select";
import StringArrayField from "@/ui/StringArrayField";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import VariationLabel from "@/ui/VariationLabel";
import Metadata from "@/ui/Metadata";
import { FeatureBadge } from "@/components/Features/FeatureBadge";
import Link from "@/ui/Link";

export type QaOverrideModalExperiment = Pick<
  ExperimentInterfaceStringDates,
  "id" | "name" | "project" | "hashAttribute" | "variations" | "phases"
>;

type FormValues = {
  sdkConnections: string[];
  assignmentType: ExperimentQaOverrideAssignment["type"];
  forcedVariationId: string;
  applyExperimentTargeting: boolean;
  applyExperimentCoverage: boolean;
  hasAdditionalTargeting: boolean;
  attribute: string;
  values: string[];
};

export default function QaOverrideModal({
  experiment,
  linkedFeatures,
  existing,
  lockedConnection,
  close,
  onSaved,
}: {
  experiment: QaOverrideModalExperiment;
  linkedFeatures?: LinkedFeatureInfo[];
  existing?: ExperimentQaOverrideInterface;
  lockedConnection?: QaOverrideSdkConnection;
  close: () => void;
  onSaved: () => Promise<unknown> | void;
}) {
  const { apiCall } = useAuth();
  const environments = useEnvironments();
  const { data: connectionData } = useSDKConnections();
  const attributes = useAttributeSchema(false, experiment.project);

  const variations = getLatestPhaseVariations(experiment);
  const phase = experiment.phases[experiment.phases.length - 1];

  const identifierAttributes = useMemo(
    () => attributes.filter((a) => a.hashAttribute && !a.archived),
    [attributes],
  );

  const connectionOptions = useMemo(() => {
    const eligibleEnvs = new Set(
      environments.filter((e) => !isProductionEnvironment(e)).map((e) => e.id),
    );
    return (connectionData?.connections ?? []).map((c) => {
      const envEligible = eligibleEnvs.has(c.environment);
      const inProject =
        !c.projects?.length || c.projects.includes(experiment.project || "");
      return {
        value: c.id,
        label: c.name,
        environment: c.environment,
        isDisabled: !envEligible || !inProject,
        reason: !envEligible
          ? "QA overrides aren't available on production"
          : !inProject
            ? "Does not include this experiment's project"
            : "",
      };
    });
  }, [connectionData, environments, experiment.project]);

  const form = useForm<FormValues>({
    defaultValues: {
      sdkConnections: existing
        ? [existing.sdkConnection]
        : lockedConnection
          ? [lockedConnection.id]
          : [],
      assignmentType: existing?.assignment.type ?? "forced",
      forcedVariationId:
        existing?.assignment.type === "forced"
          ? existing.assignment.variationId
          : "",
      applyExperimentTargeting: existing?.applyExperimentTargeting ?? false,
      applyExperimentCoverage: existing?.applyExperimentCoverage ?? false,
      hasAdditionalTargeting: !!existing?.additionalTargeting,
      attribute:
        existing?.additionalTargeting?.attribute ??
        identifierAttributes[0]?.property ??
        "",
      values: existing?.additionalTargeting?.values ?? [],
    },
  });

  const values = form.watch();
  const [advancedOpen, setAdvancedOpen] = useState(
    !!existing &&
      (existing.applyExperimentTargeting ||
        existing.applyExperimentCoverage ||
        !!existing.additionalTargeting),
  );
  const connectionLocked = !!existing || !!lockedConnection;

  const draftLinkedFeatures = (linkedFeatures ?? []).filter(
    (f) => f.state === "draft" || f.liveHasMatchingRule === false,
  );

  const valid =
    values.sdkConnections.length > 0 &&
    (values.assignmentType === "random" || !!values.forcedVariationId) &&
    (!values.hasAdditionalTargeting ||
      (!!values.attribute && values.values.length > 0));

  const coveragePct = Math.round((phase?.coverage ?? 1) * 100);
  const summary = [
    `${values.sdkConnections.length} connection${
      values.sdkConnections.length === 1 ? "" : "s"
    }`,
    values.assignmentType === "forced"
      ? `forced ${
          variations.find((v) => v.id === values.forcedVariationId)?.name ??
          "variation"
        }`
      : "random assignment",
    `${values.applyExperimentCoverage ? coveragePct : 100}% of traffic`,
  ].join(" · ");

  const buildAdditionalTargeting = (): QaOverrideAdditionalTargeting | null =>
    values.hasAdditionalTargeting
      ? { attribute: values.attribute, values: values.values }
      : null;

  const buildAssignment = (): ExperimentQaOverrideAssignment =>
    values.assignmentType === "forced"
      ? { type: "forced", variationId: values.forcedVariationId }
      : { type: "random" };

  return (
    <ModalStandard
      open={true}
      close={close}
      header={existing ? "Edit QA Override" : "Add Experiment QA Override"}
      subheader={experiment.name}
      cta="Save override"
      ctaEnabled={valid}
      size="md"
      trackingEventModalType="experiment-qa-override"
      submit={form.handleSubmit(async (value) => {
        const fields = {
          assignment: buildAssignment(),
          applyExperimentTargeting: value.applyExperimentTargeting,
          applyExperimentCoverage: value.applyExperimentCoverage,
          additionalTargeting: buildAdditionalTargeting(),
        };
        if (existing) {
          await apiCall(`/qa-overrides/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(fields),
          });
        } else {
          await apiCall(`/qa-overrides/experiment/${experiment.id}`, {
            method: "POST",
            body: JSON.stringify({
              ...fields,
              sdkConnections: value.sdkConnections,
            }),
          });
        }
        await onSaved();
      })}
    >
      <Flex direction="column" gap="5">
        <Box>
          <Heading as="h3" size="sm" mb="1">
            SDK Connections
          </Heading>
          {connectionLocked ? (
            <Metadata
              label="Connection"
              value={
                <Flex align="center" gap="2">
                  <Text>
                    {lockedConnection?.name ??
                      connectionOptions.find(
                        (c) => c.value === existing?.sdkConnection,
                      )?.label ??
                      existing?.sdkConnection}
                  </Text>
                  <Badge
                    label={
                      lockedConnection?.environment ??
                      existing?.environment ??
                      ""
                    }
                    color="gray"
                  />
                </Flex>
              }
            />
          ) : (
            <>
              <Text size="sm" color="text-low" as="p" mb="2">
                Every other connection keeps ignoring this draft until the
                experiment starts.
              </Text>
              <MultiSelectField
                value={values.sdkConnections}
                onChange={(v) => form.setValue("sdkConnections", v)}
                options={connectionOptions}
                placeholder="Select SDK Connections..."
                isOptionDisabled={(o) =>
                  "value" in o
                    ? !!connectionOptions.find((c) => c.value === o.value)
                        ?.isDisabled
                    : false
                }
                formatOptionLabel={(o) => {
                  const option = connectionOptions.find(
                    (c) => c.value === o.value,
                  );
                  return (
                    <Flex align="center" gap="2">
                      <span>{o.label}</span>
                      {option && (
                        <Badge label={option.environment} color="gray" />
                      )}
                      {option?.reason && (
                        <Text size="sm" color="text-low">
                          {option.reason}
                        </Text>
                      )}
                    </Flex>
                  );
                }}
              />
            </>
          )}
        </Box>

        {draftLinkedFeatures.length > 0 && (
          <Callout status="warning">
            The rule for this experiment isn&apos;t published in{" "}
            {draftLinkedFeatures.map((f, i) => (
              <span key={f.feature.id}>
                {i > 0 ? ", " : ""}
                <FeatureBadge featureId={f.feature.id} />
              </span>
            ))}{" "}
            yet, so this override won&apos;t change that Feature Flag until its
            draft is published.
          </Callout>
        )}

        <Box>
          <Heading as="h3" size="sm" mb="2">
            Which Variation?
          </Heading>
          <RadioCards
            columns="1"
            value={values.assignmentType}
            setValue={(v) =>
              form.setValue(
                "assignmentType",
                v as ExperimentQaOverrideAssignment["type"],
              )
            }
            options={[
              {
                value: "random",
                label: "Random assignment",
                description: `Normal hashing on ${
                  experiment.hashAttribute || "id"
                }, ${(phase?.variationWeights ?? [])
                  .map((w) => Math.round(w * 100))
                  .join(" / ")}`,
              },
              {
                value: "forced",
                label: "Force variation",
                description: "Everyone on these connections gets one variation",
              },
            ]}
          />
          {values.assignmentType === "forced" && (
            <Box mt="3" ml="2">
              <RadioGroup
                value={values.forcedVariationId}
                setValue={(v) => form.setValue("forcedVariationId", v)}
                options={variations.map((v, i) => ({
                  value: v.id,
                  label: <VariationLabel number={i} name={v.name} />,
                }))}
              />
            </Box>
          )}
        </Box>

        <Box>
          <Link weight="bold" onClick={() => setAdvancedOpen((v) => !v)}>
            <PiCaretRightFill
              style={{
                marginRight: 4,
                transform: advancedOpen ? "rotate(90deg)" : undefined,
                transition: "transform 0.15s",
              }}
            />
            Advanced Targeting
          </Link>
          {advancedOpen ? (
            <Flex direction="column" gap="5" mt="3">
              <Box>
                <Heading as="h3" size="sm" mb="2">
                  Experiment Targeting
                </Heading>
                <Flex direction="column" gap="2">
                  <Checkbox
                    value={values.applyExperimentTargeting}
                    setValue={(v) =>
                      form.setValue("applyExperimentTargeting", v)
                    }
                    label="Apply the experiment's targeting conditions"
                    description={experimentTargetingDescription(experiment)}
                  />
                  <Checkbox
                    value={values.applyExperimentCoverage}
                    setValue={(v) =>
                      form.setValue("applyExperimentCoverage", v)
                    }
                    label={`Apply the experiment's traffic coverage (${coveragePct}%)`}
                    description={
                      values.applyExperimentCoverage
                        ? undefined
                        : "Unchecked: 100% of matching traffic is included"
                    }
                  />
                </Flex>
              </Box>

              <Box>
                <Heading as="h3" size="sm" mb="1">
                  Additional Targeting
                </Heading>
                {values.hasAdditionalTargeting ? (
                  <Flex direction="column" gap="2">
                    <Flex align="center" gap="2">
                      <Select
                        aria-label="Attribute"
                        value={values.attribute}
                        setValue={(v) => {
                          form.setValue("attribute", v);
                          form.setValue("values", []);
                        }}
                        placeholder="Attribute"
                      >
                        {identifierAttributes.map((a) => (
                          <SelectItem key={a.property} value={a.property}>
                            {a.property}
                          </SelectItem>
                        ))}
                      </Select>
                      <Text color="text-mid">is any of</Text>
                      <Box ml="auto">
                        <Button
                          variant="ghost"
                          color="gray"
                          size="sm"
                          onClick={() => {
                            form.setValue("hasAdditionalTargeting", false);
                            form.setValue("values", []);
                          }}
                        >
                          Remove
                        </Button>
                      </Box>
                    </Flex>
                    <StringArrayField
                      value={values.values}
                      onChange={(v) => form.setValue("values", v)}
                      placeholder="Add a value and press Enter"
                    />
                    {identifierAttributes.length === 0 && (
                      <Text size="sm" color="text-low">
                        No identifier attributes are configured for this
                        project.
                      </Text>
                    )}
                  </Flex>
                ) : (
                  <Flex align="center" gap="3">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={identifierAttributes.length === 0}
                      onClick={() =>
                        form.setValue("hasAdditionalTargeting", true)
                      }
                    >
                      Add targeting
                    </Button>
                    <Text size="sm" color="text-low">
                      Without it, every request on these connections can get the
                      draft.
                    </Text>
                  </Flex>
                )}
              </Box>
            </Flex>
          ) : (
            <Text as="p" size="sm" color="text-low" mt="1">
              {advancedTargetingSummary({
                applyExperimentTargeting: values.applyExperimentTargeting,
                applyExperimentCoverage: values.applyExperimentCoverage,
                coveragePct,
                additionalTargeting: buildAdditionalTargeting(),
              })}
            </Text>
          )}
        </Box>

        <Callout status="info">
          Cleared automatically when the experiment starts.
        </Callout>

        <Text size="sm" color="text-low">
          {summary}
        </Text>
      </Flex>
    </ModalStandard>
  );
}

function advancedTargetingSummary({
  applyExperimentTargeting,
  applyExperimentCoverage,
  coveragePct,
  additionalTargeting,
}: {
  applyExperimentTargeting: boolean;
  applyExperimentCoverage: boolean;
  coveragePct: number;
  additionalTargeting: QaOverrideAdditionalTargeting | null;
}): string {
  return [
    applyExperimentTargeting
      ? "Experiment targeting applied"
      : "Experiment targeting skipped",
    `${applyExperimentCoverage ? coveragePct : 100}% of traffic`,
    additionalTargeting
      ? `${additionalTargeting.attribute} is any of ${
          additionalTargeting.values.length
        } value${additionalTargeting.values.length === 1 ? "" : "s"}`
      : "no additional targeting",
  ].join(" · ");
}

function experimentTargetingDescription(
  experiment: QaOverrideModalExperiment,
): string {
  const phase = experiment.phases[experiment.phases.length - 1];
  if (!phase) return "No targeting configured";
  const parts: string[] = [];
  if (phase.condition && phase.condition !== "{}") {
    parts.push("attribute conditions");
  }
  if (phase.savedGroups?.length) {
    parts.push(
      `${phase.savedGroups.length} saved group rule${
        phase.savedGroups.length === 1 ? "" : "s"
      }`,
    );
  }
  if (phase.prerequisites?.length) {
    parts.push(
      `${phase.prerequisites.length} prerequisite${
        phase.prerequisites.length === 1 ? "" : "s"
      }`,
    );
  }
  return parts.length ? parts.join(", ") : "No targeting configured";
}
