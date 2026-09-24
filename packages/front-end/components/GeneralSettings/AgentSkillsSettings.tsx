import { Box, Flex } from "@radix-ui/themes";
import { useFormContext } from "react-hook-form";
import type { OrgSkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { skillDisplayName } from "@/enterprise/components/AIChat/Composer/extensions/skillCommand";

export default function AgentSkillsSettings({ canEdit }: { canEdit: boolean }) {
  const form = useFormContext();
  const { data } = useApi<{ skills: OrgSkillSummary[] }>("/agent/skills");
  const domains = (data?.skills ?? []).filter((s) => s.kind === "domain");
  if (!domains.length) return null;

  const disabled: string[] = form.watch("disabledAgentSkills") ?? [];

  return (
    <Box mb="6" width="100%">
      <Text as="div" size="lg" weight="semibold">
        AI Assistant skills
      </Text>
      <Text as="div" mb="3">
        Choose which skills the AI Assistant can use.
      </Text>
      {domains.map((skill) => (
        <Flex key={skill.name} gap="3" align="start" mb="3">
          <Checkbox
            id={`toggle-skill-${skill.name}`}
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
            mt="1"
          />
          <Flex direction="column">
            <Flex gap="2" align="center">
              <Text weight="medium">
                <label htmlFor={`toggle-skill-${skill.name}`}>
                  {skillDisplayName(skill.name)}
                </label>
              </Text>
              {skill.custom && <Badge label="Custom" color="violet" />}
            </Flex>
            <Text color="text-mid">{skill.description}</Text>
          </Flex>
        </Flex>
      ))}
    </Box>
  );
}
