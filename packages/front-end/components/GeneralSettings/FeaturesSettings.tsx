import { isEqual } from "lodash";
import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { FaExclamationCircle, FaQuestionCircle } from "react-icons/fa";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Toggle from "@/components/Forms/Toggle";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useEnvironments } from "@/services/features";

export default function FeaturesSettings() {
  const [
    codeRefsBranchesToFilterStr,
    setCodeRefsBranchesToFilterStr,
  ] = useState<string>("");

  const { hasCommercialFeature } = useUser();
  const environments = useEnvironments();
  const form = useFormContext();

  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes"
  );
  const hasRequireApprovals = hasCommercialFeature("require-approvals");

  const hasCodeReferencesFeature = hasCommercialFeature("code-references");

  useEffect(() => {
    if (!form) return;

    const branches = codeRefsBranchesToFilterStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (isEqual(branches, form.watch("codeRefsBranchesToFilter"))) return;

    form.setValue(
      "codeRefsBranchesToFilter",
      codeRefsBranchesToFilterStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }, [form, codeRefsBranchesToFilterStr]);

  useEffect(() => {
    const requireReview = form.watch("requireReviews");
    if (requireReview === false || requireReview === true) {
      form.setValue("requireReviews", [
        {
          requireReview,
          resetReviewOnChange: false,
          environments: [],
          projects: [],
          tags: [],
        },
      ]);
    }
  }, [form]);
  return (
    <div className="row">
      <div className="col-sm-3">
        <h4>Features Settings</h4>
      </div>
      <div className="col-sm-9">
        <div className="form-inline">
          <Field
            label={
              <PremiumTooltip
                commercialFeature="hash-secure-attributes"
                body={
                  <>
                    <p>
                      Feature targeting conditions referencing{" "}
                      <code>secureString</code> attributes will be anonymized
                      via SHA-256 hashing. When evaluating feature flags in a
                      public or insecure environment (such as a browser),
                      hashing provides an additional layer of security through
                      obfuscation. This allows you to target users based on
                      sensitive attributes.
                    </p>
                    <p>
                      You must enable this feature in your SDK Connection for it
                      to take effect.
                    </p>
                    <p>
                      You may add a cryptographic salt string (a random string
                      of your choosing) to the hashing algorithm, which helps
                      defend against hash lookup vulnerabilities.
                    </p>
                    <p className="mb-0 text-warning-orange small">
                      <FaExclamationCircle /> When using an insecure
                      environment, do not rely exclusively on hashing as a means
                      of securing highly sensitive data. Hashing is an
                      obfuscation technique that makes it very difficult, but
                      not impossible, to extract sensitive data.
                    </p>
                  </>
                }
              >
                Salt string for secure attributes <FaQuestionCircle />
              </PremiumTooltip>
            }
            disabled={!hasSecureAttributesFeature}
            className="ml-2"
            containerClassName="mb-3"
            type="string"
            {...form.register("secureAttributeSalt")}
          />
        </div>

        <div>
          <label className="mr-1" htmlFor="toggle-killswitchConfirmation">
            Require confirmation when changing an environment kill switch
          </label>
        </div>
        <div>
          <Toggle
            id="toggle-killswitchConfirmation"
            value={!!form.watch("killswitchConfirmation")}
            setValue={(value) => {
              form.setValue("killswitchConfirmation", value);
            }}
          />
        </div>
        {hasRequireApprovals && (
          <>
            <div className="d-inline-block h4 mt-5 mb-2">Approval Flow</div>
            {form.watch("requireReviews")?.map?.((requireReviews, i) => (
              <div className="appbox py-2 px-3" key={`approval-flow-${i}`}>
                <label
                  className="mr-1 mt-3 d-block"
                  htmlFor="toggle-require-reviews"
                >
                  Require approval to publish changes
                </label>
                <div>
                  <Toggle
                    id={"toggle-require-reviews"}
                    value={!!form.watch(`requireReviews.${i}.requireReview`)}
                    setValue={(value) => {
                      form.setValue(`requireReviews.${i}.requireReview`, value);
                    }}
                  />
                </div>

                {!!form.watch(`requireReviews.${i}.requireReview`) && (
                  <div className="mt-3">
                    <label htmlFor="environments" className="h5">
                      Environments
                    </label>
                    <MultiSelectField
                      id="environments"
                      value={
                        form.watch(`requireReviews.${i}.environments`) || []
                      }
                      onChange={(environments) => {
                        form.setValue(
                          `requireReviews.${i}.environments`,
                          environments
                        );
                      }}
                      options={environments.map((e) => {
                        return {
                          value: e.id,
                          label: e.id,
                        };
                      })}
                      placeholder="All Environments"
                    />
                    <label
                      className="d-block mt-3 h5"
                      htmlFor="toggle-reset-review-on-change"
                    >
                      Reset review on changes
                    </label>
                    <Toggle
                      id="toggle-reset-review-on-change"
                      value={
                        !!form.watch(`requireReviews.${i}.resetReviewOnChange`)
                      }
                      setValue={(value) => {
                        form.setValue(
                          `requireReviews.${i}.resetReviewOnChange`,
                          value
                        );
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        <div className="my-3">
          <PremiumTooltip commercialFeature="code-references">
            <div
              className="d-inline-block h4 mt-4 mb-0"
              id="configure-code-refs"
            >
              Configure Code References
            </div>
          </PremiumTooltip>
          <div>
            <label className="mr-1" htmlFor="toggle-codeReferences">
              Enable displaying code references for feature flags in the
              GrowthBook UI
            </label>
          </div>
          <div className="my-2">
            <Toggle
              id="toggle-codeReferences"
              value={!!form.watch("codeReferencesEnabled")}
              setValue={(value) => {
                form.setValue("codeReferencesEnabled", value);
              }}
              disabled={!hasCodeReferencesFeature}
            />
          </div>
          {form.watch("codeReferencesEnabled") ? (
            <>
              <div className="my-4">
                <h4>Code References Setup</h4>
                <div className="appbox my-4 p-3">
                  <div className="row">
                    <div className="col-sm-9">
                      <strong>For GitHub Users</strong>
                      <p className="my-2">
                        Use our all-in-one GitHub Action to integrate GrowthBook
                        into your CI workflow.
                      </p>
                    </div>
                    <div className="col-sm-3 text-right">
                      <a
                        href="https://github.com/marketplace/actions/growthbook-code-references"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Setup
                      </a>
                    </div>
                  </div>
                </div>

                <div className="appbox my-4 p-3">
                  <div className="row">
                    <div className="col-sm-9">
                      <strong>For Non-GitHub Users</strong>
                      <p className="my-2">
                        Use our CLI utility that takes in a list of feature keys
                        and scans your codebase to provide a JSON output of code
                        references, which you can supply to our code references{" "}
                        <a
                          href="https://docs.growthbook.io/api#tag/code-references"
                          target="_blank"
                          rel="noreferrer"
                        >
                          REST API endpoint
                        </a>
                        .
                      </p>
                    </div>
                    <div className="col-sm-3 text-right">
                      <a
                        href="https://github.com/growthbook/gb-find-code-refs"
                        target="_blank"
                        rel="noreferrer"
                      >
                        CLI Utility
                      </a>{" "}
                      |{" "}
                      <a
                        href="https://hub.docker.com/r/growthbook/gb-find-code-refs"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Docker Image
                      </a>
                    </div>
                  </div>
                </div>
              </div>
              <div className="my-4">
                <strong>
                  Only show code refs from the following branches
                  (comma-separated, optional):
                </strong>
                <Field
                  className="my-2"
                  type="text"
                  placeholder="main, qa, dev"
                  value={codeRefsBranchesToFilterStr}
                  onChange={(v) => {
                    const branches = v.currentTarget.value;
                    setCodeRefsBranchesToFilterStr(branches);
                  }}
                />
              </div>

              <div className="my-4">
                <strong>Platform (to allow direct linking, optional):</strong>
                <div className="d-flex">
                  <SelectField
                    className="my-2"
                    value={form.watch("codeRefsPlatformUrl") || ""}
                    isClearable
                    options={[
                      {
                        label: "GitHub",
                        value: "https://github.com",
                      },
                      {
                        label: "GitLab",
                        value: "https://gitlab.com",
                      },
                    ]}
                    onChange={(v: string) => {
                      if (!v) form.setValue("codeRefsPlatformUrl", "");
                      else form.setValue("codeRefsPlatformUrl", v);
                    }}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
