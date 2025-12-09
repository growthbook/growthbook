import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ago, datetime } from "shared/dates";
import { EventUserLoggedIn } from "back-end/src/events/event-types";
import { PiCheckCircleFill, PiCircleDuotone, PiFileX } from "react-icons/pi";
import { useAddComputedFields, useSearch } from "@/services/search";
import useApi from "@/hooks/useApi";
import Field from "@/components/Forms/Field";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Pagination from "@/components/Pagination";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import LoadingOverlay from "@/components/LoadingOverlay";
import ProjectBadges from "@/components/ProjectBadges";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
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
    [],
  );

  const revisions = useAddComputedFields(featuresAndRevisions, (revision) => {
    const createdBy = revision?.createdBy as EventUserLoggedIn | null;
    let dateAndStatus = new Date(revision?.dateUpdated).getTime();
    switch (revision?.status) {
      case "draft":
        dateAndStatus = parseInt(`0${dateAndStatus}`);
        break;
      case "approved":
        dateAndStatus = parseInt(`0${dateAndStatus}`);
        break;
      case "pending-review":
        dateAndStatus = parseInt(`1${dateAndStatus}`);
        break;
      case "changes-requested":
        dateAndStatus = parseInt(`1${dateAndStatus}`);
        break;
    }
    return {
      id: revision.feature?.id,
      tags: revision.feature?.tags,
      status: revision?.status,
      version: revision?.version,
      dateCreated: revision?.dateCreated,
      dateUpdated: revision?.dateUpdated,
      project: revision.feature?.project,
      creator: createdBy?.name,
      comment: revision?.comment,
      dateAndStatus,
    };
  });

  const { searchInputProps, items, SortableTH } = useSearch({
    items: revisions,
    defaultSortField: "dateAndStatus",
    defaultSortDir: -1,
    searchFields: ["id^3", "comment", "tags^2", "status", "creator"],
    localStorageKey: "features-drafts-table-test-1-3",
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.status === "draft") is.push("draft");
        if (item.status === "pending-review")
          is.push("pending-review", "awaiting-review");
        if (item.status === "approved") is.push("approved");
        return is;
      },
      status: (item) => item.status,
      tag: (item) => item.tags,
      project: (item) => item.feature?.project,
      created: (item) => item.dateCreated,
      updated: (item) => item.dateUpdated,
      user: (item) => item.creator,
      version: (item) => item.version,
    },
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const loading = !data;

  const renderFeaturesTableDrafts = () => {
    return revisions.length > 0 ? (
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

        <Table className="gbtable appbox">
          <TableHeader
            className="sticky-top bg-white shadow-sm"
            style={{ top: "56px", zIndex: 900 }}
          >
            <TableRow>
              <SortableTH field="id">Feature Key</SortableTH>
              <TableColumnHeader>Comment</TableColumnHeader>
              <TableColumnHeader>Project</TableColumnHeader>
              <TableColumnHeader> Creator</TableColumnHeader>
              <SortableTH field="dateUpdated">Last Updated</SortableTH>
              <SortableTH field="status">Status</SortableTH>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.slice(start, end).map((featureAndRevision) => {
              const projectId = featureAndRevision.project;
              const projectName = projectId
                ? getProjectById(projectId)?.name || null
                : null;
              const projectIsDeReferenced = projectId && !projectName;

              return (
                <TableRow
                  key={`${featureAndRevision.id}:${featureAndRevision.version}`}
                  className="hover-highlight"
                >
                  <TableCell className="py-0">
                    <Link
                      className="featurename d-block p-2"
                      href={`/features/${featureAndRevision.id}?v=${featureAndRevision?.version}`}
                    >
                      {featureAndRevision.id}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <OverflowText maxWidth={200}>
                      {featureAndRevision.comment}
                    </OverflowText>
                  </TableCell>
                  {
                    <TableCell>
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
                        <>
                          {featureAndRevision.project ? (
                            <ProjectBadges
                              resourceType="feature"
                              projectIds={[featureAndRevision.project]}
                            />
                          ) : (
                            <></>
                          )}
                        </>
                      )}
                    </TableCell>
                  }
                  <TableCell>{featureAndRevision.creator}</TableCell>

                  <TableCell title={datetime(featureAndRevision.dateUpdated)}>
                    {ago(featureAndRevision.dateUpdated)}
                  </TableCell>
                  <TableCell>{renderStatusCopy(featureAndRevision)}</TableCell>
                </TableRow>
              );
            })}
            {!items.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  No matching drafts
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
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
