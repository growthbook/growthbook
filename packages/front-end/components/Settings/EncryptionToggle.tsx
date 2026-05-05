import React from "react";
import { FaExclamationCircle, FaInfoCircle } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import { DocLink } from "@/components/DocLink";
import Switch from "@/ui/Switch";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

type Props = {
  value: boolean;
  setValue: (value: boolean) => void;
  showUpgradeModal: () => void;
  showRequiresChangesWarning?: boolean;
  showUpgradeMessage?: boolean;
};

export default function EncryptionToggle({
  value,
  setValue,
  showUpgradeModal,
  showRequiresChangesWarning = true,
  showUpgradeMessage = true,
}: Props) {
  const { hasCommercialFeature } = useUser();

  const hasFeature = hasCommercialFeature("encrypt-features-endpoint");

  return (
    <div className="mt-4">
      <div className="form-group">
        <label htmlFor="encryptSDK">
          <PremiumTooltip
            commercialFeature="encrypt-features-endpoint"
            body={
              <>
                <p>
                  Feature payloads will be encrypted via the AES encryption
                  algorithm. When evaluating feature flags in a public or
                  insecure environment (such as a browser), encryption provides
                  an additional layer of security through obfuscation. This
                  allows you to target users based on sensitive attributes.
                </p>
                <p className="mb-0 text-warning-orange small">
                  <FaExclamationCircle /> When using an insecure environment, do
                  not rely exclusively on payload encryption as a means of
                  securing highly sensitive data. Because the client performs
                  the decryption, the unencrypted payload may be extracted with
                  sufficient effort.
                </p>
              </>
            }
          >
            Encrypt this endpoint&apos;s response? <FaInfoCircle />
          </PremiumTooltip>
        </label>
        <div className="row mb-4">
          <div className="col-md-3">
            <Switch
              id={"encryptSDK"}
              value={!!value}
              onChange={setValue}
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
      {showUpgradeMessage && (
        <UpgradeMessage
          showUpgradeModal={showUpgradeModal}
          commercialFeature="encrypt-features-endpoint"
          upgradeMessage="enable encryption"
        />
      )}
    </div>
  );
}
