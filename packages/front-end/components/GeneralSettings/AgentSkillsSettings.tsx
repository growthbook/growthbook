import { Box, Flex } from "@radix-ui/themes";
import { useFormContext } from "react-hook-form";
import type { OrgSkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import { skillDisplayName } from "@/enterprise/components/AIChat/Composer/extensions/skillCommand";

const SKILL_COPY: Record<string, { label: string; description: string }> = {
  analytics: {
    label: "Analytics",
    description:
      "Chart product data, build dashboards, and query metrics and fact tables.",
  },
  experiments: {
    label: "Experiments",
    description:
      "Design, launch, analyze, and stop experiments, and record Learnings.",
  },
  "feature-flags": {
    label: "Feature Flags",
    description:
      "Create, target, roll out, publish, and clean up Feature Flags.",
  },
  "growthbook-docs": {
    label: "GrowthBook docs",
    description: "Answer how-to and setup questions about GrowthBook itself.",
  },
};

export default function AgentSkillsSettings({ canEdit }: { canEdit: boolean }) {
  const form = useFormContext();
  const { data, error } = useApi<{ skills: OrgSkillSummary[] }>(
    "/agent/skills",
  );
  const domains = (data?.skills ?? []).filter((s) => s.kind === "domain");
  if (!error && !domains.length) return null;

  const disabled: string[] = form.watch("disabledAgentSkills") ?? [];

  return (
    <Box width="100%">
      {error ? (
        <Callout status="error">
          Could not load the AI Assistant skills. {error.message}
        </Callout>
      ) : (
        <Flex direction="column" gap="3">
          {domains.map((skill) => {
            const copy = skill.custom ? undefined : SKILL_COPY[skill.name];
            return (
              <Checkbox
                key={skill.name}
                id={`toggle-skill-${skill.name}`}
                align="start"
                weight="medium"
                label={
                  <Flex as="span" gap="2" align="center">
                    {copy?.label ?? skillDisplayName(skill.name)}
                    {skill.custom && <Badge label="Custom" color="violet" />}
                  </Flex>
                }
                description={copy?.description ?? skill.description}
                value={!disabled.includes(skill.name)}
                setValue={(on) =>
                  form.setValue(
                    "disabledAgentSkills",
                    on
                      ? disabled.filter((name) => name !== skill.name)
                      : [...disabled, skill.name],
                  )
                }
                disabled={!canEdit}
              />
            );
          })}
        </Flex>
      )}
    </Box>
  );
}
