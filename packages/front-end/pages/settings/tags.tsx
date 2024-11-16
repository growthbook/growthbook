import React, { useState, FC } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { TagInterface } from "back-end/types/tag";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import TagsModal from "@/components/Tags/TagsModal";
import Tag from "@/components/Tags/Tag";
import { useSearch } from "@/services/search";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Radix/Button";

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

  const permissionsUtil = usePermissionsUtil();

  const canManageTags =
    permissionsUtil.canCreateAndUpdateTag() || permissionsUtil.canDeleteTag();

  if (!canManageTags) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          您无权查看此页面。
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
      <h1>标签</h1>
      <p>使用标签对特性、实验、指标等进行分类管理。</p>
      {tags?.length > 0 ? (
        <>
          <div className="row mb-2 align-items-center">
            <div className="col-auto">
              <Field
                placeholder="搜索..."
                type="search"
                {...searchInputProps}
              />
            </div>
          </div>
          <table className="table appbox gbtable table-hover">
            <thead>
              <tr>
                <SortableTH field="id">标签名称</SortableTH>
                <SortableTH field="description">描述</SortableTH>
                <th>预览</th>
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
                      <Tag tag={t.id} skipMargin={true} />
                    </td>
                    <td>
                      {permissionsUtil.canCreateAndUpdateTag() ? (
                        <button
                          className="btn btn-outline-primary tr-hover mr-2"
                          onClick={(e) => {
                            e.preventDefault();
                            setModalOpen(t);
                          }}
                        >
                          <FaPencilAlt />
                        </button>
                      ) : null}
                      {permissionsUtil.canDeleteTag() ? (
                        <DeleteButton
                          deleteMessage="您确定吗？删除标签将使其从所有特性、指标和实验中移除。"
                          className="tr-hover"
                          displayName="标签"
                          onClick={async () => {
                            await apiCall(`/tag/`, {
                              method: "DELETE",
                              body: JSON.stringify({ id: t.id }),
                            });
                            mutateDefinitions();
                          }}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!items.length && isFiltered && (
                <tr>
                  <td colSpan={4} align={"center"}>
                    未找到匹配的标签。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ) : (
        <></>
      )}
      {permissionsUtil.canCreateAndUpdateTag() ? (
        <Button onClick={() => setModalOpen({})}>添加标签</Button>
      ) : null}
    </div>
  );
};
export default TagsPage;