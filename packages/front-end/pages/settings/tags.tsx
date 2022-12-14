import Link from "next/link";
import React, { useState, FC } from "react";
import { FaAngleLeft, FaPencilAlt } from "react-icons/fa";
import { TagInterface } from "back-end/types/tag";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import TagsModal from "@/components/Tags/TagsModal";
import Tag from "@/components/Tags/Tag";
import { GBAddCircle } from "@/components/Icons";
import { useSearch } from "@/services/search";
import usePermissions from "@/hooks/usePermissions";
import Field from "@/components/Forms/Field";

const TagsPage: FC = () => {
  const { tags, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<TagInterface> | null>(
    null
  );
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: tags || [],
    localStorageKey: "tags",
    defaultSortField: "id",
    searchFields: ["id", "description"],
  });

  const permissions = usePermissions();

  if (!permissions.manageTags) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid  pagecontents">
      {modalOpen && (
        <TagsModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Tags</h1>
      <p>Organize features, experiments, metrics, and more with tags.</p>
      {tags?.length > 0 ? (
        <>
          <div className="row mb-2 align-items-center">
            <div className="col-auto">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </div>
          </div>
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <SortableTH field="id">Tag name</SortableTH>
                <SortableTH field="description">Description</SortableTH>
                <th>Preview</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {items?.map((t, i) => {
                return (
                  <tr key={i}>
                    <td
                      onClick={(e) => {
                        e.preventDefault();
                        setModalOpen(t);
                      }}
                      className="cursor-pointer"
                    >
                      {t.id}
                    </td>
                    <td>{t.description}</td>
                    <td>
                      <Tag tag={t.id} />
                    </td>
                    <td>
                      <button
                        className="btn btn-outline-primary tr-hover"
                        onClick={(e) => {
                          e.preventDefault();
                          setModalOpen(t);
                        }}
                      >
                        <FaPencilAlt />
                      </button>{" "}
                      <DeleteButton
                        deleteMessage="Are you sure? Deleting a tag will remove it from all features, metrics, and experiments."
                        className="tr-hover"
                        displayName="Tag"
                        onClick={async () => {
                          await apiCall(`/tag/${t.id}`, {
                            method: "DELETE",
                          });
                          mutateDefinitions();
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={4} align={"center"}>
                    No matching tags found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ) : (
        <></>
      )}
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setModalOpen({});
        }}
      >
        <span className="h4 pr-2 m-0 d-inline-block">
          <GBAddCircle />
        </span>{" "}
        Add Tag
      </button>
    </div>
  );
};
export default TagsPage;
