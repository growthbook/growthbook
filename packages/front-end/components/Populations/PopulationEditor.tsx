import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { populationEndpoints } from "shared/api-endpoints";
import type { ApiPopulation, PopulationStep } from "shared/validators";
import { MAX_POPULATION_STEPS } from "shared/populations";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Callout from "@/ui/Callout";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import { Select, SelectItem } from "@/ui/Select";
import PageHead from "@/components/Layout/PageHead";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useRestApiCall } from "@/services/restApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PopulationStepCard from "./PopulationStepCard";
import {
  getDefaultPopulationUserIdType,
  getPopulationDraftIssue,
  movePopulationStep,
  newPopulationStep,
  PopulationDraft,
  removePopulationStep,
} from "./populationDraft";

export default function PopulationEditor({
  population,
}: {
  population?: ApiPopulation;
}) {
  const router = useRouter();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const { project, datasources, factTables, getDatasourceById } =
    useDefinitions();

  const eligibleDatasources = useMemo(
    () =>
      datasources.filter(
        (d) =>
          d.id === population?.datasource ||
          factTables.some((ft) => ft.datasource === d.id),
      ),
    [datasources, factTables, population?.datasource],
  );

  const defaultUserIdTypes = (datasourceId: string) => {
    const userIdType = getDefaultPopulationUserIdType(
      getDatasourceById(datasourceId)?.settings.userIdTypes?.map(
        (t) => t.userIdType,
      ) ?? [],
      factTables,
      datasourceId,
    );
    return userIdType ? [userIdType] : [];
  };

  const [draft, setDraft] = useState<PopulationDraft>(() => {
    if (population) {
      return {
        name: population.name,
        description: population.description,
        datasource: population.datasource,
        userIdTypes: population.userIdTypes,
        steps: population.steps,
      };
    }
    const datasource = eligibleDatasources[0]?.id ?? "";
    return {
      name: "",
      description: "",
      datasource,
      userIdTypes: defaultUserIdTypes(datasource),
      steps: [newPopulationStep({ isFirst: true })],
    };
  });
  const [error, setError] = useState<string | null>(null);

  const projects = population?.projects ?? (project ? [project] : []);
  const canSave = population
    ? permissionsUtil.canUpdatePopulation(population, { projects })
    : permissionsUtil.canCreatePopulation({ projects });
  const issue = canSave
    ? getPopulationDraftIssue(draft)
    : "You don't have permission to save this Population.";

  const userIdTypeOptions =
    getDatasourceById(draft.datasource)?.settings.userIdTypes?.map(
      (t) => t.userIdType,
    ) ?? [];
  // Keep identifier types saved through the API selectable even if the Data
  // Source no longer lists them.
  for (const t of draft.userIdTypes) {
    if (!userIdTypeOptions.includes(t)) userIdTypeOptions.push(t);
  }

  const setSteps = (steps: PopulationStep[]) =>
    setDraft((d) => ({ ...d, steps }));

  const save = async () => {
    const body = {
      name: draft.name.trim(),
      description: draft.description,
      userIdTypes: draft.userIdTypes,
      steps: draft.steps,
    };
    if (population) {
      await restApiCall(populationEndpoints.updatePopulation, {
        params: { id: population.id },
        body,
      });
      await router.push(`/populations/${population.id}`);
    } else {
      const { population: created } = await restApiCall(
        populationEndpoints.createPopulation,
        { body: { ...body, datasource: draft.datasource, projects } },
      );
      await router.push(`/populations/${created.id}`);
    }
  };
  const cancelHref = population
    ? `/populations/${population.id}`
    : "/populations";

  const title = population ? "Edit Population" : "New Population";
  const addStep = (negation: boolean) =>
    setSteps([
      ...draft.steps,
      newPopulationStep({ isFirst: draft.steps.length === 0, negation }),
    ]);
  const atStepLimit = draft.steps.length >= MAX_POPULATION_STEPS;

  return (
    <Box className="pagecontents" style={{ margin: "0 auto" }}>
      <PageHead
        breadcrumb={[
          { display: "Populations", href: "/populations" },
          ...(population
            ? [
                { display: population.name, href: cancelHref },
                { display: "Edit" },
              ]
            : [{ display: "New Population" }]),
        ]}
      />
      <Flex justify="between" align="center" gap="3" mb="4" wrap="wrap">
        <Heading as="h1" size="xl">
          {title}
        </Heading>
        <Flex gap="3">
          <LinkButton href={cancelHref} variant="outline">
            Cancel
          </LinkButton>
          <Tooltip content={issue ?? ""} enabled={!!issue}>
            <span>
              <Button onClick={save} setError={setError} disabled={!!issue}>
                Save Population
              </Button>
            </span>
          </Tooltip>
        </Flex>
      </Flex>

      {error && (
        <Callout status="error" mb="4">
          {error}
        </Callout>
      )}

      {/* The form's large flex-grow keeps the size panel at its base width
          until it wraps below. */}
      <Flex wrap="wrap" gap="4" align="start">
        <Box
          className="appbox"
          p="5"
          mb="0"
          minWidth="0"
          style={{ flex: "999 1 600px" }}
        >
          <Grid columns={{ initial: "1fr", sm: "3fr 2fr 2fr" }} gap="4" mb="4">
            <TextField
              label="Name"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              placeholder="e.g. Signed up, never ordered"
              autoFocus={!population}
            />
            <Select
              label="Data Source"
              value={draft.datasource}
              disabled={!!population}
              setValue={(datasource) =>
                setDraft((d) => ({
                  ...d,
                  datasource,
                  userIdTypes: defaultUserIdTypes(datasource),
                  steps: [newPopulationStep({ isFirst: true })],
                }))
              }
              placeholder="Choose a Data Source..."
            >
              {eligibleDatasources.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </Select>
            <Select
              label="Identifier type"
              value={draft.userIdTypes[0] ?? ""}
              setValue={(t) => setDraft((d) => ({ ...d, userIdTypes: [t] }))}
              placeholder="Choose an identifier type..."
            >
              {userIdTypeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </Select>
          </Grid>

          <Box mb="4">
            <Text as="label" htmlFor="population-description" weight="semibold">
              Description
            </Text>
            <Box mt="1">
              <MarkdownInput
                id="population-description"
                value={draft.description}
                setValue={(description) =>
                  setDraft((d) => ({ ...d, description }))
                }
                placeholder="Who is in this Population, and what is it used for?"
                hidePreview
                maxRows={6}
              />
            </Box>
          </Box>

          <Box pt="4" style={{ borderTop: "1px solid var(--gray-a5)" }}>
            <Heading as="h2" size="md" mb="1">
              Steps
            </Heading>
            <Box mb="3">
              <Text size="sm" color="text-mid">
                Members match every step, in order. Each step sets one date. A
                member&apos;s joined date comes from the last step.
              </Text>
            </Box>

            {draft.steps.map((step, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <Box
                    ml="4"
                    pl="3"
                    py="2"
                    style={{ borderLeft: "2px solid var(--gray-a5)" }}
                  >
                    <Text size="sm" weight="semibold" color="text-low">
                      THEN
                    </Text>
                  </Box>
                )}
                <PopulationStepCard
                  steps={draft.steps}
                  index={i}
                  datasource={draft.datasource}
                  userIdTypes={draft.userIdTypes}
                  onChange={(updated) =>
                    setSteps(draft.steps.map((s, j) => (j === i ? updated : s)))
                  }
                  onMove={(to) =>
                    setSteps(movePopulationStep(draft.steps, i, to))
                  }
                  onRemove={() =>
                    setSteps(removePopulationStep(draft.steps, i))
                  }
                />
              </Fragment>
            ))}

            <Flex gap="3" mt="3">
              <Button
                variant="soft"
                size="sm"
                icon={<PiPlus size={14} />}
                disabled={atStepLimit}
                onClick={() => addStep(false)}
              >
                Add step
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<PiPlus size={14} />}
                disabled={atStepLimit || draft.steps.length === 0}
                onClick={() => addStep(true)}
              >
                Add &quot;doesn&apos;t have&quot; step
              </Button>
            </Flex>
          </Box>
        </Box>

        <Box className="appbox" p="5" mb="0" style={{ flex: "1 1 280px" }}>
          <Heading as="h2" size="md" mb="3">
            Population Size
          </Heading>
          <Text size="sm" color="text-mid">
            A live size preview is coming soon. Membership is calculated when
            the Population refreshes.
          </Text>
        </Box>
      </Flex>
    </Box>
  );
}
