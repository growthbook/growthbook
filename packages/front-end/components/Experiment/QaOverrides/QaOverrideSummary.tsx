import { Flex } from "@radix-ui/themes";
import { ExperimentPhaseStringDates } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { ago } from "shared/dates";
import { useUser } from "@/services/UserContext";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import VariationNumber from "@/ui/VariationNumber";

type VariationLike = { id: string; name: string };

export function QaOverrideVariation({
  override,
  variations,
}: {
  override: ExperimentQaOverrideInterface;
  variations: VariationLike[];
}) {
  if (override.assignment.type === "random") {
    return <Text>Random assignment</Text>;
  }
  const { variationId } = override.assignment;
  const index = variations.findIndex((v) => v.id === variationId);
  if (index < 0) return <Text color="text-low">Unknown variation</Text>;
  return (
    <Flex align="center" gap="2">
      <VariationNumber number={index} />
      <Text>{variations[index].name}</Text>
    </Flex>
  );
}

export function QaOverrideAdditionalTargeting({
  override,
}: {
  override: ExperimentQaOverrideInterface;
}) {
  const targeting = override.additionalTargeting;
  if (!targeting) return <Text color="text-low">None</Text>;
  return (
    <Flex align="center" gap="1" wrap="wrap">
      <code>{targeting.attribute}</code>
      <Text size="sm">is any of</Text>
      {targeting.values.map((v) => (
        <Badge key={v} label={v} color="gray" variant="soft" />
      ))}
    </Flex>
  );
}

export function experimentTargetingLabel(
  override: ExperimentQaOverrideInterface,
): string {
  const parts: string[] = [];
  if (override.applyExperimentTargeting) parts.push("Conditions");
  if (override.applyExperimentCoverage) parts.push("Coverage");
  return parts.length ? parts.join(" · ") : "Skipped";
}

export function qaOverrideIncludedLabel(
  override: ExperimentQaOverrideInterface,
  phase: Pick<ExperimentPhaseStringDates, "coverage"> | undefined,
): string {
  const coverage = override.applyExperimentCoverage
    ? Math.round((phase?.coverage ?? 1) * 100)
    : 100;
  const parts = [`${coverage}% of traffic`];
  if (override.applyExperimentTargeting) parts.push("experiment targeting");
  if (override.additionalTargeting) {
    const n = override.additionalTargeting.values.length;
    parts.push(
      `${override.additionalTargeting.attribute} is any of ${n} value${
        n === 1 ? "" : "s"
      }`,
    );
  }
  return parts.join(" · ");
}

export function QaOverrideSetBy({
  override,
}: {
  override: ExperimentQaOverrideInterface;
}) {
  const { getUserDisplay } = useUser();
  return (
    <Text size="sm" color="text-low">
      {getUserDisplay(override.createdBy, true)} · {ago(override.dateCreated)}
    </Text>
  );
}
