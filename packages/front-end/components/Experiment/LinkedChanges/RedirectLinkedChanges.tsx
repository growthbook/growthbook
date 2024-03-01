import { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import UrlRedirectModal from "../UrlRedirectModal";
import LinkedChangesContainer from "./LinkedChangesContainer";

interface RedirectLinkedChangesProps {
  setUrlRedirectModal: (boolean) => void;
  visualChangesets: VisualChangesetInterface[];
  experiment: ExperimentInterfaceStringDates;
  canAddChanges: boolean;
  mutate: () => void;
}

interface RedirectProps {
  visualChangeset: VisualChangesetInterface;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

const Redirect = ({ visualChangeset, experiment, mutate }: RedirectProps) => {
  const [editingRedirect, setEditingRedirect] = useState<boolean>(false);

  return (
    <>
      {editingRedirect ? (
        <UrlRedirectModal
          mode="edit"
          experiment={experiment}
          visualChangeset={visualChangeset}
          mutate={mutate}
          close={() => setEditingRedirect(false)}
        />
      ) : null}
      <div className="appbox p-3 mb-0">
        <div className="d-flex justify-content-between">
          <h5 className="mt-2">Original URL</h5>
          <button
            className="btn btn-link"
            onClick={() => {
              setEditingRedirect(true);
            }}
          >
            Edit{" "}
          </button>
        </div>

        <span>{visualChangeset.urlPatterns[0].pattern}</span>
        <hr className="mr-5" />
        <h5>Redirects</h5>
        {experiment.variations.map((v, i) => (
          <div
            className={
              i === experiment.variations.length - 1
                ? `mb-0 variation with-variation-label variation${i}`
                : `mb-4 variation with-variation-label variation${i}`
            }
            key={i}
          >
            <div className="d-flex align-items-baseline">
              <span
                className="label"
                style={{
                  width: 18,
                  height: 18,
                }}
              >
                {i}
              </span>
              <div className="col pl-0">
                <h5 className="mb-0">{v.name}</h5>
                {visualChangeset.urlRedirects &&
                visualChangeset.urlRedirects[i]?.url ? (
                  <span>{visualChangeset.urlRedirects[i].url}</span>
                ) : (
                  <i className="text-muted">No redirect</i>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default function RedirectLinkedChanges({
  setUrlRedirectModal,
  visualChangesets,
  experiment,
  canAddChanges,
  mutate,
}: RedirectLinkedChangesProps) {
  const redirectCount = visualChangesets.length;

  return (
    <LinkedChangesContainer
      canAddChanges={canAddChanges}
      changeCount={redirectCount}
      experimentStatus={experiment.status}
      type="redirects"
      onAddChange={() => setUrlRedirectModal(true)}
    >
      <div>
        {visualChangesets.map((v, i) => (
          <div className={i > 0 ? "mt-3" : undefined} key={v.id}>
            <Redirect
              visualChangeset={v}
              experiment={experiment}
              mutate={mutate}
            />
          </div>
        ))}
      </div>
    </LinkedChangesContainer>
  );
}
