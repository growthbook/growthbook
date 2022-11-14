import { UseFormReturn } from "react-hook-form";
import { useUser } from "../../services/UserContext";
import { DocLink } from "../DocLink";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip/Tooltip";
import UpgradeMessage from "../UpgradeMessage";

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
    <div className="bg-light px-3 pt-3 appbox mt-2">
      <div className="form-group">
        <label htmlFor="encryptSDK">
          Encrypt this endpoint&apos;s response?
        </label>
        <div>
          <Tooltip body={!hasFeature && "Upgrade to enable this feature"}>
            <Toggle
              id={"encryptSDK"}
              value={!!form.watch("encryptSDK")}
              setValue={(value) => {
                form.setValue("encryptSDK", value);
              }}
              disabled={!hasFeature}
            />
          </Tooltip>
        </div>
      </div>
      <div className="mb-3">
        Only supported when using our Javascript or React SDKs. Requires changes
        to your implementation.{" "}
        <DocLink docSection="encryptedSDKEndpoints">View docs</DocLink>
      </div>
      {!hasFeature && (
        <UpgradeMessage
          showUpgradeModal={showUpgradeModal}
          commercialFeature="encrypt-features-endpoint"
          upgradeMessage="enable encryption"
        />
      )}
    </div>
  );
}
