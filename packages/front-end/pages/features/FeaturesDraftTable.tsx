import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ago, datetime } from "shared/dates";
import { EventAuditUserLoggedIn } from "back-end/src/events/event-types";
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

export default function FeaturesDraftTable() {
  const draftAndReviewData = useApi<{
    status: number;
    featuresAndRevisions: {
      feature: FeatureInterface;
      revision: FeatureRevisionInterface;
    }[];
  }>(`/feature/revisions/draftAndReview`);
  const [currentPage, setCurrentPage] = useState(1);

  const NUM_PER_PAGE = 20;
  const { data } = draftAndReviewData;
  const { getProjectById } = useDefinitions();
  const statusToCopy = (status) => {
    switch (status) {
      case "approved":
        return <span>Approved</span>;
      case "pending-review":
        return <span>Pending Review</span>;
      case "draft":
        return <span className="feature-draft-copy">Draft</span>;
      case "changes-requested":
        return <span> Changes Requested</span>;
      default:
        return;
    }
  };
  const featuresAndRevisions = useAddComputedFields(
    data?.featuresAndRevisions,
    (featureAndRevision) => {
      const createdBy = featureAndRevision?.revision
        ?.createdBy as EventAuditUserLoggedIn | null;
      return {
        id: featureAndRevision?.feature?.id,
        tags: featureAndRevision?.feature?.tags,
        status: featureAndRevision?.revision?.status,
        version: featureAndRevision?.revision?.version,
        dateUpdated: featureAndRevision?.revision?.dateUpdated,
        project: featureAndRevision?.feature?.project,
        creator: createdBy?.name,
        comment: featureAndRevision?.revision?.comment,
      };
    }
  );

  const { searchInputProps, items, SortableTH } = useSearch({
    items: featuresAndRevisions,
    defaultSortField: "id",
    searchFields: ["id^3", "comment", "tags^2", "status", "creator"],
    transformQuery: removeEnvFromSearchTerm,
    localStorageKey: "features",
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const renderFeaturesTableDrafts = () => {
    return (
      items.length > 0 && (
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
                const projectId = featureAndRevision.feature.project;
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
                        <a>{featureAndRevision.id}</a>
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
                    <td>{statusToCopy(featureAndRevision.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {Math.ceil(featuresAndRevisions.length / NUM_PER_PAGE) > 1 && (
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
      )
    );
  };

  return renderFeaturesTableDrafts() || null;
}
