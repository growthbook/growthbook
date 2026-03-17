import React, { useMemo, useState } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { Box, Flex } from "@radix-ui/themes";
import { BiShow } from "react-icons/bi";
import { SDKAttribute } from "shared/types/organization";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import AttributeModal from "@/components/Features/AttributeModal";
import AttributeReferencesList from "@/components/Features/AttributeReferencesList";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import { useAddComputedFields, useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import AttributeSearchFilters from "@/components/Search/AttributeSearchFilters";
import SortedTags from "@/components/Tags/SortedTags";
import Markdown from "@/components/Markdown/Markdown";
import Link from "@/ui/Link";
import { useAttributeReferences } from "@/hooks/useAttributeReferences";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import Heading from "@/ui/Heading";

const FeatureAttributesPage = (): React.ReactElement => {
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const { project, projects, getProjectById } = useDefinitions();
  const attributeSchema = useAttributeSchema(true, project);

  const canCreateAttributes = permissionsUtil.canViewAttributeModal(
    project,
    projects,
  );

  const [modalData, setModalData] = useState<null | string>(null);
  const { refreshOrganization } = useUser();

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

  const attributesWithIndex = useMemo(
    () =>
      attributesWithComputedFields.map((a, i) => ({
        ...a,
        originalIndex: i,
      })),
    [attributesWithComputedFields],
  );

  const {
    items: filteredAttributes,
    searchInputProps,
    setSearchValue,
    syntaxFilters,
    isFiltered,
    SortableTableColumnHeader,
  } = useSearch({
    items: attributesWithIndex,
    localStorageKey: "attributes",
    defaultSortField: "property",
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

  const [showReferencesModal, setShowReferencesModal] = useState<number | null>(
    null,
  );

  const drawRow = (v: SDKAttribute) => {
    const refs = references?.[v.property];
    const numReferences =
      (refs?.features.length ?? 0) +
      (refs?.experiments.length ?? 0) +
      (refs?.savedGroups.length ?? 0);

    return (
      <TableRow
        className={v.archived ? "disabled" : ""}
        key={"attr-row-" + v.property}
      >
        <TableCell
          className="text-gray font-weight-bold"
          style={{ width: "17%", minWidth: 90 }}
        >
          <Link href={`/attributes/${encodeURIComponent(v.property)}`}>
            {v.property}
          </Link>{" "}
          {v.archived && (
            <span className="badge badge-secondary" style={{ marginLeft: 8 }}>
              archived
            </span>
          )}
        </TableCell>
        <TableCell className="text-gray" style={{ minWidth: 120 }}>
          {v.description ? (
            <Markdown className="mb-0">{v.description}</Markdown>
          ) : null}
        </TableCell>
        <TableCell
          className="text-gray"
          style={{ width: "15%", minWidth: 90, wordWrap: "break-word" }}
        >
          {v.datatype}
          {v.datatype === "enum" && <>: ({v.enum})</>}
          {v.format && (
            <p className="my-0">
              <small>(format: {v.format})</small>
            </p>
          )}
        </TableCell>
        <TableCell style={{ paddingRight: "1rem", minWidth: 80 }}>
          <ProjectBadges
            resourceType="attribute"
            projectIds={(v.projects || []).length > 0 ? v.projects : undefined}
          />
        </TableCell>
        <TableCell style={{ minWidth: 100 }}>
          <SortedTags tags={v.tags || []} useFlex={true} />
        </TableCell>
        <TableCell className="text-gray" style={{ minWidth: 85 }}>
          {numReferences > 0 ? (
            <Link
              onClick={() => {
                const schemaIndex = attributeSchema.findIndex(
                  (a) => a.property === v.property,
                );
                if (schemaIndex >= 0) setShowReferencesModal(schemaIndex);
              }}
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
          )}
        </TableCell>
        <TableCell className="text-gray" style={{ minWidth: 70 }}>
          <Flex justify="center">{v.hashAttribute && <>yes</>}</Flex>
        </TableCell>
        <TableCell style={{ minWidth: 44 }}>
          {permissionsUtil.canCreateAttribute(v) ? (
            <Flex justify="center">
              <MoreMenu>
                {!v.archived && (
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setModalData(v.property);
                    }}
                  >
                    Edit
                  </button>
                )}
                <button
                  className="dropdown-item"
                  onClick={async (e) => {
                    e.preventDefault();
                    const updatedAttribute: SDKAttribute = {
                      property: v.property,
                      datatype: v.datatype,
                      projects: v.projects,
                      format: v.format,
                      enum: v.enum,
                      hashAttribute: v.hashAttribute,
                      archived: !v.archived,
                      tags: v.tags,
                      description: v.description,
                      disableEqualityConditions: v.disableEqualityConditions,
                    };
                    await apiCall<{
                      res: number;
                    }>("/attribute", {
                      method: "PUT",
                      body: JSON.stringify(updatedAttribute),
                    });
                    refreshOrganization();
                  }}
                >
                  {v.archived ? "Unarchive" : "Archive"}
                </button>
                <DeleteButton
                  displayName="Attribute"
                  deleteMessage={
                    <>
                      Are you sure you want to delete the{" "}
                      {v.hashAttribute ? "identifier " : ""}
                      {v.datatype} attribute:{" "}
                      <code className="font-weight-bold">{v.property}</code>?
                      <br />
                      This action cannot be undone.
                    </>
                  }
                  className="dropdown-item text-danger"
                  onClick={async () => {
                    await apiCall<{
                      status: number;
                    }>("/attribute/", {
                      method: "DELETE",
                      body: JSON.stringify({ id: v.property }),
                    });
                    refreshOrganization();
                  }}
                  text="Delete"
                  useIcon={false}
                />
              </MoreMenu>
            </Flex>
          ) : null}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <>
      <Box className="contents container-fluid pagecontents">
        <Box mb="5">
          <Flex direction="column" gap="2" mb="3">
            <Flex justify="between" align="center" mb="1">
              <Heading size="x-large">Targeting Attributes</Heading>
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
                    placeholder="Search..."
                    type="search"
                    {...searchInputProps}
                  />
                </Box>
                <AttributeSearchFilters
                  attributes={attributesWithIndex}
                  searchInputProps={searchInputProps}
                  setSearchValue={setSearchValue}
                  syntaxFilters={syntaxFilters}
                  hasArchived={hasArchived}
                />
              </Flex>
            </Box>
          )}
          <Table
            variant="list"
            stickyHeader
            roundedCorners
            style={{ tableLayout: "fixed", minWidth: 900 }}
          >
            <TableHeader>
              <TableRow>
                <SortableTableColumnHeader
                  field="property"
                  style={{ width: "17%", minWidth: 90 }}
                >
                  Attribute
                </SortableTableColumnHeader>
                <SortableTableColumnHeader
                  field="description"
                  style={{ minWidth: 120 }}
                >
                  Description
                </SortableTableColumnHeader>
                <SortableTableColumnHeader
                  field="datatype"
                  style={{ width: "15%", minWidth: 90 }}
                >
                  Data Type
                </SortableTableColumnHeader>
                <TableColumnHeader
                  style={{ width: "15%", minWidth: 80, paddingRight: "1rem" }}
                >
                  Projects
                </TableColumnHeader>
                <TableColumnHeader style={{ width: "15%", minWidth: 100 }}>
                  Tags
                </TableColumnHeader>
                <TableColumnHeader style={{ width: "10%", minWidth: 85 }}>
                  References
                </TableColumnHeader>
                <TableColumnHeader
                  style={{ width: "10%", minWidth: 70 }}
                  className="text-center"
                >
                  Identifier{" "}
                  <Tooltip body="Any attribute that uniquely identifies a user, account, device, or similar.">
                    <FaQuestionCircle
                      style={{ position: "relative", top: "-1px" }}
                    />
                  </Tooltip>
                </TableColumnHeader>
                <TableColumnHeader
                  style={{ width: 44, minWidth: 44 }}
                  className="text-center"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {attributeSchema?.length > 0 ? (
                <>
                  {filteredAttributes.map((v) => drawRow(v))}
                  {!filteredAttributes.length && isFiltered && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-gray">
                        No matching attributes found.
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray">
                    <em>No attributes defined.</em>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Box>
      {showReferencesModal !== null &&
        attributeSchema?.[showReferencesModal] && (
          <Modal
            header={`'${attributeSchema[showReferencesModal].property}' References`}
            trackingEventModalType="show-attribute-references"
            close={() => setShowReferencesModal(null)}
            open={true}
            useRadixButton={true}
            closeCta="Close"
          >
            <Text as="p" mb="3">
              This attribute is referenced by the following features,
              experiments, and condition groups.
            </Text>
            <AttributeReferencesList
              features={
                references?.[attributeSchema[showReferencesModal].property]
                  ?.features ?? []
              }
              experiments={
                references?.[attributeSchema[showReferencesModal].property]
                  ?.experiments ?? []
              }
              conditionGroups={
                references?.[attributeSchema[showReferencesModal].property]
                  ?.savedGroups ?? []
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
