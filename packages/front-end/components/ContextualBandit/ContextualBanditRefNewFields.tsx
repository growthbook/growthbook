import { useFormContext } from "react-hook-form";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Box, Separator } from "@radix-ui/themes";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import AddEditContextualBanditQueryModal from "@/components/ContextualBandit/AddEditContextualBanditQueryModal";
import ContextualBanditDecisionMetricSettings from "@/components/ContextualBandit/ContextualBanditDecisionMetricSettings";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import { useAttributeSchema } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import Tooltip from "@/components/Tooltip/Tooltip";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";

export default function ContextualBanditRefNewFields({
  step,
  project,
  coverage,
  setCoverage,
  setWeight,
  variations,
  setVariations,
  disableBanditConversionWindow,
  setDisableBanditConversionWindow,
  namespaceFormPrefix = "",
}: {
  step: number;
  project?: string;
  coverage: number;
  setCoverage: (c: number) => void;
  setWeight: (i: number, w: number) => void;
  variations: SortableVariation[];
  setVariations: (v: SortableVariation[]) => void;
  disableBanditConversionWindow: boolean;
  setDisableBanditConversionWindow: (v: boolean) => void;
  namespaceFormPrefix?: string;
}) {
  const form = useFormContext();

  const { datasources, getDatasourceById, getExperimentMetricById } =
    useDefinitions();

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const exposureQueryId = form.watch("exposureQueryId");

  const { contextualBanditQueries: cbQueries, mutate: mutateCbQueries } =
    useContextualBanditQueries(datasource?.id ?? undefined);
  const [cbQueryModalOpen, setCbQueryModalOpen] = useState(false);

  const selectedCbQuery = useMemo(
    () => cbQueries.find((q) => q.id === exposureQueryId),
    [cbQueries, exposureQueryId],
  );

  useEffect(() => {
    if (!cbQueries.length) return;
    if (!cbQueries.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", cbQueries[0]?.id ?? "");
    }
  }, [cbQueries, exposureQueryId, form]);

  const attributeSchema = useAttributeSchema(false, project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const settings = useOrgSettings();
  const { namespaces } = useOrgSettings();

  return (
    <>
      {step === 1 ? (
        <>
          <div className="mb-4">
            <Text as="label" weight="semibold" mb="1">
              Assign Variation by Attribute
            </Text>
            <Text as="div" color="text-mid" mb="2">
              Will be hashed together with the Tracking Key to determine which
              variation to assign
            </Text>
            <SelectField
              withRadixThemedPortal
              containerClassName="flex-1"
              options={attributeSchema
                .filter((s) => !hasHashAttributes || s.hashAttribute)
                .map((s) => ({
                  label: s.property,
                  value: s.property,
                  description: s.description,
                  tags: s.tags,
                  datatype: s.datatype,
                  hashAttribute: s.hashAttribute,
                }))}
              value={form.watch("hashAttribute")}
              onChange={(v) => {
                form.setValue("hashAttribute", v);
              }}
              formatOptionLabel={(o, meta) => {
                return (
                  <AttributeOptionWithTooltip
                    option={o as AttributeOptionForTooltip}
                    context={meta.context}
                  >
                    {o.label}
                  </AttributeOptionWithTooltip>
                );
              }}
            />
          </div>

          <FeatureVariationsInput
            simple={true}
            hideCoverage={true}
            label="Variations"
            valueType="string"
            coverageLabel="Traffic included in this Bandit"
            coverageTooltip="Users not included in the Bandit will skip this experiment"
            coverage={coverage}
            setCoverage={setCoverage}
            setWeight={setWeight}
            variations={variations}
            setVariations={setVariations}
          />

          {namespaces && namespaces.length > 0 && (
            <div className="mt-4">
              <NamespaceSelector
                form={form}
                formPrefix={namespaceFormPrefix}
                trackingKey={form.watch("trackingKey")}
                featureId={""}
                experimentHashAttribute={form.watch("hashAttribute")}
                fallbackAttribute={form.watch("fallbackAttribute")}
              />
            </div>
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <div className="rounded px-3 pt-3 pb-1 bg-highlight mb-4">
            <SelectField
              label="Data Source"
              labelClassName="font-weight-bold"
              helpText="Only data sources with an Experiment Assignment Table that has targeting attributes can power a Contextual Bandit."
              value={form.watch("datasource") ?? ""}
              onChange={(newDatasource) => {
                form.setValue("datasource", newDatasource);
                if (!newDatasource) {
                  form.setValue("decisionMetric", "");
                  return;
                }
                const decisionMetricId = form.watch("decisionMetric");
                if (
                  decisionMetricId &&
                  getExperimentMetricById(decisionMetricId)?.datasource !==
                    newDatasource
                ) {
                  form.setValue("decisionMetric", "");
                }
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

            {datasource ? (
              <>
                {cbQueries.length === 0 ? (
                  <Callout status="warning" mt="3" contentsAs="div">
                    No Contextual Bandit queries exist for this data source yet.{" "}
                    <Link
                      href="#"
                      className="underline"
                      onClick={(e) => {
                        e.preventDefault();
                        setCbQueryModalOpen(true);
                      }}
                    >
                      Add one
                    </Link>
                    .
                  </Callout>
                ) : (
                  <SelectField
                    label={
                      <>
                        Contextual Bandit Query{" "}
                        <Tooltip body="Should correspond to the Identifier Type used to randomize units for this experiment" />
                      </>
                    }
                    labelClassName="font-weight-bold"
                    value={form.watch("exposureQueryId") ?? ""}
                    onChange={(v) => form.setValue("exposureQueryId", v)}
                    required
                    options={cbQueries.map((q) => ({
                      label: q.name,
                      value: q.id,
                    }))}
                    formatOptionLabel={({ label, value }) => {
                      const userIdType = cbQueries.find(
                        (e) => e.id === value,
                      )?.userIdType;
                      return (
                        <>
                          {label}
                          {userIdType ? (
                            <span
                              className="text-muted small float-right position-relative"
                              style={{ top: 3 }}
                            >
                              Identifier Type: <code>{userIdType}</code>
                            </span>
                          ) : null}
                        </>
                      );
                    }}
                  />
                )}
                {selectedCbQuery ? (
                  <Box mt="2">
                    <strong className="font-weight-semibold">
                      Targeting Attributes:{" "}
                    </strong>
                    {(selectedCbQuery.targetingAttributeColumns ?? []).map(
                      (d, i) => (
                        <Fragment key={d}>
                          {i ? ", " : ""}
                          <code>{d}</code>
                        </Fragment>
                      ),
                    )}
                    {!(selectedCbQuery.targetingAttributeColumns ?? [])
                      .length && <em className="text-muted">none</em>}
                  </Box>
                ) : null}
                {cbQueries.length > 0 ? (
                  <Box mt="2">
                    <Link
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setCbQueryModalOpen(true);
                      }}
                    >
                      + Add Contextual Bandit query
                    </Link>
                  </Box>
                ) : null}
                {cbQueryModalOpen && datasource ? (
                  <AddEditContextualBanditQueryModal
                    dataSource={datasource}
                    mode="add"
                    onSave={async (q) => {
                      await mutateCbQueries();
                      form.setValue("exposureQueryId", q.id);
                      setCbQueryModalOpen(false);
                    }}
                    onCancel={() => setCbQueryModalOpen(false)}
                  />
                ) : null}
              </>
            ) : null}
          </div>

          <Box my="4">
            <BanditSettings page="experiment-settings" />
          </Box>

          <Separator my="5" size="4" />

          <ContextualBanditDecisionMetricSettings
            disableBanditConversionWindow={disableBanditConversionWindow}
            setDisableBanditConversionWindow={setDisableBanditConversionWindow}
            project={project}
          />
        </>
      ) : null}
    </>
  );
}
