import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { FaQuestionCircle } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import useSDKConnections from "@/hooks/useSDKConnections";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Toggle from "@/components/Forms/Toggle";
import {
  StickyBucketingToggleWarning,
  StickyBucketingTooltip,
} from "@/components/Features/FallbackAttributeSelector";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ConnectSettingsForm } from "@/pages/settings";

export default function StickyBucketingSettings() {
  const { hasCommercialFeature } = useUser();
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithStickyBucketing = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
  }).includes("stickyBucketing");

  // 定义一个变量来控制是否显示粘性分桶设置区域，这里设置为false表示不显示
  const shouldShowStickyBucketingSettings = false;

  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => (
        <>
          {shouldShowStickyBucketingSettings && (
            <div>
              <h4 className="mt-4 mb-2">粘性分桶设置</h4>
              <div className="appbox py-2 px-3">
                <div className="w-100 mt-2">
                  <div className="d-flex">
                    <label className="mr-2" htmlFor="toggle-useStickyBucketing">
                      <PremiumTooltip
                        commercialFeature={"sticky-bucketing"}
                        body={<StickyBucketingTooltip />}
                      >
                        启用粘性分桶 <FaQuestionCircle />
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
                                如果用户的分配属性不可用，则可以使用回退属性来替代。切换此选项可在创建实验时允许选择回退属性。
                              </div>
                              <div>
                                虽然使用回退属性可以提高用户体验的一致性，但如果实施不当，也可能导致统计偏差。如需更多信息，请参阅粘性分桶文档。
                              </div>
                            </>
                          }
                        >
                          启用实验中的回退属性{" "}
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
            </div>
          )}
        </>
      )}
    </ConnectSettingsForm>
  );
}