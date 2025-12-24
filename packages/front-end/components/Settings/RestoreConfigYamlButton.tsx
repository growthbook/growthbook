import { OrganizationSettings } from "shared/types/organization";
import { FaUpload } from "react-icons/fa";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { load, dump } from "js-yaml";
import { createPatch } from "diff";
import { html } from "diff2html";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import {
  MetricCappingSettings,
  MetricWindowSettings,
} from "shared/types/fact-table";
import {
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
} from "shared/constants";
import { useAuth } from "@/services/auth";
import { useConfigJson } from "@/services/config";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Page from "@/components/Modal/Page";
import PagedModal from "@/components/Modal/PagedModal";
import UploadConfigYml from "./UploadConfigYml";

function sanitizeSecrets(d: DataSourceInterfaceWithParams) {
  if (!d || !d.params) return;
  Object.keys(d.params).forEach((p) => {
    if (
      [
        "password",
        "pass",
        "secretAccessKey",
        "accessKeyId",
        "privateKey",
        "refreshToken",
        "secret",
      ].includes(p)
    ) {
      d.params[p] = "********";
    }
  });
}

export default function RestoreConfigYamlButton({
  settings = {},
  mutate,
}: {
  settings?: OrganizationSettings;
  mutate: () => void;
}) {
  const { datasources, metrics, dimensions, mutateDefinitions, segments } =
    useDefinitions();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [parsed, setParsed] = useState(null);
  const [diffHTML, setDiffHTML] = useState("");

  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      config: "",
    },
  });

  const config = useConfigJson({
    datasources,
    metrics,
    dimensions,
    settings,
    segments,
  });

  function parseConfig(json) {
    try {
      // Only include relevant objects in original value
      // Merge original value to new value to backfill missing properties
      const origConfig = cloneDeep(config);
      const newConfig = cloneDeep(json);

      if (origConfig.datasources) {
        Object.keys(origConfig.datasources).forEach((k) => {
          if (!newConfig?.datasources?.[k]) {
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            delete origConfig.datasources[k];
          } else {
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            const o = origConfig.datasources[k];
            const n = newConfig.datasources[k];

            newConfig.datasources[k] = {
              ...o,
              ...n,
              settings: {
                ...o.settings,
                ...n.settings,
              },
              params: {
                ...o.params,
                ...n.params,
              },
            };
          }
        });
      }
      if (origConfig.metrics) {
        Object.keys(origConfig.metrics).forEach((k) => {
          if (!newConfig?.metrics?.[k]) {
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            delete origConfig.metrics[k];
          } else {
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            const o = origConfig.metrics[k];
            const n = newConfig.metrics[k];

            // Error for deprecated fields
            if (n.cap) {
              throw new Error(`
                \`cap\` is a deprecated field in metric definitions.
                Instead use \`cappingSettings\` with sub properties 
                \`capping: 'absolute'\` and \`value: ${n.cap}\``);
            }
            // backwards compatibility for settings
            if ((n.capping || n.capValue) && n.cappingSettings === undefined) {
              const cappingSetting: MetricCappingSettings = {
                type: n.capping ?? "absolute",
                value: n.capValue ?? 0,
              };
              n.cappingSettings = cappingSetting;
              delete n.capping;
              delete n.capValue;
            }
            if (
              (n.conversionDelayHours || n.conversionWindowHours) &&
              n.windowSettings === undefined
            ) {
              const windowSetting: MetricWindowSettings = {
                type: "conversion",
                delayValue:
                  n.conversionDelayHours ?? DEFAULT_METRIC_WINDOW_DELAY_HOURS,
                delayUnit: "hours",
                windowValue:
                  n.conversionWindowHours ?? DEFAULT_METRIC_WINDOW_HOURS,
                windowUnit: "hours",
              };
              n.windowSettings = windowSetting;
              delete n.conversionWindowDelay;
              delete n.conversionDelayHours;
            } else if (n.windowSettings.delayValue === undefined) {
              const windowSettings: MetricWindowSettings = {
                ...n.windowSettings,
                delayValue: n.windowSettings.delayHours ?? 0,
                delayUnit: n.windowSettings.delayUnit ?? "hours",
              };
              n.windowSettings = windowSettings;
              delete n.windowSettings.delayHours;
            }
            if (n.userIdType || n.anonymousIdType) {
              throw new Error(`
                \`userIdType\` and \`anonymousIdType\` have been deprecated. 
                Please use \`userIdTypes\` instead.`);
            }
            newConfig.metrics[k] = {
              ...o,
              ...n,
            };
          }
        });
      }
      if (origConfig.dimensions) {
        Object.keys(origConfig.dimensions).forEach((k) => {
          if (!newConfig?.dimensions?.[k]) {
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            delete origConfig.dimensions[k];
          } else {
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            const o = origConfig.dimensions[k];
            const n = newConfig.dimensions[k];

            newConfig.dimensions[k] = {
              ...o,
              ...n,
            };
          }
        });
      }

      if (origConfig.segments) {
        Object.keys(origConfig.segments).forEach((k) => {
          if (!newConfig?.segments?.[k]) {
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            delete origConfig.segments[k];
          } else {
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            const o = origConfig.segments[k];
            const n = newConfig.segments[k];

            newConfig.segments[k] = {
              ...o,
              ...n,
            };
          }
        });
      }

      // Mask secrets in datasource settings
      if (origConfig.datasources) {
        Object.keys(origConfig.datasources).forEach((k) => {
          sanitizeSecrets(
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            origConfig.datasources[k] as DataSourceInterfaceWithParams,
          );
        });
      }
      if (newConfig.datasources) {
        Object.keys(newConfig.datasources).forEach((k) => {
          sanitizeSecrets(newConfig.datasources[k]);
        });
      }

      const patch = createPatch(
        "config.yml",
        dump(origConfig, { skipInvalid: true }),
        dump(newConfig, { skipInvalid: true }),
        "",
        "",
        { context: 10 },
      );

      setDiffHTML(html(patch, {}));
    } catch (e) {
      console.error(e);
      throw new Error(e);
    }
  }

  return (
    <div>
      {open && (
        <PagedModal
          trackingEventModalType="import-settings-config-yaml"
          close={() => setOpen(false)}
          header="Import from config.yml"
          step={step}
          setStep={setStep}
          navFill={false}
          submit={async () => {
            if (!parsed) {
              throw new Error("Empty config.yml file");
            }
            await apiCall(`/organization/config/import`, {
              method: "POST",
              body: JSON.stringify({
                contents: JSON.stringify(parsed),
              }),
            });
            mutateDefinitions();
            mutate();
          }}
          size="max"
          cta="Confirm and Import"
        >
          <Page
            display="Select File"
            enabled
            validate={async () => {
              const { config } = form.getValues();
              const json = load(config);

              if (!json || typeof json !== "object") {
                throw new Error("Could not parsed yaml file into JSON object");
              }

              // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'object' is not assignable to par... Remove this comment to see the full error message
              setParsed(json);
              parseConfig(json);
            }}
          >
            <div>
              <UploadConfigYml
                setContent={(content) => {
                  form.setValue("config", content);
                }}
              />
            </div>

            <Field
              textarea
              label={
                <>
                  Or paste in the contents of <code>config.yml</code> below:
                </>
              }
              minRows={10}
              maxRows={30}
              minLength={20}
              required
              {...form.register("config")}
            />
          </Page>
          <Page display="Review and Confirm">
            <div dangerouslySetInnerHTML={{ __html: diffHTML }} />
          </Page>
        </PagedModal>
      )}
      <a
        href="#"
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          form.reset({
            config: "",
          });
          setStep(0);
          setParsed(null);
          setOpen(true);
        }}
      >
        <FaUpload /> Import from config.yml
      </a>
    </div>
  );
}
