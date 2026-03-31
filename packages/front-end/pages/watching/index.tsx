import Link from "next/link";
import React, { useMemo } from "react";
import { Box } from "@radix-ui/themes";
import { FeatureMetaInfo } from "shared/types/feature";
import { date, datetime } from "shared/dates";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import LoadingOverlay from "@/components/LoadingOverlay";
import SortedTags from "@/components/Tags/SortedTags";
import WatchButton from "@/components/WatchButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useFeatureMetaInfo } from "@/hooks/useFeatureMetaInfo";
import { useWatching } from "@/services/WatchProvider";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/ui/Callout";

const HEADER_HEIGHT_PX = 55;

type FeatureType = FeatureMetaInfo & {
  __typename: "feature";
};

type ExperimentType = ExperimentInterfaceStringDates & {
  __typename: "experiment";
};

type TableItemType = {
  id: string;
  type: "feature" | "experiment";
  displayType: "Feature" | "Experiment";
  name: string;
  href: string;
  tags: FeatureMetaInfo["tags"];
  project: FeatureMetaInfo["project"];
  dateUpdated: FeatureMetaInfo["dateUpdated"];
};

export default function WatchingPage() {
  const watching = useWatching();
  const { project } = useDefinitions();

  const {
    features: allFeatures,
    loading: featureLoading,
    error: featureError,
  } = useFeatureMetaInfo({
    project: project || undefined,
  });

  const {
    experiments: allExperiments,
    error: experimentError,
    loading: experimentsLoading,
  } = useExperiments(project);

  const loading = featureLoading || experimentsLoading;
  const error = featureError || experimentError;

  const watchedFeatures = useMemo<FeatureType[]>(
    () =>
      watching.watchedFeatures.reduce((acc, id) => {
        const match = allFeatures.find((meta) => meta.id === id);
        if (match) acc.push({ ...match, __typename: "feature" });
        return acc;
      }, [] as FeatureType[]),
    [allFeatures, watching.watchedFeatures],
  );

  const watchedExperiments = useMemo<ExperimentType[]>(
    () =>
      watching.watchedExperiments.reduce((acc, id) => {
        const match = allExperiments.find((meta) => meta.id === id);
        if (match) acc.push({ ...match, __typename: "experiment" });
        return acc;
      }, [] as ExperimentType[]),
    [allExperiments, watching.watchedExperiments],
  );

  const allItems = useMemo<TableItemType[]>(
    () =>
      [...watchedFeatures, ...watchedExperiments].map((item) => {
        if (item.__typename === "feature") {
          return {
            id: item.id,
            type: item.__typename,
            displayType: "Feature",
            name: item.id,
            href: `/features/${item.id}`,
            tags: item.tags,
            project: item.project,
            dateUpdated: item.dateUpdated,
          } satisfies TableItemType;
        }

        return {
          id: item.id,
          type: item.__typename,
          displayType: "Experiment",
          name: item.name,
          href: `/experiment/${item.id}`,
          tags: item.tags,
          project: item.project,
          dateUpdated: new Date(item.dateUpdated),
        } satisfies TableItemType;
      }),
    [watchedExperiments, watchedFeatures],
  );

  const renderTable = ({
    showProjectColumn,
  }: {
    showProjectColumn: boolean;
  }) => {
    return (
      <Box>
        <table className="table gbtable appbox">
          <thead
            className="sticky-top shadow-sm"
            style={{ top: HEADER_HEIGHT_PX + "px", zIndex: 900 }}
          >
            <tr>
              <th style={{ width: 20 }}></th>
              <th>Name</th>
              <th>Type</th>
              <th>Tags</th>
              {showProjectColumn && <th>Project</th>}
              <th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((feature) => {
              return (
                <tr key={feature.id} className="hover-highlight">
                  <td data-title="Watching status:" className="watching">
                    <WatchButton
                      item={feature.id}
                      itemType={feature.type}
                      type="icon"
                    />
                  </td>
                  <td className="p-0">
                    <Link
                      href={feature.href}
                      className={"featurename d-block p-2"}
                    >
                      {feature.name}
                    </Link>
                  </td>
                  <td>{feature.displayType}</td>
                  <td>
                    <SortedTags tags={feature?.tags || []} useFlex={true} />
                  </td>
                  {showProjectColumn && (
                    <td>
                      {feature.project ? (
                        <ProjectBadges
                          resourceType="feature"
                          projectIds={[feature.project]}
                        />
                      ) : null}
                    </td>
                  )}
                  <td title={datetime(feature.dateUpdated)}>
                    {date(feature.dateUpdated)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Box>
    );
  };

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }

  if (loading) {
    return <LoadingOverlay />;
  }

  // If "All Projects" is selected and some features are in a project, show the project column
  const showProjectColumn = !project && allFeatures.some((f) => f.project);

  return (
    <div className="contents container pagecontents">
      <div className="row my-3">
        <div className="col">
          <h1>Watching</h1>
        </div>
      </div>

      {allItems.length > 0 ? (
        renderTable({ showProjectColumn })
      ) : (
        <Callout status="info">
          You&#39;re not watching any features or experiments.
        </Callout>
      )}
    </div>
  );
}
