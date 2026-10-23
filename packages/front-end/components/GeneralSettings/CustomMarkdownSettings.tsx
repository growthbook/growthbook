import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useUser } from "@/services/UserContext";
import Frame from "@/ui/Frame";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { DocLink } from "@/components/DocLink";

const FIELDS = [
  ["featureListMarkdown", "Features list"],
  ["featurePageMarkdown", "Feature page"],
  ["experimentListMarkdown", "Experiments list"],
  ["experimentPageMarkdown", "Experiment page"],
  ["metricListMarkdown", "Metrics list"],
  ["metricPageMarkdown", "Metric page"],
] as const;

export default function CustomMarkdownSettings() {
  const form = useFormContext<OrganizationSettingsWithMetricDefaults>();
  const { hasCommercialFeature } = useUser();
  const enabled = hasCommercialFeature("custom-markdown");

  return (
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="md" as="h4">
            <PremiumTooltip commercialFeature="custom-markdown">
              Custom Markdown
            </PremiumTooltip>
          </Heading>
          <Text as="p" size="sm" color="text-mid" mt="2">
            Shown at the top of each list and detail page.{" "}
            <DocLink docSection="customMarkdown">View docs</DocLink>
          </Text>
        </Box>
        <Flex direction="column" flexGrow="1" pt="6" gap="4">
          {enabled ? (
            FIELDS.map(([key, label]) => (
              <Box key={key} width="100%">
                <Text as="label" size="md" weight="semibold">
                  {label}
                </Text>
                <MarkdownInput
                  value={form.watch(key) || ""}
                  setValue={(value) =>
                    form.setValue(key, value, { shouldDirty: true })
                  }
                />
              </Box>
            ))
          ) : (
            <Text color="text-mid">
              Upgrade to add organization-specific guidance to your team&apos;s
              pages.
            </Text>
          )}
        </Flex>
      </Flex>
    </Frame>
  );
}
