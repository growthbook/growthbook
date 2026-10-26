import React, { useState, FC } from "react";
import { TagInterface } from "shared/types/tag";
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import TagsModal from "@/components/Tags/TagsModal";
import Tag from "@/components/Tags/Tag";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import TagRowMenu from "@/components/Tags/TagRowMenu";
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

  const { items, searchInputProps, isFiltered, SortableTH, pagination } =
    useSearch({
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
            <Box className="relative" width="40%" mb="4">
              <Field
                size="legacy"
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <table
              className="table appbox gbtable table-valign-top"
              style={{ tableLayout: "fixed", width: "100%" }}
            >
              <thead>
                <tr>
                  <SortableTH field="id" style={{ width: "35%" }}>
                    Tag name
                  </SortableTH>
                  <SortableTH field="description">Description</SortableTH>
                  <th style={{ width: 40, minWidth: 40 }} />
                </tr>
              </thead>
              <tbody>
                {items?.map((t) => (
                  <tr key={t.id}>
                    <td>
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
                    </td>
                    <td className="text-gray">
                      {t.description && t.description.length > 80
                        ? t.description.substring(0, 80).trim() + "..."
                        : (t.description ?? "")}
                    </td>
                    <td>
                      <TagRowMenu
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
                    </td>
                  </tr>
                ))}
                {!items.length && isFiltered && (
                  <tr>
                    <td colSpan={3} align={"center"}>
                      No matching tags found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
