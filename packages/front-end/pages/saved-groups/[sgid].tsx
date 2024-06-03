import React, { useCallback, useState } from "react";
import { useRouter } from "next/router";
import { SavedGroupInterface } from "back-end/types/saved-group";
import { FaMinusCircle } from "react-icons/fa";
import { FaPencil } from "react-icons/fa6";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm from "@/components/SavedGroups/SavedGroupForm";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";

const NUM_PER_PAGE = 20;

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    `/saved-groups/${sgid}`
  );
  const savedGroup = data?.savedGroup;

  const values = savedGroup?.values || [];
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState("");
  const filteredValues = values.filter((v) => v.match(filter));

  const { apiCall } = useAuth();

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const valuesPage = filteredValues.slice(start, end);

  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);

  const mutateValues = useCallback(
    (newValues: string[]) => {
      if (!savedGroup) return;
      mutate({
        savedGroup: {
          ...savedGroup,
          values: newValues,
        },
      });
    },
    [mutate, savedGroup]
  );

  if (!savedGroup || savedGroup.type !== "list" || error) {
    return (
      <div className="alert alert-danger">
        There was an error loading the saved group.
      </div>
    );
  }
  return (
    <>
      {savedGroupForm && (
        <SavedGroupForm
          close={() => setSavedGroupForm(null)}
          current={savedGroupForm}
          type="list"
        />
      )}
      <PageHead
        breadcrumb={[
          { display: "Saved Groups", href: "/saved-groups" },
          { display: savedGroup.groupName },
        ]}
      />
      <div className="p-3 container-fluid pagecontents">
        <div className="row align-items-center mb-2">
          <h1 className="col-auto">{savedGroup.groupName}</h1>
          <div style={{ flex: 1 }} />
          <div className="col-auto">
            <MoreMenu>
              <button
                className="btn dropdown-item py-2"
                onClick={(e) => {
                  e.preventDefault();
                  setSavedGroupForm(savedGroup);
                }}
              >
                <FaPencil /> Edit
              </button>
              <DeleteButton
                className="btn dropdown-item py-2"
                text="Delete"
                title="Delete this Saved Group"
                // TODO
                // getConfirmationContent={getMetricUsage(metric)}
                onClick={async () => {
                  await apiCall(`/saved-groups/${savedGroup.id}`, {
                    method: "DELETE",
                  });
                  mutate(undefined);
                  router.push("/saved-groups");
                }}
                useIcon={true}
                displayName={"Saved Group '" + savedGroup.groupName + "'"}
              />
            </MoreMenu>
          </div>
        </div>
        <div className="row mb-3 align-items-center">
          <div className="col">
            Owner: {savedGroup.owner ? savedGroup.owner : "None"}
          </div>
          <div className="col">Attribute Key: {savedGroup.attributeKey}</div>
        </div>
        <>
          <div>Group Members</div>
          <div className="row mb-2 align-items-center">
            <div className="col-auto">
              <Field
                placeholder="Search..."
                type="search"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                }}
              />
            </div>
          </div>

          <table className="table gbtable table-hover appbox">
            <thead
              className="sticky-top bg-white shadow-sm"
              style={{ top: "56px", zIndex: 900 }}
            >
              <tr>
                <th>{savedGroup.attributeKey}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {valuesPage.map((value) => {
                return (
                  <tr key={value}>
                    <td>{value}</td>
                    <td>
                      <FaMinusCircle
                        onClick={async (e) => {
                          e.preventDefault();
                          await apiCall(
                            `/saved-groups/${sgid}/remove-member/${value}`,
                            { method: "POST" }
                          );
                          const newValues = (savedGroup.values || []).slice();
                          const index = newValues.indexOf(value);
                          if (index !== -1) {
                            newValues.splice(index, 1);
                          }
                          mutateValues(newValues);
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
              {!values.length && (
                <tr>
                  <td colSpan={2}>
                    This group doesn&apos;t have any members yet
                  </td>
                </tr>
              )}
              {values.length && !filteredValues.length ? (
                <tr>
                  <td colSpan={2}>No matching members</td>
                </tr>
              ) : (
                <></>
              )}
            </tbody>
          </table>
          {Math.ceil(filteredValues.length / NUM_PER_PAGE) > 1 && (
            <Pagination
              numItemsTotal={values.length}
              currentPage={currentPage}
              perPage={NUM_PER_PAGE}
              onPageChange={(d) => {
                setCurrentPage(d);
              }}
            />
          )}
        </>
      </div>
    </>
  );
}
