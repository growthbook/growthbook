import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { MdRestore } from "react-icons/md";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { ago, datetime } from "@/services/dates";
import Dropdown from "../Dropdown/Dropdown";
import Modal from "../Modal";
import Pagination from "../Pagination";
import Tooltip from "../Tooltip/Tooltip";

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
  const liveVersion = feature.revision?.version || 1;
  const isDraft = !!feature.draft?.active;
  const permissions = usePermissions();

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
        live: r.version === liveVersion,
      };
    });

    // Fix for when the feature has no revisions (because it was created before revisions existed)
    if (!revs.length) {
      revs.push({
        version: liveVersion,
        comment: "New feature",
        date: feature.dateCreated,
        data: null,
        draft: false,
        live: true,
      });
    }

    // In-progress drafts are not stored with the rest of the revisions
    // Need to add them to the list separately
    if (isDraft) {
      revs.push({
        // Increment the live version for the draft
        version: liveVersion + 1,
        comment: feature.draft?.comment || "",
        date: null,
        data: null,
        draft: true,
        live: false,
      });
    }

    // Sort by version descending
    revs.sort((a, b) => b.version - a.version);

    // Add the new array index to each element after sorting
    return revs.map((r, i) => ({ ...r, i }));
  }, [feature, revisions, isDraft, liveVersion]);

  const numPages = Math.ceil(rows.length / NUM_PER_PAGE);

  const start = (page - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;

  async function createDraft(revision: FeatureRevisionInterface) {
    await apiCall(`/feature/${feature.id}/draft`, {
      method: "POST",
      body: JSON.stringify({
        comment: `(Reverting to version #${revision.version})`,
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
            Version: <strong>{isDraft ? liveVersion + 1 : liveVersion}</strong>{" "}
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
                      ) : permissions.check(
                          "createFeatureDrafts",
                          feature.project
                        ) ? (
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
                          <Tooltip body="Revert to this version (will create a new draft for you to review)">
                            <MdRestore style={{ fontSize: "1.1em" }} />
                          </Tooltip>
                        </a>
                      ) : null}
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
