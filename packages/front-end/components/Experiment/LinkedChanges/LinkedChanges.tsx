import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { Box } from "@radix-ui/themes";
import LinkedFeatureFlag from "@/components/Experiment/LinkedChanges/LinkedFeatureFlag";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import Heading from "@/ui/Heading";
import { RedirectLinkedChanges } from "./RedirectLinkedChanges";

export default function LinkedChanges({
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  experiment,
  canAddChanges,
  isPublic,
  mutate,
  canEditVisualChangesets,
  visualChangesetEnvStates,
  urlRedirectEnvStates,
}: {
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  experiment: ExperimentInterfaceStringDates;
  canAddChanges: boolean;
  isPublic?: boolean;
  mutate?: () => void;
  canEditVisualChangesets: boolean;
  visualChangesetEnvStates?: LinkedChangeEnvStates;
  urlRedirectEnvStates?: LinkedChangeEnvStates;
}) {
  const numLinkedChanges =
    linkedFeatures.length + visualChangesets.length + urlRedirects.length;
  // Don't display linked changes section if none have been added and experiment is no longer a draft
  if (
    (experiment.status !== "draft" && numLinkedChanges === 0) ||
    numLinkedChanges === 0
  )
    return null;

  return (
    <Box className="appbox" px="5" py="4">
      <Box mb="2" mx="1" mt="2">
        <Heading as="h4" size="small">
          Values
        </Heading>
      </Box>
      {!isPublic ? (
        <>
          {linkedFeatures.map((info) => (
            <LinkedFeatureFlag
              info={info}
              experiment={experiment}
              key={info.feature.id}
            />
          ))}
          <VisualChangesetTable
            experiment={experiment}
            visualChangesets={visualChangesets}
            mutate={mutate}
            canEditVisualChangesets={canEditVisualChangesets}
            environmentStates={visualChangesetEnvStates}
          />
          {urlRedirects.map((r) => (
            <RedirectLinkedChanges
              urlRedirect={r}
              experiment={experiment}
              mutate={mutate}
              canEdit={canAddChanges}
              key={r.id}
              environmentStates={urlRedirectEnvStates}
            />
          ))}
        </>
      ) : null}
    </Box>
  );
}
