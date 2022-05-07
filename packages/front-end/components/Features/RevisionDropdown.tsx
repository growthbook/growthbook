import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import clsx from "clsx";
import { useMemo } from "react";
import { useState } from "react";
import { FaRegCopy } from "react-icons/fa";
import { useAuth } from "../../services/auth";
import { ago, datetime } from "../../services/dates";
import Dropdown from "../Dropdown/Dropdown";
import Modal from "../Modal";
import Pagination from "../Pagination";
import Tooltip from "../Tooltip";

export interface Props {
  feature: FeatureInterface;
  revisions: FeatureRevisionInterface[];
  publish: () => void;
  // eslint-disable-next-line
  mutate: () => Promise<any>;
}

export default function RevisionDropdown({
  feature,
  revisions,
  publish,
  mutate,
}: Props) {
  let revision = feature.revision?.version || 1;
  const isDraft = !!feature.draft?.active;
  if (isDraft) {
    revision++;
  }

  const { apiCall } = useAuth();
  const [selectedRevision, setSelectedRevision] = useState(0);

  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const NUM_PER_PAGE = 5;

  const rows = useMemo(() => {
    const revs = revisions.map((r) => {
      return {
        version: r.version,
        comment: r.comment || "",
        date: r.revisionDate,
        data: r,
        draft: false,
        live: false,
      };
    });

    revs.push({
      version: feature.revision?.version || 1,
      comment: feature.revision?.comment || "",
      date: feature.revision?.date || feature.dateCreated,
      data: null,
      draft: false,
      live: true,
    });

    if (isDraft) {
      revs.push({
        version: (feature.revision?.version || 1) + 1,
        comment: feature.draft?.comment || "",
        date: null,
        data: null,
        draft: true,
        live: false,
      });
    }

    revs.sort((a, b) => b.version - a.version);

    return revs;
  }, [feature, revisions, isDraft]).map((r, i) => ({ ...r, i }));

  const numPages = Math.ceil(rows.length / NUM_PER_PAGE);

  const start = (page - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  async function createDraft(revision: FeatureRevisionInterface) {
    await apiCall(`/feature/${feature.id}/draft`, {
      method: "POST",
      body: JSON.stringify({
        comment: `(Cloned from version #${revision.version})`,
        defaultValue: revision.defaultValue,
        rules: revision.rules,
      }),
    });
    await mutate();
  }

  return (
    <>
      {selectedRevision > 0 && isDraft && (
        <Modal
          open={true}
          header={"Create New Draft"}
          submit={async () => {
            const revision = rows[selectedRevision]?.data;
            if (!revision) return;
            await createDraft(revision);
          }}
          cta="Continue"
          close={() => {
            setSelectedRevision(0);
          }}
          closeCta="cancel"
        >
          <div className="alert alert-danger">
            <strong>Warning: </strong> This will completely overwrite your
            existing draft. Are you sure you want to continue?
          </div>
        </Modal>
      )}
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
                    <div className="d-flex align-items-center">
                      <div className="mr-2">{row.version}</div>
                      {row.live ? (
                        <div>
                          <span className="badge badge-pill badge-success">
                            live
                          </span>
                        </div>
                      ) : row.draft ? (
                        <div>
                          <span className="badge badge-pill badge-warning">
                            draft
                          </span>
                        </div>
                      ) : (
                        <a
                          href="#"
                          onClick={async (e) => {
                            e.preventDefault();
                            setOpen(false);
                            // If there's an existing draft, warn before overwriting it
                            if (isDraft) {
                              setSelectedRevision(row.i);
                            } else if (row.data) {
                              await createDraft(row.data);
                            }
                          }}
                        >
                          <Tooltip text="Create a new draft from this revision">
                            <FaRegCopy />
                          </Tooltip>
                        </a>
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
    </>
  );
}
