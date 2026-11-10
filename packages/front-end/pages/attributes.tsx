import React, { FC, ReactNode, useEffect, useMemo, useState } from "react";
import { SDKAttribute } from "shared/types/organization";
import { CustomField } from "shared/types/custom-fields";
import { PiInfo, PiMagnifyingGlass } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import RadixTooltip from "@/ui/Tooltip";
import { useAttributeSchema } from "@/services/features";
import AttributeModal from "@/components/Features/AttributeModal";
import IdentifierModal from "@/components/Features/IdentifierModal";
import AttributeRowMenu from "@/components/Features/AttributeRowMenu";
import ProjectBadges from "@/components/ProjectBadges";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import TextField from "@/ui/TextField";
import Pagination from "@/ui/Pagination";
import {
  AttributeRefEntry,
  useAttributeReferences,
} from "@/hooks/useAttributeReferences";
import {
  SearchReturn,
  useAddComputedFields,
  useSearch,
} from "@/services/search";
import AttributeSearchFilters from "@/components/Search/AttributeSearchFilters";
import SortedTags from "@/components/Tags/SortedTags";
import Markdown from "@/components/Markdown/Markdown";
import Link from "@/ui/Link";
import { TruncateMiddleWithTooltip } from "@/ui/TruncateMiddleWithTooltip";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import Heading from "@/ui/Heading";
import ColumnSettingsButton from "@/ui/ColumnSettingsButton";
import { useTableColumns } from "@/hooks/useTableColumns";
import {
  columnWidthBounds,
  ResolvedTableColumn,
  TableColumnDef,
} from "@/services/tableColumns";
import ColumnResizeHandle from "@/ui/ColumnResizeHandle";
import { useCustomFields } from "@/hooks/useCustomFields";
import { useUser } from "@/services/UserContext";
import {
  filterCustomFieldsForSection,
  filterCustomFieldsForSectionAndProjects,
} from "@/services/customFields";
import {
  customFieldFilterValue,
  customFieldValueToText,
  renderCustomFieldValue,
} from "@/components/CustomFields/renderCustomFieldValue";

// Built-in `key:value` filters. A custom field with one of these ids keeps its
// column and free-text search but can't shadow the built-in filter.
const RESERVED_FILTER_KEYS = new Set([
  "is",
  "datatype",
  "project",
  "identifier",
  "tag",
]);

const PAGE_SIZE = 10;

// Rough char budget for a column of `width` px. Only settles after a resize
// commits, which is why it takes the committed width rather than a live one.
function truncateCharsForWidth(width: number | undefined) {
  return Math.max(12, Math.floor((width ?? 220) / 8));
}

/**
 * Clamped content plus a tooltip that only appears once the text is actually
 * clipped. Measured rather than guessed from a character count: these columns
 * are resizable, so the same string clips at one width and fits at another.
 */
const ClampedCell: FC<{
  tooltip: string;
  clampLines?: number;
  children: ReactNode;
}> = ({ tooltip, clampLines = 1, children }) => {
  // A callback ref, not useRef: toggling `enabled` swaps a fragment for the
  // tooltip trigger, which remounts this node. A held ref would keep measuring
  // the detached one, read 0, and flip the tooltip straight back off.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    if (!node) return;
    const measure = () =>
      setOverflowing(
        node.scrollHeight > node.clientHeight + 1 ||
          node.scrollWidth > node.clientWidth + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    // The cell too: a line-clamped box keeps the same height whatever its
    // content, so watching only this node would never re-fire on resize.
    if (node.parentElement) observer.observe(node.parentElement);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, tooltip, clampLines]);

  return (
    <RadixTooltip content={tooltip} enabled={overflowing}>
      <div
        ref={setNode}
        style={
          clampLines > 1
            ? {
                display: "-webkit-box",
                WebkitLineClamp: clampLines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
            : {
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }
        }
      >
        {children}
      </div>
    </RadixTooltip>
  );
};

const EmptySection: FC<{
  title: string;
  body: string;
  cta: string | null;
  onClick: () => void;
}> = ({ title, body, cta, onClick }) => (
  <Flex
    direction="column"
    align="center"
    gap="2"
    py="7"
    px="6"
    style={{
      background: "var(--color-panel-solid)",
      border: "1px solid var(--gray-a5)",
      borderRadius: "var(--radius-3)",
      textAlign: "center",
    }}
  >
    <Text weight="semibold" align="center">
      {title}
    </Text>
    <Box style={{ maxWidth: 460 }}>
      <Text as="div" color="text-low" align="center">
        {body}
      </Text>
    </Box>
    {cta && (
      <Box mt="2">
        <Button onClick={onClick}>{cta}</Button>
      </Box>
    )}
  </Flex>
);

// Features count rollout and experiment rules as well as targeting conditions.
function usageCounts(refs: AttributeRefEntry | undefined) {
  if (!refs) return { usedIn: undefined };
  return {
    usedIn: refs.experiments.length + refs.features.length,
    experimentCount: refs.experiments.length,
    featureCount: refs.features.length,
  };
}

function pluralize(count: number, noun: string) {
  return count ? `${count} ${noun}${count === 1 ? "" : "s"}` : "";
}

function buildAttributeColumns<T extends SDKAttribute>({
  nameLabel,
  customFields,
  extraColumns = [],
  onEdit,
  onConvertToIdentifier,
}: {
  nameLabel: string;
  customFields: CustomField[];
  extraColumns?: TableColumnDef<T>[];
  onEdit: (row: T) => void;
  onConvertToIdentifier?: (row: T) => void;
}): TableColumnDef<T>[] {
  return [
    {
      id: "property",
      label: nameLabel,
      sortField: "property",
      hideable: false,
      defaultWidth: 200,
      minWidth: 120,
      render: (v, width) => (
        <Flex align="center" gap="2">
          <Link
            href={`/attributes/${encodeURIComponent(v.property)}`}
            style={{ color: "var(--gray-12)" }}
          >
            <Text mono weight="medium">
              <TruncateMiddleWithTooltip
                text={v.property}
                maxChars={truncateCharsForWidth(width)}
                maxWidth="100%"
              />
            </Text>
          </Link>
          {v.archived && <Badge label="Archived" color="gray" />}
        </Flex>
      ),
    },
    {
      id: "description",
      label: "Description",
      sortField: "description",
      defaultWidth: 360,
      cellProps: () => ({ className: "text-gray" }),
      render: (v) =>
        v.description ? (
          // Plain text in the tooltip: Radix wraps content in a <p>, so
          // rendered Markdown would nest block elements inside it.
          <ClampedCell tooltip={v.description} clampLines={2}>
            <Markdown className="mb-0">{v.description}</Markdown>
          </ClampedCell>
        ) : (
          <Text color="text-low">—</Text>
        ),
    },
    {
      id: "datatype",
      label: "Data Type",
      sortField: "datatype",
      defaultWidth: 170,
      cellProps: () => ({ className: "text-gray" }),
      render: (v) => {
        // Enum lists are unbounded, so the detail line gets one line plus a
        // tooltip rather than wrapping and making every row taller.
        const detail =
          v.datatype === "enum" && v.enum
            ? `(${v.enum})`
            : v.format
              ? `(format: ${v.format})`
              : "";
        return (
          <>
            <Text as="div" truncate>
              {v.datatype}
            </Text>
            {detail && (
              <ClampedCell tooltip={detail}>
                {/* Inline, so the clamp's text-overflow ellipsis applies — it
                      doesn't act on an overflowing block child. whiteSpace is
                      explicit because Text otherwise sets `normal` inline,
                      which beats the clamp's nowrap and lets the text wrap. */}
                <Text as="span" size="sm" whiteSpace="nowrap">
                  {detail}
                </Text>
              </ClampedCell>
            )}
          </>
        );
      },
    },
    {
      id: "projects",
      label: "Projects",
      defaultWidth: 130,
      render: (v) => (
        <ProjectBadges
          resourceType="attribute"
          projectIds={(v.projects || []).length > 0 ? v.projects : undefined}
        />
      ),
    },
    {
      id: "tags",
      label: "Tags",
      defaultWidth: 130,
      render: (v) => (
        // The inner div is the flex min-width: 0 fix for SortedTags useFlex;
        // overflow must not go on the <td> (list cells stay visible so
        // in-cell poppers aren't clipped).
        <div
          className="tags-cell-content"
          style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden" }}
        >
          <SortedTags
            tags={v.tags || []}
            useFlex={true}
            maxVisibleTags={1}
            truncateTagChars={15}
          />
        </div>
      ),
    },
    // Hidden by default so existing users see no change until they opt in.
    ...customFields.map<TableColumnDef<T>>((f) => ({
      id: `custom:${f.id}`,
      label: f.name,
      header: f.description ? (
        <>
          {f.name}{" "}
          <RadixTooltip content={f.description}>
            <PiInfo style={{ position: "relative", top: "-1px" }} />
          </RadixTooltip>
        </>
      ) : undefined,
      defaultWidth: 160,
      defaultHidden: true,
      cellProps: () => ({ className: "text-gray" }),
      render: (v) => {
        const raw = v.customFields?.[f.id] ?? "";
        const text = customFieldValueToText(f, raw);
        if (!text.trim()) return null;
        return (
          <ClampedCell
            tooltip={text}
            clampLines={f.type === "textarea" || f.type === "markdown" ? 2 : 1}
          >
            {renderCustomFieldValue(f, raw)}
          </ClampedCell>
        );
      },
    })),
    ...extraColumns,
    {
      // The one column that absorbs leftover width, so a resize elsewhere
      // only moves the columns to its right. Renders nothing.
      id: "spacer",
      label: "",
      header: null,
      locked: true,
      resizable: false,
      minWidth: 0,
      render: () => null,
    },
    {
      id: "actions",
      label: "Row actions",
      header: null,
      locked: true,
      resizable: false,
      // Fixed, so the pinned column can't grow over the data it covers.
      defaultWidth: 40,
      minWidth: 40,
      headerProps: { style: { paddingLeft: 4, paddingRight: 4 } },
      cellProps: () => ({ style: { paddingLeft: 4, paddingRight: 4 } }),
      render: (v) => (
        <Flex justify="center">
          <AttributeRowMenu
            attribute={v}
            onEdit={() => onEdit(v)}
            onConvertToIdentifier={
              onConvertToIdentifier && (() => onConvertToIdentifier(v))
            }
          />
        </Flex>
      ),
    },
  ];
}

// Column order, visibility and width are saved per table under `storageKey`.
function AttributeColumnsTable<T extends SDKAttribute>({
  storageKey,
  columnDefs,
  rows,
  SortableHeader,
  emptyMessage,
  note,
}: {
  storageKey: string;
  columnDefs: TableColumnDef<T>[];
  rows: T[];
  SortableHeader: SearchReturn<T>["SortableTableColumnHeader"];
  emptyMessage: string | null;
  note: string;
}) {
  const {
    columns,
    visibleColumns,
    colSpan,
    hiddenCount,
    isCustomized,
    applySettings,
    setWidth,
    reset,
    colRefs,
    minTableWidth,
    ColGroup,
  } = useTableColumns({ storageKey, columns: columnDefs });

  // Lives in the empty row-actions header rather than the filter toolbar, which
  // is for data filters.
  const columnSettings = (
    <Flex justify="center">
      <ColumnSettingsButton
        columns={columns
          // Locked columns can't be hidden or moved, so listing them is noise.
          .filter((c) => !c.locked)
          .map((c) => ({
            id: c.id,
            label: c.label,
            visible: c.visible,
            alwaysVisible: c.hideable === false,
          }))}
        hiddenCount={hiddenCount}
        canReset={isCustomized}
        onReset={reset}
        onChange={applySettings}
        note={note}
      />
    </Flex>
  );

  const renderHeader = (col: ResolvedTableColumn<T>) =>
    col.id === "actions"
      ? columnSettings
      : col.header !== undefined
        ? col.header
        : col.label;

  const renderResizeHandle = (col: ResolvedTableColumn<T>) => {
    if (col.resizable === false) return null;
    const { min, max } = columnWidthBounds(col);
    return (
      <ColumnResizeHandle
        label={col.label}
        width={col.width}
        minWidth={min}
        maxWidth={max}
        onCommit={(w) => setWidth(col.id, w)}
        setLiveWidth={(w) => {
          const el = colRefs.current.get(col.id);
          if (!el) return;
          el.style.width = `${w}px`;
          // Move the floor with the drag, or the auto column squeezes mid-drag
          // and snaps back to its minimum on release.
          const committed = col.width ?? columnWidthBounds(col).min;
          el.closest<HTMLElement>("[data-table-list]")?.style.setProperty(
            "--table-min-width",
            `${minTableWidth - committed + w}px`,
          );
        }}
      />
    );
  };

  return (
    <Table
      variant="list"
      stickyHeader
      roundedCorners
      layout="fixed"
      scrollX
      stickyLastColumn
      minTableWidth={minTableWidth}
    >
      <ColGroup />
      <TableHeader>
        <TableRow>
          {visibleColumns.map((col) =>
            col.sortField ? (
              <SortableHeader
                key={col.id}
                field={col.sortField}
                className={col.headerProps?.className}
                style={{
                  textAlign: col.align,
                  ...col.headerProps?.style,
                }}
                endAdornment={renderResizeHandle(col)}
              >
                {renderHeader(col)}
              </SortableHeader>
            ) : (
              <TableColumnHeader
                key={col.id}
                className={col.headerProps?.className}
                style={{
                  textAlign: col.align,
                  ...col.headerProps?.style,
                }}
              >
                {renderHeader(col)}
                {renderResizeHandle(col)}
              </TableColumnHeader>
            ),
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((v) => (
          <TableRow key={v.property}>
            {visibleColumns.map((col) => {
              const { className, style } = col.cellProps?.(v) ?? {};
              return (
                <TableCell key={col.id} className={className} style={style}>
                  {col.render(v, col.width)}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
        {!rows.length && emptyMessage && (
          <TableRow>
            <TableCell colSpan={colSpan}>
              <Text color="text-low">{emptyMessage}</Text>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

const FeatureAttributesPage = (): React.ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const { project, projects, getProjectById } = useDefinitions();
  const attributeSchema = useAttributeSchema(true, project);

  const canCreateAttributes = permissionsUtil.canViewAttributeModal(
    project,
    projects,
  );

  const [modalData, setModalData] = useState<null | string>(null);
  const [identifierModal, setIdentifierModal] = useState<{
    existing?: SDKAttribute;
  } | null>(null);

  // Column ids are namespaced `custom:<fieldId>`. Those ids are org-unique, so a
  // saved layout carried into another org just resolves away instead of breaking.
  const { hasCommercialFeature } = useUser();
  const allCustomFields = useCustomFields();
  const attributeCustomFields = useMemo(() => {
    if (!hasCommercialFeature("custom-metadata")) return [];
    // Under "All Projects" the table lists attributes from every project, so
    // scoping the columns to one project's fields would hide metadata that
    // visible rows carry.
    const fields = project
      ? filterCustomFieldsForSectionAndProjects(allCustomFields, "attribute", [
          project,
        ])
      : filterCustomFieldsForSection(allCustomFields, "attribute");
    return fields ?? [];
  }, [allCustomFields, hasCommercialFeature, project]);
  const filterableCustomFields = useMemo(
    () =>
      attributeCustomFields.filter(
        (f) => !RESERVED_FILTER_KEYS.has(f.id.toLowerCase()),
      ),
    [attributeCustomFields],
  );

  const attributesWithComputedFields = useAddComputedFields(
    attributeSchema,
    (attr) => {
      const projectNames = (attr.projects || []).map(
        (pid) => getProjectById(pid)?.name ?? pid,
      );
      const datatypeSearch = [
        attr.datatype,
        attr.datatype === "enum" && attr.enum ? attr.enum : "",
        attr.format ? `format ${attr.format}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return {
        ...attr,
        id: attr.property,
        projectNames,
        projectNamesSearch: projectNames.filter(Boolean).join(" "),
        datatypeSearch,
        tagsSearch: (attr.tags || []).join(" "),
        customFieldsSearch: attributeCustomFields
          .map((f) =>
            customFieldValueToText(f, attr.customFields?.[f.id] ?? ""),
          )
          .filter(Boolean)
          .join(" "),
      };
    },
    [getProjectById, attributeCustomFields],
  );

  const identifiers = useMemo(
    () =>
      attributesWithComputedFields
        .filter((a) => a.hashAttribute)
        // Creation order, so the org's primary identifier stays first.
        .map((a, order) => ({ ...a, order })),
    [attributesWithComputedFields],
  );
  const targetingAttributes = useMemo(
    () => attributesWithComputedFields.filter((a) => !a.hashAttribute),
    [attributesWithComputedFields],
  );

  // Archived rows are hidden until an `archived:` filter asks for them, mirroring
  // the features list. Synced from the parsed query below, as there.
  const [showArchived, setShowArchived] = useState(false);
  const archivedFilter = useMemo(
    () =>
      showArchived
        ? undefined
        : (items: typeof attributesWithComputedFields) =>
            items.filter((a) => !a.archived),
    [showArchived],
  );

  const {
    items: filteredAttributes,
    searchInputProps,
    setSearchValue,
    syntaxFilters,
    isFiltered,
    SortableTableColumnHeader,
    unpaginatedItems: sortedAttributes,
    page: attributePage,
    setPage: setAttributePage,
  } = useSearch({
    items: targetingAttributes,
    localStorageKey: "attributes",
    defaultSortField: "property",
    pageSize: PAGE_SIZE,
    filterResults: archivedFilter,
    searchFields: [
      "property^3",
      "description",
      "datatype",
      "datatypeSearch",
      "projectNamesSearch",
      "tagsSearch",
      "customFieldsSearch",
    ],
    updateSearchQueryOnChange: true,
    searchTermFilterDeps: [attributeCustomFields],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [item.datatype];
        if (item.archived) is.push("archived");
        return is;
      },
      datatype: (item) => item.datatype,
      project: (item) => item.projectNames || [],
      tag: (item) => item.tags || [],
      // parseQuery lowercases the field, so the filter keys must match.
      ...Object.fromEntries(
        filterableCustomFields.map((f) => [
          f.id.toLowerCase(),
          (item: { customFields?: Record<string, string> }) =>
            customFieldFilterValue(f, item.customFields?.[f.id] ?? ""),
        ]),
      ),
    },
  });

  useEffect(() => {
    setShowArchived(
      syntaxFilters.some(
        (f) =>
          f.field === "is" &&
          !f.negated &&
          f.values.some((v) => v.toLowerCase() === "archived"),
      ),
    );
  }, [syntaxFilters]);

  const { references: identifierReferences } = useAttributeReferences(
    identifiers.map((i) => i.property),
  );
  // Separate from the attributes search, which only filters that table.
  const [showArchivedIdentifiers, setShowArchivedIdentifiers] = useState(false);
  const identifierRows = useMemo(
    () =>
      identifiers.map((i) => ({
        ...i,
        ...usageCounts(identifierReferences?.[i.property]),
      })),
    [identifiers, identifierReferences],
  );
  const archivedIdentifierFilter = useMemo(
    () =>
      showArchivedIdentifiers
        ? undefined
        : (items: typeof identifierRows) => items.filter((i) => !i.archived),
    [showArchivedIdentifiers],
  );
  const {
    items: pagedIdentifiers,
    unpaginatedItems: sortedIdentifiers,
    page: identifierPage,
    setPage: setIdentifierPage,
    SortableTableColumnHeader: SortableIdentifierHeader,
    searchInputProps: identifierSearchInputProps,
    setSearchValue: setIdentifierSearchValue,
    syntaxFilters: identifierSyntaxFilters,
    isFiltered: identifiersFiltered,
  } = useSearch({
    items: identifierRows,
    localStorageKey: "identifiers",
    defaultSortField: "order",
    persistSort: false,
    disableUrlSearchTerm: true,
    pageSize: PAGE_SIZE,
    filterResults: archivedIdentifierFilter,
    searchFields: [
      "property^3",
      "description",
      "datatype",
      "projectNamesSearch",
      "tagsSearch",
      "customFieldsSearch",
    ],
    searchTermFilters: {
      is: (item) =>
        item.archived ? [item.datatype, "archived"] : [item.datatype],
      datatype: (item) => item.datatype,
      project: (item) => item.projectNames || [],
      tag: (item) => item.tags || [],
    },
  });

  useEffect(() => {
    setShowArchivedIdentifiers(
      identifierSyntaxFilters.some(
        (f) =>
          f.field === "is" &&
          !f.negated &&
          f.values.some((v) => v.toLowerCase() === "archived"),
      ),
    );
  }, [identifierSyntaxFilters]);

  type AttributeRow = (typeof attributesWithComputedFields)[number];
  type IdentifierRow = (typeof identifierRows)[number];

  const attributeColumns = useMemo(
    () =>
      buildAttributeColumns<AttributeRow>({
        nameLabel: "Attribute",
        customFields: attributeCustomFields,
        onEdit: (v) => setModalData(v.property),
        onConvertToIdentifier: (v) => setIdentifierModal({ existing: v }),
      }),
    [attributeCustomFields],
  );
  const identifierColumns = useMemo(
    () =>
      buildAttributeColumns<IdentifierRow>({
        nameLabel: "Identifier",
        customFields: attributeCustomFields,
        onEdit: (v) => setIdentifierModal({ existing: v }),
        extraColumns: [
          {
            id: "usedIn",
            label: "Used in",
            sortField: "usedIn",
            defaultWidth: 130,
            render: (v) =>
              v.usedIn === undefined ? null : v.usedIn === 0 ? (
                <Text color="text-low">Not used</Text>
              ) : (
                <Text color="text-mid">
                  {[
                    pluralize(v.experimentCount ?? 0, "experiment"),
                    pluralize(v.featureCount ?? 0, "feature"),
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </Text>
              ),
          },
        ],
      }),
    [attributeCustomFields],
  );

  return (
    <>
      <Box className="contents container-fluid pagecontents">
        <Box mb="5">
          <Heading as="h1" size="xl" mb="2">
            Attributes
          </Heading>
          <Text as="div" color="text-low">
            The user properties your SDK passes in: identifiers for experiment
            assignment, and attributes for targeting.
          </Text>
        </Box>
        <Flex direction="column" gap="7" mb="5">
          <Flex direction="column" gap="3">
            <Flex justify="between" align="end" gap="3">
              <Box>
                <Flex align="center" gap="2" mb="1">
                  <Heading as="h2" size="md" mb="0">
                    Identifiers
                  </Heading>
                  <Badge label={String(identifiers.length)} color="gray" />
                </Flex>
                <Text as="div" color="text-low">
                  Used to assign users consistently in experiments and
                  percentage rollouts.
                </Text>
              </Box>
              {canCreateAttributes && identifiers.length > 0 && (
                <Button onClick={() => setIdentifierModal({})}>
                  Add Identifier
                </Button>
              )}
            </Flex>
            {identifiers.length > 0 ? (
              <>
                <Flex justify="between" gap="3" align="center">
                  <Box style={{ width: "40%", minWidth: 240 }}>
                    <TextField
                      placeholder="Search identifiers"
                      type="search"
                      aria-label="Search identifiers"
                      prepend={<PiMagnifyingGlass aria-hidden="true" />}
                      {...identifierSearchInputProps}
                    />
                  </Box>
                  <AttributeSearchFilters
                    attributes={identifiers}
                    searchInputProps={identifierSearchInputProps}
                    setSearchValue={setIdentifierSearchValue}
                    syntaxFilters={identifierSyntaxFilters}
                    noun="identifiers"
                  />
                </Flex>
                <AttributeColumnsTable
                  storageKey="identifiers"
                  columnDefs={identifierColumns}
                  rows={pagedIdentifiers}
                  SortableHeader={SortableIdentifierHeader}
                  emptyMessage={
                    identifiersFiltered
                      ? "No identifiers match this search."
                      : "All identifiers are archived. Show them with More > Archived identifiers."
                  }
                  note="The Identifier column is always shown."
                />
                {sortedIdentifiers.length > PAGE_SIZE && (
                  <Box mt="3">
                    <Pagination
                      numItemsTotal={sortedIdentifiers.length}
                      perPage={PAGE_SIZE}
                      currentPage={identifierPage}
                      onPageChange={setIdentifierPage}
                    />
                  </Box>
                )}
              </>
            ) : (
              <EmptySection
                title="No identifiers yet"
                body="Experiments need at least one identifier, such as a user ID or device ID, to assign variations consistently."
                cta={canCreateAttributes ? "Add Identifier" : null}
                onClick={() => setIdentifierModal({})}
              />
            )}
          </Flex>

          <Flex direction="column" gap="3">
            <Flex justify="between" align="end" gap="3">
              <Box>
                <Flex align="center" gap="2" mb="1">
                  <Heading as="h2" size="md" mb="0">
                    Targeting Attributes
                  </Heading>
                  <Badge
                    label={String(targetingAttributes.length)}
                    color="gray"
                  />
                </Flex>
                <Text as="div" color="text-low">
                  Used in targeting conditions for feature flags and
                  experiments. Attributes must also be passed in through the
                  SDK.
                </Text>
              </Box>
              {canCreateAttributes && targetingAttributes.length > 0 && (
                <Button onClick={() => setModalData("")}>Add Attribute</Button>
              )}
            </Flex>
            {targetingAttributes.length > 0 ? (
              <Box>
                <Box mb="3">
                  <Flex justify="between" gap="3" align="center">
                    <Box style={{ width: "40%", minWidth: 240 }}>
                      <TextField
                        placeholder="Search attributes"
                        type="search"
                        aria-label="Search attributes"
                        prepend={<PiMagnifyingGlass aria-hidden="true" />}
                        {...searchInputProps}
                      />
                    </Box>
                    <AttributeSearchFilters
                      attributes={targetingAttributes}
                      searchInputProps={searchInputProps}
                      setSearchValue={setSearchValue}
                      syntaxFilters={syntaxFilters}
                      customFields={filterableCustomFields}
                    />
                  </Flex>
                </Box>
                <AttributeColumnsTable
                  storageKey="attributes"
                  columnDefs={attributeColumns}
                  rows={filteredAttributes}
                  SortableHeader={SortableTableColumnHeader}
                  emptyMessage={
                    isFiltered ? "No attributes match this search." : null
                  }
                  note="The Attribute column is always shown."
                />
                {sortedAttributes.length > PAGE_SIZE && (
                  <Box mt="3">
                    <Pagination
                      numItemsTotal={sortedAttributes.length}
                      perPage={PAGE_SIZE}
                      currentPage={attributePage}
                      onPageChange={setAttributePage}
                    />
                  </Box>
                )}
              </Box>
            ) : (
              <EmptySection
                title="No targeting attributes yet"
                body="Add the user properties your SDK passes in, like country, plan, or browser, to use them in targeting conditions."
                cta={canCreateAttributes ? "Add Attribute" : null}
                onClick={() => setModalData("")}
              />
            )}
          </Flex>
        </Flex>
      </Box>
      {modalData !== null && (
        <AttributeModal
          close={() => setModalData(null)}
          attribute={modalData || undefined}
          onAddIdentifier={() => {
            setModalData(null);
            setIdentifierModal({});
          }}
        />
      )}
      {identifierModal && (
        <IdentifierModal
          source="attributes-page"
          existing={identifierModal.existing}
          close={() => setIdentifierModal(null)}
        />
      )}
    </>
  );
};

export default FeatureAttributesPage;
