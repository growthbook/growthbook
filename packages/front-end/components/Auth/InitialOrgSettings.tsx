import { ReactElement, useState } from "react";
import { useForm } from "react-hook-form";
import { FiLogOut } from "react-icons/fi";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import WelcomeFrame from "./WelcomeFrame";

export default function InitialOrgSettings(): ReactElement {
  const techStacks = [
    { display: "Python", value: "python" },
    { display: "Ruby", value: "ruby" },
    { display: "Node JS", value: "node" },
    { display: "PHP", value: "php" },
    { display: "Go", value: "go" },
    { display: "Java", value: "java" },
    { display: ".Net", value: "dotnet" },
    { display: "React", value: "react" },
    { display: "Angular", value: "angular" },
    { display: "Vue", value: "vue" },
  ];
  const dataSources = [
    { display: "Redshift", value: "redshift" },
    { display: "Google Analytics", value: "google_analytics" },
    { display: "AWS Athena", value: "athena" },
    { display: "PrestoDB or Trino", value: "presto" },
    { display: "Snowflake", value: "snowflake" },
    { display: "Postgres", value: "postgres" },
    { display: "MySQL or MariaDB", value: "mysql" },
    { display: "MS SQL/SQL Server", value: "mssql" },
    { display: "BigQuery", value: "bigquery" },
    { display: "Databricks", value: "databricks" },
    { display: "Mixpanel", value: "mixpanel" },
    { display: "ClickHouse", value: "clickhouse" },
  ];

  const form = useForm({
    defaultValues: {
      types: {
        visual: false,
        code: true,
      },
      datasource: [],
      dataother: "",
      techstack: [],
      techother: "",
    },
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { apiCall, logout } = useAuth();
  const { refreshOrganization } = useUser();

  const submit = form.handleSubmit(async (value) => {
    // add the other to the array:
    const datas = [...value.datasource];
    const techs = [...value.techstack];
    if (value.dataother) {
      datas.push(value.dataother.trim());
    }
    if (value.techother) {
      techs.push(value.techother.trim());
    }

    await apiCall("/organization", {
      method: "PUT",
      body: JSON.stringify({
        types: value.types,
        dataSource: datas,
        techStack: techs,
      }),
    });

    track("onboarding questions");
    refreshOrganization();
  });

  const leftside = (
    <>
      <h1 className="title h1">Welcome to Growth&nbsp;Book</h1>
      <p>One last page...</p>
    </>
  );

  return (
    <>
      <WelcomeFrame leftside={leftside} loading={loading}>
        <a
          className="logout-link"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setLoading(true);
            logout();
          }}
        >
          <FiLogOut /> log out
        </a>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (loading) return;
            setError(null);
            setLoading(true);
            try {
              await submit();
              setLoading(false);
            } catch (e) {
              setError(e.message);
              setLoading(false);
            }
          }}
        >
          <div>
            <h3 className="h2">Organization settings</h3>
            <p className="text-muted">Help us understand your needs.</p>
          </div>
          <div className="row">
            <h4>Implementation</h4>
            <div className="col-4 col-sm-4">
              <div className="form-group">
                <label></label>
              </div>
            </div>
          </div>
          <div className="form-group">
            <div className="form-check">
              <input
                type="checkbox"
                className="form-check-input "
                {...form.register("types.visual")}
                id="checkbox-visualeditor"
              />

              <label
                htmlFor="checkbox-visualeditor"
                className="form-check-label"
              >
                Enable Visual Editor{" "}
                <Tooltip
                  body="The visual editor allows you to create A/B tests by editing pages from the front-end. You will need to add a snippet of code to your site. (You can change this at any time later). "
                  tipMinWidth="200px"
                />
              </label>
            </div>
          </div>
          <div className="row">
            <div className="col-12 col-sm-6">
              <div className="form-group">
                <h4>Data sources</h4>
                {dataSources.map((d) => {
                  return (
                    <div className="form-check" key={d.value}>
                      <label className="form-check-label">
                        <input
                          type="checkbox"
                          className="form-check-input "
                          value={d.value}
                          {...form.register("datasource")}
                        />
                        {d.display}
                      </label>
                    </div>
                  );
                })}
                Other:
                <input
                  type="text"
                  {...form.register("dataother")}
                  className="form-control"
                />
              </div>
            </div>
            <div className="col-12 col-sm-6">
              <div className="form-group">
                <h4>Tech stacks</h4>
                {techStacks.map((t) => {
                  return (
                    <div className="form-check" key={t.value}>
                      <label className="form-check-label">
                        <input
                          type="checkbox"
                          className="form-check-input "
                          value={t.value}
                          {...form.register("techstack")}
                        />
                        {t.display}
                      </label>
                    </div>
                  );
                })}
                Other:
                <input
                  type="text"
                  {...form.register("techother")}
                  className="form-control"
                />
              </div>
            </div>
          </div>

          {error && <div className="alert alert-danger mr-auto">{error}</div>}
          <button className={`btn btn-primary btn-block btn-lg`} type="submit">
            Save
          </button>
        </form>
        <div className="text-right mt-3">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault(); // skip...
            }}
          >
            or skip
          </a>
        </div>
      </WelcomeFrame>
    </>
  );
}
