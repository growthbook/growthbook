import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type {
  ApiInterleavingInterface,
  ApiUpdateInterleavingBody,
} from "shared/validators";
import { validateAndFixCondition } from "shared/util";
import { useRestApiCall } from "@/services/restApi";
import { useEnvironments } from "@/services/features";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import Metadata from "@/ui/Metadata";
import Field from "@/components/Forms/Field";
import Markdown from "@/components/Markdown/Markdown";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import InterleavingVariationsInput, {
  getRankersError,
  InterleavingRankers,
} from "./InterleavingVariationsInput";
import InterleavingAnalysisFields, {
  getAnalysisError,
  InterleavingAnalysisValue,
} from "./InterleavingAnalysisFields";
import { getMetricsError } from "./InterleavingMetricsInput";

function EditableSection({
  title,
  description,
  canEdit,
  live,
  onEdit,
  onSave,
  view,
  edit,
}: {
  title: string;
  description?: string;
  canEdit: boolean;
  live: boolean;
  onEdit: () => void;
  onSave: () => Promise<void>;
  view: ReactNode;
  edit: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Frame>
      <Flex align="center" justify="between" mb="3">
        <Box>
          <Heading as="h4" size="sm" mb="0">
            {title}
          </Heading>
          {description && (
            <Text as="div" size="sm" color="text-low">
              {description}
            </Text>
          )}
        </Box>
        {canEdit && !editing && (
          <Button
            variant="ghost"
            onClick={() => {
              onEdit();
              setError(null);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </Flex>
      {editing ? (
        <>
          {live && (
            <Callout status="warning" mb="3">
              This experiment is running. Saved changes apply to live traffic
              immediately.
            </Callout>
          )}
          {edit}
          {error && (
            <Callout status="error" mt="3">
              {error}
            </Callout>
          )}
          <Flex gap="2" justify="end" mt="3">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await onSave();
                setEditing(false);
              }}
              setError={setError}
            >
              Save
            </Button>
          </Flex>
        </>
      ) : (
        view
      )}
    </Frame>
  );
}

function rankersOf(il: ApiInterleavingInterface): InterleavingRankers {
  const [a, b] = il.variations.map(({ key, name, description, config }) => ({
    key,
    name,
    description,
    config,
  }));
  return [a, b];
}

function analysisOf(il: ApiInterleavingInterface): InterleavingAnalysisValue {
  return {
    datasource: il.datasource,
    interleavingExposureQueryId: il.interleavingExposureQueryId,
    userIdType: il.userIdType,
    metrics: il.metrics,
  };
}

export default function InterleavingOverview({
  interleaving: il,
  mutate,
  canEdit,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  canEdit: boolean;
}) {
  const restApiCall = useRestApiCall();
  const environments = useEnvironments();
  const live = il.status === "running";

  const update = async (body: ApiUpdateInterleavingBody) => {
    await restApiCall(interleavingEndpoints.updateInterleaving, {
      params: { id: il.id },
      body,
    });
    await mutate();
  };

  const [rankers, setRankers] = useState(() => rankersOf(il));
  const [analysis, setAnalysis] = useState(() => analysisOf(il));
  const [trackingKey, setTrackingKey] = useState(il.trackingKey);
  const [envSettings, setEnvSettings] = useState(il.environmentSettings);
  const [hashAttribute, setHashAttribute] = useState(il.hashAttribute);
  const [coverage, setCoverage] = useState(il.coverage ?? 1);
  const [condition, setCondition] = useState(il.condition ?? "");
  const [conditionKey, setConditionKey] = useState(0);
  const [savedGroups, setSavedGroups] = useState(il.savedGroups ?? []);
  const [prerequisites, setPrerequisites] = useState(il.prerequisites ?? []);
  const [prereqSdkIssues, setPrereqSdkIssues] = useState(false);

  const sectionProps = { canEdit, live };
  const keyMetadata = (
    <Box mb="2">
      <Metadata label="Key" value={il.key} />
      <Text as="div" size="sm" color="text-low">
        Pass this to interleave() in your code. It can&apos;t be changed.
      </Text>
    </Box>
  );

  return (
    <Box>
      {il.description && (
        <Frame>
          <Markdown>{il.description}</Markdown>
        </Frame>
      )}

      <EditableSection
        {...sectionProps}
        title="Environments"
        onEdit={() => setEnvSettings(il.environmentSettings)}
        onSave={() => update({ environmentSettings: envSettings })}
        view={
          <Flex direction="column" gap="2">
            {keyMetadata}
            {environments.map((env) => (
              <Metadata
                key={env.id}
                label={env.id}
                value={il.environmentSettings[env.id]?.enabled ? "On" : "Off"}
              />
            ))}
          </Flex>
        }
        edit={
          <Flex direction="column" gap="2">
            {keyMetadata}
            {environments.map((env) => (
              <Switch
                key={env.id}
                id={`il-env-${env.id}`}
                label={env.id}
                value={!!envSettings[env.id]?.enabled}
                onChange={(enabled) =>
                  setEnvSettings({
                    ...envSettings,
                    [env.id]: { ...envSettings[env.id], enabled },
                  })
                }
              />
            ))}
          </Flex>
        }
      />

      <EditableSection
        {...sectionProps}
        title="Rankers"
        onEdit={() => setRankers(rankersOf(il))}
        onSave={async () => {
          const error = getRankersError(rankers, il.jsonSchema);
          if (error) throw new Error(error);
          await update({ variations: rankers });
        }}
        view={
          <InterleavingVariationsInput
            value={rankersOf(il)}
            setValue={() => undefined}
            jsonSchema={il.jsonSchema}
            disabled
          />
        }
        edit={
          <InterleavingVariationsInput
            value={rankers}
            setValue={setRankers}
            jsonSchema={il.jsonSchema}
          />
        }
      />

      <EditableSection
        {...sectionProps}
        title="Targeting"
        description="Which units to include in interleaving at all."
        onEdit={() => {
          setHashAttribute(il.hashAttribute);
          setCoverage(il.coverage ?? 1);
          setCondition(il.condition ?? "");
          setConditionKey((k) => k + 1);
          setSavedGroups(il.savedGroups ?? []);
          setPrerequisites(il.prerequisites ?? []);
        }}
        onSave={async () => {
          if (prereqSdkIssues) {
            throw new Error(
              "Some prerequisites aren't supported by your SDK versions.",
            );
          }
          let fixedCondition = condition;
          validateAndFixCondition(condition, (fixed) => {
            fixedCondition = fixed;
          });
          await update({
            hashAttribute,
            coverage,
            condition: fixedCondition,
            savedGroups,
            prerequisites,
          });
        }}
        view={
          <Flex direction="column" gap="2">
            <Metadata label="Hash Attribute" value={il.hashAttribute} />
            <Metadata
              label="Coverage"
              value={`${Math.round((il.coverage ?? 1) * 100)}%`}
            />
            {il.condition ||
            il.savedGroups?.length ||
            il.prerequisites?.length ? (
              <ConditionDisplay
                condition={il.condition}
                savedGroups={il.savedGroups}
                prerequisites={il.prerequisites}
              />
            ) : (
              <Text color="text-mid">Everyone is included.</Text>
            )}
          </Flex>
        }
        edit={
          <>
            <Flex gap="3">
              <Field
                label="Hash Attribute"
                value={hashAttribute}
                onChange={(e) => setHashAttribute(e.target.value)}
                containerClassName="flex-1"
              />
              <Field
                label="Coverage (%)"
                type="number"
                min={0}
                max={100}
                value={Math.round(coverage * 100)}
                onChange={(e) =>
                  setCoverage(
                    Math.min(1, Math.max(0, Number(e.target.value) / 100)),
                  )
                }
                containerClassName="flex-1"
              />
            </Flex>
            <TargetingFieldsGroup
              project={il.project ?? ""}
              environments={environments.map((e) => e.id)}
              condition={condition}
              setCondition={setCondition}
              conditionKey={conditionKey}
              savedGroups={savedGroups}
              setSavedGroups={setSavedGroups}
              prerequisites={prerequisites}
              setPrerequisites={setPrerequisites}
              setPrerequisiteTargetingSdkIssues={setPrereqSdkIssues}
            />
          </>
        }
      />

      <EditableSection
        {...sectionProps}
        title="Analysis"
        onEdit={() => {
          setAnalysis(analysisOf(il));
          setTrackingKey(il.trackingKey);
        }}
        onSave={async () => {
          if (!trackingKey.trim()) throw new Error("Tracking key is required");
          const error =
            getAnalysisError(analysis) ?? getMetricsError(analysis.metrics);
          if (error) throw new Error(error);
          await update({ ...analysis, trackingKey: trackingKey.trim() });
        }}
        view={
          <>
            <Box mb="3">
              <Metadata label="Tracking Key" value={il.trackingKey} />
            </Box>
            <InterleavingAnalysisFields
              value={analysisOf(il)}
              setValue={() => undefined}
              project={il.project}
              disabled
            />
          </>
        }
        edit={
          <>
            <Field
              label="Tracking Key"
              value={trackingKey}
              onChange={(e) => setTrackingKey(e.target.value)}
              helpText="Matched against experiment_id in your exposure query."
            />
            <InterleavingAnalysisFields
              value={analysis}
              setValue={setAnalysis}
              project={il.project}
            />
          </>
        }
      />
    </Box>
  );
}
