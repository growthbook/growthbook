import { FeatureMetaInfo } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { date, datetime } from "shared/dates";
import {
  EventUserLoggedIn,
  EventUserApiKey,
} from "shared/types/events/event-types";
import { Box, Flex } from "@radix-ui/themes";
import { useAddComputedFields, useSearch } from "@/services/search";
import useApi from "@/hooks/useApi";
import Field from "@/components/Forms/Field";
import Pagination from "@/ui/Pagination";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import LoadingOverlay from "@/components/LoadingOverlay";
import {
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import {
  draftStatusDotColor,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import Text from "@/ui/Text";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

type FeaturesAndRevisions = FeatureRevisionInterface & {
  featureMeta?: FeatureMetaInfo;
};

const COL = {
  REVISION: "5%",
  NOTES: "30%",
  AUTHOR: "15%",
  DATE: "13%",
  DRAFT_STATUS: "13%",
} as const;

export default function FeaturesDraftTable() {
  const draftAndReviewData = useApi<{
    status: number;
    revisions: FeaturesAndRevisions[];
  }>(`/revision/feature?sparse=true`);
  const [currentPage, setCurrentPage] = useState(1);

  const NUM_PER_PAGE = 20;
  const { data } = draftAndReviewData;

  const featuresAndRevisions = data?.revisions;

  const revisions = useAddComputedFields(featuresAndRevisions, (revision) => {
    const createdBy = revision?.createdBy as
      | EventUserLoggedIn
      | EventUserApiKey
      | null;
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
      // Composite ID so MiniSearch never sees duplicate IDs when a feature has
      // multiple open revisions (e.g. both a draft and a pending-review).
      id: `${revision.featureId}-v${revision.version}`,
      featureKey: revision.featureId,
      tags: revision.featureMeta?.tags,
      status: revision?.status,
      version: revision?.version,
      dateCreated: revision?.dateCreated,
      dateUpdated: revision?.dateUpdated,
      project: revision.featureMeta?.project,
      creator: createdBy?.name,
      comment: revision?.comment,
      dateAndStatus,
    };
  });

  const {
    searchInputProps,
    items,
    SortableTableColumnHeader,
    syntaxFilters,
    setSearchValue,
  } = useSearch({
    items: revisions,
    defaultSortField: "dateAndStatus",
    defaultSortDir: -1,
    searchFields: ["featureKey^3", "comment", "tags^2", "status", "creator"],
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
      project: (item) => item.featureMeta?.project,
      created: (item) => item.dateCreated,
      updated: (item) => item.dateUpdated,
      user: (item) => item.creator,
      version: (item) => item.version,
    },
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  const creators = useMemo(() => {
    const set = new Set(
      (revisions ?? []).map((r) => r.creator).filter(Boolean),
    );
    return Array.from(set) as string[];
  }, [revisions]);

  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });

  const statusFilterItems = [
    {
      name: "Pending review",
      id: "pending-review",
      searchValue: "pending-review",
    },
    { name: "Approved", id: "approved", searchValue: "approved" },
    {
      name: "Changes requested",
      id: "changes-requested",
      searchValue: "changes-requested",
    },
    { name: "Draft", id: "draft", searchValue: "draft" },
  ];

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const loading = !data;

  const renderFeaturesTableDrafts = () => {
    return revisions.length > 0 ? (
      <div>
        <Flex gap="4" align="center" justify="between" mb="4" wrap="wrap">
          <Box style={{ flexBasis: 300, flexShrink: 0 }}>
            <Field
              size="legacy"
              placeholder="Search..."
              type="search"
              containerClassName="mb-0"
              {...searchInputProps}
            />
          </Box>
          <Flex gap="5" align="center">
            <FilterDropdown
              filter="user"
              heading="Author"
              syntaxFilters={syntaxFilters}
              open={dropdownFilterOpen}
              setOpen={setDropdownFilterOpen}
              items={creators.map((c) => ({
                name: c,
                id: c,
                searchValue: c,
              }))}
              updateQuery={updateQuery}
            />
            <FilterDropdown
              filter="status"
              heading="Status"
              syntaxFilters={syntaxFilters}
              open={dropdownFilterOpen}
              setOpen={setDropdownFilterOpen}
              items={statusFilterItems}
              updateQuery={updateQuery}
            />
          </Flex>
        </Flex>

        <Table variant="list" stickyHeader roundedCorners>
          <TableHeader>
            <TableRow>
              <SortableTableColumnHeader field="featureKey">
                Feature Key
              </SortableTableColumnHeader>
              <TableColumnHeader
                style={{ width: COL.REVISION, textAlign: "right" }}
              >
                Revision
              </TableColumnHeader>
              <TableColumnHeader style={{ width: COL.NOTES }}>
                Notes
              </TableColumnHeader>
              <TableColumnHeader style={{ width: COL.AUTHOR }}>
                Author
              </TableColumnHeader>
              <SortableTableColumnHeader
                field="dateUpdated"
                style={{ width: COL.DATE }}
              >
                Last Modified
              </SortableTableColumnHeader>
              <SortableTableColumnHeader
                field="status"
                style={{ width: COL.DRAFT_STATUS }}
              >
                Draft Status
              </SortableTableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.slice(start, end).map((featureAndRevision) => {
              return (
                <TableRow
                  key={`${featureAndRevision.id}:${featureAndRevision.version}`}
                >
                  <TableCell style={{ padding: "var(--space-0)" }}>
                    <Link
                      className="featurename"
                      style={{ display: "block", padding: "var(--space-3)" }}
                      href={`/features/${featureAndRevision.featureKey}?v=${featureAndRevision?.version}`}
                    >
                      {featureAndRevision.featureKey}
                    </Link>
                  </TableCell>
                  <TableCell style={{ textAlign: "right" }}>
                    {featureAndRevision.version}
                  </TableCell>
                  <TableCell>
                    <OverflowText maxWidth={400}>
                      {featureAndRevision.comment}
                    </OverflowText>
                  </TableCell>
                  <TableCell>{featureAndRevision.creator}</TableCell>
                  <TableCell title={datetime(featureAndRevision.dateUpdated)}>
                    {date(featureAndRevision.dateUpdated)}
                  </TableCell>
                  <TableCell>
                    <Flex align="center" style={{ gap: 6 }}>
                      <span
                        style={{
                          display: "block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: draftStatusDotColor(
                            featureAndRevision.status,
                          ),
                        }}
                      />
                      <Text size="medium">
                        {revisionStatusLabel(featureAndRevision.status)}
                      </Text>
                    </Flex>
                  </TableCell>
                </TableRow>
              );
            })}
            {!items.length ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  No matching drafts
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {Math.ceil(items.length / NUM_PER_PAGE) > 1 && (
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
