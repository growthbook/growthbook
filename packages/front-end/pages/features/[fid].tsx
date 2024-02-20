import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { FeatureCodeRefsInterface } from "back-end/types/code-refs";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
import PageHead from "@/components/Layout/PageHead";
import FeaturesHeader from "@/components/Features/FeaturesHeader";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import FeaturesOverview from "@/components/Features/FeaturesOverview";
import FeaturesStats from "@/components/Features/FeaturesStats";

const featureTabs = ["overview", "stats"] as const;
export type FeatureTab = typeof featureTabs[number];

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;
  const [editProjectModal, setEditProjectModal] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);

  let extraQueryString = "";
  // Version being forced via querystring
  if ("v" in router.query) {
    const v = parseInt(router.query.v as string);
    if (v) {
      extraQueryString = `?v=${v}`;
    }
  }

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
    revisions: FeatureRevisionInterface[];
    experiments: ExperimentInterfaceStringDates[];
    codeRefs: FeatureCodeRefsInterface[];
  }>(`/feature/${fid}${extraQueryString}`);

  const [tab, setTab] = useLocalStorage<FeatureTab>(
    `tabbedPageTab__${data?.feature?.id}`,
    "overview"
  );

  const setTabAndScroll = (tab: FeatureTab) => {
    setTab(tab);
    const newUrl = window.location.href.replace(/#.*/, "") + "#" + tab;
    if (newUrl === window.location.href) return;
    window.history.pushState("", "", newUrl);
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace(/^#/, "") as FeatureTab;
      if (featureTabs.includes(hash)) {
        setTab(hash);
      }
    };
    handler();
    window.addEventListener("hashchange", handler, false);
    return () => window.removeEventListener("hashchange", handler, false);
  }, [setTab]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }

  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Features", href: "/features" },
          { display: data.feature.id },
        ]}
      />

      <FeaturesHeader
        feature={data.feature}
        experiments={data.experiments}
        mutate={mutate}
        tab={tab}
        setTab={setTabAndScroll}
        setEditProjectModal={setEditProjectModal}
        setEditTagsModal={setEditTagsModal}
        setEditOwnerModal={setEditOwnerModal}
      />

      {tab === "overview" && (
        <FeaturesOverview
          baseFeature={data.feature}
          experiments={data.experiments}
          revisions={data.revisions}
          mutate={mutate}
          editProjectModal={editProjectModal}
          setEditProjectModal={setEditProjectModal}
          editTagsModal={editTagsModal}
          setEditTagsModal={setEditTagsModal}
          editOwnerModal={editOwnerModal}
          setEditOwnerModal={setEditOwnerModal}
        />
      )}

      {tab === "stats" && <FeaturesStats codeRefs={data.codeRefs} />}
    </>
  );
}
