import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useState } from "react";
import ReactDiffViewer from "react-diff-viewer";
import { FaRegCopy } from "react-icons/fa";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

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
  const { theme } = useAppearanceUITheme();

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
    } finally {
      setCopyingRules(false);
    }
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Remove the id as it will always be different
      const { id: _, ...partialRule } = rule;
      return partialRule;
    });

    if (!updatedRules) {
      return JSON.stringify([], null, 2);
    }

    return JSON.stringify(updatedRules, null, 2);
  }

  const customDiffTheme = {
    variables: {
      light: {
        addedBackground: "#FFF9ED",
        removedBackground: "#FFF9ED",
        addedGutterBackground: "#FFF9ED",
        removedGutterBackground: "#FFF9ED",
        wordAddedBackground: "#FFF9ED",
        wordRemovedBackground: "#FFF9ED",
      },
      dark: {
        addedBackground: "#915930",
        removedBackground: "#915930",
        addedGutterBackground: "#915930",
        removedGutterBackground: "#915930",
        wordAddedBackground: "#915930",
        wordRemovedBackground: "#915930",
        diffViewerTitleColor: "white",
        codeFoldContentColor: "white",
        gutterColor: "white",
        addedGutterColor: "white",
        removedGutterColor: "white",
      },
    },
    marker: { pre: { opacity: "0" } },
  };

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
                    If copied, rules from <strong>{sourceEnv}</strong> will
                    overwrite any existing rules on <strong>{targetEnv}</strong>
                    {isDraft
                      ? " for this draft version."
                      : " in a new draft version."}
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
                        : " Copy Rules to Target Environment"}
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
                <strong>Compare Environment Rules</strong>
              </div>
              {getDiffString(sourceEnv) === getDiffString(targetEnv) ? (
                <div className="p-3">
                  The rules for <strong>{sourceEnv}</strong> and{" "}
                  <strong>{targetEnv}</strong> are the same.
                </div>
              ) : (
                <div className="d-flex w-100">
                  <ReactDiffViewer
                    leftTitle={`Source Environment: ${sourceEnv}`}
                    rightTitle={`Target Environment: ${targetEnv}`}
                    oldValue={getDiffString(sourceEnv)}
                    newValue={getDiffString(targetEnv)}
                    splitView={true}
                    styles={customDiffTheme}
                    useDarkTheme={theme === "dark" ? true : false}
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
