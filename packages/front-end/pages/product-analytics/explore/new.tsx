import React from "react";
import ExploreWorkspace from "@/enterprise/components/ProductAnalytics/ExploreWorkspace";
import { useUser } from "@/services/UserContext";
import PremiumCallout from "@/ui/PremiumCallout";

export default function NewExplorePage() {
  const { hasCommercialFeature } = useUser();

  // if (!hasCommercialFeature("product-analytics-dashboards")) {
  //   return (
  //     <div className="p-3 container-fluid pagecontents">
  //       <PremiumCallout
  //         id="product-analytics-explore"
  //         dismissable={false}
  //         commercialFeature="product-analytics-dashboards"
  //       >
  //         Use of Product Analytics Explore requires a paid plan
  //       </PremiumCallout>
  //     </div>
  //   );
  // }

  return <ExploreWorkspace />;
}
