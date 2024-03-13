import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { FaQuestionCircle } from "react-icons/fa";
import { useUser } from "@front-end/services/UserContext";
import useSDKConnections from "@front-end/hooks/useSDKConnections";
import PremiumTooltip from "@front-end/components/Marketing/PremiumTooltip";
import Toggle from "@front-end/components/Forms/Toggle";
import {
  StickyBucketingToggleWarning,
  StickyBucketingTooltip,
} from "@front-end/components/Features/FallbackAttributeSelector";
import Tooltip from "@front-end/components/Tooltip/Tooltip";
import { ConnectSettingsForm } from "@front-end/pages/settings";

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
          <h4 className="mt-4 mb-2">Sticky Bucketing Settings</h4>
          <div className="appbox py-2 px-3">
            <div className="w-100 mt-2">
              <div className="d-flex">
                <label className="mr-2" htmlFor="toggle-useStickyBucketing">
                  <PremiumTooltip
                    commercialFeature={"sticky-bucketing"}
                    body={<StickyBucketingTooltip />}
                  >
                    Enable Sticky Bucketing <FaQuestionCircle />
                  </PremiumTooltip>
                </label>
                <Toggle
                  id={"toggle-useStickyBucketing"}
                  value={!!watch("useStickyBucketing")}
                  setValue={(value) => {
                    setValue(
                      "useStickyBucketing",
                      hasCommercialFeature("sticky-bucketing") ? value : false
                    );
                  }}
                  disabled={
                    !watch("useStickyBucketing") &&
                    (!hasCommercialFeature("sticky-bucketing") ||
                      !hasSDKWithStickyBucketing)
                  }
                />
              </div>
              {!watch("useStickyBucketing") && (
                <div className="small">
                  <StickyBucketingToggleWarning
                    hasSDKWithStickyBucketing={hasSDKWithStickyBucketing}
                  />
                </div>
              )}
            </div>

            {watch("useStickyBucketing") && (
              <div className="w-100 mt-4">
                <div className="d-flex">
                  <label
                    className="mr-2"
                    htmlFor="toggle-useFallbackAttributes"
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
                      Enable fallback attributes in experiments{" "}
                      <FaQuestionCircle />
                    </Tooltip>
                  </label>
                  <Toggle
                    id="toggle-useFallbackAttributes"
                    value={!!watch("useFallbackAttributes")}
                    setValue={(value) =>
                      setValue("useFallbackAttributes", value)
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </ConnectSettingsForm>
  );
}
