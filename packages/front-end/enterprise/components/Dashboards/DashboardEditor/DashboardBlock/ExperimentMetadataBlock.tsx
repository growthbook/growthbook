import React from "react";
import { ExperimentMetadataBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { ScrollArea, Text } from "@radix-ui/themes";
import { Box } from "spectacle";
import Markdown from "@/components/Markdown/Markdown";
import VariationsTable from "@/components/Experiment/VariationsTable";
import { BlockProps } from ".";

export default function ExperimentMetadataBlock({
  block: { showDescription, showHypothesis, showVariationImages, variationIds },
  experiment,
}: BlockProps<ExperimentMetadataBlockInterface>) {
  const variationsList =
    (variationIds ?? []).length === 0
      ? experiment.variations.map(({ id }) => id)
      : variationIds;

  return (
    <>
      {showDescription && (
        <>
          <Text weight="medium">Description</Text>
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
      )}
      {showHypothesis && (
        <>
          <Text weight="medium">Hypothesis</Text>

          {experiment.hypothesis ? (
            <Box as="div" py="2">
              {experiment.hypothesis}
            </Box>
          ) : (
            <Box as="div" className="font-italic text-muted" py="2">
              This experiment doesn&apos;t have a hypothesis yet.
            </Box>
          )}
        </>
      )}
      {showVariationImages && (
        <div className="variation-image-block">
          <VariationsTable
            experiment={experiment}
            variationsList={variationsList}
            canEditExperiment={false}
            allowImages={true}
          />
        </div>
      )}
    </>
  );
}
