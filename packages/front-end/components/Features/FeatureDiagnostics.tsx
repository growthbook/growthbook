import { FeatureInterface } from "back-end/types/feature";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { OrganizationSettings } from "back-end/types/organization";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { isProjectListValidForProject } from "shared/util";
import Button from "@/ui/Button";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import LinkButton from "@/ui/LinkButton";
import Modal from "../Modal";

export function getFeatureDatasourceDefaults(
  datasources: DataSourceInterfaceWithParams[],
  settings: OrganizationSettings,
  project?: string,
  initialValue?: Partial<FeatureInterface>,
): Pick<FeatureInterface, "datasourceId"> {
  const validDatasources = datasources.filter(
    (d) =>
      d.id === initialValue?.datasourceId ||
      isProjectListValidForProject(d.projects, project),
  );

  if (!validDatasources.length) return { datasourceId: "" };

  const initialId = initialValue?.datasourceId || settings.defaultDataSource;

  const initialDatasource =
    (initialId && validDatasources.find((d) => d.id === initialId)) ||
    validDatasources[0];

  return {
    datasourceId: initialDatasource.id,
  };
}

export default function FeatureDiagnostics({
  feature,
  mutate,
}: {
  feature: FeatureInterface;
  mutate: () => Promise<unknown>;
}) {
  const [openDatasourceModal, setOpenDatasourceModal] = useState(false);
  const { getDatasourceById, datasources } = useDefinitions();
  const settings = useOrgSettings();
  const { apiCall } = useAuth();

  const datasource = feature.datasourceId
    ? getDatasourceById(feature.datasourceId)
    : null;

  const form = useForm({
    defaultValues: {
      ...getFeatureDatasourceDefaults(
        datasources,
        settings,
        feature.project,
        feature,
      ),
    },
  });

  return (
    <>
      {openDatasourceModal && (
        <Modal
          header={"Add a Datasource"}
          open={true}
          trackingEventModalType="add-datasource"
          size="md"
          close={() => setOpenDatasourceModal(false)}
          submit={form.handleSubmit(async (data) => {
            console.log(data);
            await apiCall(`/feature/${feature.id}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
            await mutate();
          })}
        >
          <div className="my-2 ml-3 mr-3">
            <p>Select a datasource to view diagnostics for this feature.</p>
            <SelectField
              value={form.watch("datasourceId") ?? ""}
              onChange={(newDatasource) => {
                form.setValue("datasourceId", newDatasource);
              }}
              options={datasources.map((d) => {
                const isDefaultDataSource = d.id === settings.defaultDataSource;
                return {
                  value: d.id,
                  label: `${d.name}${
                    d.description ? ` — ${d.description}` : ""
                  }${isDefaultDataSource ? " (default)" : ""}`,
                };
              })}
              className="portal-overflow-ellipsis"
            />
          </div>
        </Modal>
      )}
      <div className="contents container-fluid pagecontents">
        <div
          className="appbox"
          style={{
            height: "18rem",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <h2>Feature Evaluation Diagnostics</h2>
          <p>
            View recent feature evaluations along with any custom metadata
            you&apos;ve added.
          </p>
          {!datasource ? (
            <Button onClick={() => setOpenDatasourceModal(true)}>
              Select a datasource
            </Button>
          ) : !datasource.settings.queries?.featureUsage ||
            datasource.settings.queries?.featureUsage?.length === 0 ? (
            <LinkButton href={`/datasources/${datasource.id}`}>
              Setup a Feature Usage Query
            </LinkButton>
          ) : (
            <Button onClick={() => setOpenDatasourceModal(true)}>
              View recent feature evaluations
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
