import { UseFormReturn } from "react-hook-form";
import { useUser } from "../../services/UserContext";
import { DocLink } from "../DocLink";
import Toggle from "../Forms/Toggle";
import UniversalUpgradeMessage from "../UniversalUpgradeMessage";

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

  if (!hasCommercialFeature("encrypt-features-endpoint")) {
    return (
      <UniversalUpgradeMessage
        showUpgradeModal={showUpgradeModal}
        commercialFeature="encrypt-features-endpoint"
        upgradeMessage="encrypt the response from this SDK endpoint"
      />
    );
  }

  return (
    <div>
      <div className="mb-2 d-flex flex-column">
        <span>
          <label htmlFor="encryptFeatures">
            Encrypt this endpoint&apos;s response?
          </label>
        </span>
        <Toggle
          disabled={!hasCommercialFeature("encrypt-features-endpoint")}
          id={"encryptSDK"}
          value={!!form.watch("encryptSDK")}
          setValue={(value) => {
            form.setValue("encryptSDK", value);
          }}
        />
      </div>
      <div className="alert alert-warning">
        When enabled, you will need to decrypt the feature list before passing
        into our SDKs.{" "}
        <DocLink docSection="encryptedSDKEndpoints">View docs</DocLink> for more
        info and sample code.
      </div>
    </div>
  );
}
