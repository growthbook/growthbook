import { Flex } from "@radix-ui/themes";
import { Environment } from "shared/types/organization";
import { FlagImportPreviewFlag, FlagImportPreviewRule } from "shared/util";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import RuleCard from "@/components/Features/RuleCard";
import RuleField, {
  SampleByField,
  TargetingField,
} from "@/components/Features/RuleField";
import RuleEnvScopeBadges from "@/components/Features/RuleEnvScopeBadges";
import RolloutRow from "@/components/Features/RolloutRow";
import RuleVariationsTable from "@/components/Features/RuleVariationsTable";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import { PlainEntityBadge } from "@/components/Features/EntityBadge";

// The card carries the rule's number, so the message doesn't repeat it.
export function ruleIssueText(issue: string): string {
  const text = issue.replace(/^Rule \d+ /, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ruleTitle(rule: FlagImportPreviewRule): string {
  if (rule.experiment) return `Experiment: ${rule.experiment.name}`;
  if (rule.type === "experiment") return "Experiment";
  return rule.type === "rollout" ? "Rollout" : "Force Rule";
}

export default function ImportRuleCard({
  rule,
  number,
  valueType,
  environments,
}: {
  rule: FlagImportPreviewRule;
  number: number;
  valueType: FlagImportPreviewFlag["valueType"];
  environments: Environment[];
}) {
  const { experiment } = rule;
  const ribbon = rule.issue ? (
    <Callout status="warning" size="sm">
      <strong>Can&apos;t be imported</strong>: {ruleIssueText(rule.issue)}
    </Callout>
  ) : experiment ? (
    <Callout status="warning" size="sm">
      <strong>Skipped by default</strong>: This experiment does not serve while
      in draft unless the SDK connection opts in.
    </Callout>
  ) : undefined;

  return (
    <RuleCard
      index={number}
      sideColor={rule.issue || experiment ? "skipped" : "active"}
      ribbon={ribbon}
      header={
        <Flex align="center" gap="2" wrap="wrap">
          <Heading as="h4" size="md" weight="medium" mb="0">
            {ruleTitle(rule)}
          </Heading>
          {experiment ? (
            <Badge label="Draft" color="indigo" variant="solid" radius="full" />
          ) : null}
        </Flex>
      }
    >
      <RuleField label="Environments">
        <RuleEnvScopeBadges
          activeEnvironmentIds={rule.environments ?? "all"}
          environments={environments}
          my="0"
        />
      </RuleField>
      {experiment ? (
        <>
          {rule.condition ? (
            <TargetingField condition={rule.condition} />
          ) : null}
          <RuleField label="Split by">
            <AttributeBadge attributeId={rule.hashAttribute || "id"} />
          </RuleField>
          <RolloutRow coverage={rule.coverage ?? 1} />
          <RuleField label="Serve" align="start">
            <RuleVariationsTable
              rows={experiment.variations.map((variation, i) => ({
                key: String(i),
                name: variation.name,
                weight: variation.weight,
                value: (
                  <ValueDisplay value={variation.value} type={valueType} />
                ),
              }))}
            />
          </RuleField>
          <RuleField label="Tracking key" mb="0">
            <PlainEntityBadge label={experiment.trackingKey} />
          </RuleField>
        </>
      ) : (
        <>
          <TargetingField condition={rule.condition} />
          {rule.type === "rollout" ? (
            <>
              <SampleByField hashAttribute={rule.hashAttribute || "id"} />
              <RolloutRow coverage={rule.coverage ?? 1} />
            </>
          ) : null}
          {rule.value !== null ? (
            <RuleField label="Serve" mb="0">
              <ValueDisplay value={rule.value} type={valueType} />
            </RuleField>
          ) : null}
        </>
      )}
    </RuleCard>
  );
}
