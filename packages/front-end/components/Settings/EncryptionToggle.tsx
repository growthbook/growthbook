import { UseFormReturn } from "react-hook-form";
import { useUser } from "../../services/UserContext";
import { DocLink } from "../DocLink";
import Toggle from "../Forms/Toggle";
import UpgradeMessage from "../Marketing/UpgradeMessage";
import PremiumTooltip from "../Marketing/PremiumTooltip";

type FormKeys = {
  description: string;
  environment: string;
  encryptSDK: boolean;
};

type Props = {
  form: UseFormReturn<FormKeys>;
  showUpgradeModal: () => void;
};

export default function EncryptionToggle({ form, showUpgradeModal }: Props) {
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
              value={!!form.watch("encryptSDK")}
              setValue={(value) => {
                form.setValue("encryptSDK", value);
              }}
              disabled={!hasFeature}
            />
          </div>
          <div
            className="col-md-9 text-gray text-right pt-2"
            style={{ fontSize: 11 }}
          >
            May require changes to your implementation.{" "}
            <DocLink docSection="encryptedSDKEndpoints">View docs</DocLink>
          </div>
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
