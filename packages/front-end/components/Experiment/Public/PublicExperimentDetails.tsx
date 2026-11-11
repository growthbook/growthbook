import { Flex, Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Metadata from "@/ui/Metadata";
import ScrollArea from "@/ui/ScrollArea";
import { PanelSection } from "@/components/Experiment/TabbedPage/ExperimentDetailsPanel";
import {
  EmptyValue,
  ExperimentDates,
  ExperimentStatusField,
} from "@/components/Experiment/TabbedPage/ProjectTagBar";

const count = (n: number, one: string, many: string) =>
  n ? `${n} ${n === 1 ? one : many}` : null;

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
  const linkedChanges = [
    count(linkedFeatureCount, "Feature Flag", "Feature Flags"),
    count(
      visualChangesetCount,
      "AI Visual Editor change",
      "AI Visual Editor changes",
    ),
    count(urlRedirectCount, "URL Redirect", "URL Redirects"),
  ].filter(Boolean);

  return (
    <ScrollArea fill style={{ flex: 1, minHeight: 0 }}>
      <Flex px="5" py="4" direction="column" gap="4">
        <PanelSection title="General">
          <Flex direction="column" gap="3">
            <ExperimentStatusField experiment={experiment} />
            <ExperimentDates experiment={experiment} />
          </Flex>
        </PanelSection>
        <Separator size="4" />
        <PanelSection title="Data">
          <Flex direction="column" gap="3">
            <Metadata
              size="sm"
              stacked
              label="Experiment key"
              value={experiment.trackingKey || <EmptyValue />}
            />
            <Metadata
              size="sm"
              stacked
              label="Linked changes"
              value={
                linkedChanges.length ? linkedChanges.join(", ") : <EmptyValue />
              }
            />
          </Flex>
        </PanelSection>
      </Flex>
    </ScrollArea>
  );
}
