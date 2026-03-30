import React, { useState, FC } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { TagInterface } from "shared/types/tag";
import { Box, Flex } from "@radix-ui/themes";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import TagsModal from "@/components/Tags/TagsModal";
import Tag from "@/components/Tags/Tag";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const TagsPage: FC = () => {
  const { tags, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<TagInterface> | null>(
    null,
  );
  const { items, searchInputProps, isFiltered, SortableTableColumnHeader } =
    useSearch({
      items: tags || [],
      localStorageKey: "tags",
      defaultSortField: "id",
      searchFields: ["id", "description"],
    });

  const permissionsUtil = usePermissionsUtil();

  const canManageTags =
    permissionsUtil.canCreateAndUpdateTag() || permissionsUtil.canDeleteTag();

  if (!canManageTags) {
    return (
      <Box className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </Box>
    );
  }

  return (
    <Box className="container-fluid pagecontents">
      <Box mb="6">
        {modalOpen && (
          <TagsModal
            existing={modalOpen}
            close={() => setModalOpen(null)}
            onSuccess={() => mutateDefinitions()}
          />
        )}
        <Flex justify="between" align="start">
          <Heading as="h1">Tags</Heading>
          {permissionsUtil.canCreateAndUpdateTag() ? (
            <Button onClick={() => setModalOpen({})}>Add Tag</Button>
          ) : null}
        </Flex>
        <p>Organize features, experiments, metrics, and more with tags.</p>
        {tags?.length > 0 && (
          <>
            <Flex mb="2" align="center">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Flex>
            <Table variant="list" stickyHeader roundedCorners>
              <TableHeader>
                <TableRow>
                  <SortableTableColumnHeader field="id">
                    Tag name
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="description">
                    Description
                  </SortableTableColumnHeader>
                  <TableColumnHeader>Preview</TableColumnHeader>
                  <TableColumnHeader style={{ width: 140 }} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items?.map((t) => {
                  return (
                    <TableRow key={t.id}>
                      <TableCell
                        onClick={(e) => {
                          e.preventDefault();
                          setModalOpen(t);
                        }}
                        className="cursor-pointer"
                      >
                        {t.id}
                      </TableCell>
                      <TableCell>{t.description}</TableCell>
                      <TableCell>
                        <Tag tag={t.id} skipMargin={true} />
                      </TableCell>
                      <TableCell>
                        <Flex className="tr-hover" gap="2" align="center">
                          {permissionsUtil.canCreateAndUpdateTag() ? (
                            <button
                              type="button"
                              className="btn btn-outline-primary mr-2"
                              aria-label={`Edit tag ${t.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setModalOpen(t);
                              }}
                            >
                              <FaPencilAlt />
                            </button>
                          ) : null}
                          {permissionsUtil.canDeleteTag() ? (
                            <DeleteButton
                              deleteMessage="Are you sure? Deleting a tag will remove it from all features, metrics, and experiments."
                              displayName="Tag"
                              onClick={async () => {
                                await apiCall(`/tag/`, {
                                  method: "DELETE",
                                  body: JSON.stringify({ id: t.id }),
                                });
                                mutateDefinitions();
                              }}
                            />
                          ) : null}
                        </Flex>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!items.length && isFiltered && (
                  <TableRow>
                    <TableCell colSpan={4} style={{ textAlign: "center" }}>
                      No matching tags found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </Box>
    </Box>
  );
};
export default TagsPage;
