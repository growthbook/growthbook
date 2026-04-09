import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import track from "@/services/track";

import LinkedFeatureFlag from "@/components/Experiment/LinkedFeatureFlag";
import LinkedChangesContainer from "@/components/Experiment/LinkedChanges/LinkedChangesContainer";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import { Redirect } from "./RedirectLinkedChanges";

export default function LinkedChanges({
  setFeatureModal,
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  experiment,
  canAddChanges,
  isPublic,
  mutate,
  canEditVisualChangesets,
}: {
  setFeatureModal?: (open: boolean) => void;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  experiment: ExperimentInterfaceStringDates;
  canAddChanges: boolean;
  isPublic?: boolean;
  mutate?: () => void;
  canEditVisualChangesets: boolean;
}) {
  const featureFlagCount = linkedFeatures.length;

  return (
    <LinkedChangesContainer
      canAddChanges={canAddChanges}
      changeCount={featureFlagCount}
      type="feature-flag"
      experimentStatus={experiment.status}
      onAddChange={() => {
        setFeatureModal?.(true);
        track("Open linked feature modal", {
          source: "linked-changes",
          action: "add",
        });
      }}
    >
      {!isPublic ? (
        <>
          {linkedFeatures.map((info, i) => (
            <LinkedFeatureFlag info={info} experiment={experiment} key={i} />
          ))}
          <VisualChangesetTable
            experiment={experiment}
            visualChangesets={visualChangesets}
            mutate={mutate}
            canEditVisualChangesets={canEditVisualChangesets}
          />
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
