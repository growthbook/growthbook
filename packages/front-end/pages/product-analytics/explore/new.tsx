import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import { useUser } from "@/services/UserContext";
import PremiumCallout from "@/ui/PremiumCallout";

export default function NewExplorePage() {
  const { hasCommercialFeature } = useUser();

  // TODO: Re-enable this
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

  return (
    <Box className="position-relative" style={{ padding: "8px" }}>
      <Box width="100%">
        <Explorer />
      </Box>
    </Box>
  );
}
