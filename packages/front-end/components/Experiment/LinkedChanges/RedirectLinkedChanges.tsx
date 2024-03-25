import { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { diffChars } from "diff";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import { useAuth } from "@front-end/services/auth";
import DeleteButton from "@front-end/components/DeleteButton/DeleteButton";
import UrlRedirectModal from "@front-end/components/Experiment/UrlRedirectModal";
import LinkedChangesContainer from "@front-end/components/Experiment/LinkedChanges/LinkedChangesContainer";
import styles from "@front-end/components/Experiment/LinkedChanges/RedirectLinkedChanges.module.scss";

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
        <a className={styles.redirectUrl} href={url2}>
          {filtered.map((part, index) => {
            if (part.added) {
              return <b key={index}>{part.value}</b>;
            } else {
              return <span key={index}>{part.value}</span>;
            }
          })}
        </a>
      );
    } else
      return (
        <a className={styles.redirectUrl} href={url2}>
          {url2}
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
        />
      ) : null}
      <div className="appbox p-3 mb-0">
        <div className="d-flex justify-content-between">
          <h5 className="mt-2">Original URL</h5>
          {canEdit && (
            <div>
              <button
                className="btn btn-link"
                onClick={() => {
                  setEditingRedirect(true);
                }}
              >
                Edit{" "}
              </button>
              <DeleteButton
                className="btn-sm ml-4"
                onClick={async () => {
                  await apiCall(`/url-redirects/${urlRedirect.id}`, {
                    method: "DELETE",
                  });
                  mutate();
                }}
                displayName="URL Redirect"
              />
            </div>
          )}
        </div>

        <a className={styles.redirectUrl} href={originUrl}>
          {originUrl}
        </a>
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
                {urlRedirect.destinationURLs[i]?.url ? (
                  <UrlDifferenceRenderer
                    url1={urlRedirect.urlPattern}
                    url2={urlRedirect.destinationURLs[i].url}
                  />
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
