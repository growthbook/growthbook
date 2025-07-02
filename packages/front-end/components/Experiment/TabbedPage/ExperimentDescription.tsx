import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useState } from "react";
import Collapsible from "react-collapsible";
import { FaAngleRight } from "react-icons/fa";
import { Box, Flex, ScrollArea, Heading } from "@radix-ui/themes";
import Markdown from "@/components/Markdown/Markdown";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Frame from "@/components/Radix/Frame";
import Button from "@/components/Radix/Button";
import PremiumCallout from "@/components/Radix/PremiumCallout";
import { useCustomFields } from "@/hooks/useCustomFields";
import EditDescriptionModal from "../EditDescriptionModal";

export default function ExperimentDescription({
  experiment,
  canEditExperiment,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  canEditExperiment: boolean;
  mutate: () => void;
}) {
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [expandDescription, setExpandDescription] = useLocalStorage(
    `collapse-${experiment.id}-description`,
    localStorage.getItem(`collapse-${experiment.id}-description`) === "true"
      ? false
      : true
  );

  const customFields = useCustomFields();

  return (
    <>
      {showDescriptionModal ? (
        <EditDescriptionModal
          source="experiment-setup-tab"
          mutate={mutate}
          experimentId={experiment.id}
          initialValue={experiment.description}
          close={() => setShowDescriptionModal(false)}
        />
      ) : null}
      <Frame>
        <Collapsible
          open={!experiment.description ? true : expandDescription}
          transitionTime={100}
          triggerDisabled={!experiment.description}
          onOpening={() => setExpandDescription(true)}
          onClosing={() => setExpandDescription(false)}
          trigger={
            <Box
              as="div"
              style={{
                cursor: `${experiment.description ? "pointer" : "default"}`,
              }}
            >
              <Flex align="center" justify="between" className="text-dark">
                <Heading mb="0" as="h4" size="3">
                  Description
                </Heading>
                <Flex align="center" gap="2">
                  {canEditExperiment ? (
                    <Button
                      variant="ghost"
                      stopPropagation={true}
                      mr={experiment.description ? "3" : "0"}
                      onClick={() => {
                        setShowDescriptionModal(true);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                  {experiment.description ? (
                    <FaAngleRight className="chevron" />
                  ) : null}
                </Flex>
              </Flex>
            </Box>
          }
        >
          {experiment.description ? (
            <ScrollArea
              style={{
                maxHeight: "491px",
              }}
              className="py-2 fade-mask-vertical-1rem"
            >
              <Markdown>{experiment.description}</Markdown>
            </ScrollArea>
          ) : (
            <Box as="div" className="font-italic text-muted" py="2">
              Add a description to keep your team informed about the purpose and
              parameters of your experiment
            </Box>
          )}
          {!customFields.length && experiment.description ? (
            <PremiumCallout
              mt="3"
              commercialFeature="custom-metadata"
              dismissable={true}
              id="exp-description-custom-metadata"
              docSection="customMetadata"
            >
              <strong>Custom Fields</strong> add structured metadata to
              experiments and feature flags, like Jira links, categories and
              more.
            </PremiumCallout>
          ) : null}
        </Collapsible>
      </Frame>
    </>
  );
}
