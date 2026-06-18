import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { PiCaretRightFill } from "react-icons/pi";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";

const ulStyle: React.CSSProperties = {
  margin: "var(--space-1) 0 0",
  paddingLeft: "var(--space-4)",
};
const liStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

type Dependents = {
  features: string[];
  experiments: { id: string; name: string }[];
};

// Compact, comma-joined counts shared by both variants — e.g. "3 features,
// 1 experiment". These counts double as the disclosure toggle label.
function summarize({ features, experiments }: Dependents): string {
  const parts: string[] = [];
  if (features.length > 0) {
    parts.push(`${features.length} feature${features.length === 1 ? "" : "s"}`);
  }
  if (experiments.length > 0) {
    parts.push(
      `${experiments.length} experiment${experiments.length === 1 ? "" : "s"}`,
    );
  }
  return parts.join(", ");
}

function DisclosureCaret({ open }: { open: boolean }) {
  return (
    <PiCaretRightFill
      size={12}
      style={{
        flexShrink: 0,
        verticalAlign: "middle",
        marginRight: 2,
        transform: open ? "rotate(90deg)" : undefined,
        transition: "transform 0.1s",
      }}
    />
  );
}

// The dependent features/experiments, grouped with links. Shared by both
// variants when the disclosure is expanded.
function DependentLists({ features, experiments }: Dependents) {
  return (
    <>
      {features.length > 0 && (
        <Box mt="2">
          <Text size="small" weight="semibold" color="text-low">
            Features
          </Text>
          <ul style={ulStyle}>
            {features.map((id) => (
              <li key={id} style={liStyle}>
                <Link href={`/features/${id}`} target="_blank">
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </Box>
      )}
      {experiments.length > 0 && (
        <Box mt="2">
          <Text size="small" weight="semibold" color="text-low">
            Experiments
          </Text>
          <ul style={ulStyle}>
            {experiments.map((exp) => (
              <li key={exp.id} style={liStyle}>
                <Link href={`/experiment/${exp.id}`} target="_blank">
                  {exp.name ?? exp.id}
                </Link>
              </li>
            ))}
          </ul>
        </Box>
      )}
    </>
  );
}

// Non-blocking heads-up shown in edit/publish flows when other features or
// experiments use this feature as a prerequisite. Renders nothing while
// loading or when there are no dependents. The dependents themselves sit
// behind an inline disclosure so the warning stays compact.
//
// - "callout" (default): full warning Callout with a "Show N dependents"
//   toggle. Used in the create / edit / kill-switch modals.
// - "helperText": compact amber helper text with an inline "details" toggle.
//   Used above the Publish button in the review flow, where a full callout
//   would be too heavy.
export default function DependentFeaturesWarning({
  featureId,
  variant = "callout",
}: {
  featureId: string;
  variant?: "callout" | "helperText";
}) {
  const { dependents } = useFeatureDependents(featureId);
  const [expanded, setExpanded] = useState(false);

  const features = dependents?.features ?? [];
  const experiments = dependents?.experiments ?? [];
  const total = features.length + experiments.length;
  if (total === 0) return null;

  const deps = { features, experiments };
  const toggle = () => setExpanded((v) => !v);

  if (variant === "helperText") {
    return (
      <Box mb="2">
        <HelperText status="warning" size="sm">
          <span>
            Prerequisite for{" "}
            <Link
              color="amber"
              size="1"
              weight="medium"
              onClick={toggle}
              aria-expanded={expanded}
            >
              <DisclosureCaret open={expanded} />
              {summarize(deps)}
            </Link>
          </span>
        </HelperText>
        {expanded && (
          <Box ml="4">
            <DependentLists {...deps} />
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Callout status="warning" contentsAs="div" mb="3">
      <Text as="p" mb="0">
        This is a prerequisite, changes may affect{" "}
        <Link
          color="amber"
          size="2"
          weight="medium"
          onClick={toggle}
          aria-expanded={expanded}
        >
          <DisclosureCaret open={expanded} />
          {summarize(deps)}
        </Link>
        .
      </Text>
      {expanded && <DependentLists {...deps} />}
    </Callout>
  );
}
