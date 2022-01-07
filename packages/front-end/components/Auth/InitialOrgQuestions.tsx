import { ReactElement, useContext, useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import track from "../../services/track";
import WelcomeFrame from "./WelcomeFrame";
import { UserContext } from "../ProtectedPage";
import { FiLogOut } from "react-icons/fi";

export default function InitialOrgQuestions(): ReactElement {
  const techStacks = [
    { display: "React", value: "react" },
    { display: "JavaScript", value: "js" },
    { display: "Python", value: "python" },
    { display: "Ruby", value: "ruby" },
    { display: "Node JS", value: "node" },
    { display: "PHP", value: "php" },
    { display: "Go", value: "go" },
    { display: "Java", value: "java" },
    { display: ".Net", value: "dotnet" },
    { display: "Angular", value: "angular" },
    { display: "Vue", value: "vue" },
  ];
  const dataSources = [
    { display: "BigQuery", value: "bigquery" },
    { display: "Redshift", value: "redshift" },
    { display: "Postgres", value: "postgres" },
    { display: "Snowflake", value: "snowflake" },
    { display: "Mixpanel", value: "mixpanel" },
    { display: "MySQL or MariaDB", value: "mysql" },
    { display: "Google Analytics", value: "google_analytics" },
    { display: "AWS Athena", value: "athena" },
    { display: "PrestoDB/Trino", value: "presto" },
    { display: "ClickHouse", value: "clickhouse" },
  ];

  const form = useForm({
    defaultValues: {
      datasource: [],
      dataother: "",
      techstack: [],
      techother: "",
    },
  });

  const [techQuestions, setTechQuestions] = useState(false);
  const [fullList, setFullList] = useState(false);
  const [usage, setUsage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { apiCall, logout } = useAuth();
  const { update } = useContext(UserContext);

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
        settings: {
          onBoarding: false,
          dataSouce: datas,
          techStack: techs,
        },
      }),
    });

    track("onboarding question use case: " + usage);
    update();
  });

  const submitUsage = async () => {
    await apiCall("/organization", {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          onBoarding: usage === "full",
          primaryUse: usage,
        },
      }),
    });
    track("onboarding question use case: " + usage);
    if (usage === "full") {
      // for full usage, show the next page.
      setTechQuestions(true);
    }
    update();
  };

  const skip = async () => {
    await apiCall("/organization", {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          onBoarding: false,
        },
      }),
    });

    track("onboarding skipped");
    update();
  };

  const usageOptions = [
    {
      id: "full",
      title:
        "I’m not doing experimentation yet, or I’m thinking of switching from another platform.",
      subtitle:
        "We will walk you through how to set up GrowthBook to support implementing, tracking and analysing experiments",
    },
    {
      id: "analysis",
      title:
        "I already have experiment data, but want GrowthBook to help with analysis",
      subtitle:
        "We will walk you through how to import experiments into the platform for analysis and documentation",
    },
    {
      id: "notsure",
      title: "I’m not sure, help me choose",
      subtitle: "We will show you the variety of ways you can use GrowthBook",
    },
  ];

  const leftside = (
    <>
      <h1 className="title h1">Customize GrowthBook</h1>
      <p>Help us customize the platform for your needs</p>
    </>
  );
  const initialTechLimit = 5;
  const selectedOption = usageOptions.filter((o) => o.id === usage);
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
        {techQuestions ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (loading) return;
              if (!selectedOption) return;
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
            <div className="mb-4">
              <h3 className="h2">What technologies do you use?</h3>
              <p className="text-muted">
                Last questions, if you don&apos;t know, you can just skip.
              </p>
            </div>
            <div className="row">
              <div className="col-12 col-sm-6">
                <div className="form-group">
                  <h4>Data sources</h4>
                  {dataSources.map((d, i) => {
                    if (!fullList && i >= initialTechLimit) {
                      return;
                    }
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
                  {fullList && (
                    <>
                      Other:
                      <input
                        type="text"
                        {...form.register("dataother")}
                        className="form-control"
                      />
                    </>
                  )}
                  {!fullList && (
                    <a
                      className="text-center mt-2 d-inline-block"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setFullList(true);
                      }}
                    >
                      more choices...
                    </a>
                  )}
                </div>
              </div>
              <div className="col-12 col-sm-6">
                <div className="form-group">
                  <h4>Tech stacks</h4>
                  {techStacks.map((t, i) => {
                    if (!fullList && i >= initialTechLimit) {
                      return;
                    }
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
                  {fullList && (
                    <>
                      Other:
                      <input
                        type="text"
                        {...form.register("techother")}
                        className="form-control"
                      />
                    </>
                  )}
                  {!fullList && (
                    <a
                      className="text-center mt-2 d-inline-block"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setFullList(true);
                      }}
                    >
                      more choices...
                    </a>
                  )}
                </div>
              </div>
            </div>
            {error && <div className="alert alert-danger mr-auto">{error}</div>}
            <button
              className={`btn btn-block btn-lg ${
                selectedOption && selectedOption[0]
                  ? "btn-primary"
                  : "btn-disabled btn-secondary"
              }`}
              type="submit"
            >
              Save
            </button>
          </form>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (loading) return;
              if (!selectedOption) return;
              setError(null);
              setLoading(true);
              try {
                await submitUsage();
                setLoading(false);
              } catch (e) {
                setError(e.message);
                setLoading(false);
              }
            }}
          >
            <div className="mb-4">
              <h3 className="h2">How you are experimenting today?</h3>
              <p className="text-muted">
                This will be used to customize the platform based to your needs.
              </p>
            </div>
            {usageOptions.map((o) => {
              return (
                <div
                  key={o.id}
                  className={`border p-4 rounded form-group selection-question cursor-pointer ${
                    usage === o.id ? "selected border-primary" : ""
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    setUsage(o.id);
                  }}
                >
                  <div className="">
                    <h4 className="mb-0">{o.title}</h4>
                  </div>
                </div>
              );
            })}

            <div className="mb-3">
              {selectedOption && selectedOption[0]
                ? selectedOption[0].subtitle
                : "Choose an option above. You can adjust this at any time later."}
            </div>

            {error && <div className="alert alert-danger mr-auto">{error}</div>}
            <button
              className={`btn btn-block btn-lg ${
                selectedOption && selectedOption[0]
                  ? "btn-primary"
                  : "btn-disabled btn-secondary"
              }`}
              type="submit"
            >
              Next
            </button>
          </form>
        )}
        <div className="text-right mt-3">
          {techQuestions && (
            <a
              className="float-left cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                setTechQuestions(false);
              }}
            >
              back
            </a>
          )}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault(); // skip...
              skip();
            }}
          >
            or skip
          </a>
        </div>
      </WelcomeFrame>
    </>
  );
}
