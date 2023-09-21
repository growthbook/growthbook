import React, { FC, useMemo, useState } from "react";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { FeatureInterface } from "back-end/types/feature";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useRouter } from "next/router";
import useApi from "@/hooks/useApi";

type FeatureRevisionDropDownV2Props = {
  revisions: FeatureRevisionInterface[];
};

export const FeatureRevisionDropDownV2: FC<FeatureRevisionDropDownV2Props> = ({
  revisions,
}) => {
  return (
    <div>
      <h1>FeatureRevisionDropDownV2</h1>

      <pre>{JSON.stringify(revisions, null, 2)}</pre>
    </div>
  );
};

export const FeatureRevisionDropDownV2Container = () => {
  const router = useRouter();
  const { fid } = router.query;

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
    experiments: { [key: string]: ExperimentInterfaceStringDates };
    revisions: FeatureRevisionInterface[];
    drafts: FeatureRevisionInterface[];
  }>(`/feature/${fid}`);

  const revisions = useMemo(() => {
    if (!data) return [];
    return data.drafts;
  }, [data]);

  return <FeatureRevisionDropDownV2 revisions={revisions} />;
};
