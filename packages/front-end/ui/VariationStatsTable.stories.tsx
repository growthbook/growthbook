import { ExperimentMetricInterface } from "shared/experiments";
import Frame from "@/ui/Frame";
import VariationStatsTable from "@/ui/VariationStatsTable";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "VariationStatsTable",
  category: "experimentation",
  status: "stable",
  summary:
    "Table of per-variation metric stats such as value, change, and probability.",
  useWhen: ["Detailing one metric's results across variations."],
  avoidWhen: [
    {
      reason: "A compact summary in a tooltip.",
      use: "AnalysisResultSummary",
    },
  ],
  related: ["AnalysisResultSummary", "VariationLabel"],
};

const metric = {
  id: "m_bin",
  name: "Signup Rate",
  type: "binomial",
  inverse: false,
} as unknown as ExperimentMetricInterface;

export default function VariationStatsTableStories() {
  return (
    <Frame py="2" px="2">
      <VariationStatsTable
        metric={metric}
        rows={[
          {
            variationIndex: 0,
            variationName: "Control",
            stats: {
              value: 1000,
              cr: 1,
              users: 1000,
            },
            isBaseline: true,
          },
          {
            variationIndex: 1,
            variationName: "Variation with missing stats",
            isBaseline: false,
          },
        ]}
      />
    </Frame>
  );
}
