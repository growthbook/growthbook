import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useState } from "react";
import ReactDiffViewer from "react-diff-viewer";
import { FaRedo, FaRegCopy } from "react-icons/fa";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

interface Props {
  isDraft: boolean;
  isLocked: boolean;
  canEdit: boolean;
  envs: string[];
  feature: FeatureInterface;
  close: () => void;
  version: number;
  setVersion: (version: number) => void;
  mutate: () => void;
}

type PartialRule = Omit<FeatureRule, "id">;

export default function CompareRuleDiffModal({
  isLocked,
  canEdit,
  isDraft,
  envs,
  feature,
  close,
  version,
  setVersion,
  mutate,
}: Props) {
  const [copyingRules, setCopyingRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      sourceEnv: "",
      targetEnv: "",
    },
  });

  const sourceEnv = form.watch("sourceEnv");
  const targetEnv = form.watch("targetEnv");

  async function handleCopyingRules(
    targetEnv: string,
    newRules: FeatureRule[]
  ) {
    setCopyingRules(true);
    setError(null);
    try {
      const res = await apiCall<{ version: number }>(
        `/feature/${feature.id}/${version}/copy-rule-set`,
        {
          method: "PUT",
          body: JSON.stringify({
            targetEnv,
            newRules,
          }),
        }
      );
      track("Clone Feature Rule Set", {
        sourceEnvironment: sourceEnv,
        targetEnv,
        rules: newRules,
      });
      await mutate();
      res.version && setVersion(res.version);
    } catch (e) {
      setError(e.message);
    }
    setCopyingRules(false);
  }

  const options = envs.map((env) => ({
    label: `${env} (${
      feature.environmentSettings[env]?.rules.length || "0"
    } rules)`,
    value: env,
  }));

  function getDiffString(environment: string): string {
    const updatedRules: PartialRule[] = feature.environmentSettings[
      environment
    ]?.rules.map((rule: FeatureRule) => {
      // We don't want to include rule.ids in the diff as they'll always be different
      const partialRule: Omit<FeatureRule, "id"> & { id?: string } = {
        ...rule,
      };
      delete partialRule.id;
      return partialRule;
    });

    if (!updatedRules) {
      return JSON.stringify([], null, 2);
    }

    return JSON.stringify(updatedRules, null, 2);
  }

  return (
    <Modal
      close={close}
      closeCta="Close"
      header="Compare Rules Across Environments"
      open={true}
      size="max"
    >
      <div className="p-2">
        <div>
          <div>
            <SelectField
              name="environment"
              label="Select Source Environment"
              initialOption="Select Environment..."
              value={sourceEnv}
              isClearable={true}
              options={options.filter((env) => env.value !== targetEnv)}
              onChange={(value) => {
                form.setValue("sourceEnv", value);
                setError(null);
              }}
              disabled={copyingRules}
            />
          </div>
          <div>
            <SelectField
              name="environment"
              label="Select Target Environment"
              value={targetEnv}
              isClearable={true}
              initialOption="Select Environment..."
              options={options.filter((env) => env.value !== sourceEnv)}
              onChange={(value) => {
                form.setValue("targetEnv", value);
                setError(null);
              }}
              disabled={copyingRules}
            />
          </div>
        </div>
        {sourceEnv && targetEnv ? (
          <>
            {canEdit ? (
              <div>
                {isLocked ? null : (
                  <div className="alert alert-secondary">
                    If copied, we&apos;ll{" "}
                    {isDraft
                      ? "update the current draft version"
                      : "create a new draft version"}{" "}
                    and rules from <strong>{sourceEnv}</strong> will overwrite
                    any existing rules on <strong>{targetEnv}</strong>.
                  </div>
                )}
                <div className="d-flex align-items-center justify-content-between w-100">
                  <Tooltip
                    body="This version is locked and cannot be edited."
                    shouldDisplay={isLocked}
                  >
                    <button
                      className="btn btn-outline-primary"
                      onClick={async () =>
                        await handleCopyingRules(
                          targetEnv,
                          feature.environmentSettings[sourceEnv].rules
                        )
                      }
                      disabled={
                        getDiffString(sourceEnv) === getDiffString(targetEnv) ||
                        copyingRules ||
                        isLocked
                      }
                    >
                      <FaRegCopy />
                      {copyingRules
                        ? " Copying rules..."
                        : " Copy Rules to Target"}
                    </button>
                  </Tooltip>
                  <Tooltip body="Reset environment selection to trigger a new comparison.">
                    <button
                      className="btn btn-link text-decoration-none pr-0"
                      disabled={copyingRules}
                      onClick={() => {
                        form.setValue("sourceEnv", "");
                        form.setValue("targetEnv", "");
                      }}
                    >
                      {" "}
                      <FaRedo size={10} /> Compare New Selection
                    </button>
                  </Tooltip>
                </div>
              </div>
            ) : null}
            {error ? (
              <div className="alert alert-danger mt-3">{error}</div>
            ) : null}
            <div className="my-3 border rounded">
              <div className="bg-light w-100 p-2">
                <strong>Environment Rules Compared</strong>
              </div>
              {getDiffString(sourceEnv) === getDiffString(targetEnv) ? (
                <div className="p-3">
                  The rules for <strong>{sourceEnv}</strong> and{" "}
                  <strong>{targetEnv}</strong> are the same.
                </div>
              ) : (
                <div className="d-flex w-100">
                  <ReactDiffViewer
                    oldValue={getDiffString(sourceEnv)}
                    newValue={getDiffString(targetEnv)}
                    splitView={true}
                  />
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
