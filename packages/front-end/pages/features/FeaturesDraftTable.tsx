import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ago, datetime } from "shared/dates";
import { EventAuditUserLoggedIn } from "back-end/src/events/event-types";
import { PiCheckCircleFill, PiCircleDuotone, PiFileX } from "react-icons/pi";
import {
  removeEnvFromSearchTerm,
  useAddComputedFields,
  useSearch,
} from "@/services/search";
import useApi from "@/hooks/useApi";
import Field from "@/components/Forms/Field";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/components/Pagination";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import LoadingOverlay from "@/components/LoadingOverlay";
export interface Props {
  features: FeatureInterface[];
}
type FeaturesAndRevisions = FeatureRevisionInterface & {
  feature: FeatureInterface;
};
export default function FeaturesDraftTable({ features }: Props) {
  const draftAndReviewData = useApi<{
    status: number;
    revisions: FeatureRevisionInterface[];
  }>(`/revision/feature`);
  const [currentPage, setCurrentPage] = useState(1);

  const NUM_PER_PAGE = 20;
  const { data } = draftAndReviewData;
  const { getProjectById } = useDefinitions();
  const renderStatusCopy = (revision: FeatureRevisionInterface) => {
    switch (revision.status) {
      case "approved":
        return (
          <span className="mr-3">
            <PiCheckCircleFill className="text-success  mr-1" /> Approved
          </span>
        );
      case "pending-review":
        return (
          <span className="mr-3">
            <PiCircleDuotone className="text-warning  mr-1" /> Pending Review
          </span>
        );
      case "draft":
        return <span className="mr-3">Draft</span>;
      case "changes-requested":
        return (
          <span className="mr-3">
            <PiFileX className="text-danger mr-1" />
            Changes Requested
          </span>
        );
      default:
        return;
    }
  };

  const featuresAndRevisions = data?.revisions.reduce<FeaturesAndRevisions[]>(
    (result, revision) => {
      const feature = features.find((f) => f.id === revision.featureId);
      if (feature && feature?.dateCreated <= revision.dateCreated) {
        result.push({
          ...revision,
          feature,
        });
      }
      return result;
    },
    []
  );

  const revisions = useAddComputedFields(featuresAndRevisions, (revision) => {
    const createdBy = revision?.createdBy as EventAuditUserLoggedIn | null;
    return {
      id: revision.feature?.id,
      tags: revision.feature?.tags,
      status: revision?.status,
      version: revision?.version,
      dateUpdated: revision?.dateUpdated,
      project: revision.feature?.project,
      creator: createdBy?.name,
      comment: revision?.comment,
    };
  });

  const { searchInputProps, items, SortableTH } = useSearch({
    items: revisions,
    defaultSortField: "dateUpdated",
    searchFields: ["id^3", "comment", "tags^2", "status", "creator"],
    transformQuery: removeEnvFromSearchTerm,
    localStorageKey: "features-drafts-table",
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const loading = !data;

  const renderFeaturesTableDrafts = () => {
    return items.length > 0 ? (
      <div>
        <div className="row mb-2 align-items-center">
          <div className="col-auto">
            <Field
              placeholder="Search..."
              type="search"
              {...searchInputProps}
            />
          </div>
        </div>

        <table className="table gbtable table-hover appbox">
          <thead
            className="sticky-top bg-white shadow-sm"
            style={{ top: "56px", zIndex: 900 }}
          >
            <tr>
              <SortableTH field="id">Feature Key</SortableTH>
              <th>Comment</th>
              <th>Project</th>
              <th> Creator</th>
              <SortableTH field="dateUpdated">Last Updated</SortableTH>
              <SortableTH field="status">Status</SortableTH>
            </tr>
          </thead>
          <tbody>
            {items.slice(start, end).map((featureAndRevision) => {
              const projectId = featureAndRevision.project;
              const projectName = projectId
                ? getProjectById(projectId)?.name || null
                : null;
              const projectIsDeReferenced = projectId && !projectName;

              return (
                <tr
                  key={`${featureAndRevision.id}:${featureAndRevision.version}`}
                >
                  <td>
                    <Link
                      href={`/features/${featureAndRevision.id}?v=${featureAndRevision?.version}`}
                    >
                      {featureAndRevision.id}
                    </Link>
                  </td>
                  <td>
                    <OverflowText maxWidth={200}>
                      {featureAndRevision.comment}
                    </OverflowText>
                  </td>
                  {
                    <td>
                      {projectIsDeReferenced ? (
                        <Tooltip
                          body={
                            <>
                              Project
                              <code>{featureAndRevision.project}</code>
                              not found
                            </>
                          }
                        >
                          <span className="text-danger">Invalid project</span>
                        </Tooltip>
                      ) : (
                        projectName ?? <em>None</em>
                      )}
                    </td>
                  }
                  <td>{featureAndRevision.creator}</td>

                  <td title={datetime(featureAndRevision.dateUpdated)}>
                    {ago(featureAndRevision.dateUpdated)}
                  </td>
                  <td>{renderStatusCopy(featureAndRevision)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {Math.ceil(revisions.length / NUM_PER_PAGE) > 1 && (
          <Pagination
            numItemsTotal={items.length}
            currentPage={currentPage}
            perPage={NUM_PER_PAGE}
            onPageChange={(d) => {
              setCurrentPage(d);
            }}
          />
        )}
      </div>
    ) : (
      <div className="callout callout-color-amber">
        There are no drafts or revisions to review
      </div>
    );
  };
  if (loading) return <LoadingOverlay relativePosition={true} />;
  return renderFeaturesTableDrafts() || null;
}
