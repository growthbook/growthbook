import { UseFormReturn } from "react-hook-form";
import { useUser } from "../../services/UserContext";
import { DocLink } from "../DocLink";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip/Tooltip";
import UpgradeMessage from "../UpgradeMessage";
import { GBPremiumBadge } from "../Icons";

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
          <p className="mb-0">
            <Tooltip
              shouldDisplay={!hasFeature}
              body={
                <>
                  <GBPremiumBadge />
                  This is a premium feature
                </>
              }
              tipPosition="top"
              innerClassName="premium"
            >
              <GBPremiumBadge shouldDisplay={!hasFeature} />
              Encrypt this endpoint&apos;s response?
            </Tooltip>
          </p>
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
            className="col-md-9 text-gray text-right"
            style={{ fontSize: 11 }}
          >
            Only supported when using our Javascript or React SDKs.
            <br />
            Requires changes to your implementation.{" "}
            <DocLink docSection="encryptedSDKEndpoints">View docs</DocLink>
          </div>
        </div>
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
