import React from "react";
import commercialFeatures from "../data/commercialFeatures";

type FeatureKey = keyof typeof commercialFeatures;

type Props = {
  feature: FeatureKey;
  description?: string;
};

export default function CommercialFeature({ feature, description }: Props) {
  const { plan, displayName } = commercialFeatures[feature];
  const isEnterprise = plan === "enterprise";

  const defaultDescription = isEnterprise
    ? "is available on Enterprise plans."
    : "is available on Pro and Enterprise plans.";

  const planLabel = isEnterprise ? "Enterprise" : "Pro";

  return (
    <p className={`commercial-feature commercial-feature--${plan}`} role="note">
      <span
        className={`commercial-feature-badge commercial-feature-badge--${plan}`}
      >
        {planLabel}
      </span>
      <span className="commercial-feature-text">
        <strong>{displayName}</strong> {defaultDescription} {description}
      </span>
    </p>
  );
}
