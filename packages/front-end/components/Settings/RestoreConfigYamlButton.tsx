import { useDefinitions } from "../../services/DefinitionsContext";
import { OrganizationSettings } from "back-end/types/organization";
import { FaUpload } from "react-icons/fa";
import { useConfigJson } from "../../services/config";
import { useState } from "react";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import { useForm } from "react-hook-form";
import Field from "../Forms/Field";
import { load, dump } from "js-yaml";
import { useMemo } from "react";
import { createPatch } from "diff";
import { html } from "diff2html";
import { useAuth } from "../../services/auth";

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

  const diffHTML = useMemo(() => {
    const patch = createPatch(
      "config.yml",
      dump(config, { skipInvalid: true }),
      dump(parsed, { skipInvalid: true }),
      "",
      ""
    );

    return html(patch, {});
  }, [parsed]);

  return (
    <div>
      {open && (
        <PagedModal
          close={() => setOpen(false)}
          header="Restore from config.yml"
          step={step}
          setStep={setStep}
          submit={async () => {
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
          cta="Confirm and Restore"
        >
          <Page
            display="Import"
            validate={async () => {
              const { config } = form.getValues();
              const json = load(config);

              if (!json || typeof json !== "object") {
                throw new Error("Could not parsed yaml file into JSON object");
              }

              setParsed(json);
            }}
          >
            Paste in the contents of <code>config.yml</code> below:
            <Field
              textarea
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
          setOpen(true);
        }}
      >
        <FaUpload /> Restore
      </a>
    </div>
  );
}
