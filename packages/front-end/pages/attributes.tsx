import React, { useMemo, useState } from "react";
import { PiInfo } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { BiShow } from "react-icons/bi";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "@/components/Modal";
import { useAttributeSchema } from "@/services/features";
import AttributeModal from "@/components/Features/AttributeModal";
import AttributeRowMenu from "@/components/Features/AttributeRowMenu";
import AttributeReferencesList from "@/components/Features/AttributeReferencesList";
import ProjectBadges from "@/components/ProjectBadges";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import { useAddComputedFields, useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import AttributeSearchFilters from "@/components/Search/AttributeSearchFilters";
import SortedTags from "@/components/Tags/SortedTags";
import Markdown from "@/components/Markdown/Markdown";
import Link from "@/ui/Link";
import { useAttributeReferences } from "@/hooks/useAttributeReferences";
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
import { TableColumnDef } from "@/services/tableColumns";

const ATTRIBUTE_NAME_COLUMN_MAX_WIDTH = 200;
const TAGS_COLUMN_MAX_WIDTH = 160;

const FeatureAttributesPage = (): React.ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const { project, projects, getProjectById } = useDefinitions();
  const attributeSchema = useAttributeSchema(true, project);

  const canCreateAttributes = permissionsUtil.canViewAttributeModal(
    project,
    projects,
  );

  const [modalData, setModalData] = useState<null | string>(null);

  const attributeKeys = useMemo(
    () => attributeSchema.map((a) => a.property),
    [attributeSchema],
  );
  const { references } = useAttributeReferences(attributeKeys);

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
      };
    },
    [getProjectById],
  );

  const hasArchived = attributeSchema.some((a) => a.archived);

  const {
    items: filteredAttributes,
    searchInputProps,
    setSearchValue,
    syntaxFilters,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: attributesWithComputedFields,
    localStorageKey: "attributes",
    defaultSortField: "property",
    pageSize: 50,
    searchFields: [
      "property^3",
      "description",
      "datatype",
      "datatypeSearch",
      "projectNamesSearch",
      "tagsSearch",
    ],
    updateSearchQueryOnChange: true,
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [item.datatype];
        if (item.archived) is.push("archived");
        return is;
      },
      datatype: (item) => item.datatype,
      project: (item) => item.projectNames || [],
      identifier: (item) =>
        item.hashAttribute ? ["yes", "true"] : ["no", "false"],
      tag: (item) => item.tags || [],
    },
  });

  const [referencesProperty, setReferencesProperty] = useState<string | null>(
    null,
  );
  const referencesAttribute =
    referencesProperty !== null
      ? attributeSchema.find((a) => a.property === referencesProperty)
      : undefined;

  type AttributeRow = (typeof attributesWithComputedFields)[number];

  const columnDefs = useMemo<TableColumnDef<AttributeRow>[]>(
    () => [
      {
        id: "property",
        label: "Attribute",
        sortField: "property",
        hideable: false,
        defaultWidth: ATTRIBUTE_NAME_COLUMN_MAX_WIDTH,
        cellProps: () => ({ className: "text-gray font-weight-bold" }),
        render: (v) => (
          <>
            <Link
              href={`/attributes/${encodeURIComponent(v.property)}`}
              style={{ color: "var(--gray-12)" }}
            >
              <TruncateMiddleWithTooltip
                text={v.property}
                maxChars={23}
                maxWidth={ATTRIBUTE_NAME_COLUMN_MAX_WIDTH}
              />
            </Link>{" "}
            {v.archived && (
              <span className="badge badge-secondary" style={{ marginLeft: 8 }}>
                archived
              </span>
            )}
          </>
        ),
      },
      {
        id: "description",
        label: "Description",
        sortField: "description",
        defaultWidth: 200,
        cellProps: () => ({
          className: "text-gray",
          style: { overflow: "hidden" },
        }),
        render: (v) =>
          v.description ? (
            <Markdown className="mb-0">{v.description}</Markdown>
          ) : null,
      },
      {
        id: "datatype",
        label: "Data Type",
        sortField: "datatype",
        cellProps: () => ({
          className: "text-gray",
          style: { wordWrap: "break-word" },
        }),
        render: (v) => (
          <>
            {v.datatype}
            {v.datatype === "enum" && <>: ({v.enum})</>}
            {v.format && (
              <p className="my-0">
                <small>(format: {v.format})</small>
              </p>
            )}
          </>
        ),
      },
      {
        id: "projects",
        label: "Projects",
        headerProps: { style: { paddingRight: "1rem" } },
        cellProps: () => ({ style: { paddingRight: "1rem" } }),
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
        defaultWidth: TAGS_COLUMN_MAX_WIDTH,
        cellProps: () => ({ style: { overflow: "hidden" } }),
        render: (v) => (
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
      {
        id: "references",
        label: "References",
        cellProps: () => ({ className: "text-gray" }),
        render: (v) => {
          const refs = references?.[v.property];
          const numReferences =
            (refs?.features.length ?? 0) +
            (refs?.experiments.length ?? 0) +
            (refs?.savedGroups.length ?? 0);

          return numReferences > 0 ? (
            <Link
              onClick={() => setReferencesProperty(v.property)}
              style={{ whiteSpace: "nowrap" }}
            >
              <BiShow /> {numReferences} reference
              {numReferences === 1 ? "" : "s"}
            </Link>
          ) : (
            <Tooltip body="No features, experiments, or condition groups reference this attribute.">
              <span
                style={{
                  whiteSpace: "nowrap",
                  color: "var(--gray-10)",
                  cursor: "not-allowed",
                }}
              >
                <BiShow /> 0 references
              </span>
            </Tooltip>
          );
        },
      },
      {
        id: "hashAttribute",
        label: "Identifier",
        header: (
          <>
            Identifier{" "}
            <Tooltip
              body="Any attribute that uniquely identifies a user, account, device, or similar."
              popperStyle={{ textAlign: "left" }}
            >
              <PiInfo style={{ position: "relative", top: "-1px" }} />
            </Tooltip>
          </>
        ),
        align: "center",
        cellProps: () => ({ className: "text-gray" }),
        render: (v) => (
          <Flex justify="center">{v.hashAttribute && <>yes</>}</Flex>
        ),
      },
      {
        id: "actions",
        label: "Row actions",
        header: null,
        locked: true,
        resizable: false,
        headerProps: { className: "text-center" },
        render: (v) => (
          <AttributeRowMenu
            attribute={v}
            onEdit={() => setModalData(v.property)}
          />
        ),
      },
    ],
    [references],
  );

  const {
    columns,
    visibleColumns,
    colSpan,
    hiddenCount,
    isCustomized,
    applySettings,
    reset,
  } = useTableColumns({ storageKey: "attributes", columns: columnDefs });

  return (
    <>
      <Box className="contents container-fluid pagecontents">
        <Box mb="5">
          <Flex direction="column" gap="2" mb="3">
            <Flex justify="between" align="center" mb="1">
              <Heading as="h1" size="xl">
                Targeting Attributes
              </Heading>
              {canCreateAttributes && (
                <Button onClick={() => setModalData("")}>Add Attribute</Button>
              )}
            </Flex>
            <Text as="p" color="text-low">
              These attributes can be used when targeting feature flags and
              experiments. Attributes set here must also be passed in through
              the SDK.
            </Text>
          </Flex>
          {attributeSchema?.length > 0 && (
            <Box mb="3">
              <Flex justify="between" gap="3" align="center">
                <Box className="relative" style={{ width: "40%" }}>
                  <Field
                    size="legacy"
                    placeholder="Search..."
                    type="search"
                    {...searchInputProps}
                  />
                </Box>
                <Flex gap="5" align="center">
                  <AttributeSearchFilters
                    attributes={attributesWithComputedFields}
                    searchInputProps={searchInputProps}
                    setSearchValue={setSearchValue}
                    syntaxFilters={syntaxFilters}
                    hasArchived={hasArchived}
                  />
                  <ColumnSettingsButton
                    columns={columns
                      // The row-actions column has no header and can't be
                      // hidden or moved, so listing it is pure noise.
                      .filter((c) => c.header !== null)
                      .map((c) => ({
                        id: c.id,
                        label: c.label,
                        visible: c.visible,
                        alwaysVisible: c.locked || c.hideable === false,
                      }))}
                    hiddenCount={hiddenCount}
                    canReset={isCustomized}
                    onReset={reset}
                    onChange={applySettings}
                    note="The Attribute column is always shown."
                  />
                </Flex>
              </Flex>
            </Box>
          )}
          <Table
            variant="list"
            stickyHeader
            roundedCorners
            style={{ tableLayout: "auto" }}
          >
            <TableHeader>
              <TableRow>
                {visibleColumns.map((col) =>
                  col.sortField ? (
                    <SortableTableColumnHeader
                      key={col.id}
                      field={col.sortField}
                      className={col.headerProps?.className}
                      style={{
                        maxWidth: col.width,
                        textAlign: col.align,
                        ...col.headerProps?.style,
                      }}
                    >
                      {col.header !== undefined ? col.header : col.label}
                    </SortableTableColumnHeader>
                  ) : (
                    <TableColumnHeader
                      key={col.id}
                      className={col.headerProps?.className}
                      style={{
                        maxWidth: col.width,
                        textAlign: col.align,
                        ...col.headerProps?.style,
                      }}
                    >
                      {col.header !== undefined ? col.header : col.label}
                    </TableColumnHeader>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {attributeSchema?.length > 0 ? (
                <>
                  {filteredAttributes.map((v) => (
                    <TableRow
                      className={v.archived ? "disabled" : ""}
                      key={"attr-row-" + v.property}
                    >
                      {visibleColumns.map((col) => {
                        const { className, style } = col.cellProps?.(v) ?? {};
                        return (
                          <TableCell
                            key={col.id}
                            className={className}
                            style={{ maxWidth: col.width, ...style }}
                          >
                            {col.render(v)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  {!filteredAttributes.length && isFiltered && (
                    <TableRow>
                      <TableCell
                        colSpan={colSpan}
                        className="text-center text-gray"
                      >
                        No matching attributes found.
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={colSpan}
                    className="text-center text-gray"
                  >
                    <em>No attributes defined.</em>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {pagination}
        </Box>
      </Box>
      {referencesAttribute && (
        <Modal
          header={`'${referencesAttribute.property}' References`}
          trackingEventModalType="show-attribute-references"
          close={() => setReferencesProperty(null)}
          open={true}
          closeCta="Close"
        >
          <Text as="p" mb="3">
            This attribute is referenced by the following features, experiments,
            and condition groups.
          </Text>
          <AttributeReferencesList
            features={
              references?.[referencesAttribute.property]?.features ?? []
            }
            experiments={
              references?.[referencesAttribute.property]?.experiments ?? []
            }
            conditionGroups={
              references?.[referencesAttribute.property]?.savedGroups ?? []
            }
          />
        </Modal>
      )}
      {modalData !== null && (
        <AttributeModal
          close={() => setModalData(null)}
          attribute={modalData}
        />
      )}
    </>
  );
};

export default FeatureAttributesPage;
