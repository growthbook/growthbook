import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import clsx from "clsx";
import { useMemo } from "react";
import { useState } from "react";
import { ago, datetime } from "../../services/dates";
import Dropdown from "../Dropdown/Dropdown";
import Pagination from "../Pagination";

export interface Props {
  feature: FeatureInterface;
  revisions: FeatureRevisionInterface[];
  publish: () => void;
}

export default function RevisionDropdown({
  feature,
  revisions,
  publish,
}: Props) {
  const revision = feature.revision || 1;
  const isDraft = !!feature.draft?.active;

  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const NUM_PER_PAGE = 5;

  const rows = useMemo(() => {
    const revs = revisions.map((r) => {
      return {
        version: r.revision,
        comment: r.comment || "",
        date: r.revisionDate,
        data: r,
        draft: false,
        live: false,
      };
    });

    revs.push({
      version: feature.revision || 1,
      comment: feature.revisionComment || "",
      date: feature.revisionDate || feature.dateCreated,
      data: null,
      draft: false,
      live: true,
    });

    if (isDraft) {
      revs.push({
        version: (feature.revision || 1) + 1,
        comment: "",
        date: null,
        data: null,
        draft: true,
        live: false,
      });
    }

    revs.sort((a, b) => b.version - a.version);

    return revs;
  }, [feature, revisions, isDraft]);

  const numPages = Math.ceil(rows.length / NUM_PER_PAGE);

  const start = (page - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  return (
    <Dropdown
      uuid="feature-revisions"
      width={"35rem"}
      open={open}
      setOpen={setOpen}
      toggle={
        <>
          Revision: <strong>{revision}</strong>{" "}
          <span
            className={clsx(
              "badge badge-pill",
              isDraft ? "badge-warning" : "badge-success"
            )}
          >
            {isDraft ? "draft" : "live"}
          </span>
        </>
      }
    >
      <div className="p-3 bg-white">
        <table className="table table-hover mb-0">
          <thead>
            <tr>
              <th>Version</th>
              <th>Comment</th>
              <th>Date Published</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(start, end).map((row) => (
              <tr key={row.version}>
                <td>
                  <div className="d-flex">
                    <div className="mr-1">{row.version}</div>
                    {row.live && (
                      <div>
                        <span className="badge badge-pill badge-success">
                          live
                        </span>
                      </div>
                    )}
                    {row.draft && (
                      <div>
                        <span className="badge badge-pill badge-warning">
                          draft
                        </span>
                      </div>
                    )}
                  </div>
                </td>
                <td>{row.comment || "--"}</td>
                {row.draft ? (
                  <td>
                    <button
                      className="btn btn-sm btn-primary"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        publish();
                        setOpen(false);
                      }}
                    >
                      Review Changes
                    </button>
                  </td>
                ) : (
                  <td title={datetime(row.date)}>{ago(row.date)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {numPages > 1 && (
          <Pagination
            numItemsTotal={rows.length}
            currentPage={page}
            perPage={NUM_PER_PAGE}
            onPageChange={(d) => {
              setPage(d);
            }}
          />
        )}
      </div>
    </Dropdown>
  );
}
