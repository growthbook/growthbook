import React, { FC, useCallback, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
} from "shared/types/experiment";
import {
  VisualChange,
  VisualChangesetInterface,
} from "shared/types/visual-changeset";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import track from "@/services/track";
import { appendQueryParamsToURL } from "@/services/utils";
import { useAuth } from "@/services/auth";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import EditDOMMutationsModal from "@/components/Experiment/EditDOMMutationsModal";
import LinkedChange from "@/components/Experiment/LinkedChanges/LinkedChange";
import LinkedChangeVariationRows from "@/components/Experiment/LinkedChanges/LinkedChangeVariationRows";
import EnvironmentStatesGrid from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Linkbutton from "@/ui/LinkButton";

/** Stored editor URLs often omit a protocol; Next.js Link treats those as app-relative paths. */
function normalizeVisualEditorUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (!trimmed.match(/^http(s)?:/)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

type Props = {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate?: () => void;
  canEditVisualChangesets: boolean;
  environmentStates?: LinkedChangeEnvStates;
};

function VisualChangesRows({
  vc,
  experiment,
  canEditVisualChangesets,
  setEditingVisualChange,
  envStatesArray,
}: {
  vc: VisualChangesetInterface;
  experiment: ExperimentInterfaceStringDates;
  canEditVisualChangesets: boolean;
  setEditingVisualChange: (params: {
    visualChange: VisualChange;
    visualChangeIndex: number;
    visualChangeset: VisualChangesetInterface;
  }) => void;
  envStatesArray: {
    env: string;
    state: string;
    isActive: boolean;
    tooltip: string;
  }[];
}) {
  return (
    <Box className="appbox">
      <Flex width="100%" gap="4" py="4" px="5" direction="column">
        <Box flexGrow="1">
          <LinkedChangeVariationRows
            experiment={experiment}
            renderContent={(j) => {
              const change = vc.visualChanges[j];
              const numChanges =
                (change?.css ? 1 : 0) +
                (change?.js ? 1 : 0) +
                (change?.domMutations?.length || 0);

              return numChanges > 0 ? (
                <Text size="medium" weight="regular" color="text-high">
                  {numChanges} visual change
                  {numChanges === 1 ? "" : "s"}
                </Text>
              ) : (
                <Text size="medium" weight="regular" color="text-disabled">
                  No visual changes
                </Text>
              );
            }}
            renderActions={(j) => {
              const change = vc.visualChanges[j];
              let editorUrl = normalizeVisualEditorUrl(vc.editorUrl);
              editorUrl = appendQueryParamsToURL(editorUrl, {
                [experiment.trackingKey]: j,
              });

              return (
                <Flex gap="2" align="center" justify="end">
                  <Linkbutton href={editorUrl} external={true} variant="ghost">
                    Preview
                    <PiArrowSquareOut className="ml-1" />
                  </Linkbutton>
                  {canEditVisualChangesets && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingVisualChange({
                          visualChange: change,
                          visualChangeIndex: j,
                          visualChangeset: vc,
                        });
                      }}
                    >
                      Edit
                    </Button>
                  )}
                </Flex>
              );
            }}
          />
        </Box>
      </Flex>
      {envStatesArray.length > 0 && (
        <>
          <Separator size="4" />
          <EnvironmentStatesGrid environmentStates={envStatesArray} />
        </>
      )}
    </Box>
  );
}

export const VisualChangesetTable: FC<Props> = ({
  experiment,
  visualChangesets = [],
  mutate,
  canEditVisualChangesets,
  environmentStates,
}: Props) => {
  const { apiCall } = useAuth();

  const [editingVisualChangeset, setEditingVisualChangeset] =
    useState<VisualChangesetInterface | null>(null);

  const [editingVisualChange, setEditingVisualChange] = useState<{
    visualChangeset: VisualChangesetInterface;
    visualChange: VisualChange;
    visualChangeIndex: number;
  } | null>(null);

  const deleteVisualChangeset = useCallback(
    async (id: string) => {
      await apiCall(`/visual-changesets/${id}`, {
        method: "DELETE",
      });
      mutate?.();
      track("Delete visual changeset", {
        source: "visual-editor-ui",
      });
    },
    [apiCall, mutate],
  );

  const updateVisualChange = useCallback(
    async ({
      visualChangeset,
      visualChange,
      index,
    }: {
      visualChangeset: VisualChangesetInterface;
      visualChange: VisualChange;
      index: number;
    }) => {
      const newVisualChangeset: VisualChangesetInterface = {
        ...visualChangeset,
        visualChanges: visualChangeset.visualChanges.map((c, i) =>
          i === index ? visualChange : c,
        ),
      };
      await apiCall(`/visual-changesets/${visualChangeset.id}`, {
        method: "PUT",
        body: JSON.stringify(newVisualChangeset),
      });
      mutate?.();
      track("Delete visual changeset", {
        source: "visual-editor-ui",
      });
    },
    [apiCall, mutate],
  );

  const envStatesArray = environmentStates
    ? Object.entries(environmentStates).map(([env, state]) => ({
        env,
        state,
        isActive: state === "active",
        tooltip:
          state === "active"
            ? "An SDK connection in this environment has visual experiments enabled"
            : "No SDK connection in this environment has visual experiments enabled",
      }))
    : [];

  return (
    <>
      {editingVisualChangeset && mutate ? (
        <VisualChangesetModal
          mode="edit"
          experiment={experiment}
          visualChangeset={editingVisualChangeset}
          mutate={mutate}
          close={() => setEditingVisualChangeset(null)}
          source={"visual-changeset-table"}
        />
      ) : null}

      {editingVisualChange ? (
        <EditDOMMutationsModal
          experiment={experiment}
          visualChange={editingVisualChange.visualChange}
          close={() => setEditingVisualChange(null)}
          onSave={(newVisualChange) =>
            updateVisualChange({
              index: editingVisualChange.visualChangeIndex,
              visualChange: newVisualChange,
              visualChangeset: editingVisualChange.visualChangeset,
            })
          }
        />
      ) : null}
      {visualChangesets.map((vc, i) => {
        const simpleUrlPatterns = vc.urlPatterns
          .filter((v) => v.type === "simple")
          .sort((v) => (!v.include ? 1 : -1));
        const regexUrlPatterns = vc.urlPatterns
          .filter((v) => v.type === "regex")
          .sort((v) => (!v.include ? 1 : -1));

        const visualChangeTypesSet: Set<string> = new Set();
        vc.visualChanges.forEach((c) => {
          if (c.domMutations.length > 0) {
            visualChangeTypesSet.add("Text");
          }
          if (c.css) {
            visualChangeTypesSet.add("CSS");
          }
          if (c.js) {
            visualChangeTypesSet.add("Javascript");
          }
        });

        const visualChangeTypesDict: string[] = ["Text", "CSS", "Javascript"];
        const visualChangeTypes: string[] = [...visualChangeTypesSet].sort(
          (a, b) =>
            visualChangeTypesDict.indexOf(a) - visualChangeTypesDict.indexOf(b),
        );

        const normalizedHeadingUrl = normalizeVisualEditorUrl(vc.editorUrl);

        return (
          <LinkedChange
            key={i}
            changeType={"visual"}
            heading={vc.editorUrl.trim()}
            headingLink={normalizedHeadingUrl || undefined}
            vc={vc}
            experiment={experiment}
            changes={visualChangeTypes}
            onDelete={() => deleteVisualChangeset(vc.id)}
            canEdit={canEditVisualChangesets}
          >
            <Flex align="baseline" justify="between" mb="4" pr="5">
              <Flex direction="column" gap="3">
                {simpleUrlPatterns.length > 0 && (
                  <>
                    {simpleUrlPatterns.map((p, j) => (
                      <Flex gap="3" key={j}>
                        <Text weight="medium" as="p" mb="0">
                          {p.include ? "INCLUDE" : "EXCLUDE"}
                        </Text>
                        <Badge label="Simple match" color="gray" />
                        <Box>{p.pattern}</Box>
                      </Flex>
                    ))}
                  </>
                )}
                {regexUrlPatterns.length > 0 && (
                  <>
                    {regexUrlPatterns.map((p, j) => (
                      <Flex gap="3" key={j}>
                        <Text weight="medium" as="p" mb="0">
                          {p.include ? "INCLUDE" : "EXCLUDE"}
                        </Text>
                        <Badge label="Regex match" color="lime" />
                        <Box>{p.pattern}</Box>
                      </Flex>
                    ))}
                  </>
                )}
              </Flex>
              {canEditVisualChangesets && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingVisualChangeset(vc);
                    track("Open visual editor modal", {
                      source: "visual-editor-ui",
                      action: "edit",
                    });
                  }}
                >
                  Edit
                </Button>
              )}
            </Flex>
            <VisualChangesRows
              vc={vc}
              experiment={experiment}
              canEditVisualChangesets={canEditVisualChangesets}
              setEditingVisualChange={setEditingVisualChange}
              envStatesArray={envStatesArray}
            />
          </LinkedChange>
        );
      })}
    </>
  );
};
