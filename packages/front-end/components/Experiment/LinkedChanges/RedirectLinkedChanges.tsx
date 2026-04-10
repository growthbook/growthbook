import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { diffChars } from "diff";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import LinkedChangeVariationRows from "@/components/Experiment/LinkedChangeVariationRows";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import LinkedChange from "@/components/Experiment/LinkedChange";

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
        <Flex align="center">
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
          <Box ml="1">
            <PiArrowSquareOutFill color="var(--violet-a11)" />
          </Box>
        </Flex>
      </Link>
    );
  } catch {
    console.error("Failed to parse URL to for redirect diff");
    return <span>{url2}</span>;
  }
}

export const RedirectLinkedChanges = ({
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
      <LinkedChange
        changeType="redirect"
        heading={originUrl}
        headingLink={originUrl}
        onEdit={() => setEditingRedirect(true)}
        onDelete={async () => {
          await apiCall(`/url-redirects/${urlRedirect.id}`, {
            method: "DELETE",
          });
          mutate?.();
        }}
        canEdit={canEdit}
      >
        <Box className="appbox">
          <Flex width="100%" gap="4" py="4" px="5" direction="column">
            <Box flexGrow="1">
              <LinkedChangeVariationRows
                experiment={experiment}
                renderContent={(j) =>
                  urlRedirect.destinationURLs[j]?.url ? (
                    <UrlDifferenceRenderer
                      url1={urlRedirect.urlPattern}
                      url2={urlRedirect.destinationURLs[j].url}
                    />
                  ) : (
                    <Text color="text-low">No redirect</Text>
                  )
                }
              />
            </Box>
          </Flex>
        </Box>
      </LinkedChange>
    </>
  );
};
