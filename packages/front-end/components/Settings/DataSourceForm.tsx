import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  ReactElement,
} from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { dataSourceConnections } from "@/services/eventSchema";
import Button from "@/components/Button";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { getInitialSettings } from "@/services/datasources";
import { DocLink, DocSection } from "@/components/DocLink";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import ConnectionSettings from "@/components/Settings/ConnectionSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ensureAndReturn } from "@/types/utils";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import Tooltip from "@/components/Tooltip/Tooltip";
import EditSchemaOptions from "./EditSchemaOptions";

const typeOptions = dataSourceConnections;

const DataSourceForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  existing: boolean;
  source: string;
  onCancel?: () => void;
  onSuccess: (id: string) => Promise<void>;
  importSampleData?: () => Promise<void>;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
}> = ({
  data,
  onSuccess,
  onCancel,
  source,
  existing,
  importSampleData,
  inline,
  cta = "保存",
  secondaryCTA,
}) => {
    const { projects } = useDefinitions();
    const [dirty, setDirty] = useState(false);
    const [datasource, setDatasource] = useState<
      Partial<DataSourceInterfaceWithParams> | undefined
    >();
    const [hasError, setHasError] = useState(false);
    const permissionsUtil = usePermissionsUtil();

    const permissionRequired = (project: string) => {
      return existing
        ? permissionsUtil.canUpdateDataSourceParams({
          projects: [project],
          type: datasource?.type,
        })
        : permissionsUtil.canCreateDataSource({
          projects: [project],
          type: datasource?.type,
        });
    };

    const projectOptions = useProjectOptions(
      permissionRequired,
      datasource?.projects || []
    );

    useEffect(() => {
      track("View Datasource Form", {
        source,
      });
    }, [source]);

    const { apiCall } = useAuth();
    useEffect(() => {
      if (data && !dirty) {
        const newValue: Partial<DataSourceInterfaceWithParams> = {
          ...data,
        };
        setDatasource(newValue);
      }
    }, [data, dirty]);

    if (!datasource) {
      return null;
    }

    const handleSubmit = async () => {
      if (!dirty && data.id) return;
      setHasError(false);

      try {
        if (!datasource.type) {
          throw new Error("请选择一个数据源类型");
        }

        let id = data.id;

        // Update
        if (id) {
          const res = await apiCall<{ status: number; message: string }>(
            `/datasource/${data.id}`,
            {
              method: "PUT",
              body: JSON.stringify(datasource),
            }
          );
          if (res.status > 200) {
            throw new Error(res.message);
          }
        }
        // Create
        else {
          const res = await apiCall<{ id: string }>(`/datasources`, {
            method: "POST",
            body: JSON.stringify({
              ...datasource,
              settings: {
                ...getInitialSettings(
                  "custom",
                  ensureAndReturn(datasource.params)
                ),
                ...(datasource.settings || {}),
              },
            }),
          });
          id = res.id;
          track("Submit Datasource Form", {
            source,
            type: datasource.type,
          });
        }

        setDirty(false);
        await onSuccess(id);
      } catch (e) {
        track("Data Source Form Error", {
          source,
          type: datasource.type,
          error: e.message.substr(0, 32) + "...",
        });
        setHasError(true);
        throw e;
      }
    };

    const onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (
      e
    ) => {
      setDatasource({
        ...datasource,
        [e.target.name]: e.target.value,
      });
      setDirty(true);
    };
    const onManualChange = (name, value) => {
      setDatasource({
        ...datasource,
        [name]: value,
      });
      setDirty(true);
    };

    return (
      <Modal
        trackingEventModalType=""
        inline={inline}
        open={true}
        submit={handleSubmit}
        close={onCancel}
        header={existing ? "编辑数据源" : "添加数据源"}
        cta={cta}
        size="lg"
        secondaryCTA={secondaryCTA}
      >
        {importSampleData && !datasource.type && (
          <div className="alert alert-info">
            <div className="row align-items-center">
              <div className="col">
                <div>
                  <strong>还没准备好连接到你的数据源？</strong>
                </div>{" "}
                先使用示例数据集试用一下 GrowthBook。
              </div>
              <div className="col-auto">
                <Button
                  color="info"
                  className="btn-sm"
                  onClick={async () => {
                    await importSampleData();
                  }}
                >
                  使用示例数据
                </Button>
              </div>
            </div>
          </div>
        )}
        <SelectField
          label="数据源类型"
          value={datasource.type || typeOptions[0].type}
          onChange={(value) => {
            const option = typeOptions.filter((o) => o.type === value)[0];
            if (!option) return;

            track("Data Source Type Selected", {
              type: value,
            });

            setDatasource({
              ...datasource,
              type: option.type,
              params: option.default,
            } as Partial<DataSourceInterfaceWithParams>);
            setDirty(true);
          }}
          disabled={existing}
          required
          autoFocus={true}
          placeholder="选择类型..."
          options={typeOptions.map((o) => {
            return {
              value: o.type,
              label: o.display,
            };
          })}
        // helpText={
        //   <DocLink
        //     docSection={datasource.type as DocSection}
        //     fallBackSection="datasources"
        //   >
        //     查看文档
        //   </DocLink>
        // }
        />
        <div className="form-group">
          <label>显示名称</label>
          <input
            type="text"
            className="form-control"
            name="name"
            required
            onChange={onChange}
            value={datasource.name}
          />
        </div>
        <div className="form-group">
          <label>描述</label>
          <textarea
            className="form-control"
            name="description"
            onChange={onChange}
            value={datasource.description}
          />
        </div>
        {projects?.length > 0 && (
          <div className="form-group">
            <MultiSelectField
              label={
                <>
                  项目{" "}
                  <Tooltip
                    body={`下面的下拉菜单已过滤，仅包含你有权限 ${existing ? "更新" : "创建"} 数据源的项目。`}
                  />
                </>
              }
              placeholder="所有项目"
              value={datasource.projects || []}
              options={projectOptions}
              onChange={(v) => onManualChange("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="将此数据源分配给特定项目"
            />
          </div>
        )}
        <ConnectionSettings
          datasource={datasource}
          existing={existing}
          hasError={hasError}
          setDatasource={setDatasource}
          setDirty={setDirty}
        />
        <EditSchemaOptions
          datasource={datasource}
          setDatasource={setDatasource}
          setDirty={setDirty}
        />
      </Modal>
    );
  };

export default DataSourceForm;
