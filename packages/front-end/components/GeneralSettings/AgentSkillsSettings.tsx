import { useLayoutEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useFormContext } from "react-hook-form";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import type { OrgSkillSummary } from "shared/ai-chat";
import useApi from "@/hooks/useApi";
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { skillDisplayName } from "@/enterprise/components/AIChat/Composer/extensions/skillCommand";
import { useSettingsForm } from "./SettingsFormProvider";
import styles from "./SettingsSection.module.scss";

const SKILL_COPY: Record<
  string,
  { label: string; description: string; examples: string[] }
> = {
  analytics: {
    label: "Analytics",
    description:
      "Chart product data, build dashboards, and query metrics and fact tables.",
    examples: [
      "show me signups by country",
      "build me a dashboard",
      "find our revenue metric",
    ],
  },
  experiments: {
    label: "Experiments",
    description:
      "Design, launch, analyze, and stop experiments, and record Learnings.",
    examples: [
      "what have we learned",
      "have we tested this before",
      "record this learning",
    ],
  },
  "feature-flags": {
    label: "Feature Flags",
    description:
      "Create, target, roll out, publish, and clean up Feature Flags.",
    examples: [
      "release this to 10% of users",
      "turn on flag X in production",
      "delete this stale flag",
    ],
  },
  "growthbook-docs": {
    label: "GrowthBook docs",
    description: "Answer how-to and setup questions about GrowthBook itself.",
    examples: ["how does X work?"],
  },
};

function Instructions({
  text,
  examples,
}: {
  text: string;
  examples: string[];
}) {
  const [open, setOpen] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);
  // Re-measures when the width changes, since narrower cards wrap the text further.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  const hasMore = clamped || examples.length > 0;
  return (
    <Flex direction="column" gap="2" mt="2" pl="5">
      <Text weight="semibold" color="text-mid">
        Instructions sent to the AI Assistant
      </Text>
      <Text color="text-mid">
        <span
          ref={textRef}
          style={
            open
              ? undefined
              : {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }
          }
        >
          {text}
        </span>
      </Text>
      {open && examples.length > 0 && (
        <Flex direction="column" gap="1">
          <Text weight="medium" color="text-mid">
            Example requests
          </Text>
          <Flex gap="2" wrap="wrap">
            {examples.map((e) => (
              <Badge key={e} label={`“${e}”`} color="gray" variant="soft" />
            ))}
          </Flex>
        </Flex>
      )}
      {(open || hasMore) && (
        <Box>
          <Link aria-expanded={open} onClick={() => setOpen(!open)}>
            <Flex as="span" align="center" gap="1">
              {open ? "Show less" : "Show more"}
              {open ? <PiCaretUp /> : <PiCaretDown />}
            </Flex>
          </Link>
        </Box>
      )}
    </Flex>
  );
}

export default function AgentSkillsSettings({ canEdit }: { canEdit: boolean }) {
  const form = useFormContext();
  const { savedSettings } = useSettingsForm();
  const { data, error } = useApi<{ skills: OrgSkillSummary[] }>(
    "/agent/skills",
  );
  const domains = (data?.skills ?? []).filter((s) => s.kind === "domain");
  if (!error && !domains.length) return null;

  const disabled: string[] = form.watch("disabledAgentSkills") ?? [];
  const skillDirty = (name: string) =>
    (savedSettings.disabledAgentSkills ?? []).includes(name) !==
    disabled.includes(name);

  if (error) {
    return (
      <Callout status="error">
        Could not load the AI Assistant skills. {error.message}
      </Callout>
    );
  }

  return (
    <Box
      width="100%"
      style={{
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-3)",
      }}
    >
      {domains.map((skill, i) => {
        const copy = skill.custom ? undefined : SKILL_COPY[skill.name];
        return (
          <Box
            key={skill.name}
            px="4"
            py="3"
            style={i ? { borderTop: "1px solid var(--gray-a5)" } : undefined}
          >
            <Checkbox
              id={`toggle-skill-${skill.name}`}
              align="start"
              weight="medium"
              label={
                <Flex as="span" gap="2" align="center">
                  {copy?.label ?? skillDisplayName(skill.name)}
                  {skill.custom && <Badge label="Custom" color="violet" />}
                  {skillDirty(skill.name) && (
                    <span
                      className={styles.unsavedDot}
                      role="img"
                      aria-label="Unsaved"
                    />
                  )}
                </Flex>
              }
              description={copy?.description}
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
            <Instructions
              text={skill.description}
              examples={copy?.examples ?? []}
            />
          </Box>
        );
      })}
    </Box>
  );
}
