import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getMatchingRules } from "shared/util";
import { SavedGroupInterface } from "shared/src/types";
import { ago } from "shared/dates";
import { FaExclamationTriangle, FaPlusCircle } from "react-icons/fa";
import { PiArrowsDownUp } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm, {
  IdListMemberInput,
} from "@/components/SavedGroups/SavedGroupForm";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { getSavedGroupMessage } from "@/pages/saved-groups";
import EditButton from "@/components/EditButton/EditButton";
import Modal from "@/components/Modal";

const NUM_PER_PAGE = 20;

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    `/saved-groups/${sgid}`
  );
  const savedGroup = data?.savedGroup;
  const { features } = useFeaturesList(false);
  const environments = useEnvironments();
  const [sortNewestFirst, setSortNewestFirst] = useState<boolean>(true);
  const [addMembers, setAddMembers] = useState<boolean>(false);
  const [membersToAdd, setMembersToAdd] = useState<string[]>([]);

  const values = savedGroup?.values || [];
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState("");
  const filteredValues = values.filter((v) => v.match(filter));
  const sortedValues = sortNewestFirst
    ? filteredValues.reverse()
    : filteredValues;

  const { apiCall } = useAuth();

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const valuesPage = sortedValues.slice(start, end);

  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  const savedGroupFeatureIds = useMemo(() => {
    const featureIds: Set<string> = new Set();
    if (!savedGroup) return featureIds;
    features.forEach((feature) => {
      const matches = getMatchingRules(
        feature,
        (rule) =>
          rule.condition?.includes(savedGroup.id) ||
          rule.savedGroups?.some((g) => g.ids.includes(savedGroup.id)) ||
          false,
        environments.map((e) => e.id)
      );

      if (matches.length > 0) {
        featureIds.add(feature.id);
      }
    });
    return featureIds;
  }, [savedGroup, features, environments]);

  const getConfirmationContent = useMemo(() => {
    return getSavedGroupMessage(savedGroupFeatureIds);
  }, [savedGroupFeatureIds]);

  if (!savedGroup || savedGroup.type !== "list" || error) {
    return (
      <div className="alert alert-danger">
        There was an error loading the saved group.
      </div>
    );
  }

  return (
    <>
      <Modal
        close={() => {
          setAddMembers(false);
          setMembersToAdd([]);
        }}
        open={addMembers}
        size="lg"
        header={`Add ${savedGroup.attributeKey}s to List`}
        cta="Save"
        ctaEnabled={membersToAdd.length > 0}
        submit={async () => {
          await apiCall(`/saved-groups/${savedGroup.id}/add-members`, {
            method: "POST",
            body: JSON.stringify({ members: membersToAdd }),
          });
          const newValues = values.concat(membersToAdd);
          mutateValues(newValues);
          setMembersToAdd([]);
        }}
      >
        <>
          <div className="alert alert-warning mt-2 p-3">
            <FaExclamationTriangle /> Updating this group will automatically
            update any feature or experiment that references it.
          </div>
          <IdListMemberInput
            values={membersToAdd}
            setValues={(newValues) => setMembersToAdd(newValues)}
            attributeKey={savedGroup.attributeKey || "ID"}
          />
        </>
      </Modal>
      {savedGroupForm && (
        <SavedGroupForm
          close={() => {
            setSavedGroupForm(null);
            mutate();
          }}
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
        {/* TODO: more responsive styling */}
        <div style={{ maxWidth: "800px" }}>
          <div className="row m-0 align-items-center mb-2 justify-content-between">
            <h1 className="">{savedGroup.groupName}</h1>
            <div>
              <DeleteButton
                className="fw-bold mr-4 "
                text="Delete"
                title="Delete this Saved Group"
                getConfirmationContent={getConfirmationContent}
                onClick={async () => {
                  await apiCall(`/saved-groups/${savedGroup.id}`, {
                    method: "DELETE",
                  });
                  router.push("/saved-groups");
                }}
                link={true}
                useIcon={false}
                displayName={"Saved Group '" + savedGroup.groupName + "'"}
              />
              <EditButton
                onClick={() => {
                  setSavedGroupForm(savedGroup);
                }}
                outline={false}
              ></EditButton>
            </div>
          </div>
          <div className="row m-0 mb-3 align-items-center justify-content-flex-start">
            <div className="mr-4">Attribute Key: {savedGroup.attributeKey}</div>
            <div className="mr-4">
              Date Updated: {ago(savedGroup.dateUpdated)}
            </div>
            <div className="mr-4">
              Owner: {savedGroup.owner ? savedGroup.owner : "None"}
            </div>
          </div>
          <div>{savedGroup.description}</div>
          <hr />
          <>
            <div className="row m-0 mb-4 align-items-center justify-content-between">
              <div className="">
                <Field
                  placeholder="Search..."
                  type="search"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                  }}
                />
              </div>
              <div className="">
                <button
                  className="btn btn-outline-primary"
                  onClick={(e) => {
                    e.preventDefault();
                    setAddMembers(true);
                  }}
                >
                  <div className="row align-items-center m-0 p-1">
                    <span className="mr-1 lh-full">
                      <FaPlusCircle />
                    </span>
                    <span className="lh-full">Add Values</span>
                  </div>
                </button>
              </div>
            </div>
            <h4>ID List Members</h4>
            <div className="row m-0 mb-3 align-items-center justify-content-between">
              <div className="row m-0 align-items-center">
                {selected.size > 0 && (
                  <>
                    <DeleteButton
                      text={`Delete Selected (${selected.size})`}
                      title={`Delete selected member${
                        selected.size > 1 ? "s" : ""
                      }`}
                      getConfirmationContent={async () => ""}
                      onClick={async () => {
                        await apiCall(
                          `/saved-groups/${savedGroup.id}/remove-members`,
                          {
                            method: "POST",
                            body: JSON.stringify({ members: [...selected] }),
                          }
                        );
                        const newValues = values.filter(
                          (value) => !selected.has(value)
                        );
                        mutateValues(newValues);
                        setSelected(new Set());
                      }}
                      link={true}
                      useIcon={true}
                      displayName={`${selected.size} selected member${
                        selected.size > 1 ? "s" : ""
                      }`}
                    />
                    <span className="ml-2 mr-2">&middot;</span>
                  </>
                )}
                <div>Total Count: {values.length || 0}</div>
              </div>
              <div
                className="cursor-pointer text-color-primary"
                onClick={() => setSortNewestFirst(!sortNewestFirst)}
              >
                <PiArrowsDownUp className="mr-1 lh-full align-middle" />
                <span className="lh-full align-middle">
                  {sortNewestFirst ? "Most" : "Least"} Recently Added
                </span>
              </div>
            </div>

            <table className="table gbtable table-hover appbox">
              <thead>
                <tr>
                  <th style={{ width: "48px" }}>
                    <input
                      type="checkbox"
                      checked={
                        values.length > 0 && selected.size === values.length
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelected(new Set(values));
                        } else {
                          setSelected(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="uppercase-title xl">
                    {savedGroup.attributeKey}
                  </th>
                </tr>
              </thead>
              <tbody>
                {valuesPage.map((value) => {
                  return (
                    <tr
                      key={value}
                      onClick={() => {
                        if (selected.has(value)) {
                          const newSelected = new Set(selected);
                          newSelected.delete(value);
                          setSelected(newSelected);
                        } else {
                          setSelected(new Set(selected).add(value));
                        }
                      }}
                    >
                      <td>
                        <input type="checkbox" checked={selected.has(value)} />
                      </td>
                      <td>{value}</td>
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
      </div>
    </>
  );
}
