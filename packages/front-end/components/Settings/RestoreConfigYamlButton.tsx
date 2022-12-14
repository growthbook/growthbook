import { OrganizationSettings } from "back-end/types/organization";
import { FaUpload } from "react-icons/fa";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { load, dump } from "js-yaml";
import { createPatch } from "diff";
import { html } from "diff2html";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { useAuth } from "@/services/auth";
import { useConfigJson } from "@/services/config";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "../Forms/Field";
import Page from "../Modal/Page";
import PagedModal from "../Modal/PagedModal";
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
  const {
    datasources,
    metrics,
    dimensions,
    mutateDefinitions,
  } = useDefinitions();

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
  });

  function parseConfig(json) {
    try {
      // Only include relevent objects in original value
      // Merge original value to new value to backfill missing properties
      const origConfig = cloneDeep(config);
      const newConfig = cloneDeep(json);

      if (origConfig.datasources) {
        Object.keys(origConfig.datasources).forEach((k) => {
          if (!newConfig?.datasources?.[k]) {
            delete origConfig.datasources[k];
          } else {
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
            delete origConfig.metrics[k];
          } else {
            const o = origConfig.metrics[k];
            const n = newConfig.metrics[k];

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
            delete origConfig.dimensions[k];
          } else {
            const o = origConfig.dimensions[k];
            const n = newConfig.dimensions[k];

            newConfig.dimensions[k] = {
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
            origConfig.datasources[k] as DataSourceInterfaceWithParams
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
        { context: 10 }
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
            validate={async () => {
              const { config } = form.getValues();
              const json = load(config);

              if (!json || typeof json !== "object") {
                throw new Error("Could not parsed yaml file into JSON object");
              }

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
