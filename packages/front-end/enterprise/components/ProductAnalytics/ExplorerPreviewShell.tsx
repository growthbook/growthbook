import { ComponentProps, ReactNode, useEffect } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import Text from "@/ui/Text";
import PreviewShell from "@/components/QueryPreview/PreviewShell";
import { useExplorerContext } from "./ExplorerContext";

// Connects the presentational PreviewShell to the explorer that runs the
// preview query. Must be rendered inside an ExplorerProvider.
export default function ExplorerPreviewShell({
  config,
  controls,
  emptyDescription,
  incompleteDescription,
  warehouseUnavailableText,
  renderChart,
}: Pick<
  ComponentProps<typeof PreviewShell>,
  "controls" | "emptyDescription" | "incompleteDescription"
> & {
  /** Null while the definition is incomplete; only the footer is interactive. */
  config: ExplorationConfig | null;
  warehouseUnavailableText: string;
  renderChart: (state: {
    exploration: ProductAnalyticsExploration;
    submittedExploreState: ExplorationConfig;
  }) => ReactNode;
}) {
  const {
    exploration,
    submittedExploreState,
    loading,
    error,
    isSubmittable,
    managedWarehouseUnavailable,
    handleSubmit,
    setDraftExploreState,
    isStale,
    needsFetch,
  } = useExplorerContext();
  useEffect(() => {
    if (config) setDraftExploreState(config);
  }, [config, setDraftExploreState]);

  if (managedWarehouseUnavailable) {
    return <Text color="text-mid">{warehouseUnavailableText}</Text>;
  }

  return (
    <PreviewShell
      complete={config !== null}
      exploration={exploration}
      loading={loading}
      error={error}
      outdated={!!exploration && (!config || isStale || needsFetch)}
      disabled={!isSubmittable}
      onRun={() => handleSubmit()}
      onRefresh={() => handleSubmit({ force: true })}
      controls={controls}
      emptyDescription={emptyDescription}
      incompleteDescription={incompleteDescription}
      renderChart={(exploration) =>
        renderChart({
          exploration,
          // Label the result with the config that produced it, never the draft.
          submittedExploreState: submittedExploreState ?? exploration.config,
        })
      }
    />
  );
}
