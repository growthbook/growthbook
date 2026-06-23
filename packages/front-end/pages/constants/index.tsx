import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { date, datetime } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { ConstantWithoutValue } from "shared/types/constant";
import { isProjectListValidForProject, truncateString } from "shared/util";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Link from "@/ui/Link";
import EmptyState from "@/components/EmptyState";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAddComputedFields, useSearch } from "@/services/search";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import {
  draftStatusDots,
  draftStatusTooltip,
} from "@/components/Reviews/RevisionStatusBadge";
import { useConstantDraftStates } from "@/hooks/useConstantDraftStates";
import { useOpenRevisionCount } from "@/hooks/useRevisions";
import ConstantModal from "@/components/Constants/ConstantModal";
import ConstantReviews from "@/components/Constants/ConstantReviews";
import ConstantSearchFilters from "@/components/Search/ConstantSearchFilters";

const TYPE_LABEL: Record<ConstantWithoutValue["type"], string> = {
  string: "String",
  json: "JSON",
};

const VALID_TABS = ["all", "drafts"] as const;
type ConstantsTab = (typeof VALID_TABS)[number];

function isConstantsTab(value: string): value is ConstantsTab {
  return (VALID_TABS as readonly string[]).includes(value);
}

export default function ConstantsPage(): React.ReactElement {
  const router = useRouter();
  const { ready, project, projects, constants } = useDefinitions();
  const { getOwnerDisplay } = useUser();
  const permissionsUtil = usePermissionsUtil();

  // Rows navigate to the detail page; the modal is create-only.
  const [modalOpen, setModalOpen] = useState(false);
  // Archived constants are hidden by default; surfaced via the `is:archived`
  // search facet (mirrors the saved-groups list).
  const [showArchived, setShowArchived] = useState(false);

  // Tabs (All Constants | Drafts) persist via the URL hash, mirroring the
  // saved-groups list page.
  const getInitialTab = (): ConstantsTab => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.slice(1);
      if (isConstantsTab(hash)) return hash;
    }
    return "all";
  };
  const [activeTab, setActiveTab] = useState<ConstantsTab>(getInitialTab);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (isConstantsTab(hash)) setActiveTab(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const { count: openReviewsCount } = useOpenRevisionCount("constant");

  const visibleConstants = useMemo(
    () =>
      constants.filter((c) =>
        isProjectListValidForProject(c.project ? [c.project] : [], project),
      ),
    [constants, project],
  );

  const constantItems = useAddComputedFields(visibleConstants, (c) => ({
    ownerName: getOwnerDisplay(c.owner) || "",
    typeLabel: TYPE_LABEL[c.type],
    projectNames: c.project
      ? [projects.find((p) => p.id === c.project)?.name ?? c.project]
      : [],
  }));

  const draftHook = useConstantDraftStates();
  const hasDraftStates = Object.keys(draftHook.draftStates).length > 0;

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    syntaxFilters,
    setSearchValue,
    pagination,
  } = useSearch({
    items: constantItems,
    searchFields: ["name^3", "key^2", "description^2", "ownerName"],
    localStorageKey: "constants",
    defaultSortField: "name",
    defaultSortDir: 1,
    pageSize: 50,
    updateSearchQueryOnChange: true,
    filterResults: !showArchived
      ? (items) => items.filter((c) => !c.archived)
      : undefined,
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.archived) is.push("archived");
        return is;
      },
      has: (item) => {
        const has: string[] = [];
        if (draftHook.draftStates[item.id]) has.push("draft", "drafts");
        return has;
      },
      type: (item) => item.type,
      owner: (item) => item.ownerName,
      project: (item) => [
        ...(item.project ? [item.project] : []),
        ...item.projectNames,
      ],
    },
  });

  // Sync showArchived from the `is:archived` syntax filter.
  useEffect(() => {
    setShowArchived(
      syntaxFilters.some(
        (f) => f.field === "is" && f.values.includes("archived"),
      ),
    );
  }, [syntaxFilters]);

  const hasDraftFilter = syntaxFilters.some(
    (f) => f.field === "has" && f.values.includes("draft"),
  );

  // Fetch all draft states when filtering by draft, otherwise just the visible
  // rows (the hook dedupes already-fetched ids).
  useEffect(() => {
    if (hasDraftFilter) {
      draftHook.fetchAll();
    } else {
      const ids = items.map((c) => c.id);
      if (ids.length) draftHook.fetchSome(ids);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hasDraftFilter]);

  const hasArchived = constants.some((c) => c.archived);

  if (!ready) {
    return <LoadingOverlay />;
  }

  const canAdd = permissionsUtil.canCreateConstant({
    project: project || undefined,
  });
  const hasConstants = constants.length > 0;

  const addButton = (
    <Button disabled={!canAdd} onClick={() => setModalOpen(true)}>
      Add Constant
    </Button>
  );

  return (
    <>
      <Box className="contents container-fluid pagecontents" mb="3" mt="2">
        <Flex mb="3" mt="2" align="center" justify="between">
          <h1 style={{ margin: 0 }}>Constants</h1>
          {hasConstants && canAdd && addButton}
        </Flex>

        {!hasConstants ? (
          <EmptyState
            title="Reusable values for your configs"
            description="Define a value once and reference it from feature flags with {{ @const:key }}. Change it in one place and every consumer updates."
            leftButton={
              <LinkButton
                href="https://docs.growthbook.io/features/constants"
                variant="outline"
                external={true}
              >
                View docs
              </LinkButton>
            }
            rightButton={canAdd ? addButton : null}
          />
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(newTab) => {
              if (!isConstantsTab(newTab)) return;
              setActiveTab(newTab);
              router.replace(
                { pathname: router.pathname, hash: `#${newTab}` },
                undefined,
                { shallow: true },
              );
            }}
          >
            <TabsList>
              <TabsTrigger value="all">
                All Constants
                <span className="ml-2 round-text-background text-main">
                  {constants.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="drafts">
                Drafts
                <span className="ml-2 round-text-background text-main">
                  {openReviewsCount}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all">
              <Box mt="4">
                <Flex align="center" justify="between" gap="3" mb="3">
                  <Box style={{ width: "40%" }}>
                    <Field
                      placeholder="Search..."
                      type="search"
                      {...searchInputProps}
                    />
                  </Box>
                  <ConstantSearchFilters
                    searchInputProps={searchInputProps}
                    syntaxFilters={syntaxFilters}
                    setSearchValue={setSearchValue}
                    constants={items}
                    hasArchived={hasArchived}
                    hasDraftStates={hasDraftStates}
                  />
                </Flex>
                <Table variant="list" stickyHeader roundedCorners>
                  <TableHeader>
                    <TableRow>
                      <SortableTableColumnHeader field="name">
                        Name
                      </SortableTableColumnHeader>
                      <SortableTableColumnHeader field="key">
                        Key
                      </SortableTableColumnHeader>
                      <SortableTableColumnHeader field="typeLabel">
                        Type
                      </SortableTableColumnHeader>
                      <TableColumnHeader>Description</TableColumnHeader>
                      <TableColumnHeader>Projects</TableColumnHeader>
                      <TableColumnHeader>Draft Status</TableColumnHeader>
                      <SortableTableColumnHeader field="dateUpdated">
                        Last Modified
                      </SortableTableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((c) => {
                      const draftEntry = draftHook.draftStates[c.id];
                      return (
                        <TableRow
                          key={c.id}
                          style={{
                            color: c.archived ? "var(--gray-11)" : undefined,
                          }}
                        >
                          <TableCell style={{ padding: "var(--space-0)" }}>
                            <Link
                              color="dark"
                              style={{
                                display: "block",
                                padding: "var(--space-3)",
                              }}
                              href={`/constants/${c.id}`}
                            >
                              {c.name}
                            </Link>
                          </TableCell>
                          <TableCell>{c.key}</TableCell>
                          <TableCell>{c.typeLabel}</TableCell>
                          <TableCell>
                            {truncateString(c.description || "", 40)}
                          </TableCell>
                          <TableCell>
                            {c.project ? (
                              <ProjectBadges
                                resourceType="constant"
                                projectIds={[c.project]}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {draftEntry
                              ? (() => {
                                  const dots = draftStatusDots(draftEntry);
                                  if (!dots.length) return null;
                                  return (
                                    <Tooltip
                                      flipTheme={false}
                                      body={draftStatusTooltip(draftEntry)}
                                      usePortal
                                    >
                                      <Flex
                                        align="center"
                                        justify="center"
                                        gap="1"
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          padding: "0 4px",
                                        }}
                                      >
                                        {dots.map((bg) => (
                                          <span
                                            key={bg}
                                            style={{
                                              display: "block",
                                              width: 8,
                                              height: 8,
                                              borderRadius: "50%",
                                              flexShrink: 0,
                                              background: bg,
                                            }}
                                          />
                                        ))}
                                      </Flex>
                                    </Tooltip>
                                  );
                                })()
                              : null}
                          </TableCell>
                          <TableCell title={datetime(c.dateUpdated)}>
                            {date(c.dateUpdated)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} style={{ textAlign: "center" }}>
                          {isFiltered
                            ? "No constants match the current filter."
                            : "No constants found."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {pagination}
              </Box>
            </TabsContent>

            <TabsContent value="drafts">
              <ConstantReviews />
            </TabsContent>
          </Tabs>
        )}
      </Box>
      {modalOpen && (
        <ConstantModal existing={null} close={() => setModalOpen(false)} />
      )}
    </>
  );
}
