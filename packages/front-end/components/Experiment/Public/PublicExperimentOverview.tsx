import {ExperimentInterfaceStringDates, LinkedFeatureInfo} from "shared/types/experiment";
import React from "react";
import {VisualChangesetInterface} from "shared/types/visual-changeset";
import {URLRedirectInterface} from "shared/types/url-redirect";
import Markdown from "@/components/Markdown/Markdown";
import VariationsTable from "@/components/Experiment/VariationsTable";
import VisualLinkedChanges from "@/components/Experiment/LinkedChanges/VisualLinkedChanges";
import FeatureLinkedChanges from "@/components/Experiment/LinkedChanges/FeatureLinkedChanges";
import RedirectLinkedChanges from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges";
import AnalysisSettings from "@/components/Experiment/TabbedPage/AnalysisSettings";
import {SSRPolyfills} from "@/hooks/useSSRPolyfills";

export default function PublicExperimentOverview({
  experiment,
  visualChangesets,
  urlRedirects,
  linkedFeatures,
  ssrPolyfills,
}: {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  linkedFeatures: LinkedFeatureInfo[];
  ssrPolyfills: SSRPolyfills;
}) {
  const hasLinkedChanges =
    experiment?.hasVisualChangesets ||
    (linkedFeatures?.length ?? 0) > 0 ||
    experiment?.hasURLRedirects;

  return (
    <>
      <h2>Overview</h2>

      <div className="box px-4 py-3 mb-4">
        <h4>Description</h4>
        <Markdown isPublic={true} shareUid={experiment.uid} shareType="experiment">
          {experiment?.description || "_no description_"}
        </Markdown>
      </div>

      {experiment?.type !== "multi-armed-bandit" && experiment?.hypothesis ? (
        <div className="box px-4 py-3 mb-4">
          <h4>Hypothesis</h4>
          {experiment?.hypothesis}
        </div>
      ) : null}

      <h2>Implementation</h2>

      <div className="box px-2 py-3 mb-4">
        <h4 className="mx-3">Variations</h4>
        <VariationsTable
          experiment={experiment}
          canEditExperiment={false}
          isPublic={true}
          shareUid={experiment.uid}
          shareType="experiment"
        />
      </div>

      {hasLinkedChanges ? (
        <>
          <VisualLinkedChanges
            visualChangesets={visualChangesets}
            canAddChanges={false}
            canEditVisualChangesets={false}
            experiment={experiment}
            isPublic={true}
          />
          <FeatureLinkedChanges
            linkedFeatures={linkedFeatures}
            experiment={experiment}
            canAddChanges={false}
            isPublic={true}
          />
          <RedirectLinkedChanges
            urlRedirects={urlRedirects}
            experiment={experiment}
            canAddChanges={false}
            isPublic={true}
          />
        </>
      ) : null}

      <AnalysisSettings
        experiment={experiment}
        envs={[]}
        canEdit={false}
        ssrPolyfills={ssrPolyfills}
        isPublic={true}
      />
    </>
  );
}
