import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  ExperimentQaOverrideAssignment,
  ExperimentQaOverrideInterface,
} from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { isProductionEnvironment } from "shared/util";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioCards from "@/ui/RadioCards";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import VariationLabel from "@/ui/VariationLabel";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import { FeatureBadge } from "@/components/Features/FeatureBadge";

export type QaOverrideModalExperiment = Pick<
  ExperimentInterfaceStringDates,
  "id" | "name" | "project" | "hashAttribute" | "variations" | "phases"
>;

type FormValues = {
  environment: string;
  assignmentType: ExperimentQaOverrideAssignment["type"];
  forcedVariationId: string;
};

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
  const environments = useEnvironments();

  const variations = getLatestPhaseVariations(experiment);
  const phase = experiment.phases[experiment.phases.length - 1];

  const environmentOptions = useMemo(
    () =>
      environments.map((e) => ({
        id: e.id,
        isProduction: isProductionEnvironment(e),
      })),
    [environments],
  );
  const eligibleEnvironments = environmentOptions.filter(
    (e) => !e.isProduction,
  );

  const form = useForm<FormValues>({
    defaultValues: {
      environment:
        existing?.environment ??
        (eligibleEnvironments.length === 1 ? eligibleEnvironments[0].id : ""),
      assignmentType: existing?.assignment.type ?? "forced",
      forcedVariationId:
        existing?.assignment.type === "forced"
          ? existing.assignment.variationId
          : "",
    },
  });

  const values = form.watch();

  const draftLinkedFeatures = (linkedFeatures ?? []).filter(
    (f) => f.state === "draft" || f.liveHasMatchingRule === false,
  );

  const valid =
    !!values.environment &&
    (values.assignmentType === "random" || !!values.forcedVariationId);

  const buildAssignment = (): ExperimentQaOverrideAssignment =>
    values.assignmentType === "forced"
      ? { type: "forced", variationId: values.forcedVariationId }
      : { type: "random" };

  return (
    <ModalStandard
      open={true}
      close={close}
      header={existing ? "Edit QA Override" : "Add QA Override"}
      subheader={experiment.name}
      cta="Save override"
      ctaEnabled={valid}
      size="md"
      trackingEventModalType="experiment-qa-override"
      submit={form.handleSubmit(async (value) => {
        if (existing) {
          await apiCall(`/qa-overrides/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify({ assignment: buildAssignment() }),
          });
        } else {
          await apiCall(`/qa-overrides/experiment/${experiment.id}`, {
            method: "POST",
            body: JSON.stringify({
              environment: value.environment,
              filters: {},
              assignment: buildAssignment(),
            }),
          });
        }
        await onSaved();
      })}
    >
      <Flex direction="column" gap="5">
        <Box>
          <Heading as="h3" size="sm" mb="1">
            Environment
          </Heading>
          {existing ? (
            <Metadata
              label="Environment"
              value={<Badge label={existing.environment} color="gray" />}
            />
          ) : (
            <>
              <Select
                value={values.environment}
                setValue={(v) => form.setValue("environment", v)}
                placeholder="Select an environment..."
              >
                {environmentOptions.map((e) => (
                  <SelectItem key={e.id} value={e.id} disabled={e.isProduction}>
                    {e.id}
                    {e.isProduction ? " (production)" : ""}
                  </SelectItem>
                ))}
              </Select>
              <Text as="p" size="sm" color="text-low" mt="1">
                QA overrides aren&apos;t available on production. To use one of
                those environments, turn off &quot;This is a production
                environment&quot; in{" "}
                <Link href="/environments">Settings → Environments</Link>.
              </Text>
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
                description: `Run the experiment as configured: hashing on ${
                  experiment.hashAttribute || "id"
                }, ${(phase?.variationWeights ?? [])
                  .map((w) => Math.round(w * 100))
                  .join(
                    " / ",
                  )} split, with its targeting and coverage. Holdouts are ignored.`,
              },
              {
                value: "forced",
                label: "Force variation",
                description:
                  "Everyone matching this override gets one variation. Experiment targeting, coverage, namespaces and holdouts are ignored.",
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

        <Callout status="info">
          Removed automatically when the experiment starts.
        </Callout>
      </Flex>
    </ModalStandard>
  );
}
