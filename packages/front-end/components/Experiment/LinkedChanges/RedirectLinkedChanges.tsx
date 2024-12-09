import { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { diffChars } from "diff";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import { FaExternalLinkAlt } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import LinkedChangesContainer from "@/components/Experiment/LinkedChanges/LinkedChangesContainer";
import styles from "@/components/Experiment/LinkedChanges/RedirectLinkedChanges.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";

interface RedirectLinkedChangesProps {
  setUrlRedirectModal: (boolean) => void;
  urlRedirects: URLRedirectInterface[];
  experiment: ExperimentInterfaceStringDates;
  canAddChanges: boolean;
  mutate: () => void;
}

interface RedirectProps {
  urlRedirect: URLRedirectInterface;
  experiment: ExperimentInterfaceStringDates;
  canEdit: boolean;
  mutate: () => void;
}

function UrlDifferenceRenderer({ url1, url2 }: { url1: string; url2: string }) {
  const differences = diffChars(url1, url2);
  const filtered = differences.filter((d) => !d.removed);

  try {
    const parsedUrl1 = new URL(url1);
    const parsedUrl2 = new URL(url2);

    if (parsedUrl1.hostname === parsedUrl2.hostname) {
      return (
        //MKTODO: Can I revise this to reduce repetition?
        <a
          className={`${styles.redirectUrl}`}
          href={url2}
          target="_blank"
          rel="noreferrer"
        >
          {filtered.map((part, index) => {
            if (part.added) {
              return <b key={index}>{part.value}</b>;
            } else {
              return <span key={index}>{part.value}</span>;
            }
          })}
          <FaExternalLinkAlt className="ml-2" />
        </a>
      );
    } else
      return (
        <a href={url2} target="_blank" rel="noreferrer">
          {url2}
          <FaExternalLinkAlt className="ml-1" />
        </a>
      );
  } catch {
    console.error("Failed to parse URL to for redirect diff");
    return <span>{url2}</span>;
  }
}

const Redirect = ({
  urlRedirect,
  experiment,
  mutate,
  canEdit,
}: RedirectProps) => {
  const { apiCall } = useAuth();
  const [editingRedirect, setEditingRedirect] = useState<boolean>(false);
  const originUrl = urlRedirect.urlPattern;

  return (
    <>
      {editingRedirect ? (
        <UrlRedirectModal
          mode="edit"
          experiment={experiment}
          urlRedirect={urlRedirect}
          mutate={mutate}
          close={() => setEditingRedirect(false)}
          source={"redirect-linked-changes"}
        />
      ) : null}
      <div className="appbox p-3 mb-0">
        <div className="d-flex justify-content-between">
          <a
            href={originUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-link link-purple pl-0 text-left text-break"
          >
            {originUrl}
            <FaExternalLinkAlt className="ml-2" />
          </a>
          {canEdit && (
            <div>
              <button
                className="btn btn-link text-danger"
                onClick={async () => {
                  await apiCall(`/url-redirects/${urlRedirect.id}`, {
                    method: "DELETE",
                  });
                  mutate();
                }}
              >
                Remove
              </button>
              <button
                className="btn btn-link link-purple"
                onClick={() => {
                  setEditingRedirect(true);
                }}
              >
                Edit
              </button>
            </div>
          )}
        </div>
        <div className="text-muted">Original URL</div>
        <hr />
        <h5>
          Redirects
          <Tooltip
            body="Some links may be gated and can not be previewed"
            className="pl-1"
          />
        </h5>
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
                {urlRedirect.destinationURLs[i]?.url ? (
                  <div className="text-dark text-break">
                    <UrlDifferenceRenderer
                      url1={urlRedirect.urlPattern}
                      url2={urlRedirect.destinationURLs[i].url}
                    />
                  </div>
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
  urlRedirects,
  experiment,
  canAddChanges,
  mutate,
}: RedirectLinkedChangesProps) {
  const redirectCount = urlRedirects.length;

  return (
    <LinkedChangesContainer
      canAddChanges={canAddChanges}
      changeCount={redirectCount}
      experimentStatus={experiment.status}
      type="redirects"
      onAddChange={() => setUrlRedirectModal(true)}
    >
      <div>
        {urlRedirects.map((r, i) => (
          <div className={i > 0 ? "mt-3" : undefined} key={r.id}>
            <Redirect
              urlRedirect={r}
              experiment={experiment}
              mutate={mutate}
              canEdit={canAddChanges}
            />
          </div>
        ))}
      </div>
    </LinkedChangesContainer>
  );
}
