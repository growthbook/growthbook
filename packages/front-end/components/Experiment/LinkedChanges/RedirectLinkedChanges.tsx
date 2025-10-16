import { useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { diffChars } from "diff";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import { Box, Flex, Text } from "@radix-ui/themes";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import LinkedChangesContainer from "@/components/Experiment/LinkedChanges/LinkedChangesContainer";
import Tooltip from "@/components/Tooltip/Tooltip";
import Link from "@/ui/Link";

interface RedirectLinkedChangesProps {
  setUrlRedirectModal?: (boolean) => void;
  urlRedirects: URLRedirectInterface[];
  experiment: ExperimentInterfaceStringDates;
  canAddChanges: boolean;
  mutate?: () => void;
  isPublic?: boolean;
}

interface RedirectProps {
  urlRedirect: URLRedirectInterface;
  experiment: ExperimentInterfaceStringDates;
  canEdit: boolean;
  mutate?: () => void;
}

function UrlDifferenceRenderer({ url1, url2 }: { url1: string; url2: string }) {
  const differences = diffChars(url1, url2);
  const filtered = differences.filter((d) => !d.removed);

  try {
    const parsedUrl1 = new URL(url1);
    const parsedUrl2 = new URL(url2);

    return (
      <Link
        href={url2}
        color="dark"
        underline="none"
        rel="noreferrer"
        target="_blank"
      >
        <Flex align="center" py="2">
          {parsedUrl1.hostname === parsedUrl2.hostname ? (
            <>
              {filtered.map((part, index) => {
                if (part.added) {
                  return <b key={index}>{part.value}</b>;
                } else {
                  return <span key={index}>{part.value}</span>;
                }
              })}
            </>
          ) : (
            <>{url2}</>
          )}
          <PiArrowSquareOutFill className="ml-1" />
        </Flex>
      </Link>
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
      {editingRedirect && mutate ? (
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
        <Flex justify="between" align="start">
          <Box as="div">
            <Link
              href={originUrl}
              underline="none"
              weight="bold"
              rel="noreferrer"
              target="_blank"
            >
              <Flex align="center" py="2">
                {originUrl}
                <PiArrowSquareOutFill className="ml-1" />
              </Flex>
            </Link>
            <Text as="span" color="gray">
              Original URL
            </Text>
          </Box>
          {canEdit && (
            <div>
              <button
                className="btn btn-link text-danger"
                onClick={async () => {
                  await apiCall(`/url-redirects/${urlRedirect.id}`, {
                    method: "DELETE",
                  });
                  mutate?.();
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
        </Flex>
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
  isPublic,
}: RedirectLinkedChangesProps) {
  const redirectCount = urlRedirects.length;

  return (
    <LinkedChangesContainer
      canAddChanges={canAddChanges}
      changeCount={redirectCount}
      experimentStatus={experiment.status}
      type="redirects"
      onAddChange={() => setUrlRedirectModal?.(true)}
    >
      {!isPublic ? (
        <>
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
        </>
      ) : null}
    </LinkedChangesContainer>
  );
}
