import { Flex, Text, Box } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { PiSlidersHorizontal, PiArrowSquareOut } from "react-icons/pi";
import { FactTableInterface } from "back-end/types/fact-table";
import { useUser } from "@/services/UserContext";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { DocLink } from "@/components/DocLink";
import MultiSelectField from "@/components/Forms/MultiSelectField";

interface Props {
  block: DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<MetricExplorerBlockInterface>
  >;
  factTable: FactTableInterface | null;
}

export default function MetricSlicesSection({
  block,
  setBlock,
  factTable,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");
  const availableSlices =
    factTable?.columns?.filter(
      (col) => col.isAutoSliceColumn && !col.deleted,
    ) || [];
  return (
    <Flex
      direction="column"
      height="100%"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        overflow: "hidden",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Collapsible
        trigger={
          <div
            style={{
              paddingLeft: "12px",
              paddingRight: "12px",
              paddingTop: "12px",
              paddingBottom: "12px",
              borderBottom: "1px solid var(--gray-a3)",
            }}
          >
            <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
              <Flex justify="between" align="center">
                <Flex align="center" gap="1">
                  <PiSlidersHorizontal
                    style={{
                      color: "var(--violet-11)",
                    }}
                    size={20}
                  />
                  Metric Slices
                </Flex>
                {/* //MKTODO: Not sure if this should be clearable yet */}
                <Flex align="center" gap="1">
                  {/* <Button
                  variant="ghost"
                  color="red"
                  disabled={
                    block.analysisSettings.numeratorFilters?.length === 0 &&
                    block.analysisSettings.denominatorFilters?.length === 0
                  }
                  onClick={() => {
                    setBlock({
                      ...block,
                      analysisSettings: {
                        ...block.analysisSettings,
                        numeratorFilters: [],
                        denominatorFilters: [],
                      },
                    });
                  }}
                >
                  Clear
                </Button> */}
                  <FaAngleRight className="chevron" />
                </Flex>
              </Flex>
            </Text>
          </div>
        }
        transitionTime={100}
      >
        <Box p="4" height="fit-content">
          <Flex direction="column" gap="4">
            <div>
              <label className="font-weight-bold mb-1">
                <span style={{ opacity: hasMetricSlicesFeature ? 1 : 0.5 }}>
                  Auto Slices
                </span>
                <PaidFeatureBadge
                  commercialFeature="metric-slices"
                  premiumText="Creating and applying auto slices on a dashboard is an Enterprise feature"
                  variant="outline"
                  ml="2"
                />
              </label>
              <Text
                as="p"
                className="mb-2"
                style={{
                  color: "var(--color-text-mid)",
                  opacity: hasMetricSlicesFeature ? 1 : 0.5,
                }}
              >
                Choose metric breakdowns to automatically analyze in your
                experiments.{" "}
                <DocLink docSection="autoSlices">
                  Learn More <PiArrowSquareOut />
                </DocLink>
              </Text>
              <div>
                {availableSlices.length > 0 ? (
                  <MultiSelectField
                    value={block.analysisSettings.metricAutoSlices || []}
                    disabled={!hasMetricSlicesFeature}
                    onChange={(metricAutoSlices) => {
                      setBlock({
                        ...block,
                        analysisSettings: {
                          ...block.analysisSettings,
                          metricAutoSlices,
                        },
                      });
                    }}
                    options={availableSlices.map((col) => ({
                      label: col.name || col.column,
                      value: col.column,
                    }))}
                    placeholder="Select auto slice columns..."
                  />
                ) : (
                  <Text
                    as="span"
                    style={{
                      color: "var(--color-text-low)",
                      fontStyle: "italic",
                    }}
                    size="1"
                  >
                    {hasMetricSlicesFeature
                      ? "No slices available. Configure your fact table to enable auto slices."
                      : "You need to upgrade to the Enterprise plan to use auto slices."}
                  </Text>
                )}
              </div>
            </div>
            <div>
              <label className="font-weight-bold mb-1">
                <span style={{ opacity: hasMetricSlicesFeature ? 1 : 0.5 }}>
                  Custom Slices
                </span>
                <PaidFeatureBadge
                  commercialFeature="metric-slices"
                  premiumText="Creating and applying custom slices on a dashboard is an Enterprise feature"
                  variant="outline"
                  ml="2"
                />
              </label>
              <Text
                as="p"
                className="mb-2"
                style={{
                  color: "var(--color-text-mid)",
                  opacity: hasMetricSlicesFeature ? 1 : 0.5,
                }}
              >
                Define custom slices to power deeper analysis of your metrics.{" "}
                <DocLink docSection="customSlices">
                  Learn More <PiArrowSquareOut />
                </DocLink>
              </Text>
              Custom Slice Builder goes here Make sure to disable it if the user
              doesn't have the feature
            </div>
          </Flex>
        </Box>
      </Collapsible>
    </Flex>
  );
}
