import { useRouter } from "next/router";
import React, { ReactElement } from "react";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { isInterleavingEnabled } from "@/services/interleaving";
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
  const { t } = useLingui();
  const { ilid } = useRouter().query;
  const { organization, hasCommercialFeature } = useUser();
  const gb = useGrowthBook();
  const interleavingEnabled = isInterleavingEnabled(gb);
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
          h1={t`Interleaving Experiments`}
          title={t`Compare two rankers head-to-head with Interleaving`}
          description={t`Interleaving merges two ranked lists for each user and measures which ranker's items get engagement.`}
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
          <Trans>Interleaving experiment not found.</Trans>
        </Callout>
      </div>
    );
  }

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: t`Interleaving`, href: "/interleavings" },
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
