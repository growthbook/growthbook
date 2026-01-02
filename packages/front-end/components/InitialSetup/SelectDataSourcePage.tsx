import { PiPaperPlaneTiltFill } from "react-icons/pi";
import { useState } from "react";
import { SchemaFormat } from "shared/types/datasource";
import DataSourceLogo, {
  eventTrackerMapping,
} from "@/components/DataSources/DataSourceLogo";
import InviteModal from "@/components/Settings/Team/InviteModal";
import { useUser } from "@/services/UserContext";
import Callout from "@/ui/Callout";
import DataSourceDiagram from "@/components/InitialSetup/DataSourceDiagram";

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
      <div className="mt-5" style={{ padding: "0px 57px" }}>
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
        <Callout status="info">
          To analyze experiment results, connect an event tracker and data
          source. If using GrowthBook to manage feature flags only, feel free to
          skip this step.
        </Callout>
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
                ),
              )}
            </div>
          </div>
        </div>
        <DataSourceDiagram className="appbox p-4 mb-3" />
      </div>
    </>
  );
};

export default SelectDataSourcePage;
