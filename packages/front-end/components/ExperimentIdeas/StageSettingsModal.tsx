import { useState } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { PiArrowDown, PiArrowUp, PiPlus, PiTrash } from "react-icons/pi";
import uniqid from "uniqid";
import {
  ExperimentIdeaStage,
  LearningStatusColor,
} from "shared/types/organization";
import { validateExperimentIdeaStages } from "shared/experiment-ideas";
import { DEFAULT_EXPERIMENT_IDEA_STAGES } from "shared/constants";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useExperimentIdeaStages } from "./useExperimentIdeas";

const COLORS: LearningStatusColor[] = [
  "gray",
  "blue",
  "cyan",
  "indigo",
  "violet",
  "purple",
  "amber",
  "orange",
  "yellow",
  "green",
  "teal",
  "red",
  "pink",
];

export default function StageSettingsModal({ close }: { close: () => void }) {
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const current = useExperimentIdeaStages();
  const [stages, setStages] = useState<ExperimentIdeaStage[]>(
    current.stages.map((s) => ({ ...s })),
  );
  const [defaultStageId, setDefaultStageId] = useState(current.defaultStageId);

  const update = (index: number, patch: Partial<ExperimentIdeaStage>) =>
    setStages(stages.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const move = (index: number, delta: number) => {
    const next = [...stages];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setStages(next);
  };

  const validationError = validateExperimentIdeaStages(stages, defaultStageId);

  return (
    <ModalStandard
      open={true}
      close={close}
      size="lg"
      header="Idea stages"
      subheader="Stages are the columns of the Ideas board. Renaming, recoloring or reordering a stage never changes the ideas in it."
      cta="Save"
      ctaEnabled={!validationError}
      trackingEventModalType="experiment-idea-stages"
      submit={async () => {
        await apiCall("/experiment-ideas/stages", {
          method: "PUT",
          body: JSON.stringify({
            stages: stages.map((s) => ({
              ...s,
              description: s.description || undefined,
            })),
            defaultStageId,
          }),
        });
        await refreshOrganization();
        close();
      }}
      secondaryAction={
        <Button
          variant="ghost"
          onClick={() => {
            setStages(DEFAULT_EXPERIMENT_IDEA_STAGES.map((s) => ({ ...s })));
            setDefaultStageId(DEFAULT_EXPERIMENT_IDEA_STAGES[0].id);
          }}
        >
          Restore defaults
        </Button>
      }
    >
      <Flex direction="column" gap="2">
        {stages.map((s, i) => (
          <Grid key={s.id} columns="1fr 130px 2fr auto" gap="2" align="center">
            <Field
              placeholder="Label"
              aria-label="Stage label"
              value={s.label}
              onChange={(e) => update(i, { label: e.target.value })}
              maxLength={64}
            />
            <SelectField
              value={s.color || "gray"}
              options={COLORS.map((c) => ({ label: c, value: c }))}
              onChange={(color) =>
                update(i, { color: color as LearningStatusColor })
              }
              sort={false}
            />
            <Field
              placeholder="One-line hint shown under the column title"
              aria-label="Stage hint"
              value={s.description ?? ""}
              onChange={(e) => update(i, { description: e.target.value })}
              maxLength={200}
            />
            <Flex gap="1">
              <IconButton
                variant="ghost"
                color="gray"
                size="1"
                disabled={i === 0}
                aria-label="Move up"
                onClick={() => move(i, -1)}
              >
                <PiArrowUp />
              </IconButton>
              <IconButton
                variant="ghost"
                color="gray"
                size="1"
                disabled={i === stages.length - 1}
                aria-label="Move down"
                onClick={() => move(i, 1)}
              >
                <PiArrowDown />
              </IconButton>
              <IconButton
                variant="ghost"
                color="red"
                size="1"
                disabled={stages.length === 1}
                aria-label="Remove stage"
                onClick={() => setStages(stages.filter((other) => other !== s))}
              >
                <PiTrash />
              </IconButton>
            </Flex>
          </Grid>
        ))}
      </Flex>
      <Flex justify="between" align="end" mt="4">
        <Box style={{ width: 260 }}>
          <SelectField
            label="New ideas start in"
            value={defaultStageId}
            options={stages
              .filter((s) => s.label.trim())
              .map((s) => ({ label: s.label, value: s.id }))}
            onChange={setDefaultStageId}
            sort={false}
          />
        </Box>
        <Button
          variant="ghost"
          size="sm"
          icon={<PiPlus />}
          onClick={() =>
            setStages([
              ...stages,
              { id: uniqid("ideast_"), label: "", color: "gray" },
            ])
          }
        >
          Add stage
        </Button>
      </Flex>
      {validationError && stages.every((s) => s.label.trim()) && (
        <Box mt="3">
          <Text size="sm" color="text-mid">
            {validationError}
          </Text>
        </Box>
      )}
    </ModalStandard>
  );
}
