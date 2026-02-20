import React, { FC } from "react";
import dynamic from "next/dynamic";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { PresentationInterface } from "shared/types/presentation";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import useSwitchOrg from "@/services/useSwitchOrg";
import { Props as PresentationProps } from "./Presentation";
const DynamicPresentation = dynamic<PresentationProps>(
  () => import("@/components/Share/Presentation"),
  {
    ssr: false,
    //loading: () => (<p>Loading...</p>) // this causes a lint error
  },
);

const Preview: FC<{
  expIds: string;
  theme: string;
  title: string;
  desc: string;
  backgroundColor: string;
  textColor: string;
  headingFont?: string;
  bodyFont?: string;
  logoUrl?: string;
  celebration?: string;
  transition?: string;
}> = ({
  expIds,
  theme,
  title,
  desc,
  backgroundColor,
  textColor,
  headingFont,
  bodyFont,
  logoUrl,
  celebration = "none",
  transition = "fade",
}) => {
  const { data: pdata, error } = useApi<{
    status: number;
    presentation: PresentationInterface;
    experiments: {
      experiment: ExperimentInterfaceStringDates;
      snapshot?: ExperimentSnapshotInterface;
    }[];
  }>(`/presentation/preview/?expIds=${expIds}`);

  useSwitchOrg(pdata?.presentation?.organization || null);

  if (error) {
    return (
      <div className="alert alert-danger">
        Couldn&apos;t find the presentation. Are you sure it still exists?
      </div>
    );
  }
  if (!pdata) {
    return <LoadingOverlay />;
  }

  return (
    <DynamicPresentation
      key={`preview-${expIds}-${logoUrl ?? ""}-${celebration}-${transition}`}
      experiments={pdata.experiments}
      theme={theme}
      preview={true}
      title={title}
      desc={desc}
      logoUrl={logoUrl}
      celebration={celebration}
      transition={transition}
      customTheme={{
        backgroundColor: "#" + backgroundColor,
        textColor: "#" + textColor,
        headingFont: headingFont,
        bodyFont: bodyFont,
      }}
    />
  );
};
export default Preview;
