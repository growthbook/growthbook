import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { Box } from "@radix-ui/themes";
import { useFormContext } from "react-hook-form";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { StickyBucketingTooltip } from "@/components/Features/FallbackAttributeSelector";
import { DocLink } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";
import Checkbox from "@/ui/Checkbox";
import { GBInfo } from "@/components/Icons";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import { UnsavedMark } from "@/components/GeneralSettings/SettingsGroup";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";

export default function StickyBucketingSettings() {
  const { hasCommercialFeature } = useUser();
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithStickyBucketing = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
  }).includes("stickyBucketing");

  const { watch, setValue } =
    useFormContext<OrganizationSettingsWithMetricDefaults>();
  return (
    <>
      <>
        <UnsavedMark name="useStickyBucketing">
          <Checkbox
            id="toggle-useStickyBucketing"
            label={
              <PremiumTooltip
                commercialFeature={"sticky-bucketing"}
                body={<StickyBucketingTooltip />}
              >
                Enable sticky bucketing <GBInfo />
              </PremiumTooltip>
            }
            description="Users stay in the first variation they're assigned, even if targeting changes."
            disabled={
              !watch("useStickyBucketing") &&
              (!hasCommercialFeature("sticky-bucketing") ||
                !hasSDKWithStickyBucketing)
            }
            value={!!watch("useStickyBucketing")}
            setValue={(v) =>
              setValue(
                "useStickyBucketing",
                hasCommercialFeature("sticky-bucketing") ? v : false,
              )
            }
          />
        </UnsavedMark>

        {watch("useStickyBucketing") && (
          <Box pl="5">
            <UnsavedMark name="stickyBucketingOnByDefault">
              <Checkbox
                id="toggle-stickyBucketingOnByDefault"
                label="On by default for new experiments"
                description="Can still be turned off per experiment."
                value={!!watch("stickyBucketingOnByDefault")}
                setValue={(v) => setValue("stickyBucketingOnByDefault", v)}
                mb="3"
              />
            </UnsavedMark>
            <UnsavedMark name="useFallbackAttributes">
              <Checkbox
                id="toggle-useFallbackAttributes"
                label={
                  <Tooltip
                    body={
                      <>
                        <div className="mb-2">
                          If the user&apos;s assignment attribute is not
                          available a fallback attribute may be used instead.
                          Toggle this to allow selection of a fallback attribute
                          when creating experiments.
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
                    Fallback attributes <GBInfo />
                  </Tooltip>
                }
                description="Allow experiments to set a fallback attribute for sticky bucketing."
                value={!!watch("useFallbackAttributes")}
                setValue={(v) => setValue("useFallbackAttributes", v)}
              />
            </UnsavedMark>
          </Box>
        )}

        <SDKCapabilityWarning
          as="helperText"
          size="medium"
          status="info"
          capability="stickyBucketing"
          popoverTriggerText="Show incompatible SDKs"
          someMessage={
            <>
              Make sure Sticky Bucketing is correctly integrated with your SDK.{" "}
              <DocLink
                useRadix={false}
                docSection="stickyBucketing"
                className="underline"
              >
                See docs
              </DocLink>
            </>
          }
          noneMessage="None of your SDK Connections support Sticky Bucketing."
        />
      </>
    </>
  );
}
