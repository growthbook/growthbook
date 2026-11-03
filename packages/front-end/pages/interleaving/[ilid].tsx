import { useRouter } from "next/router";
import React, { ReactElement } from "react";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { useInterleaving } from "@/hooks/useInterleavings";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import { docUrl } from "@/components/DocLink";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import InterleavingDetailPage from "@/components/Interleaving/InterleavingDetailPage";
import Custom404 from "@/pages/404";

const InterleavingPage = (): ReactElement => {
  const { ilid } = useRouter().query;
  const { organization, hasCommercialFeature } = useUser();
  const gb = useGrowthBook<AppFeatures>();
  const interleavingEnabled = !!gb?.isOn("interleave-exp");
  const { interleaving, loading, mutate } = useInterleaving(
    typeof ilid === "string" ? ilid : undefined,
    { enabled: interleavingEnabled },
  );
  useSwitchOrg(interleaving?.id && organization.id ? organization.id : null);

  if (!interleavingEnabled) {
    return <Custom404 />;
  }
  if (!hasCommercialFeature("interleaving")) {
    return (
      <div className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Interleaving Experiments"
          title="Compare two rankers head-to-head with Interleaving"
          description="Interleaving merges two ranked lists for each user and measures which ranker's items get engagement."
          commercialFeature="interleaving"
          learnMoreLink={docUrl("interleaving")}
        />
      </div>
    );
  }
  if (loading) {
    return <LoadingOverlay />;
  }
  if (!interleaving) {
    return (
      <div className="contents container-fluid pagecontents">
        <Callout status="error" mt="4">
          Interleaving experiment not found.
        </Callout>
      </div>
    );
  }

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Interleaving", href: "/interleavings" },
          { display: interleaving.name },
        ]}
      />
      <div className="contents container-fluid pagecontents">
        <InterleavingDetailPage interleaving={interleaving} mutate={mutate} />
      </div>
    </>
  );
};

export default InterleavingPage;
