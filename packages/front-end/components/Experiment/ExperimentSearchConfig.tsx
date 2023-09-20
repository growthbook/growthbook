import React, { ChangeEvent, FC, useState } from "react";
import {
  ExperimentSearchFilters,
  SavedSearchInterface,
} from "back-end/types/experiment";
import { UseFormReturn } from "react-hook-form";
import { useRouter } from "next/router";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import TagsInput from "@/components/Tags/TagsInput";
import ProjectsInput from "@/components/Projects/ProjectsInput";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";

const ExperimentSearchConfig: FC<{
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
  filterForm: UseFormReturn<ExperimentSearchFilters>;
  showForm;
  sort;
  setSort;
  showFormValues: Record<
    string,
    {
      initialValue: boolean;
      name: string;
      show: boolean;
      sortable: boolean;
    }
  >;
  existingSavedSearch?: SavedSearchInterface;
  savedSearchForm: UseFormReturn<{
    id: string;
    name: string;
    description: string;
    public: boolean;
    filters: Record<string, unknown>;
    show: Record<string, unknown>;
    sort: Record<string, unknown>;
    display: string;
  }>;
  setShowFilter;
  onUpdate: () => void;
  saveSearchModal: boolean;
  setSaveSearchModal: (open: boolean) => void;
}> = ({
  searchInputProps,
  filterForm,
  showForm,
  sort,
  setSort,
  showFormValues,
  existingSavedSearch,
  savedSearchForm,
  setShowFilter,
  onUpdate,
  saveSearchModal,
  setSaveSearchModal,
}) => {
  const {
    metrics,
    datasources,
    getDatasourceById,
    getMetricById,
  } = useDefinitions();
  //const permissions = usePermissions();
  const { userId } = useUser();
  const { apiCall } = useAuth();
  const router = useRouter();

  //const [saveSearchModal, setSaveSearchModal] = useState(openModal);
  const [dirty, setDirty] = useState(false);

  const filterValues = filterForm.getValues();
  const filterDescriptionTextArr: string[] = [];
  if (searchInputProps.value) {
    filterDescriptionTextArr.push(`search term: ${searchInputProps.value}`);
  }
  Object.keys(filterValues).forEach((key) => {
    if (key === "search") return; // already handled above.
    const keyDisplayName = showFormValues?.[key]?.name ?? key;
    if (Array.isArray(filterValues[key])) {
      if (filterValues[key].length > 0) {
        filterDescriptionTextArr.push(
          `${keyDisplayName}: ${filterValues[key]
            .map((v, i) => {
              let displayValue = v;
              if (key === "dataSources") {
                displayValue = getDatasourceById(v)?.name ?? v;
              }
              if (key === "metrics") {
                displayValue = getMetricById(v)?.name ?? v;
              }
              return (
                displayValue +
                (i === filterValues[key].length - 2
                  ? " or "
                  : i === filterValues[key].length - 1
                  ? ""
                  : ", ")
              );
            })
            .join(" ")}`
        );
      }
    } else if (filterValues[key]) {
      if (filterValues[key] !== "") {
        filterDescriptionTextArr.push(
          `${keyDisplayName}: ${filterValues[key]}`
        );
      }
    }
  });
  const filterDescription = filterDescriptionTextArr.length
    ? "Showing experiments where " + filterDescriptionTextArr.join(" AND ")
    : "Showing all experiments";
  const savable = !(
    existingSavedSearch?.id && existingSavedSearch.owner !== userId
  );
  const sortDesc = sort?.field?.toLowerCase().includes("date")
    ? "Newest first"
    : "A -> Z";
  const sortAsc = sort?.field?.toLowerCase().includes("date")
    ? "Oldest first"
    : "Z -> A";

  const saveSearch = async () => {
    const data = savedSearchForm.getValues();
    //console.log("data: ", data);
    const filters = filterForm.getValues();
    const show = showForm.getValues();
    filters.search = searchInputProps.value;

    const savedSearch = { ...data, filters, show };
    //console.log("saved search obj", savedSearch);

    try {
      let id = data.id;

      if (!data.name) {
        throw new Error("A name is required");
      }
      // Update
      if (data.id) {
        const res = await apiCall<{ status: number; message: string }>(
          `/experiments/saved-search/${data.id}`,
          {
            method: "PUT",
            body: JSON.stringify(savedSearch),
          }
        );
        if (res.status > 200) {
          throw new Error(res.message);
        }
        setDirty(false);
        onUpdate();
      }
      // Create
      else {
        const res = await apiCall<{ search: SavedSearchInterface }>(
          `/experiments/saved-search/`,
          {
            method: "POST",
            body: JSON.stringify(savedSearch),
          }
        );
        //console.log("got res", res);
        id = res.search.id;
        track("Saved Experiment Search Form", {
          savedSearch,
        });
        setDirty(false);
        // redirect (can we just update the URL?)
        await router.replace("/experiments/custom/" + id);
        //onUpdate();
        setSaveSearchModal(false);
      }
      //await onSuccess(id);
    } catch (e) {
      track("Saved Experiment Search Form Error", {
        savedSearch,
        error: e.message.substr(0, 32) + "...",
      });
      //setHasError(true);
      throw e;
    }
  };

  return (
    <>
      {saveSearchModal && (
        <Modal
          header={
            existingSavedSearch?.id ? "Update Saved Search" : "Save Search"
          }
          open={true}
          autoCloseOnSubmit={false}
          close={() => setSaveSearchModal(false)}
          cta={existingSavedSearch?.id ? "Update Saved Search" : "Save Search"}
          successMessage="Saved successfully..."
          submit={saveSearch}
        >
          <Field
            label="Name"
            placeholder="Name"
            {...savedSearchForm.register("name")}
          />
          <Field
            label="Description"
            textarea
            placeholder="Description"
            {...savedSearchForm.register("description")}
          />
          <div className="form-check">
            <label>
              <input
                type="checkbox"
                className="form-check-input"
                {...savedSearchForm.register("public")}
              />
              Make this search visible to your whole organization
            </label>
          </div>
        </Modal>
      )}
      <div className="row align-items-top row row-cols-1 row-cols-sm-2 row-cols-md-3">
        <div className="col">
          <div className="row mb-2 align-items-center">
            <div className="col-5">
              <label>Text search</label>
            </div>
            <div className="col-7">
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
                onChange={(e) => {
                  searchInputProps.onChange(e);
                  setDirty(true);
                }}
              />
            </div>
          </div>
        </div>
        <div className="col">
          <div className="row mb-2 align-items-center">
            <div className="col-5">
              <label>Tags</label>
            </div>
            <div className="col-7">
              <TagsInput
                value={filterForm.watch("tags")}
                onChange={(value) => {
                  setDirty(true);
                  filterForm.setValue("tags", value);
                }}
                prompt={"Filter by tags..."}
                autoFocus={false}
                closeMenuOnSelect={true}
                creatable={false}
              />
            </div>
          </div>
        </div>
        <div className="col">
          <div className="row mb-2 align-items-center">
            <div className="col-5">
              <label>Project</label>
            </div>
            <div className="col-7">
              <ProjectsInput
                value={filterForm.watch("projects")}
                onChange={(value) => {
                  setDirty(true);
                  filterForm.setValue("projects", value);
                }}
                prompt={"Filter by project..."}
                autoFocus={false}
                closeMenuOnSelect={true}
                creatable={false}
              />
            </div>
          </div>
        </div>
        <div className="col">
          <div className="row mb-2 align-items-center">
            <div className="col-5">
              <label>Status</label>
            </div>
            <div className="col-7">
              <MultiSelectField
                value={filterForm.watch("status")}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "running", label: "Running" },
                  { value: "stopped", label: "Stopped" },
                ]}
                onChange={(value: string[]) => {
                  setDirty(true);
                  filterForm.setValue("status", value);
                }}
              />
            </div>
          </div>
        </div>
        <div className="col">
          <div className="row mb-2 align-items-center">
            <div className="col-5">
              <label>Experiment Results</label>
            </div>
            <div className="col-7">
              <MultiSelectField
                value={filterForm.watch("results")}
                options={[
                  { value: "won", label: "Won" },
                  { value: "lost", label: "Lost" },
                  { value: "inconclusive", label: "Inconclusive" },
                  { value: "dnf", label: "Did not finish" },
                ]}
                onChange={(value: string[]) => {
                  setDirty(true);
                  filterForm.setValue("results", value);
                }}
              />
            </div>
          </div>
        </div>
        <div className="col">
          <div className="row mb-2 align-items-center">
            <div className="col-5">
              <label>Owner</label>
            </div>
            <div className="col-7">
              <Field
                type="text"
                placeholder=""
                {...filterForm.register("ownerName")}
                onChange={(e) => {
                  filterForm.setValue("ownerName", e.target.value);
                  setDirty(true);
                }}
              />
            </div>
          </div>
        </div>
        {/*<div className="col">*/}
        {/*  <div className="row mb-2 align-items-center">*/}
        {/*    <div className="col-5">*/}
        {/*      <label>Start Dates</label>*/}
        {/*    </div>*/}
        {/*    <div className="col-7"></div>*/}
        {/*  </div>*/}
        {/*</div>*/}
        <div className="col">
          <div className="row mb-2 align-items-center">
            <div className="col-5">
              <label>Data Sources</label>
            </div>
            <div className="col-7">
              <MultiSelectField
                value={filterForm.watch("dataSources")}
                options={datasources.map((ds) => ({
                  value: ds.id,
                  label: ds.name,
                }))}
                onChange={(value: string[]) => {
                  setDirty(true);
                  filterForm.setValue("dataSources", value);
                }}
              />
            </div>
          </div>
        </div>
        <div className="col">
          <div className="row mb-2 align-items-center">
            <div className="col-5">
              <label>Metrics</label>
            </div>
            <div className="col-7">
              <MultiSelectField
                value={filterForm.watch("metrics")}
                options={metrics.map((m) => ({
                  value: m.id,
                  label: m.name,
                }))}
                onChange={(value: string[]) => {
                  setDirty(true);
                  filterForm.setValue("metrics", value);
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <h4 className="mt-3">Show:</h4>
      <div className="row align-items-top row row-cols-1 row-cols-sm-2 row-cols-md-3">
        {Object.entries(showFormValues)
          .filter((v) => v[1].show)
          .map(([key, val]) => {
            return (
              <div className="col" key={key}>
                <div className="form-check">
                  <label style={{ marginBottom: "2px" }}>
                    <input
                      className="form-check-input position-relative mr-2"
                      style={{ top: "2px" }}
                      type="checkbox"
                      id={"description"}
                      checked={!!showForm.watch(key)}
                      onChange={(e) => {
                        setDirty(true);
                        showForm.setValue(key, e.target.checked);
                      }}
                    />
                    {val.name}
                  </label>
                </div>
              </div>
            );
          })}
      </div>
      <h4 className="mt-3">Sort</h4>
      <div className="row align-items-center">
        <div className="col-auto">Sort by </div>
        <div className="col-auto">
          <SelectField
            value={sort.field}
            className="d-inline-block"
            options={[
              ...Object.entries(showFormValues)
                .filter((v) => v[1].sortable)
                .map(([key, val]) => {
                  return { value: key, label: val.name };
                }),
            ]}
            onChange={(v) => {
              setDirty(true);
              setSort({ field: v, dir: sort.dir });
            }}
          />
        </div>
        <div className="col-auto">
          <SelectField
            value={sort.dir + ""}
            options={[
              { value: "1", label: sortDesc },
              { value: "-1", label: sortAsc },
            ]}
            onChange={(v) => {
              setDirty(true);
              setSort({ field: sort.field, dir: Number(v) });
            }}
          />
        </div>
      </div>
      <div className="row justify-content-end mt-2">
        <div className="col-auto mx-2">
          {savable && (
            <button
              className={`btn btn-primary ${
                savable && dirty ? "" : "disabled"
              }`}
              title={
                savable
                  ? ``
                  : `You cannot update this search results as you did not create it`
              }
              onClick={() => {
                if (savable) {
                  if (!existingSavedSearch?.id) {
                    savedSearchForm.setValue("description", filterDescription);
                  }
                  setSaveSearchModal(true);
                }
              }}
            >
              {existingSavedSearch?.id
                ? "Update saved search..."
                : "Save search..."}
            </button>
          )}
        </div>
        <div className="col-auto mx-2">
          <button
            className="btn btn-outline-primary"
            onClick={() => setShowFilter(false)}
          >
            Minimize
          </button>
        </div>
      </div>
    </>
  );
};

export default ExperimentSearchConfig;
