import { useRouter } from "next/router";
import React, { ReactElement } from "react";
import { useInterleaving } from "@/hooks/useInterleavings";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import InterleavingDetailPage from "@/components/Interleaving/InterleavingDetailPage";

const InterleavingPage = (): ReactElement => {
  const { ilid } = useRouter().query;
  const { organization, hasCommercialFeature } = useUser();
  const { interleaving, loading, mutate } = useInterleaving(
    typeof ilid === "string" ? ilid : undefined,
  );
  useSwitchOrg(interleaving?.id && organization.id ? organization.id : null);

  if (!hasCommercialFeature("interleaving")) {
    return (
      <div className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Interleaving Experiments"
          title="Compare two rankers head-to-head with Interleaving"
          description="Interleaving merges two ranked lists for each user and measures which ranker's items get engagement."
          commercialFeature="interleaving"
          learnMoreLink="https://docs.growthbook.io"
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
