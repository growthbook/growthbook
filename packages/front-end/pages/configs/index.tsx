import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { date, datetime } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { isProjectListValidForProject, truncateString } from "shared/util";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Link from "@/ui/Link";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
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
import { useConfigDraftStates } from "@/hooks/useConstantDraftStates";
import { useRevisionsEntityType } from "@/hooks/useRevisions";
import ConfigModal from "@/components/Configs/ConfigModal";
import ConfigReviews from "@/components/Constants/ConfigReviews";
import ConfigSearchFilters from "@/components/Search/ConfigSearchFilters";

const VALID_TABS = ["all", "drafts"] as const;
type ConfigsTab = (typeof VALID_TABS)[number];

function isConfigsTab(value: string): value is ConfigsTab {
  return (VALID_TABS as readonly string[]).includes(value);
}

export default function ConfigsPage(): React.ReactElement {
  const router = useRouter();
  const { ready, project, projects, configs } = useDefinitions();
  const { getOwnerDisplay } = useUser();
  const permissionsUtil = usePermissionsUtil();

  // Rows navigate to the detail page; the modal is create-only.
  const [modalOpen, setModalOpen] = useState(false);
  // Archived configs are hidden by default; surfaced via the `is:archived` facet.
  const [showArchived, setShowArchived] = useState(false);

  // Tabs (All Configs | Drafts) persist via the URL hash.
  const getInitialTab = (): ConfigsTab => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.slice(1);
      if (isConfigsTab(hash)) return hash;
    }
    return "all";
  };
  const [activeTab, setActiveTab] = useState<ConfigsTab>(getInitialTab);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (isConfigsTab(hash)) setActiveTab(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const { revisions: openConfigRevisions } = useRevisionsEntityType("config", {
    status: "open",
    limit: 500,
  });
  const openReviewsCount = useMemo(
    () => openConfigRevisions.filter((r) => r.target.type === "config").length,
    [openConfigRevisions],
  );

  const visibleConfigs = useMemo(
    () =>
      configs.filter((c) =>
        isProjectListValidForProject(c.project ? [c.project] : [], project),
      ),
    [configs, project],
  );

  const configItems = useAddComputedFields(visibleConfigs, (c) => ({
    ownerName: getOwnerDisplay(c.owner) || "",
    projectNames: c.project
      ? [projects.find((p) => p.id === c.project)?.name ?? c.project]
      : [],
  }));

  const draftHook = useConfigDraftStates();
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
    items: configItems,
    searchFields: ["name^3", "key^2", "description^2", "ownerName"],
    localStorageKey: "configs",
    defaultSortField: "name",
    defaultSortDir: 1,
    pageSize: 50,
    updateSearchQueryOnChange: true,
    filterResults: !showArchived
      ? (items) => items.filter((c) => !c.archived)
      : undefined,
    // The `has:draft` filter reads async-loaded draft states; declare the dep so
    // results recompute when they arrive (even when `filterResults` is stable).
    searchTermFilterDeps: [draftHook.draftStates],
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

  const hasArchived = configs.some((c) => c.archived);

  if (!ready) {
    return <LoadingOverlay />;
  }

  const canAdd = permissionsUtil.canCreateConfig({
    project: project || undefined,
  });
  const hasConfigs = configs.length > 0;

  const addButton = (
    <Button disabled={!canAdd} onClick={() => setModalOpen(true)}>
      Add Config
    </Button>
  );

  return (
    <>
      <Box className="contents container-fluid pagecontents" mb="3" mt="2">
        <Flex align="center" justify="between" mb="3" mt="2">
          <Heading as="h1" size="2x-large">
            Configs
          </Heading>
          {hasConfigs && canAdd && addButton}
        </Flex>
        <Text as="p" mb="3" color="text-mid">
          Strongly-typed configuration objects with a base config and
          field-level overrides, composed and delivered through your feature
          flags.
        </Text>

        {!hasConfigs ? (
          <EmptyState
            title="Typed, composable configuration"
            description="Define a base config with a field schema, then create override configs that inherit and override specific fields."
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
              if (!isConfigsTab(newTab)) return;
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
                All Configs
                <span className="ml-2 round-text-background text-main">
                  {configs.length}
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
                  <ConfigSearchFilters
                    searchInputProps={searchInputProps}
                    syntaxFilters={syntaxFilters}
                    setSearchValue={setSearchValue}
                    configs={items}
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
                      <TableColumnHeader style={{ width: "25%" }}>
                        Description
                      </TableColumnHeader>
                      <TableColumnHeader>Projects</TableColumnHeader>
                      <TableColumnHeader style={{ textAlign: "center" }}>
                        Draft Status
                      </TableColumnHeader>
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
                            <Flex align="center" gap="2">
                              <Link
                                color="dark"
                                style={{
                                  display: "block",
                                  padding: "var(--space-3)",
                                }}
                                href={`/configs/${c.key}`}
                              >
                                {c.name}
                              </Link>
                              {c.archived && (
                                <Badge label="Archived" color="gray" />
                              )}
                            </Flex>
                          </TableCell>
                          <TableCell>{c.key}</TableCell>
                          <TableCell>
                            {truncateString(c.description || "", 80)}
                          </TableCell>
                          <TableCell>
                            {c.project ? (
                              <ProjectBadges
                                resourceType="constant"
                                projectIds={[c.project]}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell style={{ textAlign: "center" }}>
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
                        <TableCell colSpan={6} style={{ textAlign: "center" }}>
                          {isFiltered
                            ? "No configs match the current filter."
                            : "No configs found."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {pagination}
              </Box>
            </TabsContent>

            <TabsContent value="drafts">
              <ConfigReviews />
            </TabsContent>
          </Tabs>
        )}
      </Box>
      {modalOpen && <ConfigModal close={() => setModalOpen(false)} />}
    </>
  );
}
