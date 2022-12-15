import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { PresentationInterface } from "back-end/types/presentation";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import useSwitchOrg from "@/services/useSwitchOrg";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
const DynamicPresentation = dynamic(
  () => import("../../components/Share/Presentation"),
  {
    ssr: false,
    //loading: () => (<p>Loading...</p>) // this causes a lint error
  }
);

const PresentPage = (): React.ReactElement => {
  const router = useRouter();
  const { pid } = router.query;
  const { data: pdata, error } = useApi<{
    status: number;
    presentation: PresentationInterface;
    experiments: {
      experiment: ExperimentInterfaceStringDates;
      snapshot?: ExperimentSnapshotInterface;
    }[];
  }>(`/presentation/${pid}`);

  useSwitchOrg(pdata?.presentation?.organization);

  if (error) {
    return <div className="alert alert-danger">An error occurred</div>;
  }
  if (!pdata) {
    return <LoadingOverlay />;
  }
  if (pdata.status !== 200) {
    return <div>Sorry, presentation not found</div>;
  }

  return (
    <DynamicPresentation
      presentation={pdata.presentation}
      experiments={pdata.experiments}
    />
  );
};
export default PresentPage;
