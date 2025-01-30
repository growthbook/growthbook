import React, { FC, useState } from "react";
import { CommercialFeature } from "enterprise";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import LinkButton from "@/components/Radix/LinkButton";
import Button from "@/components/Radix/Button";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useUser } from "@/services/UserContext";

interface Props {
  h1?: string;
  title: string;
  description: string;
  learnMoreLink?: string;
  commercialFeature: CommercialFeature;
  reason: string;
}

const PremiumEmptyState: FC<Props> = ({
  title,
  description,
  h1 = "",
  learnMoreLink,
  commercialFeature,
  reason,
}) => {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const { hasCommercialFeature, commercialFeatureLowestPlan } = useUser();
  const hasFeature = commercialFeature
    ? hasCommercialFeature(commercialFeature)
    : true;

  if (hasFeature) {
    return null;
  }

  const lowestPlanLevel = commercialFeature
    ? commercialFeatureLowestPlan?.[commercialFeature]
    : undefined;
  return (
    <>
      {h1 && (
        <div className="mb-4 mt-3 d-flex align-items-center">
          <h1 className="mb-0">{h1}</h1>{" "}
          <PaidFeatureBadge commercialFeature={commercialFeature} />
        </div>
      )}
      <div className="mb-5">
        <div className="mb-3">
          <div className="appbox p-5 text-center">
            <div className="py-2">
              <h2>{title}</h2>
              <p>{description}</p>
              <div className="mt-4">
                {learnMoreLink && (
                  <div className="mr-4 d-inline-block">
                    <LinkButton
                      href={learnMoreLink}
                      variant="outline"
                      external={true}
                    >
                      Learn more
                    </LinkButton>
                  </div>
                )}
                <Button
                  onClick={() => {
                    setUpgradeModal(true);
                  }}
                >
                  Upgrade to{" "}
                  {lowestPlanLevel === "enterprise"
                    ? "Enterprise"
                    : lowestPlanLevel === "pro"
                    ? "Pro"
                    : "access"}
                </Button>
              </div>
            </div>
          </div>
          {upgradeModal && (
            <UpgradeModal
              close={() => setUpgradeModal(false)}
              reason={reason}
              source={commercialFeature}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default PremiumEmptyState;
