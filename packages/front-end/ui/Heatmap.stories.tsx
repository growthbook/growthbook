import { Flex, Text } from "@radix-ui/themes";
import Badge from "./Badge";
import Heatmap, {
  HeatmapColorScale,
  HeatmapColumn,
  HeatmapRow,
} from "./Heatmap";

const variationColumns: HeatmapColumn[] = [
  { key: "control", header: "Control" },
  { key: "v1", header: "Variation 1" },
  { key: "v2", header: "Variation 2" },
  { key: "v3", header: "Variation 3" },
  { key: "v4", header: "Variation 4" },
];

function makeRows(): HeatmapRow[] {
  const data: { label: string; values: number[]; units: number }[] = [
    {
      label: "country is any of (US, CA, MX)",
      values: [0.25, 0.1, 0.04, 0.03, 0.12],
      units: 1204,
    },
    {
      label: "country is any of (US) AND browser is chrome",
      values: [0.25, 0.1, 0.16, 0.14, 0.1],
      units: 980,
    },
    {
      label: "country is any of (GB, DE)",
      values: [0.25, 0.1, 0.34, 0.4, 0.12],
      units: 1530,
    },
    {
      label: "browser is safari",
      values: [0.41, 0.1, 0.44, 0.2, 0.12],
      units: 720,
    },
    {
      label: "device is mobile",
      values: [0.25, 0.1, 0.09, 0.2, 0.42],
      units: 311,
    },
  ];
  return data.map((row, i) => ({
    key: `row-${i}`,
    label: (
      <Flex gap="2" align="center" wrap="wrap">
        <Text size="2" weight="medium">
          IF
        </Text>
        <Badge color="gray" label={row.label} />
      </Flex>
    ),
    leading: [`${row.units.toLocaleString()} units`],
    cells: row.values.map((value) => ({ value })),
  }));
}

export default function HeatmapStories() {
  const rows = makeRows();
  const scales: HeatmapColorScale[] = ["indigo", "violet", "blue", "teal"];

  return (
    <Flex direction="column" gap="6">
      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Default (indigo, row-normalized) with a leading Units column
        </Text>
        <Heatmap
          labelHeader="Context"
          leadingColumns={[{ key: "units", header: "Units" }]}
          columns={variationColumns}
          rows={rows}
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Global normalization (intensity compared across the whole grid)
        </Text>
        <Heatmap
          labelHeader="Context"
          columns={variationColumns}
          rows={rows}
          normalize="all"
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Color scales
        </Text>
        {scales.map((scale) => (
          <Flex key={scale} direction="column" gap="1">
            <Text size="1" style={{ color: "var(--gray-9)" }}>
              {scale}
            </Text>
            <Heatmap
              labelHeader="Context"
              columns={variationColumns.slice(0, 4)}
              rows={rows.map((r) => ({ ...r, cells: r.cells.slice(0, 4) }))}
              colorScale={scale}
            />
          </Flex>
        ))}
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="bold">
          Counts (custom formatter) with null cells
        </Text>
        <Heatmap
          labelHeader="Context"
          columns={variationColumns.slice(0, 3)}
          rows={[
            {
              key: "a",
              label: <Text size="2">browser is chrome</Text>,
              cells: [{ value: 1204 }, { value: 980 }, { value: null }],
            },
            {
              key: "b",
              label: <Text size="2">browser is safari</Text>,
              cells: [{ value: 311 }, { value: 720 }, { value: 540 }],
            },
          ]}
          formatValue={(v) => v.toLocaleString()}
        />
      </Flex>
    </Flex>
  );
}
