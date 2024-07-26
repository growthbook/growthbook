import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getMatchingRules, SMALL_GROUP_SIZE_LIMIT } from "shared/util";
import { SavedGroupInterface } from "shared/src/types";
import { ago } from "shared/dates";
import { FaPlusCircle } from "react-icons/fa";
import { PiArrowsDownUp } from "react-icons/pi";
import Link from "next/link";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import Field from "@/components/Forms/Field";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import SavedGroupForm from "@/components/SavedGroups/SavedGroupForm";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { getSavedGroupMessage } from "@/pages/saved-groups";
import EditButton from "@/components/EditButton/EditButton";
import Modal from "@/components/Modal";
import useSDKConnections from "@/hooks/useSDKConnections";
import LoadingOverlay from "@/components/LoadingOverlay";
import { IdListItemInput } from "@/components/SavedGroups/IdListItemInput";
import UpgradeModal from "@/components/Settings/UpgradeModal";

const NUM_PER_PAGE = 10;

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    `/saved-groups/${sgid}`
  );
  const savedGroup = data?.savedGroup;
  const { features } = useFeaturesList(false);
  const environments = useEnvironments();
  const { data: sdkConnectionData } = useSDKConnections();
  const [sortNewestFirst, setSortNewestFirst] = useState<boolean>(true);
  const [addItems, setAddItems] = useState<boolean>(false);
  const [itemsToAdd, setItemsToAdd] = useState<string[]>([]);
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);

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
  const [disableSubmit, setDisableSubmit] = useState(true);
  const [importOperation, setImportOperation] = useState<"replace" | "append">(
    "replace"
  );

  const [
    savedGroupForm,
    setSavedGroupForm,
  ] = useState<null | Partial<SavedGroupInterface>>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [passByReferenceOnly, setPassByReferenceOnly] = useState(
    savedGroup?.passByReferenceOnly || false
  );

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

  const {
    featuresReferencingSavedGroup,
    projectsReferencingSavedGroup,
  } = useMemo(() => {
    const featuresReferencingSavedGroup: Set<string> = new Set();
    const projectsReferencingSavedGroup: Set<string> = new Set();
    if (!savedGroup)
      return { featuresReferencingSavedGroup, projectsReferencingSavedGroup };
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
        featuresReferencingSavedGroup.add(feature.id);
        projectsReferencingSavedGroup.add(feature.project || "");
      }
    });
    return { featuresReferencingSavedGroup, projectsReferencingSavedGroup };
  }, [savedGroup, features, environments]);

  const referencingUnsupportedSdkConnections = useMemo(() => {
    if (projectsReferencingSavedGroup.size === 0) {
      return [];
    }
    return (sdkConnectionData?.connections || []).filter((connection) => {
      return (
        !getConnectionSDKCapabilities(connection).includes(
          "savedGroupReferences"
        ) &&
        (connection.projects?.length === 0 ||
          connection.projects?.some((project) =>
            projectsReferencingSavedGroup.has(project)
          ))
      );
    });
  }, [sdkConnectionData, projectsReferencingSavedGroup]);

  const convertingLegacyWithUnsupportedConnections =
    !savedGroup?.passByReferenceOnly &&
    passByReferenceOnly &&
    referencingUnsupportedSdkConnections.length > 0;

  const getConfirmationContent = useMemo(() => {
    return getSavedGroupMessage(featuresReferencingSavedGroup);
  }, [featuresReferencingSavedGroup]);

  if (!data || !savedGroup) {
    return <LoadingOverlay />;
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }

  if (savedGroup.type !== "list") {
    return (
      <div className="alert alert-danger">
        This type of Saved Group isn&apos;t supported. Return to your{" "}
        <Link className="text-error-muted underline" href="/saved-groups">
          saved groups
        </Link>
      </div>
    );
  }

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          reason=""
          source="large-saved-groups"
        />
      )}
      {addItems && (
        <Modal
          close={() => {
            setAddItems(false);
            setItemsToAdd([]);
          }}
          open={addItems}
          size="lg"
          header="Add Items to List"
          cta="Save"
          ctaEnabled={
            itemsToAdd.length > 0 &&
            !disableSubmit &&
            !convertingLegacyWithUnsupportedConnections
          }
          submit={async () => {
            let newValues: Set<string>;
            if (importOperation === "append") {
              await apiCall(`/saved-groups/${savedGroup.id}/add-items`, {
                method: "POST",
                body: JSON.stringify({
                  items: itemsToAdd,
                  passByReferenceOnly,
                }),
              });
              newValues = new Set([...values, ...itemsToAdd]);
            } else {
              await apiCall(`/saved-groups/${savedGroup.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  values: itemsToAdd,
                  passByReferenceOnly,
                }),
              });
              newValues = new Set(itemsToAdd);
            }
            mutateValues([...newValues]);
            setItemsToAdd([]);
          }}
        >
          <>
            <div className="form-group">
              Updating this list will automatically update any associated
              Features and Experiments.
            </div>
            <label className="form-group font-weight-bold">Choose one:</label>
            <div className="row ml-0 mr-0 form-group">
              <div className="cursor-pointer row align-items-center ml-0 mr-5">
                <input
                  type="radio"
                  id="replaceItems"
                  checked={importOperation === "replace"}
                  readOnly={true}
                  className="mr-1 radio-button-lg"
                  onChange={() => {
                    setImportOperation("replace");
                  }}
                />
                <label className="m-0" htmlFor="replaceItems">
                  Replace all items
                </label>
              </div>
              <div className="cursor-pointer row align-items-center ml-0 mr-0">
                <input
                  type="radio"
                  id="appendItems"
                  checked={importOperation === "append"}
                  readOnly={true}
                  className="mr-1 radio-button-lg"
                  onChange={() => {
                    setImportOperation("append");
                  }}
                />
                <label className="m-0" htmlFor="appendItems">
                  Append new items to list
                </label>
              </div>
            </div>
            <IdListItemInput
              values={itemsToAdd}
              passByReferenceOnly={savedGroup.passByReferenceOnly || false}
              bypassSmallListSizeLimit={
                (savedGroup?.values || []).length > SMALL_GROUP_SIZE_LIMIT &&
                !savedGroup?.passByReferenceOnly
              }
              groupReferencedByUnsupportedSdks={
                referencingUnsupportedSdkConnections.length > 0
              }
              setValues={(newValues) => setItemsToAdd(newValues)}
              setPassByReferenceOnly={setPassByReferenceOnly}
              disableSubmit={disableSubmit}
              setDisableSubmit={setDisableSubmit}
              limit={
                SMALL_GROUP_SIZE_LIMIT -
                (importOperation === "append"
                  ? savedGroup.values?.length || 0
                  : 0)
              }
              openUpgradeModal={() => setUpgradeModal(true)}
            />
          </>
        </Modal>
      )}
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
                  setAddItems(true);
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
          <h4>ID List Items</h4>
          <div className="row m-0 mb-3 align-items-center justify-content-between">
            <div className="row m-0 align-items-center">
              {selected.size > 0 && (
                <>
                  <DeleteButton
                    text={`Delete Selected (${selected.size})`}
                    title={`Delete selected item${
                      selected.size > 1 ? "s" : ""
                    }`}
                    getConfirmationContent={async () => ""}
                    onClick={async () => {
                      await apiCall(
                        `/saved-groups/${savedGroup.id}/remove-items`,
                        {
                          method: "POST",
                          body: JSON.stringify({ items: [...selected] }),
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
                    displayName={`${selected.size} selected item${
                      selected.size > 1 ? "s" : ""
                    }`}
                  />
                </>
              )}
            </div>
            <div className="d-flex align-items-center">
              {values.length > 0 && (
                <div className="mr-3">
                  {start + 1}-{start + valuesPage.length} of{" "}
                  {values.length || 0}
                </div>
              )}
              <div
                className="cursor-pointer text-color-primary"
                onClick={() => {
                  setSortNewestFirst(!sortNewestFirst);
                  setCurrentPage(1);
                }}
              >
                <PiArrowsDownUp className="mr-1 lh-full align-middle" />
                <span className="lh-full align-middle">
                  {sortNewestFirst ? "Newest" : "Oldest"}
                </span>
              </div>
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
                    readOnly={true}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected(new Set(values));
                      } else {
                        setSelected(new Set());
                      }
                    }}
                  />
                </th>
                <th className="no-uppercase">{savedGroup.attributeKey}</th>
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
                      <input
                        type="checkbox"
                        readOnly={true}
                        checked={selected.has(value)}
                      />
                    </td>
                    <td>{value}</td>
                  </tr>
                );
              })}
              {!values.length && (
                <tr>
                  <td colSpan={2}>
                    This group doesn&apos;t have any items yet
                  </td>
                </tr>
              )}
              {values.length && !filteredValues.length ? (
                <tr>
                  <td colSpan={2}>No matching items</td>
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
