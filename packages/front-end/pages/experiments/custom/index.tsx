import React, { useCallback, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { SavedSearchInterface } from "back-end/types/experiment";
import { datetime, ago } from "shared/dates";
import { FaLock } from "react-icons/fa";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import Toggle from "@/components/Forms/Toggle";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";

const CustomSearchesPage = (): React.ReactElement => {
  const router = useRouter();

  const { data, error } = useApi<{
    searches: SavedSearchInterface[];
  }>(`/experiments/saved-searches`);
  const [onlyMySearches, setOnlyMySearches] = useState(false);
  const { userId, getUserDisplay } = useUser();

  const savedSearches = useAddComputedFields(
    data?.searches,
    (ss) => ({
      ownerName: ss.owner ? getUserDisplay(ss.owner) : "",
    }),
    []
  );

  const filterResults = useCallback(
    (items: SavedSearchInterface[]) => {
      return items.filter((ss) => {
        if (onlyMySearches) {
          return ss.owner === userId;
        } else {
          // when showing 'all' show all your searches, but only published reports from everyone else (or if status isn't set because it was before the change)
          return ss.owner === userId || ss?.public;
        }
      });
    },
    [onlyMySearches, userId]
  );
  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: savedSearches,
    localStorageKey: "savedSearches",
    defaultSortField: "dateUpdated",
    defaultSortDir: -1,
    searchFields: ["name", "description", "ownerName", "dateUpdated"],
    filterResults,
  });

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  if (!savedSearches.length) {
    return (
      <div className="container p-4">
        <h1>Saved Searches</h1>
        <p>
          Customize a report of experiments based on the criteria you specify.
        </p>

        <p>
          To create your first saved search, click on the new button, then when
          you have the search parameters as you like them, click on the{" "}
          <i>save</i> button to generate a sharable URL.
        </p>
      </div>
    );
  }

  return (
    <div className="container-fluid py-3 p-3 pagecontents">
      <div className="filters md-form row mb-3 align-items-center">
        <div className="col-auto">
          <h3>Saved Searches</h3>
        </div>
        <div className="col-lg-3 col-md-4 col-6">
          <Field placeholder="Search..." type="search" {...searchInputProps} />
        </div>
        <div className="col-auto">
          <Toggle
            id={"onlymine"}
            value={onlyMySearches}
            label={"onlymine"}
            setValue={setOnlyMySearches}
          />
          Show only my searches
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <Link href="/experiments/custom/new" className="">
            <button className="btn btn-primary float-right" type="button">
              New Search
            </button>
          </Link>
        </div>
      </div>
      <table className="table appbox gbtable table-hover">
        <thead>
          <tr>
            <th></th>
            <SortableTH field="name">Name</SortableTH>
            <SortableTH field="description">Description</SortableTH>
            <SortableTH field="ownerName">Created By</SortableTH>
            <SortableTH field="dateUpdated">Last Updated</SortableTH>
          </tr>
        </thead>
        <tbody>
          {items.map((ss) => (
            <tr
              key={ss.id}
              onClick={(e) => {
                e.preventDefault();
                router.push(`/experiments/custom/${ss.id}`);
              }}
              style={{ cursor: "pointer" }}
            >
              <td className="text-center">
                {ss.owner == userId && !ss.public && (
                  <span className="text-purple">
                    <Tooltip body="This saved search is private to you">
                      <FaLock />
                    </Tooltip>
                  </span>
                )}
              </td>
              <td>
                <Link
                  href={`/experiments/custom/${ss.id}`}
                  className={`text-dark font-weight-bold`}
                >
                  {ss.name}
                </Link>
              </td>
              <td
                className="text-muted"
                style={{
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "260px",
                  overflow: "hidden",
                }}
              >
                {ss.description}
              </td>
              <td>{ss.ownerName}</td>
              <td
                title={datetime(ss.dateUpdated)}
                className="d-none d-md-table-cell"
              >
                {ago(ss.dateUpdated)}
              </td>
            </tr>
          ))}

          {!items.length && (
            <tr>
              <td colSpan={5} align={"center"}>
                {isFiltered
                  ? "No matching saved searches"
                  : onlyMySearches
                  ? "You have no saved searches"
                  : "No saved searches"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default CustomSearchesPage;
