import { useFormContext } from "react-hook-form";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import PremiumCallout from "@/ui/PremiumCallout";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { DocLink } from "@/components/DocLink";
import { SettingsField, SettingsGroup } from "./SettingsGroup";

const GROUPS = [
  {
    id: "md-features",
    title: "Features",
    description:
      "Shown at the top of the features list and on each feature page.",
    fields: [
      ["featureListMarkdown", "Features list"],
      ["featurePageMarkdown", "Feature page"],
    ],
  },
  {
    id: "md-experiments",
    title: "Experiments",
    description:
      "Shown at the top of the experiments list and on each experiment page.",
    fields: [
      ["experimentListMarkdown", "Experiments list"],
      ["experimentPageMarkdown", "Experiment page"],
    ],
  },
  {
    id: "md-metrics",
    title: "Metrics",
    description:
      "Shown at the top of the metrics list and on each metric page.",
    fields: [
      ["metricListMarkdown", "Metrics list"],
      ["metricPageMarkdown", "Metric page"],
    ],
  },
] as const;

export default function CustomMarkdownSettings() {
  const form = useFormContext<OrganizationSettingsWithMetricDefaults>();
  const { hasCommercialFeature } = useUser();
  const enabled = hasCommercialFeature("custom-markdown");

  return (
    <>
      {GROUPS.map((group, i) => (
        <SettingsGroup
          key={group.id}
          id={group.id}
          title={
            i === 0 ? (
              <PremiumTooltip commercialFeature="custom-markdown">
                {group.title}
              </PremiumTooltip>
            ) : (
              group.title
            )
          }
          description={
            <>
              {group.description}
              {i === 0 && (
                <>
                  {" "}
                  <DocLink docSection="customMarkdown">View docs</DocLink>
                </>
              )}
            </>
          }
          keywords="custom markdown guidance documentation help"
        >
          {enabled ? (
            group.fields.map(([key, label]) => (
              <SettingsField key={key} label={label}>
                <MarkdownInput
                  value={form.watch(key) || ""}
                  setValue={(value) =>
                    form.setValue(key, value, { shouldDirty: true })
                  }
                />
              </SettingsField>
            ))
          ) : (
            <PremiumCallout
              commercialFeature="custom-markdown"
              id={`settings-${group.id}`}
            >
              Add organization-specific guidance to your team&apos;s pages.
            </PremiumCallout>
          )}
        </SettingsGroup>
      ))}
    </>
  );
}
