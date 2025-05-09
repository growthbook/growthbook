import React, { useEffect, useState } from "react";
import { date } from "shared/dates";
import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useDefinitions } from "@/services/DefinitionsContext";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/components/Radix/Button";
import EmptyState from "@/components/EmptyState";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";

const NUM_PER_PAGE = 20;

export function holdoutDate(holdout: any): string {
  return holdout.startedAt ?? holdout.dateCreated ?? "";
}

const GlobalHoldoutsPage = (): React.ReactElement => {
  const { ready, project } = useDefinitions();
  const [openNewHoldoutModal, setOpenNewHoldoutModal] = useState(false);
  const { getUserDisplay, userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();

  // TODO: Replace with actual API call
  const [holdouts, setHoldouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // TODO: Replace with actual API call
    setLoading(false);
  }, []);

  const processedHoldouts = useAddComputedFields(
    holdouts,
    (holdout) => {
      return {
        ownerName: getUserDisplay(holdout.owner, false) || "",
        date: holdoutDate(holdout),
        status: holdout.status,
      };
    },
    [getUserDisplay]
  );

  const { items, searchInputProps, isFiltered, SortableTH } = useSearch({
    items: processedHoldouts,
    localStorageKey: "global-holdouts",
    defaultSortField: "date",
    defaultSortDir: -1,
    updateSearchQueryOnChange: true,
    searchFields: [
      "key^3",
      "id",
      "description",
      "tags",
      "status",
      "ownerName",
    ],
    searchTermFilters: {
      is: (item) => {
        const is: string[] = [];
        if (item.status === "running") is.push("running");
        if (item.status === "stopped") is.push("stopped");
        return is;
      },
    },
  });

  const canCreateHoldouts = permissionsUtil.canViewExperimentModal(project);

  if (!ready) {
    return <LoadingOverlay />;
  }

  return (
    <div className="contents experiments container-fluid pagecontents">
      <div className="mb-3 mt-2">
        <div className="filters md-form row mb-3 align-items-center">
          <div className="col d-flex align-items-center">
            <h1>Global Holdouts</h1>
          </div>
          <div style={{flex: 1}}/>
          {canCreateHoldouts && (
            <div className="col-auto">
              <Button
                onClick={() => setOpenNewHoldoutModal(true)}
              >
                Add Global Holdout
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div className="alert alert-danger">
            Error loading global holdouts: {error.message}
          </div>
        )}

        <div className="row mb-3">
          <div className="col-md-3 col-lg-3">
            <Field
              placeholder="Search..."
              {...searchInputProps}
              autoFocus
              className="w-100"
            />
          </div>
        </div>

        {loading ? (
          <LoadingOverlay />
        ) : items.length > 0 ? (
          <div className="row">
            <div className="col-12">
              <div className="table-responsive">
                <table className="table appbox gbtable">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Owner</th>
                      <SortableTH field="date">Started</SortableTH>
                      <th style={{ width: 30 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((holdout) => (
                      <tr key={holdout.id}>
                        <td>
                          <Link href={`/global-holdouts/${holdout.id}`}>
                            {holdout.key}
                          </Link>
                          {holdout.description && (
                            <div className="text-muted small">
                              {holdout.description}
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className={clsx("badge", {
                              "badge-success": holdout.status === "running",
                              "badge-secondary": holdout.status === "stopped",
                            })}
                          >
                            {holdout.status}
                          </span>
                        </td>
                        <td>{holdout.ownerName}</td>
                        <td>{date(holdout.date)}</td>
                        <td>
                          <Link
                            href={`/global-holdouts/${holdout.id}`}
                            className="btn btn-sm btn-outline-primary"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {items.length > NUM_PER_PAGE && (
                <Pagination
                  numItemsTotal={items.length}
                  currentPage={currentPage}
                  perPage={NUM_PER_PAGE}
                  onPageChange={setCurrentPage}
                />
              )}
            </div>
          </div>
        ) : (
          <EmptyState
            title="No global holdouts yet"
            description={
              canCreateHoldouts
                ? "Get started by creating your first global holdout"
                : "No global holdouts have been created yet"
            }
            leftButton={
              canCreateHoldouts ? (
                <Button onClick={() => setOpenNewHoldoutModal(true)}>
                  Create Global Holdout
                </Button>
              ) : undefined
            }
            rightButton={undefined}
          />
        )}

        {openNewHoldoutModal && (
          <NewExperimentForm
            onClose={() => setOpenNewHoldoutModal(false)}
            source="holdouts-list"
            isNewExperiment={true}
            initialValue={{
              type: "holdout",
              phases: [
                {
                  coverage: 0.2,
                }
              ]
            }}
          />
        )}
      </div>
    </div>
  );
};

export default GlobalHoldoutsPage;
