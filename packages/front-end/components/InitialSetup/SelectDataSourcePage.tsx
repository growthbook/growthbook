import { PiInfo, PiPaperPlaneTiltFill } from "react-icons/pi";
import { useState } from "react";
import { SchemaFormat } from "back-end/types/datasource";
import { Callout } from "@radix-ui/themes";
import clsx from "clsx";
import DataSourceLogo, {
  eventTrackerMapping,
} from "@/components/DataSources/DataSourceLogo";
import InviteModal from "@/components/Settings/Team/InviteModal";
import { useUser } from "@/services/UserContext";
import styles from "./InitialSetup.module.scss";

interface Props {
  eventTracker: SchemaFormat | null;
  setEventTracker: (eventTracker: SchemaFormat | null) => void;
}

const SelectDataSourcePage = ({ eventTracker, setEventTracker }: Props) => {
  const [inviting, setInviting] = useState(false);

  const { refreshOrganization } = useUser();

  return (
    <>
      {inviting && (
        <InviteModal
          close={() => setInviting(false)}
          mutate={refreshOrganization}
          defaultRole="analyst"
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
              {Object.keys(eventTrackerMapping).map(
                (eventSchema: SchemaFormat) => (
                  <div
                    className={`hover-highlight cursor-pointer border rounded ${
                      eventTracker === eventSchema ? "bg-white" : ""
                    }`}
                    style={{
                      height: 50,
                      padding: eventSchema === "custom" ? "10px 20px" : 10,
                      boxShadow:
                        eventTracker === eventSchema
                          ? "0 0 0 1px var(--text-color-primary)"
                          : "",
                    }}
                    key={eventSchema}
                    onClick={(e) => {
                      e.preventDefault();
                      if (eventTracker === eventSchema) {
                        setEventTracker(null);
                      } else {
                        setEventTracker(eventSchema);
                      }
                    }}
                  >
                    <DataSourceLogo
                      eventTracker={eventSchema}
                      showLabel={true}
                    />
                  </div>
                )
              )}
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
