import React from "react";
import dynamic from "next/dynamic";
import useApi from "../../hooks/useApi";
import { useRouter } from "next/router";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { PresentationInterface } from "back-end/types/presentation";
import useSwitchOrg from "../../services/useSwitchOrg";
//import { LearningInterface } from "back-end/types/insight";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
const DynamicPresentation = dynamic(
  () => import("../../components/Share/Presentation"),
  {
    ssr: false,
    //loading: () => (<p>Loading...</p>) // this causes a lint error
  }
);

const PresentPage = (): React.ReactElement => {
  const router = useRouter();
  const {
    expIds,
    theme,
    title,
    desc,
    backgroundcolor,
    textcolor,
  } = router.query as {
    expIds: string;
    theme: string;
    title: string;
    desc: string;
    backgroundcolor: string;
    textcolor: string;
  };
  const { data: pdata, error } = useApi<{
    status: number;
    presentation: PresentationInterface;
    //learnings: LearningInterface[];
    experiments: {
      experiment: ExperimentInterfaceStringDates;
      snapshot?: ExperimentSnapshotInterface;
    }[];
  }>(`/presentation/preview/?expIds=${expIds}`);

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
    <>
      <DynamicPresentation
        experiments={pdata.experiments}
        theme={theme}
        title={title}
        desc={desc}
        customTheme={{
          backgroundColor: "#" + backgroundcolor,
          textColor: "#" + textcolor,
        }}
        //learnings={pdata.learnings}
      />
    </>
  );
};
export default PresentPage;
