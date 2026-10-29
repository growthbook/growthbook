import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, SegmentedControl } from "@radix-ui/themes";
import { PiKanban, PiList, PiPlus } from "react-icons/pi";
import {
  ExperimentIdeaListItem,
  ExperimentIdeaSort,
  experimentIdeaSortValues,
} from "shared/validators";
import { sortExperimentIdeas } from "shared/experiment-ideas";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import LoadingOverlay from "@/components/LoadingOverlay";
import EmptyState from "@/components/EmptyState";
import { useSearch } from "@/services/search";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import IdeaBoard from "@/components/ExperimentIdeas/IdeaBoard";
import IdeaTable from "@/components/ExperimentIdeas/IdeaTable";
import IdeaFilters, {
  getVisibleStageIds,
} from "@/components/ExperimentIdeas/IdeaFilters";
import IdeaFormModal from "@/components/ExperimentIdeas/IdeaFormModal";
import StageSettingsModal from "@/components/ExperimentIdeas/StageSettingsModal";
import {
  useExperimentIdeas,
  useExperimentIdeaStages,
} from "@/components/ExperimentIdeas/useExperimentIdeas";

type View = "board" | "list";

function isSort(v: unknown): v is ExperimentIdeaSort {
  return (
    typeof v === "string" &&
    (experimentIdeaSortValues as readonly string[]).includes(v)
  );
}

const ExperimentIdeasPage = (): React.ReactElement => {
  const router = useRouter();
  const view: View = router.query.view === "list" ? "list" : "board";
  const sort: ExperimentIdeaSort = isSort(router.query.sort)
    ? router.query.sort
    : "updated";

  const setQueryParam = (key: string, value: string | null) => {
    const query = { ...router.query };
    if (value === null) delete query[key];
    else query[key] = value;
    router.replace({ pathname: router.pathname, query }, undefined, {
      shallow: true,
    });
  };

  const { getOwnerDisplay } = useUser();
  const { project, getProjectById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canManageExperimentIdea({
    project: project || "",
  });
  const canConfigureStages = permissionsUtil.canManageOrgSettings();
  const { stages } = useExperimentIdeaStages();

  const includeArchived =
    typeof router.query.q === "string" &&
    /\bis:archived\b/.test(router.query.q);
  const { ideas, error, mutate, setStage, toggleUpvote } =
    useExperimentIdeas(includeArchived);

  const [newIdeaStage, setNewIdeaStage] = useState<string | null>(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const scopedIdeas = useMemo(
    () =>
      (ideas ?? []).filter(
        (i) => !project || !i.project || i.project === project,
      ),
    [ideas, project],
  );

  const showArchivedOnly = useCallback(
    (items: ExperimentIdeaListItem[]) =>
      includeArchived ? items : items.filter((i) => !i.archived),
    [includeArchived],
  );

  const { unpaginatedItems, searchInputProps, syntaxFilters, setSearchValue } =
    useSearch({
      items: scopedIdeas,
      localStorageKey: "experiment-ideas",
      defaultSortField: "dateUpdated",
      defaultSortDir: -1,
      searchFields: [
        "title^3",
        "description^2",
        "hypothesis",
        "expectedOutcome",
        "rationale",
        "tags",
      ],
      updateSearchQueryOnChange: true,
      filterResults: showArchivedOnly,
      searchTermFilters: {
        stage: (i) => i.stage,
        project: (i) => [
          i.project,
          getProjectById(i.project)?.name ?? i.project,
        ],
        owner: (i) => (i.owner ? getOwnerDisplay(i.owner) : ""),
        tag: (i) => i.tags,
        is: (i) => (i.archived ? ["archived"] : []),
      },
    });

  const sorted = useMemo(
    () => sortExperimentIdeas(unpaginatedItems, sort),
    [unpaginatedItems, sort],
  );
  const visibleStageIds = getVisibleStageIds(syntaxFilters, stages);

  const run = async (fn: () => Promise<unknown>) => {
    setMutationError(null);
    try {
      await fn();
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error) {
    return (
      <div className="container-fluid pagecontents p-4">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!ideas) return <LoadingOverlay />;

  return (
    <div className="container-fluid pagecontents p-4">
      <Flex justify="between" align="start" gap="4" mb="4" wrap="wrap">
        <Box style={{ maxWidth: 640 }}>
          <Heading as="h1" size="2xl" weight="medium" mb="1">
            Ideas
          </Heading>
          <Text color="text-mid">
            A lightweight backlog of experiment ideas. Capture a title, develop
            the detail, then convert an idea into one or more draft experiments.
          </Text>
        </Box>
        <Flex align="center" gap="3">
          {canConfigureStages && (
            <Button variant="ghost" onClick={() => setStagesOpen(true)}>
              Configure stages
            </Button>
          )}
          <SegmentedControl.Root
            value={view}
            onValueChange={(v) =>
              setQueryParam("view", v === "list" ? "list" : null)
            }
          >
            <SegmentedControl.Item value="board">
              <Flex align="center" gap="1">
                <PiKanban /> Board
              </Flex>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="list">
              <Flex align="center" gap="1">
                <PiList /> List
              </Flex>
            </SegmentedControl.Item>
          </SegmentedControl.Root>
          {canCreate && (
            <Button
              icon={<PiPlus />}
              onClick={() =>
                setNewIdeaStage(visibleStageIds[0] ?? stages[0].id)
              }
            >
              New idea
            </Button>
          )}
        </Flex>
      </Flex>

      {mutationError && (
        <Box mb="3">
          <Callout status="error">{mutationError}</Callout>
        </Box>
      )}

      {scopedIdeas.length === 0 && !includeArchived ? (
        <EmptyState
          title="No ideas yet"
          description="Capture experiment ideas as they come up, develop them in stages, and convert the best into experiments."
          leftButton={
            canCreate ? (
              <Button onClick={() => setNewIdeaStage(stages[0].id)}>
                New idea
              </Button>
            ) : null
          }
          rightButton={null}
        />
      ) : (
        <>
          <Flex align="center" justify="between" gap="4" mb="4" wrap="wrap">
            <Box style={{ width: 300 }}>
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <IdeaFilters
              searchInputProps={searchInputProps}
              syntaxFilters={syntaxFilters}
              setSearchValue={setSearchValue}
              ideas={scopedIdeas}
              stages={stages}
              sort={sort}
              setSort={(s) => setQueryParam("sort", s === "updated" ? null : s)}
            />
          </Flex>
          {view === "board" ? (
            <IdeaBoard
              ideas={sorted}
              stages={stages}
              visibleStageIds={visibleStageIds}
              canCreate={canCreate}
              onAdd={(stageId) => setNewIdeaStage(stageId)}
              onMove={(idea, stage) => run(() => setStage(idea, stage))}
              onToggleUpvote={(idea) => run(() => toggleUpvote(idea))}
            />
          ) : sorted.length === 0 ? (
            <Text color="text-mid">No ideas match your filters.</Text>
          ) : (
            <IdeaTable
              ideas={sorted.filter(
                (i) =>
                  visibleStageIds.includes(i.stage) ||
                  !stages.some((s) => s.id === i.stage),
              )}
              stages={stages}
              onToggleUpvote={(idea) => run(() => toggleUpvote(idea))}
            />
          )}
        </>
      )}

      {newIdeaStage && (
        <IdeaFormModal
          defaultStage={newIdeaStage}
          close={() => setNewIdeaStage(null)}
          onSaved={() => {
            setNewIdeaStage(null);
            mutate();
          }}
        />
      )}
      {stagesOpen && <StageSettingsModal close={() => setStagesOpen(false)} />}
    </div>
  );
};

export default ExperimentIdeasPage;
