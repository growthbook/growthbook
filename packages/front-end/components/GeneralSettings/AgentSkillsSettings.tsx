import { Box, Flex } from "@radix-ui/themes";
import { useFormContext } from "react-hook-form";
import type { OrgSkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import { skillDisplayName } from "@/enterprise/components/AIChat/Composer/extensions/skillCommand";

export default function AgentSkillsSettings({ canEdit }: { canEdit: boolean }) {
  const form = useFormContext();
  const { data, error } = useApi<{ skills: OrgSkillSummary[] }>(
    "/agent/skills",
  );
  const domains = (data?.skills ?? []).filter((s) => s.kind === "domain");
  if (!error && !domains.length) return null;

  const disabled: string[] = form.watch("disabledAgentSkills") ?? [];

  return (
    <Box mb="6" width="100%">
      <Text as="div" size="lg" weight="semibold">
        AI Assistant skills
      </Text>
      <Text as="div" mb="3">
        Choose which skills the AI Assistant can use.
      </Text>
      {error ? (
        <Callout status="error">
          Could not load the AI Assistant skills. {error.message}
        </Callout>
      ) : (
        <Flex direction="column" gap="3">
          {domains.map((skill) => (
            <Checkbox
              key={skill.name}
              id={`toggle-skill-${skill.name}`}
              align="start"
              weight="medium"
              label={
                <Flex as="span" gap="2" align="center">
                  {skillDisplayName(skill.name)}
                  {skill.custom && <Badge label="Custom" color="violet" />}
                </Flex>
              }
              description={skill.description}
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
          ))}
        </Flex>
      )}
    </Box>
  );
}
