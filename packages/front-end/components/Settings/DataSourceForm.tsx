import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  ReactElement,
} from "react";
import { useAuth } from "../../services/auth";
import {
  DataSourceInterfaceWithParams,
  DataSourceType,
  DataSourceParams,
} from "back-end/types/datasource";
import AthenaForm from "./AthenaForm";
import PostgresForm from "./PostgresForm";
import GoogleAnalyticsForm from "./GoogleAnalyticsForm";
import SnowflakeForm from "./SnowflakeForm";
import BigQueryForm from "./BigQueryForm";
import ClickHouseForm from "./ClickHouseForm";
import MixpanelForm from "./MixpanelForm";
import track from "../../services/track";
import Modal from "../Modal";
import PrestoForm from "./PrestoForm";
import MysqlForm from "./MysqlForm";

const typeOptions: {
  type: DataSourceType;
  display: string;
  default: Partial<DataSourceParams>;
}[] = [
  {
    type: "redshift",
    display: "Redshift",
    default: {
      host: "",
      port: 5439,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "google_analytics",
    display: "Google Analytics",
    default: {
      viewId: "",
      customDimension: "1",
      refreshToken: "",
    },
  },
  {
    type: "athena",
    display: "AWS Athena",
    default: {
      bucketUri: "s3://",
      region: "us-east-1",
      database: "",
      accessKeyId: "",
      secretAccessKey: "",
      workGroup: "primary",
    },
  },
  {
    type: "presto",
    display: "PrestoDB or Trino",
    default: {
      engine: "presto",
      host: "",
      port: 8080,
      username: "",
      password: "",
      catalog: "",
      schema: "",
    },
  },
  {
    type: "snowflake",
    display: "Snowflake",
    default: {
      account: "",
      username: "",
      password: "",
    },
  },
  {
    type: "postgres",
    display: "Postgres",
    default: {
      host: "",
      port: 5432,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "mysql",
    display: "MySQL or MariaDB",
    default: {
      host: "",
      port: 3306,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "bigquery",
    display: "BigQuery",
    default: {
      privateKey: "",
      clientEmail: "",
      projectId: "",
    },
  },
  {
    type: "clickhouse",
    display: "ClickHouse",
    default: {
      url: "",
      port: 8123,
      username: "",
      password: "",
      database: "",
    },
  },
  {
    type: "mixpanel",
    display: "Mixpanel",
    default: {
      username: "",
      secret: "",
      projectId: "",
    },
  },
];

const DataSourceForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  existing: boolean;
  source: string;
  onCancel: () => void;
  onSuccess: () => void;
}> = ({ data, onSuccess, onCancel, source, existing }) => {
  const [dirty, setDirty] = useState(false);
  const [datasource, setDatasource] = useState<
    Partial<DataSourceInterfaceWithParams>
  >(null);
  const [hasError, setHasError] = useState(false);

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
  }, [data]);

  if (!datasource) {
    return null;
  }

  const handleSubmit = async () => {
    if (!dirty && data.id) return;
    setHasError(false);

    try {
      if (!datasource.type) {
        throw new Error("Please select a data source type");
      }

      // Update
      if (data.id) {
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
        const res = await apiCall<{ status: number; message: string }>(
          `/datasources`,
          {
            method: "POST",
            body: JSON.stringify(datasource),
          }
        );
        if (res.status > 200) {
          throw new Error(res.message);
        }
        track("Submit Datasource Form", {
          source,
          type: datasource.type,
        });
      }

      setDirty(false);
      onSuccess();
    } catch (e) {
      setHasError(true);
      throw e;
    }
  };

  const onChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setDatasource({
      ...datasource,
      [e.target.name]: e.target.value,
    });
    setDirty(true);
  };
  const setParams = (params: { [key: string]: string }) => {
    const newVal = {
      ...datasource,
      params: {
        ...datasource.params,
        ...params,
      },
    };

    setDatasource(newVal as Partial<DataSourceInterfaceWithParams>);
    setDirty(true);
  };
  const onParamChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setParams({ [e.target.name]: e.target.value });
  };
  let connSettings: ReactElement | null = null;
  if (datasource.type === "athena") {
    connSettings = (
      <AthenaForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "presto") {
    connSettings = (
      <PrestoForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "redshift") {
    connSettings = (
      <PostgresForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "postgres") {
    connSettings = (
      <PostgresForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "mysql") {
    connSettings = (
      <MysqlForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "google_analytics") {
    connSettings = (
      <GoogleAnalyticsForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
        error={hasError}
      />
    );
  } else if (datasource.type === "snowflake") {
    connSettings = (
      <SnowflakeForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "clickhouse") {
    connSettings = (
      <ClickHouseForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "bigquery") {
    connSettings = (
      <BigQueryForm setParams={setParams} params={datasource.params} />
    );
  } else if (datasource.type === "mixpanel") {
    connSettings = (
      <MixpanelForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  }

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      header={existing ? "Edit Data Source" : "Add Data Source"}
      cta="Save"
    >
      <div className="form-group">
        <label>Data Source Type</label>
        <select
          className="form-control"
          value={datasource.type}
          disabled={existing}
          required
          onChange={(e) => {
            const option = typeOptions.filter(
              (o) => o.type === e.target.value
            )[0];
            if (!option) return;

            setDatasource({
              ...datasource,
              type: option.type,
              params: option.default,
            } as Partial<DataSourceInterfaceWithParams>);
            setDirty(true);
          }}
        >
          <option value="">Choose Type...</option>
          {typeOptions.map(({ type, display }) => (
            <option value={type} key={type}>
              {display}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Display Name</label>
        <input
          type="text"
          className="form-control"
          name="name"
          required
          onChange={onChange}
          value={datasource.name}
        />
      </div>
      {connSettings}
    </Modal>
  );
};

export default DataSourceForm;
