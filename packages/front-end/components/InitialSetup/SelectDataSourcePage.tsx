import { PiInfo, PiPaperPlaneTiltFill } from "react-icons/pi";
import { useState } from "react";
import { SchemaFormat } from "@back-end/types/datasource";
import { Callout } from "@radix-ui/themes";
import clsx from "clsx";
import { eventSchemas } from "@/services/eventSchema";
import NewDataSourceForm from "@/components/Settings/NewDataSourceForm";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import InviteModal from "@/components/Settings/Team/InviteModal";
import { useUser } from "@/services/UserContext";
import styles from "./InitialSetup.module.scss";

interface Props {
  onSuccess: () => void;
}

const SelectDataSourcePage = ({ onSuccess }: Props) => {
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [eventTracker, setEventTracker] = useState<null | SchemaFormat>(null);
  const [inviting, setInviting] = useState(false);

  const { refreshOrganization } = useUser();
  const { mutateDefinitions } = useDefinitions();
  const { exists: demoDataSourceExists } = useDemoDataSourceProject();

  return (
    <>
      {inviting && (
        <InviteModal
          close={() => setInviting(false)}
          mutate={refreshOrganization}
        />
      )}
      {newModalOpen && eventTracker && (
        <NewDataSourceForm
          existing={false}
          data={{
            name: "My Datasource",

            settings: {
              schemaFormat: eventTracker,
            },
            projects: [],
          }}
          source="datasource-list"
          onSuccess={async () => {
            await mutateDefinitions({});
            setNewModalOpen(false);
            onSuccess();
          }}
          onCancel={() => {
            setNewModalOpen(false);
            localStorage.setItem(`setup_event_tracker`, eventTracker);
          }}
          showImportSampleData={!demoDataSourceExists}
          showBackButton={false}
        />
      )}
      <div
        className={clsx(styles.setupPage, "mt-5")}
        style={{ padding: "0px 57px" }}
      >
        <div className="d-flex mb-3">
          <h3 className="mb-0 align-self-center">Select your Event Tracker</h3>

          <div className="ml-auto">
            <button
              className="btn btn-link"
              onClick={(e) => {
                e.preventDefault();
                setInviting(true);
              }}
            >
              <PiPaperPlaneTiltFill className="mr-1" />
              Invite your Data Specialist
            </button>
          </div>
        </div>
        <Callout.Root>
          <Callout.Icon>
            <PiInfo />
          </Callout.Icon>
          <Callout.Text>
            To analyze experiment results, connect an event tracker and data
            source. If using GrowthBook to manage feature flags only, feel free
            to skip this step.
          </Callout.Text>
        </Callout.Root>
        <div className="row mt-3 mb-5">
          <div className="col-auto">
            <div
              className="d-flex flex-wrap pb-3"
              style={{ rowGap: "1em", columnGap: "1em" }}
            >
              {eventSchemas
                .filter((s) => s.value !== "mixpanel")
                .map((eventSchema) => (
                  <div
                    className={`hover-highlight cursor-pointer border rounded ${
                      eventTracker === eventSchema.value ? "bg-light" : ""
                    }`}
                    style={{
                      height: 50,
                      padding: 10,
                      boxShadow:
                        eventTracker === eventSchema.value
                          ? "0 0 0 1px var(--text-color-primary)"
                          : "",
                    }}
                    key={eventSchema.value}
                    onClick={(e) => {
                      e.preventDefault();
                      if (eventTracker === eventSchema.value) {
                        setEventTracker(null);
                      } else {
                        setEventTracker(eventSchema.value);
                        setNewModalOpen(true);
                      }
                    }}
                  >
                    <DataSourceLogo
                      language={eventSchema.value}
                      showLabel={true}
                    />
                  </div>
                ))}
            </div>
          </div>
        </div>
        <div className="appbox p-4 mb-3">
          <h3 className="mb-2">How A/B Testing Works at GrowthBook</h3>

          <p>
            For example, Google Analytics is an event tracker that sits on top
            of BigQuery, where your data is stored. You will need to configure
            BigQuery in order to connect GrowthBook to Google Analytics
          </p>
          <img
            className="mt-2"
            src="images/essential-setup/data-source-diagram.svg"
            style={{ maxWidth: "100%", display: "block", margin: "auto" }}
          />
        </div>
      </div>
    </>
  );
};

export default SelectDataSourcePage;
