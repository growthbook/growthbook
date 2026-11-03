import { PiLink, PiCheck } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Button from "@/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import LinkButton from "@/ui/LinkButton";
import track from "@/services/track";
import Heading from "@/ui/Heading";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";

export default function PublicExperimentMetaInfo({
  experiment,
  showPrivateLink,
}: {
  experiment: ExperimentInterfaceStringDates;
  showPrivateLink?: boolean;
}) {
  const HOST = globalThis?.window?.location?.origin;
  const isBandit = experiment.type === "multi-armed-bandit";
  const shareableLink = experiment.uid
    ? `${HOST}/public/e/${experiment.uid}`
    : `${HOST}/${isBandit ? "bandit" : "experiment"}/${experiment.id}`;

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });

  const shareLinkButton =
    experiment.shareLevel !== "public" ? null : copySuccess ? (
      <Button style={{ width: 130 }} icon={<PiCheck />}>
        Link copied
      </Button>
    ) : (
      <Button
        icon={<PiLink />}
        onClick={() => {
          if (!copySuccess) performCopy(shareableLink);
          track("Experiment: Click Copy Link", {
            source: "public page",
            type: experiment.shareLevel,
          });
        }}
        style={{ width: 130 }}
      >
        Copy link
      </Button>
    );

  return (
    <div className="container-fluid pagecontents position-relative px-4 pt-3 pb-0">
      <Flex direction="row" align="start" justify="between" gap="5">
        <Flex align="center" gap="2">
          <Heading
            as="h1"
            size="2xl"
            color="text-high"
            overflowWrap="anywhere"
            weight="medium"
          >
            {experiment.name}
          </Heading>
          <Box style={{ userSelect: "none" }}>
            <ExperimentStatusIndicator experimentData={experiment} />
          </Box>
        </Flex>
        <Flex direction="row" align="center" gap="2" flexShrink="0">
          {showPrivateLink && (
            <LinkButton
              variant="outline"
              href={`/${isBandit ? "bandit" : "experiment"}/${experiment.id}`}
            >
              Edit {isBandit ? "Bandit" : "experiment"}
            </LinkButton>
          )}
          {shareLinkButton}
        </Flex>
      </Flex>
    </div>
  );
}
