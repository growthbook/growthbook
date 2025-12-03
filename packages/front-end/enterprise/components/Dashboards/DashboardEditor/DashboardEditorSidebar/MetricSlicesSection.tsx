import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Flex, Text, Box, Separator } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { CustomMetricSlice } from "back-end/src/validators/experiments";
import { FactTableInterface } from "back-end/types/fact-table";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { PiChartPieSlice, PiArrowSquareOut } from "react-icons/pi";
import { MAX_METRICS_IN_METRIC_ANALYSIS_QUERY } from "shared/constants";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import { DocLink } from "@/components/DocLink";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { RadixStatusIcon, getRadixColor } from "@/ui/HelperText";
import PremiumCallout from "@/ui/PremiumCallout";
import MetricExplorerMetricSliceSelector from "./MetricExplorerMetricSliceSelector";

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
  const [showMaxSlicesWarning, setShowMaxSlicesWarning] = useState(false);
  const { hasCommercialFeature } = useUser();
  const hasMetricSlicesFeature = hasCommercialFeature("metric-slices");
  const availableSlices = useMemo(() => {
    return (
      factTable?.columns?.filter(
        (col) => col.isAutoSliceColumn && !col.deleted,
      ) || []
    );
  }, [factTable]);

  useEffect(() => {
    // We start at 1 b/c the main metric is considered a slice
    let numOfSlices = 1;

    if (
      block.analysisSettings?.metricAutoSlices?.length &&
      block.analysisSettings.metricAutoSlices.length > 0
    ) {
      block.analysisSettings.metricAutoSlices.forEach((autoSlice) => {
        const numOfSliceVariants =
          availableSlices.find((slice) => slice.column === autoSlice)
            ?.autoSlices?.length || 0;
        numOfSlices += numOfSliceVariants;
      });
    }
    if (
      block.analysisSettings?.customMetricSlices?.length &&
      block.analysisSettings.customMetricSlices.length > 0
    ) {
      numOfSlices += block.analysisSettings.customMetricSlices.length;
    }

    if (numOfSlices > MAX_METRICS_IN_METRIC_ANALYSIS_QUERY) {
      setShowMaxSlicesWarning(true);
    } else {
      setShowMaxSlicesWarning(false);
    }
  }, [
    availableSlices,
    block.analysisSettings?.customMetricSlices,
    block.analysisSettings.metricAutoSlices,
  ]);

  const hasAnySlices = useMemo(() => {
    if (
      !block.analysisSettings?.metricAutoSlices ||
      !block.analysisSettings?.customMetricSlices
    ) {
      return false;
    }
    return (
      block.analysisSettings.metricAutoSlices.length > 0 ||
      block.analysisSettings.customMetricSlices.length > 0
    );
  }, [
    block.analysisSettings?.metricAutoSlices,
    block.analysisSettings?.customMetricSlices,
  ]);

  const setCustomMetricSlices = useCallback(
    (slices: CustomMetricSlice[]) => {
      setBlock({
        ...block,
        analysisSettings: {
          ...block.analysisSettings,
          customMetricSlices: slices,
        } as typeof block.analysisSettings & {
          customMetricSlices?: CustomMetricSlice[];
        },
      });
    },
    [block, setBlock],
  );

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
                  <PiChartPieSlice
                    style={{
                      color: "var(--violet-11)",
                    }}
                    size={20}
                  />
                  Metric Slices
                  <Badge
                    label={
                      (
                        (block.analysisSettings.metricAutoSlices?.length || 0) +
                        (block.analysisSettings.customMetricSlices?.length || 0)
                      ).toString() || "0"
                    }
                    color="violet"
                    radius="full"
                    variant="soft"
                  />
                </Flex>
                <Flex align="center" gap="1">
                  {showMaxSlicesWarning ? (
                    <Text color={getRadixColor("warning")}>
                      <RadixStatusIcon status="warning" size="md" />
                    </Text>
                  ) : null}
                  <Button
                    variant="ghost"
                    color="red"
                    disabled={!hasAnySlices}
                    onClick={() => {
                      setBlock({
                        ...block,
                        analysisSettings: {
                          ...block.analysisSettings,
                          metricAutoSlices: [],
                          customMetricSlices: [],
                        },
                      });
                    }}
                  >
                    Clear
                  </Button>
                  <FaAngleRight className="chevron" />
                </Flex>
              </Flex>
            </Text>
          </div>
        }
        transitionTime={100}
      >
        <Box p="4" height="fit-content">
          <>
            {showMaxSlicesWarning && (
              <Callout status="warning" mb="2">
                You have exceeded the maximum number of slices allowed (
                {MAX_METRICS_IN_METRIC_ANALYSIS_QUERY}). Any slices beyond the
                limit will not be analyzed.
              </Callout>
            )}
            {!hasMetricSlicesFeature ? (
              <PremiumCallout
                commercialFeature="metric-slices"
                id="metric-explorer-metric-slices-promo"
              >
                Metric slices allow you to easily split your metrics during
                analysis.{" "}
                <DocLink docSection="metricSlices">
                  Learn More <PiArrowSquareOut />
                </DocLink>
              </PremiumCallout>
            ) : !availableSlices.length ? (
              <Text
                as="span"
                style={{
                  color: "var(--color-text-low)",
                  fontStyle: "italic",
                }}
                size="1"
              >
                There are no slices defined on the fact table this metric is
                built on. Update the fact table to enable auto slices.{" "}
                <DocLink docSection="autoSlices">
                  Learn More <PiArrowSquareOut />
                </DocLink>
              </Text>
            ) : (
              <Flex direction="column" gap="4">
                <div>
                  <label className="font-weight-bold mb-1">Auto Slices</label>
                  <Text
                    as="p"
                    className="mb-2"
                    style={{
                      color: "var(--color-text-mid)",
                      opacity: hasMetricSlicesFeature ? 1 : 0.5,
                    }}
                  >
                    Select metric slices to automatically analyze in your
                    dashboard.{" "}
                    <DocLink docSection="autoSlices">
                      Learn More <PiArrowSquareOut />
                    </DocLink>
                  </Text>
                  <div>
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
                  </div>
                </div>
                <Separator size="4" my="2" />
                <div>
                  <label className="font-weight-bold mb-1">Custom Slices</label>
                  <Text
                    as="p"
                    className="mb-2"
                    style={{
                      color: "var(--color-text-mid)",
                      opacity: hasMetricSlicesFeature ? 1 : 0.5,
                    }}
                  >
                    Create custom combinations of auto slices to power deeper
                    analysis of your metrics.{" "}
                    <DocLink docSection="customSlices">
                      Learn More <PiArrowSquareOut />
                    </DocLink>
                  </Text>
                  <MetricExplorerMetricSliceSelector
                    factMetricId={block.factMetricId}
                    customMetricSlices={
                      (
                        block.analysisSettings as typeof block.analysisSettings & {
                          customMetricSlices?: CustomMetricSlice[];
                        }
                      ).customMetricSlices || []
                    }
                    setCustomMetricSlices={setCustomMetricSlices}
                    disabled={!hasMetricSlicesFeature}
                  />
                </div>
              </Flex>
            )}
          </>
        </Box>
      </Collapsible>
    </Flex>
  );
}
