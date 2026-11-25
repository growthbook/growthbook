import { Flex, Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useLingui } from "@lingui/react/macro";
import Metadata from "@/ui/Metadata";
import ScrollArea from "@/ui/ScrollArea";
import { PanelSection } from "@/components/DetailsPanel";
import { EmptyValue } from "@/components/DetailsPanelFields";
import {
  ExperimentDates,
  ExperimentStatusField,
} from "@/components/Experiment/TabbedPage/ProjectTagBar";

export default function PublicExperimentDetails({
  experiment,
  linkedFeatureCount,
  visualChangesetCount,
  urlRedirectCount,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatureCount: number;
  visualChangesetCount: number;
  urlRedirectCount: number;
}) {
  const { t } = useLingui();
  const linkedChanges = [
    linkedFeatureCount
      ? linkedFeatureCount === 1
        ? t`${linkedFeatureCount} Feature Flag`
        : t`${linkedFeatureCount} Feature Flags`
      : null,
    visualChangesetCount
      ? visualChangesetCount === 1
        ? t`${visualChangesetCount} AI Visual Editor change`
        : t`${visualChangesetCount} AI Visual Editor changes`
      : null,
    urlRedirectCount
      ? urlRedirectCount === 1
        ? t`${urlRedirectCount} URL Redirect`
        : t`${urlRedirectCount} URL Redirects`
      : null,
  ].filter(Boolean);

  return (
    <ScrollArea fill style={{ flex: 1, minHeight: 0 }}>
      <Flex px="5" py="4" direction="column" gap="4">
        <PanelSection title={t`General`}>
          <ExperimentStatusField experiment={experiment} />
          <ExperimentDates experiment={experiment} />
        </PanelSection>
        <Separator size="4" />
        <PanelSection title={t`Data`}>
          <Metadata
            size="sm"
            stacked
            label={t`Experiment key`}
            value={experiment.trackingKey || <EmptyValue />}
          />
          <Metadata
            size="sm"
            stacked
            label={t`Linked changes`}
            value={
              linkedChanges.length ? linkedChanges.join(", ") : <EmptyValue />
            }
          />
        </PanelSection>
      </Flex>
    </ScrollArea>
  );
}
