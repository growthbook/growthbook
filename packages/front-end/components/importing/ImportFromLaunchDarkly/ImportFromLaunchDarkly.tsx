import Link from "next/link";
import {GBCircleArrowLeft} from "@/components/Icons";
import {FaUpload} from "react-icons/fa";
import React, {FormEvent, useEffect} from "react";
import {getLDEnvironments, getLDFeatureFlags, getLDProjects} from "@/services/importing";
import LoadingSpinner from "@/components/LoadingSpinner";
import { ProjectInterface } from "back-end/types/project";
import { Environment } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";
import CodeTextArea from "@/components/Forms/CodeTextArea";

type TaskState = "idle" | "pending" | "error" | "completed";
export const ImportFromLaunchDarkly = () => {

  const [fetchState, setFetchState] = React.useState<TaskState>("idle");
  const [importState, setImportState] = React.useState<TaskState>("idle");

  const [ldProjects, setLdProjects] = React.useState<any[]>([]);
  const [ldEnvironments, setLdEnvironments] = React.useState<any[]>([]);
  const [ldUniqueEnvironments, setLdUniqueEnvironments] = React.useState<Record<string, any>>({});
  const [ldFeatures, setLdFeatures] = React.useState<any[]>([]);

  const [gbEnvironments, setGbEnvironments] = React.useState<Partial<Environment>[]>([]);
  const [gbProjects, setGbProjects] = React.useState<Partial<ProjectInterface>[]>([]);
  const [gbFeatures, setGbFeatures] = React.useState<Partial<FeatureInterface>[]>([]);
  const [showGbImportDetails, setShowGbImportDetails] = React.useState(false);

  const clearLdData = () => {
    setLdProjects([]);
    setLdEnvironments([]);
    setLdUniqueEnvironments([]);
    setLdFeatures([]);
    setFetchState("idle");
    setImportState("idle");
    setShowGbImportDetails(false);
  }
  const clearGbData = () => {
    setGbProjects([]);
    setGbEnvironments([]);
    setGbFeatures([]);
    setImportState("idle");
  }

  const handleSubmit = async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (fetchState !== "idle") {
      return;
    }
    console.log("START FETCHING");
    setFetchState("pending");

    const form = evt.currentTarget as HTMLFormElement;
    const apiKey = form.elements["api_token"].value;

    // get projects
    const ldps: any[] = [];
    const projectsResp = await getLDProjects(apiKey);
    if (projectsResp.items) {
      projectsResp.items.map((project) => {
        ldps.push(project);
      });
    }
    setLdProjects(ldps);
    await sleep();

    // get environments from projects
    const ldes: any[] = [];
    for (const project of ldps) {
      const environmentsResp = await getLDEnvironments(apiKey, project.key);
      if (environmentsResp.items) {
        environmentsResp.items.map((env) => {
          ldes.push(env);
        });
      }
      await sleep();
    }
    const uniqueLdes: Record<string, any> = {};
    for (const env of ldes) {
      uniqueLdes[env.key] = env;
    }
    setLdEnvironments(ldes);
    setLdUniqueEnvironments(uniqueLdes);

    // get features from projects
    const ldfs: any[] = [];
    for (const project of ldps) {
      const featuresResp = await getLDFeatureFlags(apiKey, project.key);
      if (featuresResp.items) {
        featuresResp.items.map((feature) => {
          ldfs.push({
            ...feature,
            project: project.key
          });
        });
      }
      await sleep();
    }
    setLdFeatures(ldfs);

    setFetchState("completed");
    console.log("END FETCHING");
  };

  useEffect(() => {
    if (fetchState !== "completed") return;
    console.log({
      ldProjects,
      ldEnvironments,
      ldFeatures
    })
    const gbps: Partial<ProjectInterface>[] = [];
    const gbes: Partial<Environment>[] = [];
    const gbfs: Partial<FeatureInterface>[] = [];
    ldProjects.forEach((p) => {
      gbps.push({
        name: p.name,
        description: p.description,
      });
    });
    for (const key in ldUniqueEnvironments) {
      const e = ldUniqueEnvironments[key];
      gbes.push({
        id: e.key,
        description: e.name,
      });
    }
    ldFeatures.forEach(
      ({
        _maintainer,
        environments,
        project,
        key,
        kind,
        variations,
        name,
        description,
        tags,
      }) => {
        const envKeys = Object.keys(environments);

        const defaultValue = environments[envKeys[0]].on;

        const gbEnvironments: FeatureInterface["environmentSettings"] = {};
        envKeys.forEach((envKey) => {
          gbEnvironments[envKey] = {
            enabled: environments[envKey].on,
            // Note: Rules do not map 1-to-1 between GB and LD
            rules: [],
          };
        });

        const owner = _maintainer
          ? `${_maintainer.firstName} ${_maintainer.lastName} (${_maintainer.email})`
          : "(unknown - imported from LaunchDarkly)";

        gbfs.push({
          environmentSettings: gbEnvironments,
          defaultValue:
            kind === "boolean"
              ? `${defaultValue}`
              : (variations["0"].value as string),
          project,
          id: key,
          description: description || name,
          owner,
          tags,
          // todo: get valueType a bit better
          valueType: kind === "boolean" ? "boolean" : "string",
        });
      }
    );

    setGbProjects(gbps);
    setGbEnvironments(gbes);
    setGbFeatures(gbfs);

  }, [fetchState]);

  return (
    <div>
      <div className="mb-4">
        <Link href="/importing">
          <a>
            <GBCircleArrowLeft/> Back to Importing
          </a>
        </Link>
      </div>

      <h1>Import from LaunchDarkly</h1>
      <p>
        Import your data from LaunchDarkly. Just provide a LaunchDarkly API key
        or personal access token to proceed.
      </p>
      <p>
        This task will attempt to import the following resources from
        LaunchDarkly:
      </p>
      <ul>
        <li>Projects</li>
        <li>Environments</li>
        <li>Feature flags</li>
      </ul>

      <div className="appbox px-4 py-3">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="text-muted font-weight-bold" htmlFor="api_token">
              LaunchDarkly API token
            </label>
            <input
              className="form-control"
              style={{maxWidth: 400}}
              type="text"
              name="api_token"
              id="api_token"
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={fetchState !== "idle"}
          >
            <FaUpload/> Start Fetch
          </button>
        </form>
      </div>

      {["pending", "error", "completed"].includes(fetchState) && (
        <div className="mt-4 appbox px-4 py-3">
          <h2>1. Fetch from LD</h2>
          {fetchState === "pending" && (
            <h3>Fetching <LoadingSpinner/></h3>
          )}
          {fetchState === "error" && (
            <h3 className="text-danger">Error fetching</h3>
          )}
          {fetchState === "completed" && (
            <h3 className="text-success">Fetch completed</h3>
          )}
          <div>Projects: {ldProjects.length}</div>
          <div>Environments: {Object.keys(ldUniqueEnvironments).length} unique <small>({ldEnvironments.length} by
            project)</small></div>
          <div>Feature flags: {ldFeatures.length}</div>

          {["completed", "error"].includes(fetchState) && (
            <div
              className="mt-2 btn btn-danger"
              onClick={clearLdData}
            >
              Clear and Restart Fetch
            </div>
          )}
        </div>
      )}

      {fetchState === "completed" && (
        <div className="mt-4 appbox px-4 py-3">
          <h2>2. Import into GB</h2>
          {importState === "pending" && (
            <h3>Importing <LoadingSpinner/></h3>
          )}
          {importState === "error" && (
            <h3 className="text-danger">Error importing</h3>
          )}
          {importState === "completed" && (
            <h3 className="text-success">Import completed</h3>
          )}

          {["completed", "error"].includes(importState) && (
            <button
              className="mt-2 btn btn-danger"
              onClick={clearGbData}
            >
              Clear and Restart Import
            </button>
          )}

          <div className="mt-2">
            <a
              role="button"
              className="link-purple"
              onClick={() => setShowGbImportDetails(!showGbImportDetails)}
            >
              {showGbImportDetails ? "Hide" : "Show"} import details
            </a>
          </div>
          {showGbImportDetails && (
            <div>
              <div>Projects: {gbProjects.length}</div>
              {gbProjects.map((p) => (
                <CodeTextArea language={"json"} value={JSON.stringify(p, null, 2)} setValue={()=>{}}/>
              ))}
              <hr/>

              <div>Environments: {gbEnvironments.length}</div>
              {gbEnvironments.map((e) => (
                <CodeTextArea language={"json"} value={JSON.stringify(e, null, 2)} setValue={()=>{}}/>
              ))}
              <hr/>

              <div>Feature flags: {gbFeatures.length}</div>
              {gbFeatures.map((f) => (
                <CodeTextArea language={"json"} value={JSON.stringify(f, null, 2)} setValue={()=>{}}/>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

async function sleep(ms: number = 500) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
