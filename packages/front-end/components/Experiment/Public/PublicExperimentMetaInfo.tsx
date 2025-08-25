import { PiLink, PiCheck } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { date } from "shared/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Button from "@/ui/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import LinkButton from "@/ui/LinkButton";
import track from "@/services/track";
import Metadata from "@/ui/Metadata";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";

export default function PublicExperimentMetaInfo({
  experiment,
  showPrivateLink,
}: {
  experiment: ExperimentInterfaceStringDates;
  showPrivateLink?: boolean;
}) {
  const HOST = globalThis?.window?.location?.origin;
  const shareableLink = experiment.uid
    ? `${HOST}/public/e/${experiment.uid}`
    : `${HOST}/${experiment?.type === "multi-armed-bandit"
                      ? "bandit"
                      : "experiment"
                  }/${experiment.id}`;

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
        Copy Link
      </Button>
    );

  return (
        <div className="container-fluid pagecontents d-flex my-3 px-3">
          <div className="flex-1">
            <h1 className="mb-3 mr-2">
              {experiment.name}
              <div
                className="d-inline-block ml-2 position-relative"
                style={{top: -2}}
              >
                <ExperimentStatusIndicator experimentData={experiment}/>
              </div>
            </h1>

            <Flex gap="3" mt="2" mb="1">
              <Metadata
                label="Experiment Key"
                value={experiment.trackingKey || "None"}
              />
              <Metadata
                label="Created"
                value={date(experiment.dateCreated)}
              />
            </Flex>
          </div>
          <div className="flex-shrink-0">
            <div className="d-flex align-items-center" style={{ height: 40 }}>
              {showPrivateLink && (
                <LinkButton
                  variant="outline"
                  href={`/${
                    experiment?.type === "multi-armed-bandit"
                      ? "bandit"
                      : "experiment"
                  }/${experiment?.id}`}
                  mr={experiment.shareLevel === "public" ? "4" : "0"}
                >
                  Edit {
                  experiment?.type === "multi-armed-bandit"
                    ? "Bandit"
                    : "Experiment"
                }
                </LinkButton>
              )}
              {shareLinkButton}
            </div>
          </div>
        </div>
  );
}
