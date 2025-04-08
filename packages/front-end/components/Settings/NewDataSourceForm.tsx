import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  useCallback,
  ReactNode,
} from "react";
import {
  DataSourceInterfaceWithParams,
  SchemaFormat,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { FaExternalLinkAlt } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";
import { getInitialSettings } from "@/services/datasources";
import {
  eventSchemas,
  dataSourceConnections,
  eventSchema,
} from "@/services/eventSchema";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { GBCircleArrowLeft } from "@/components/Icons";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/components/Radix/Callout";
import { DocLink } from "@/components/DocLink";
import DataSourceTypeSelector from "@/components/Settings/DataSourceTypeSelector";
import EventSourceList from "./EventSourceList";
import ConnectionSettings from "./ConnectionSettings";

type Step =
  | "initial"
  | "eventTracker"
  | "connection"
  | "schemaOptions"
  | "done";

const schemasMap = new Map(eventSchemas.map((o) => [o.value, o]));

const NewDataSourceForm: FC<{
  initial?: Partial<DataSourceInterfaceWithParams>;
  source: string;
  onCancel?: () => void;
  onSuccess: (id: string) => Promise<void>;
  showImportSampleData: boolean;
  inline?: boolean;
  showBackButton?: boolean;
}> = ({
  initial,
  onSuccess,
  onCancel,
  source,
  inline,
  showBackButton = true,
}) => {
    const {
      projects: allProjects,
      project,
      mutateDefinitions,
    } = useDefinitions();
    const permissionsUtil = usePermissionsUtil();
    const { apiCall, orgId } = useAuth();

    const settings = useOrgSettings();
    const { metricDefaults } = useOrganizationMetricDefaults();

    useEffect(() => {
      track("查看数据源表单", {
        source,
        newDatasourceForm: true,
      });
    }, [source]);

    const [step, setStep] = useState<Step>("initial");

    // Form data for the event tracker screen
    const [eventTracker, setEventTracker] = useState<SchemaFormat | "">("");

    // Form data for the main connection screen
    const [connectionInfo, setConnectionInfo] = useState<
      Partial<DataSourceInterfaceWithParams>
    >({
      name: "我的数据源",
      settings: {},
      projects: project ? [project] : [],
      ...initial,
    });

    // Form data for the schema options screen
    const schemaOptionsForm = useForm<Record<string, string | number>>({
      defaultValues: {},
    });

    // Progress for the resource creation screen (final screen)
    const [resourceProgress, setResourceProgress] = useState(0);
    const [creatingResources, setCreatingResources] = useState(false);

    // Holds the final data source object
    const [
      createdDatasource,
      setCreatedDatasource,
    ] = useState<DataSourceInterfaceWithParams | null>(null);

    const possibleSchemas = eventSchemas
      .filter(
        (s) => connectionInfo.type && s.types?.includes(connectionInfo.type)
      )
      .map((s) => s.value);

    const [lastError, setLastError] = useState("");

    const setSchemaSettings = useCallback(
      (s: eventSchema) => {
        setEventTracker(s.value);
        track("选定事件模式", {
          schema: s.value,
          source,
          newDatasourceForm: true,
        });

        setConnectionInfo((connectionInfo) => ({
          ...connectionInfo,
          settings: {
            schemaFormat: s.value,
          },
        }));

        if (s.options) {
          s.options.forEach((o) => {
            schemaOptionsForm.setValue(o.name, o.defaultValue || "");
          });
        } else {
          schemaOptionsForm.reset({});
        }
      },
      [schemaOptionsForm, source]
    );

    useEffect(() => {
      if (initial?.type) {
        if (
          initial.type !== "mixpanel" &&
          eventSchemas.some(
            (s) => initial.type && s.types?.includes(initial.type)
          )
        ) {
          setStep("eventTracker");
        } else {
          setStep("connection");
        }
      }
    }, [initial?.type]);

    const selectedSchema: eventSchema = schemasMap.get(
      eventTracker || "custom"
    ) || {
      label: "Custom",
      value: "custom",
    };

    // Filter out demo datasource from available projects
    const projects = allProjects.filter(
      (p) =>
        !isDemoDatasourceProject({
          projectId: p.id,
          organizationId: orgId || "",
        })
    );
    const projectOptions = useProjectOptions(
      (project) =>
        permissionsUtil.canCreateDataSource({
          projects: [project],
          type: undefined,
        }),
      []
    );

    let ctaEnabled = true;
    let disabledMessage: string | null = null;
    if (!permissionsUtil.canViewCreateDataSourceModal(project)) {
      ctaEnabled = false;
      disabledMessage = "您没有创建数据源的权限。";
    }

    const saveConnectionInfo = async (): Promise<DataSourceInterfaceWithParams> => {
      setLastError("");

      try {
        if (!connectionInfo.type || !connectionInfo.params) {
          throw new Error("请选择一种数据源类型");
        }

        if (connectionInfo.settings && eventTracker) {
          connectionInfo.settings.schemaFormat = eventTracker;
        }

        // Update
        // Used if someone goes back to this step after already submitting
        if (createdDatasource) {
          const res = await apiCall<{
            datasource: DataSourceInterfaceWithParams;
          }>(`/datasource/${createdDatasource.id}`, {
            method: "PUT",
            body: JSON.stringify({
              ...connectionInfo,
            }),
          });
          track("更新数据源表单", {
            source,
            type: connectionInfo.type,
            schema: eventTracker,
            newDatasourceForm: true,
          });

          setCreatedDatasource(res.datasource);
          return res.datasource;
        }
        // Create
        else {
          const data: Partial<DataSourceInterfaceWithParams> = {
            ...connectionInfo,
            settings: {
              ...getInitialSettings(
                selectedSchema.value,
                connectionInfo.params,
                {}
              ),
              ...(connectionInfo.settings || {}),
            },
          };
          const res = await apiCall<{
            datasource: DataSourceInterfaceWithParams;
          }>(`/datasources`, {
            method: "POST",
            body: JSON.stringify(data),
          });
          track("提交数据源表单", {
            source,
            type: connectionInfo.type,
            schema: eventTracker,
            newDatasourceForm: true,
          });

          setCreatedDatasource(res.datasource);
          return res.datasource;
        }
      } catch (e) {
        track("数据源表单错误", {
          source,
          type: connectionInfo.type,
          error: e.message.substr(0, 32) + "...",
          newDatasourceForm: true,
        });
        setLastError(e.message);
        throw e;
      }
    };

    const saveSchemaOptions = async (values: Record<string, string | number>) => {
      if (!createdDatasource) {
        throw new Error("尚未创建数据源");
      }

      // Re-generate settings with the entered schema options
      const settings = getInitialSettings(
        selectedSchema.value,
        createdDatasource.params,
        values
      );

      const updates: Pick<DataSourceInterfaceWithParams, "settings"> = {
        settings: {
          ...settings,
          schemaOptions: values,
        },
      };

      const res = await apiCall<{ datasource: DataSourceInterfaceWithParams }>(
        `/datasource/${createdDatasource.id}`,
        {
          method: "PUT",
          body: JSON.stringify(updates),
        }
      );
      track("保存数据源查询设置", {
        source,
        type: createdDatasource.type,
        schema: createdDatasource.settings?.schemaFormat,
        newDatasourceForm: true,
      });

      setCreatedDatasource(res.datasource);
    };

    const onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (
      e
    ) => {
      setConnectionInfo({
        ...connectionInfo,
        [e.target.name]: e.target.value,
      });
    };
    const onManualChange = (name: keyof DataSourceInterfaceWithParams, value) => {
      setConnectionInfo({
        ...connectionInfo,
        [name]: value,
      });
    };

    const createResources = (ds: DataSourceInterfaceWithParams) => {
      if (!ds) {
        return;
      }

      const resources = getInitialDatasourceResources({ datasource: ds });
      if (!resources.factTables.length) {
        setCreatingResources(false);
        return;
      }

      setCreatingResources(true);
      createInitialResources({
        datasource: ds,
        onProgress: (progress) => {
          setResourceProgress(progress);
        },
        apiCall,
        metricDefaults,
        settings,
        resources,
      })
        .then(() => {
          track("创建数据源资源", {
            source,
            type: ds.type,
            schema: ds.settings?.schemaFormat,
            newDatasourceForm: true,
          });
        })
        .catch((e) => {
          console.error(e);
        })
        .finally(() => {
          mutateDefinitions();
          setCreatingResources(false);
        });
    };

    const submit =
      step === "initial"
        ? async () => {
          if (connectionInfo.type === "mixpanel") {
            setStep("connection");
          } else if (possibleSchemas.length > 0) {
            setStep("eventTracker");
          } else {
            setStep("connection");
          }
        }
        : step === "eventTracker"
          ? async () => {
            setStep("connection");
          }
          : step === "connection"
            ? async () => {
              const ds = await saveConnectionInfo();
              mutateDefinitions();

              // If the selected schema supports options, go to that step
              // Otherwise, skip to end
              if (selectedSchema.options) {
                setStep("schemaOptions");
              } else {
                createResources(ds);
                setStep("done");
              }
            }
            : step === "schemaOptions"
              ? schemaOptionsForm.handleSubmit(async (values) => {
                await saveSchemaOptions(values);
                createdDatasource && createResources(createdDatasource);
                setStep("done");
              })
              : async () => {
                // Done
                await onSuccess(createdDatasource?.id || "");
                onCancel && onCancel();
              };

    let stepContents: ReactNode = null;
    if (step === "initial") {
      stepContents = (
        <div>
          <p className="底部外边距_4px">
            GrowthBook是< strong>数据仓库原生</strong>的，这意味着我们基于您现有的数据，而不是存储我们自己的数据副本。这种方式更经济、更安全且更灵活。
          </p>
          <div>
            <label>您将分析数据存储在哪里？</label>

            <DataSourceTypeSelector
              value={connectionInfo.type || ""}
              setValue={(value) => {
                const option = dataSourceConnections.find(
                  (o) => o.type === value
                );
                if (!option) return;

                setLastError("");

                track("数据源类型已选定", {
                  type: value,
                  newDatasourceForm: true,
                });

                setConnectionInfo({
                  ...connectionInfo,
                  type: option.type,
                  params: option.default,
                } as Partial<DataSourceInterfaceWithParams>);

                if (
                  option.type !== "mixpanel" &&
                  eventSchemas.some((s) => s.types?.includes(option.type))
                ) {
                  setStep("eventTracker");
                } else {
                  setStep("connection");
                }
              }}
            />

            {/* <Callout status="info" mt="3">
              还没有数据仓库吗？我们推荐使用带有谷歌分析的BigQuery。{" "}
              <DocLink docSection="ga4BigQuery">
                了解更多 <FaExternalLinkAlt />
              </DocLink>
            </Callout> */}
          </div>
        </div>
      );
    } else if (step === "eventTracker") {
      stepContents = (
        <div>
          <div className="mb-3">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setLastError("");
                setStep("initial");
              }}
            >
              <span style={{ position: "relative", top: "-1px" }}>
                <GBCircleArrowLeft />
              </span>{" "}
              返回
            </a>
          </div>
          {connectionInfo.type ? (
            <h3>
              {dataSourceConnections.find((d) => d.type === connectionInfo.type)
                ?.display || connectionInfo.type}
            </h3>
          ) : (
            <h3>选择您的事件跟踪器</h3>
          )}
          <p>
            我们可以为许多常见的事件跟踪器预填充SQL。如果没有看到您使用的跟踪器？请选择“自定义”进行手动配置。
          </p>
          <EventSourceList
            onSelect={(s) => {
              setSchemaSettings(s);
              setStep("connection");
            }}
            selected={connectionInfo.settings?.schemaFormat}
            allowedSchemas={connectionInfo.type ? possibleSchemas : undefined}
          />
        </div>
      );
    } else if (step === "connection") {
      const datasourceInfo = dataSourceConnections.find(
        (d) => d.type === connectionInfo.type
      );

      const headerParts: string[] = [
        datasourceInfo?.display || connectionInfo.type || "",
      ];
      if (connectionInfo.type !== "mixpanel") {
        headerParts.push(selectedSchema.label);
      }

      stepContents = (
        <div>
          <div className="mb-3">
            {showBackButton && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setLastError("");
                  if (connectionInfo.type === "mixpanel") {
                    setStep("initial");
                  } else {
                    setStep("eventTracker");
                  }
                }}
              >
                <span style={{ position: "relative", top: "-1px" }}>
                  <GBCircleArrowLeft />
                </span>{" "}
                返回
              </a>
            )}
          </div>
          <h3>{headerParts.join(" > ")}</h3>

          {datasourceInfo ? (
            <Callout status="info" mb="3">
              查看关于连接{" "}
              {selectedSchema.helpLink ? (
                <>
                  <a
                    href={selectedSchema.helpLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {selectedSchema.label} 到 {datasourceInfo.display}{" "}
                    <FaExternalLinkAlt />
                  </a>{" "}
                  或者{" "}
                </>
              ) : null}
              <DocLink docSection={datasourceInfo.docs}>
                {datasourceInfo.display} 到GrowthBook <FaExternalLinkAlt />
              </DocLink>{" "}
            </Callout>
          ) : null}

          <div className="form-group">
            <label>名称</label>
            <input
              type="text"
              className="form-control"
              name="name"
              required
              onChange={onChange}
              value={connectionInfo.name}
              autoFocus={true}
            />
          </div>
          <div className="form-group">
            <label>描述</label>
            <textarea
              className="form-control"
              name="description"
              onChange={onChange}
              value={connectionInfo.description}
            />
          </div>
          {projects?.length > 0 && (
            <div className="form-group">
              <MultiSelectField
                label={
                  <>
                    项目{" "}
                    <Tooltip
                      body={`下面的下拉菜单已过滤，仅显示您有权创建数据源的项目。`}
                    />
                  </>
                }
                placeholder="所有项目"
                value={connectionInfo.projects || []}
                options={projectOptions}
                onChange={(v) => onManualChange("projects", v)}
                customClassName="label-overflow-ellipsis"
                helpText="将此数据源分配给特定项目"
              />
            </div>
          )}
          <ConnectionSettings
            datasource={connectionInfo}
            existing={false}
            hasError={!!lastError}
            setDatasource={setConnectionInfo}
          />
        </div>
      );
    } else if (step === "schemaOptions") {
      stepContents = (
        <div>
          <div className="mb-2">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setStep("connection");
              }}
            >
              <span style={{ position: "relative", top: "-1px" }}>
                <GBCircleArrowLeft />
              </span>{" "}
              返回
            </a>
          </div>
          <h3>{selectedSchema.label || ""} 查询选项</h3>
          <div className="my-4">
            <div className="d-inline-block">
              以下是{" "}
              {selectedSchema.label || "此数据源"}的典型默认值。{" "}
              {selectedSchema.options?.length === 1
                ? "该值 "
                : "这些值 "}
              用于生成查询，您可以根据需要随时调整。
            </div>
          </div>
          <div>
            {selectedSchema?.options?.map(({ name, label, type, helpText }) => (
              <div key={name} className="form-group">
                <Field
                  label={label}
                  name={name}
                  value={schemaOptionsForm.watch(name)}
                  type={type}
                  onChange={(e) => {
                    schemaOptionsForm.setValue(name, e.target.value);
                  }}
                  helpText={helpText}
                />
              </div>
            ))}
          </div>
        </div>
      );
    } else if (step === "done") {
      stepContents = (
        <div>
          <Callout status="success" mb="3">
            连接成功！
          </Callout>

          {creatingResources ? (
            <div>
              <p>请稍等，我们正在为您创建指标。</p>
              <div className="progress">
                <div
                  className="progress-bar"
                  role="progressbar"
                  style={{ width: `${Math.floor(resourceProgress * 100)}%` }}
                  aria-valuenow={resourceProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          ) : resourceProgress > 0 ? (
            <div>
              <p>全部完成！现在您可以开始进行实验了。</p>
            </div>
          ) : (
            <div>
              <p>
                现在您可以创建指标并开始进行实验了。
              </p>
            </div>
          )}
        </div>
      );

      if (creatingResources) {
        ctaEnabled = false;
      }
    }

    // Disabling the CTA if the user hasn't input a data set to call attention to the "Test Connection" button
    if (
      step == "connection" &&
      connectionInfo.type === "bigquery" &&
      !connectionInfo.params?.defaultDataset
    ) {
      ctaEnabled = false;
    }

    if (step === "initial" && !connectionInfo.type) {
      ctaEnabled = false;
    }

    return (
      <Modal
        trackingEventModalType=""
        open={true}
        header={"添加数据源"}
        close={onCancel}
        disabledMessage={disabledMessage || undefined}
        ctaEnabled={ctaEnabled}
        submit={submit}
        autoCloseOnSubmit={false}
        cta={step === "done" ? "完成" : "下一步"}
        closeCta="取消"
        size="lg"
        error={lastError}
        inline={inline}
      >
        {stepContents}
      </Modal>
    );
  };

export default NewDataSourceForm;
