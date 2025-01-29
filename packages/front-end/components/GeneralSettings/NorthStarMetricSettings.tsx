import { Box, Flex, Heading } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import { ConnectSettingsForm } from "@/pages/settings";

export default function NorthStarMetricSettings() {
  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => (
        <Box mb="4" className="appbox">
          <Flex gap="4" p="5">
            <Box width="220px" flexShrink="0">
              <Heading size="4" as="h4">
                North Star Metrics
              </Heading>
            </Box>

            <Flex align="start" direction="column" flexGrow="1" pt="2">
              <p>
                North stars are metrics your team is focused on improving. These
                metrics are shown on the home page with the experiments that
                have the metric as a goal.
              </p>
              <Box className={"form-group"} width="100%">
                <div className="my-3">
                  <div className="form-group">
                    <label>Metric(s)</label>
                    <MetricsSelector
                      selected={watch("northStar.metricIds")}
                      onChange={(metricIds) =>
                        setValue("northStar.metricIds", metricIds)
                      }
                      includeFacts={true}
                      includeGroups={false}
                      excludeQuantiles={true}
                    />
                  </div>
                  <Field
                    label="Title"
                    value={watch("northStar.title")}
                    onChange={(e) => {
                      setValue("northStar.title", e.target.value);
                    }}
                  />
                </div>
              </Box>
            </Flex>
          </Flex>
        </Box>
      )}
    </ConnectSettingsForm>
  );
}
