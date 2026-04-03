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
import Tooltip from "@/components/Tooltip/Tooltip";
import TagRowMenu from "@/components/Tags/TagRowMenu";

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
    return (
      <div className="container-fluid pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <TagsModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}

      <Box mt="4" mb="5">
        <div className="row align-items-center mb-1">
          <div className="col-auto">
            <h2 className="mb-0">Tags</h2>
          </div>
          <div className="flex-1" />
          <div className="col-auto">
            <Tooltip
              body="You don't have permission to add tags"
              shouldDisplay={!canCreateAndUpdate}
            >
              <Button
                disabled={!canCreateAndUpdate}
                onClick={() => setModalOpen({})}
              >
                Add Tag
              </Button>
            </Tooltip>
          </div>
        </div>
        <p className="text-gray mb-4">
          Organize features, experiments, metrics, and more with{" "}
          <strong>tags</strong>.
        </p>

        {tags && tags.length > 0 ? (
          <>
            <Box className="relative" width="40%" mb="4">
              <Field
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
                  <SortableTH field="id" style={{ width: "30%" }}>
                    Tag name
                  </SortableTH>
                  <th style={{ width: "30%" }}>Preview</th>
                  <SortableTH field="description">Description</SortableTH>
                  <th style={{ width: 40, minWidth: 40 }} />
                </tr>
              </thead>
              <tbody>
                {items?.map((t) => (
                  <tr key={t.id}>
                    <td className="text-gray">
                      {canCreateAndUpdate ? (
                        <a
                          href="#"
                          className="link-purple"
                          onClick={(e) => {
                            e.preventDefault();
                            setModalOpen(t);
                          }}
                        >
                          {t.id}
                        </a>
                      ) : (
                        <span>{t.id}</span>
                      )}
                    </td>
                    <td className="text-gray">
                      <Tag tag={t.id} skipMargin={true} />
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
                    <td colSpan={4} align={"center"}>
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
    </div>
  );
};
export default TagsPage;
