import React from "react";
import { useUser } from "@/services/UserContext";
import { DocLink } from "../DocLink";
import Toggle from "../Forms/Toggle";
import UpgradeMessage from "../Marketing/UpgradeMessage";
import PremiumTooltip from "../Marketing/PremiumTooltip";

type Props = {
  value: boolean;
  setValue: (value: boolean) => void;
  showUpgradeModal: () => void;
  showRequiresChangesWarning?: boolean;
};

export default function EncryptionToggle({
  value,
  setValue,
  showUpgradeModal,
  showRequiresChangesWarning = true,
}: Props) {
  const { hasCommercialFeature } = useUser();

  const hasFeature = hasCommercialFeature("encrypt-features-endpoint");

  return (
    <div className="mt-4">
      <div className="form-group">
        <label htmlFor="encryptSDK">
          <PremiumTooltip commercialFeature="encrypt-features-endpoint">
            Encrypt this endpoint&apos;s response?
          </PremiumTooltip>
        </label>
        <div className="row mb-4">
          <div className="col-md-3 mt-1">
            <Toggle
              id={"encryptSDK"}
              value={!!value}
              setValue={setValue}
              disabled={!hasFeature}
            />
          </div>
          {showRequiresChangesWarning && (
            <div
              className="col-md-9 text-gray text-right pt-2"
              style={{ fontSize: 11 }}
            >
              Requires changes to your implementation.{" "}
              <DocLink docSection="encryptedSDKEndpoints">View docs</DocLink>
            </div>
          )}
        </div>
      </div>
      <UpgradeMessage
        showUpgradeModal={showUpgradeModal}
        commercialFeature="encrypt-features-endpoint"
        upgradeMessage="enable encryption"
      />
    </div>
  );
}
