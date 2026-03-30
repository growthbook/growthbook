import { ExperimentMetricInterface } from "shared/experiments";
import Frame from "@/ui/Frame";
import VariationStatsTable from "@/ui/VariationStatsTable";

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
