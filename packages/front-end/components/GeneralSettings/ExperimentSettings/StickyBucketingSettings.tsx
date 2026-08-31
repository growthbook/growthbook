import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { StickyBucketingTooltip } from "@/components/Features/FallbackAttributeSelector";
import { DocLink } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ConnectSettingsForm } from "@/pages/settings";
import Checkbox from "@/ui/Checkbox";
import { GBInfo } from "@/components/Icons";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";

export default function StickyBucketingSettings() {
  const { hasCommercialFeature } = useUser();
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithStickyBucketing = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
  }).includes("stickyBucketing");

  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => (
        <>
          <Heading mb="4" as="h3" size="3">
            Sticky Bucketing Settings
          </Heading>

          <Flex align="start" gap="3">
            <Checkbox
              disabled={
                !watch("useStickyBucketing") &&
                (!hasCommercialFeature("sticky-bucketing") ||
                  !hasSDKWithStickyBucketing)
              }
              value={watch("useStickyBucketing")}
              setValue={(v) =>
                setValue(
                  "useStickyBucketing",
                  hasCommercialFeature("sticky-bucketing") ? v : false,
                )
              }
              id="toggle-useStickyBucketing"
            />
            <Box>
              <label
                htmlFor="toggle-useStickyBucketing"
                className="font-weight-semibold"
              >
                <PremiumTooltip
                  commercialFeature={"sticky-bucketing"}
                  body={<StickyBucketingTooltip />}
                >
                  Enable Sticky Bucketing <GBInfo />
                </PremiumTooltip>
              </label>
              <p>
                Prevent users from flipping between variations. (Persists the
                first variation each user is exposed to)
              </p>
            </Box>
          </Flex>

          {watch("useStickyBucketing") && (
            <Flex direction="column" gap="3" mt="3" ml="6">
              <Flex align="start" gap="3">
                <Checkbox
                  value={watch("stickyBucketingOnByDefault")}
                  setValue={(v) => setValue("stickyBucketingOnByDefault", v)}
                  id="toggle-stickyBucketingOnByDefault"
                />
                <Box>
                  <label
                    htmlFor="toggle-stickyBucketingOnByDefault"
                    className="font-weight-semibold"
                  >
                    Enable by default for new Experiments
                  </label>
                  <p>
                    When enabled, new Experiments start with Sticky Bucketing
                    on. You can still turn it off for individual Experiments.
                  </p>
                </Box>
              </Flex>

              <Flex align="start" gap="3">
                <Checkbox
                  value={watch("useFallbackAttributes")}
                  setValue={(v) => setValue("useFallbackAttributes", v)}
                  id="toggle-useFallbackAttributes"
                />
                <Box>
                  <label
                    htmlFor="toggle-useFallbackAttributes"
                    className="font-weight-semibold"
                  >
                    <Tooltip
                      body={
                        <>
                          <div className="mb-2">
                            If the user&apos;s assignment attribute is not
                            available a fallback attribute may be used instead.
                            Toggle this to allow selection of a fallback
                            attribute when creating experiments.
                          </div>
                          <div>
                            While using a fallback attribute can improve the
                            consistency of the user experience, it can also lead
                            to statistical biases if not implemented carefully.
                            See the Sticky Bucketing docs for more information.
                          </div>
                        </>
                      }
                    >
                      Enable fallback attributes in Experiments <GBInfo />
                    </Tooltip>
                  </label>
                </Box>
              </Flex>
            </Flex>
          )}

          <SDKCapabilityWarning
            as="helperText"
            size="medium"
            status="info"
            capability="stickyBucketing"
            popoverTriggerText="Show incompatible SDKs"
            someMessage={
              <>
                Ensure that Sticky Bucketing is correctly integrated (
                <DocLink
                  useRadix={false}
                  docSection="stickyBucketing"
                  className="underline"
                >
                  see docs
                </DocLink>
                ) with your SDK.
              </>
            }
            noneMessage="None of your SDK Connections support Sticky Bucketing."
            mt="3"
          />
        </>
      )}
    </ConnectSettingsForm>
  );
}
