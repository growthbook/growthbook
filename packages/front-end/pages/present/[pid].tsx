import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PresentationInterface } from "shared/types/presentation";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import useSwitchOrg from "@/services/useSwitchOrg";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import { defaultTheme } from "@/components/Share/ShareModal";

const DynamicPresentation = dynamic(
  () => import("@/components/Share/Presentation"),
  {
    ssr: false,
  },
);

const PresentPage = (): React.ReactElement => {
  const router = useRouter();
  const { pid, slide: slideParam } = router.query;
  const { hasCommercialFeature } = useUser();
  const hasPresentationStyling = hasCommercialFeature("presentation-styling");

  const initialSlideIndex = useMemo(() => {
    if (slideParam === undefined || Array.isArray(slideParam)) return 0;
    const n = parseInt(slideParam, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  }, [slideParam]);

  const { data: pdata, error } = useApi<{
    status: number;
    presentation: PresentationInterface;
    experiments: {
      experiment: ExperimentInterfaceStringDates;
      snapshot?: ExperimentSnapshotInterface;
    }[];
  }>(`/presentation/${pid}`);
  useSwitchOrg(pdata?.presentation?.organization || null);

  const handleSlideChange = (slideIndex: number) => {
    const pid = router.query.pid;
    if (typeof pid !== "string") return;
    router.replace(
      { pathname: `/present/${pid}`, query: { slide: slideIndex } },
      undefined,
      { shallow: true },
    );
  };

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!pdata) {
    return <LoadingOverlay />;
  }
  if (pdata.status !== 200) {
    return <div>Sorry, presentation not found</div>;
  }

  const presentation: PresentationInterface = hasPresentationStyling
    ? pdata.presentation
    : {
        ...pdata.presentation,
        theme:
          pdata.presentation.theme === "custom"
            ? defaultTheme
            : pdata.presentation.theme,
        transition: undefined,
        celebration: undefined,
        customTheme: undefined,
      };

  return (
    <div
      style={{
        minHeight: "100vh",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <DynamicPresentation
        presentation={presentation}
        experiments={pdata.experiments}
        initialSlideIndex={initialSlideIndex}
        onSlideChange={handleSlideChange}
      />
    </div>
  );
};
export default PresentPage;
