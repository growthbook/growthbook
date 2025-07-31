import React from "react";
import { ExperimentDescriptionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { ScrollArea } from "@radix-ui/themes";
import Markdown from "react-markdown";
import { Box } from "spectacle";
import { BlockProps } from ".";

export default function ExperimentDescriptionBlock({
  experiment,
}: BlockProps<ExperimentDescriptionBlockInterface>) {
  return (
    <>
      {experiment.description ? (
        <Box as="div" py="2">
          <ScrollArea
            style={{
              maxHeight: "491px",
            }}
          >
            <Markdown>{experiment.description}</Markdown>
          </ScrollArea>
        </Box>
      ) : (
        <Box as="div" className="font-italic text-muted" py="2">
          This experiment doesn&apos;t have a description yet.
        </Box>
      )}
    </>
  );
}
