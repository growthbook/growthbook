import React, { useState, FC } from "react";
import { TagInterface } from "shared/types/tag";
import { Box, Flex } from "@radix-ui/themes";
import { PiMagnifyingGlass } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import TagsModal from "@/components/Tags/TagsModal";
import Tag from "@/components/Tags/Tag";
import { useSearch } from "@/services/search";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagRowMenu from "@/components/Tags/TagRowMenu";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import SettingsPage, {
  SettingsNoAccess,
} from "@/components/Layout/SettingsPage";

const TagsPage: FC = () => {
  const { tags, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<TagInterface> | null>(
    null,
  );

  const permissionsUtil = usePermissionsUtil();
  const canCreateAndUpdate = permissionsUtil.canCreateAndUpdateTag();
  const canDelete = permissionsUtil.canDeleteTag();
  const canManageTags = canCreateAndUpdate || canDelete;

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    pagination,
  } = useSearch({
    items: tags || [],
    localStorageKey: "tags",
    defaultSortField: "id",
    defaultSortDir: 1,
    searchFields: ["id^2", "description"],
    pageSize: 50,
    updateSearchQueryOnChange: true,
  });

  if (!canManageTags) {
    return <SettingsNoAccess title="Tags" />;
  }

  return (
    <SettingsPage
      title="Tags"
      description={
        <>
          Organize features, experiments, metrics, and more with{" "}
          <strong>tags</strong>.
        </>
      }
      actions={
        <Tooltip
          body="You don't have permission to add tags"
          shouldDisplay={!canCreateAndUpdate}
        >
          <Button
            disabled={!canCreateAndUpdate}
            onClick={() => setModalOpen({})}
          >
            Add tag
          </Button>
        </Tooltip>
      }
    >
      {modalOpen && (
        <TagsModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}

      <Box mb="5">
        {tags && tags.length > 0 ? (
          <>
            <Flex align="center" gap="3" mb="2">
              <Text weight="medium">{`${tags.length} tag${tags.length === 1 ? "" : "s"}`}</Text>
              <Box width="280px" flexShrink="0">
                <TextField
                  type="search"
                  aria-label="Search tags"
                  placeholder="Search tags"
                  prepend={<PiMagnifyingGlass aria-hidden />}
                  {...searchInputProps}
                />
              </Box>
            </Flex>
            <Table
              variant="list"
              stickyHeader={false}
              roundedCorners
              layout="fixed"
              mb="4"
            >
              <TableHeader>
                <TableRow>
                  <SortableTableColumnHeader
                    field="id"
                    style={{ width: "35%" }}
                  >
                    Tag name
                  </SortableTableColumnHeader>
                  <SortableTableColumnHeader field="description">
                    Description
                  </SortableTableColumnHeader>
                  <TableColumnHeader style={{ width: 46 }} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items?.map((t) => (
                  <TableRow key={t.id} align="start">
                    <TableCell>
                      {canCreateAndUpdate ? (
                        <Link
                          aria-label={`Edit tag ${t.id}`}
                          onClick={() => setModalOpen(t)}
                        >
                          <Tag tag={t.id} skipMargin />
                        </Link>
                      ) : (
                        <Tag tag={t.id} skipMargin />
                      )}
                    </TableCell>
                    <TableCell>
                      {t.description && t.description.length > 80
                        ? t.description.substring(0, 80).trim() + "..."
                        : (t.description ?? "")}
                    </TableCell>
                    <TableCell justify="end">
                      <TagRowMenu
                        name={t.id}
                        canEdit={canCreateAndUpdate}
                        canDelete={canDelete}
                        onEdit={() => setModalOpen(t)}
                        onDelete={async () => {
                          await apiCall(`/tag/`, {
                            method: "DELETE",
                            body: JSON.stringify({ id: t.id }),
                          });
                          mutateDefinitions();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && isFiltered && (
                  <TableRow>
                    <TableCell colSpan={3} justify="center">
                      No matching tags found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {pagination}
          </>
        ) : (
          <p className="text-gray">
            Click the button above to create your first tag.
          </p>
        )}
      </Box>
    </SettingsPage>
  );
};
export default TagsPage;
