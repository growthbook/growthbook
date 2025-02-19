import React, { FC, useCallback, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  Variation,
} from "back-end/types/experiment";
import {
  VisualChange,
  VisualChangesetInterface,
  VisualChangesetURLPattern,
} from "back-end/types/visual-changeset";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import track from "@/services/track";
import { appendQueryParamsToURL } from "@/services/utils";
import { useAuth } from "@/services/auth";
import VisualChangesetModal from "@/components/Experiment/VisualChangesetModal";
import EditDOMMutatonsModal from "@/components/Experiment/EditDOMMutationsModal";
import LinkedChange from "@/components/Experiment/LinkedChange";
import Badge from "@/components/Radix/Badge";
import Button from "@/components/Radix/Button";

type Props = {
  experiment: ExperimentInterfaceStringDates;
  visualChangesets: VisualChangesetInterface[];
  mutate?: () => void;
  canEditVisualChangesets: boolean;
};

const drawChange = ({
  i,
  vc,
  variations,
  experiment,
  canEditVisualChangesets,
  setEditingVisualChangeset,
  setEditingVisualChange,
  simpleUrlPatterns,
  regexUrlPatterns,
}: {
  i: number;
  vc: VisualChangesetInterface;
  variations: Variation[];
  experiment: ExperimentInterfaceStringDates;
  canEditVisualChangesets: boolean;
  setEditingVisualChangeset: (vc: VisualChangesetInterface) => void;
  setEditingVisualChange: (params: {
    visualChange: VisualChange;
    visualChangeIndex: number;
    visualChangeset: VisualChangesetInterface;
  }) => void;
  simpleUrlPatterns: VisualChangesetURLPattern[];
  regexUrlPatterns: VisualChangesetURLPattern[];
}) => {
  return (
    <>
      <Flex width="100%" gap="4">
        <Box flexBasis="50%">
          <Flex align="center" gap="4">
            <Heading weight="bold" as="h4" size="3" mb="0">
              URL Targeting
            </Heading>
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
          <Flex direction="column" gap="3" mt="4">
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
        </Box>
        <Box width="50%">
          <Flex align="center" gap="4" justify="between">
            <Heading weight="bold" as="h4" size="3" mb="0">
              Variations
            </Heading>
            {/*}
            {canEditVisualChangesets && experiment.status === "draft" && (
              <>
                <Box flexGrow="1"></Box>
                <DeleteButton
                  className="btn-sm ml-4"
                  useRadix={true}
                  text="Delete"
                  onClick={() => deleteVisualChangeset(vc.id)}
                  displayName="Visual Changes"
                />
              </>
            )}
            {*/}
          </Flex>
          <Box>
            {variations.map((v, j) => {
              const changes = vc.visualChanges[j];
              const numChanges =
                (changes?.css ? 1 : 0) +
                (changes?.js ? 1 : 0) +
                (changes?.domMutations?.length || 0);

              // todo: memoize/refactor?
              let editorUrl = vc.editorUrl.trim();
              if (!editorUrl.match(/^http(s)?:/)) {
                editorUrl = "http://" + editorUrl;
              }
              editorUrl = appendQueryParamsToURL(editorUrl, {
                [experiment.trackingKey]: j,
              });
              return (
                <Flex
                  justify="between"
                  width="100%"
                  key={j}
                  gap="4"
                  py="2"
                  my="2"
                  style={{ borderBottom: "1px solid var(--slate-a4)" }}
                >
                  <Flex
                    align="start"
                    gap="2"
                    flexBasis="30%"
                    flexShrink="0"
                    className={`variation with-variation-label border-right-0 variation${j}`}
                  >
                    <span
                      className="label mt-1"
                      style={{ width: 20, height: 20 }}
                    >
                      {i}
                    </span>
                    <Flex direction="column">
                      <span
                        className="d-inline-block text-ellipsis font-weight-semibold"
                        title={v.name}
                      >
                        {v.name}
                      </span>
                      <Text size="1" style={{ color: "var(--color-text-mid)" }}>
                        {numChanges} visual change
                        {numChanges === 1 ? "" : "s"}
                      </Text>
                    </Flex>
                  </Flex>
                  <Flex gap="2" align="center" justify="end">
                    <Button variant="ghost">
                      <a target="_blank" rel="noreferrer" href={editorUrl}>
                        Preview{" "}
                        <PiArrowSquareOut
                          className="ml-1"
                          style={{ position: "relative", top: "-2px" }}
                        />
                      </a>
                    </Button>
                    {canEditVisualChangesets && (
                      <Button
                        variant="soft"
                        onClick={() => {
                          setEditingVisualChange({
                            visualChange: changes,
                            visualChangeIndex: j,
                            visualChangeset: vc,
                          });
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </Flex>
                </Flex>
              );
            })}
          </Box>
        </Box>
      </Flex>
    </>
  );
};

export const VisualChangesetTable: FC<Props> = ({
  experiment,
  visualChangesets = [],
  mutate,
  canEditVisualChangesets,
}: Props) => {
  const { variations } = experiment;
  const { apiCall } = useAuth();

  const [
    editingVisualChangeset,
    setEditingVisualChangeset,
  ] = useState<VisualChangesetInterface | null>(null);

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
    [apiCall, mutate]
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
          i === index ? visualChange : c
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
    [apiCall, mutate]
  );

  return (
    <>
      {visualChangesets.map((vc, i) => {
        const simpleUrlPatterns = vc.urlPatterns
          .filter((v) => v.type === "simple")
          .sort((v) => (!v.include ? 1 : -1));
        const regexUrlPatterns = vc.urlPatterns
          .filter((v) => v.type === "regex")
          .sort((v) => (!v.include ? 1 : -1));

        const change = drawChange({
          i,
          vc,
          variations,
          experiment,
          canEditVisualChangesets,
          setEditingVisualChangeset,
          setEditingVisualChange,
          simpleUrlPatterns,
          regexUrlPatterns,
        });

        const visualChangeTypesSet: Set<string> = new Set();
        vc.visualChanges.forEach((c) => {
          if (c.domMutations.length > 0) {
            visualChangeTypesSet.add("Copy");
          }
          if (c.css) {
            visualChangeTypesSet.add("CSS");
          }
          if (c.js) {
            visualChangeTypesSet.add("Javascript");
          }
        });

        const visualChangeTypesDict: string[] = ["Copy", "CSS", "Javascript"];
        const visualChangeTypes: string[] = [...visualChangeTypesSet].sort(
          (a, b) =>
            visualChangeTypesDict.indexOf(a) - visualChangeTypesDict.indexOf(b)
        );

        return (
          <LinkedChange
            key={i}
            changeType={"visual"}
            page={vc.editorUrl}
            vc={vc}
            experiment={experiment}
            canEditVisualChangesets={canEditVisualChangesets}
            deleteVisualChangeset={deleteVisualChangeset}
            changes={visualChangeTypes}
            open={experiment.status === "draft"}
          >
            {change}
          </LinkedChange>
        );
      })}

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
        <EditDOMMutatonsModal
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
    </>
  );
};
