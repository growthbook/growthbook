import { useDefinitions } from "../../services/DefinitionsContext";
import { OrganizationSettings } from "back-end/types/organization";
import { FaUpload } from "react-icons/fa";
import { useConfigJson } from "../../services/config";
import { useState } from "react";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import Code from "../Code";

export default function RestoreConfigYamlButton({
  settings = {},
}: {
  settings?: OrganizationSettings;
}) {
  const { datasources, metrics, dimensions } = useDefinitions();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const config = useConfigJson({
    datasources,
    metrics,
    dimensions,
    settings,
  });

  return (
    <div>
      {open && (
        <PagedModal
          close={() => setOpen(false)}
          header="Restore from config.yml"
          step={step}
          setStep={setStep}
          submit={async () => {
            console.log("submit");
          }}
          size="lg"
        >
          <Page display="Import">
            Import config.yml file or paste in contents.
          </Page>
          <Page display="Review and Confirm">
            Review diff and confirm.
            <Code language="json" code={JSON.stringify(config, null, 2)} />
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
