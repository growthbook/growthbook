import useApi from "../../hooks/useApi";
import { FeatureInterface } from "back-end/types/feature";
import { useDefinitions } from "../../services/DefinitionsContext";
import LoadingOverlay from "../../components/LoadingOverlay";
import { ago, datetime } from "../../services/dates";
import Link from "next/link";
import { useState } from "react";
import { GBAddCircle } from "../../components/Icons";
import FeatureModal from "../../components/Features/FeatureModal";
import ValueDisplay from "../../components/Features/ValueDisplay";
import { useRouter } from "next/router";
import { useContext } from "react";
import { UserContext } from "../../components/ProtectedPage";
import { FaCheck, FaRegCircle } from "react-icons/fa";
import clsx from "clsx";
import EditAttributesModal from "../../components/Features/EditAttributesModal";
import CodeSnippetModal from "../../components/Features/CodeSnippetModal";

export default function FeaturesPage() {
  const { project } = useDefinitions();

  const [modalOpen, setModalOpen] = useState(false);
  const [attributeModalOpen, setAttributeModalOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const router = useRouter();
  const { data, error, mutate } = useApi<{
    features: FeatureInterface[];
  }>(`/feature?project=${project || ""}`);

  const { settings } = useContext(UserContext);
  const [showSteps, setShowSteps] = useState(false);

  const stepsRequired =
    !settings?.attributeSchema?.length ||
    !settings?.sdkInstructionsViewed ||
    (data && !data?.features?.length);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  let step = -1;
  if (!settings?.attributeSchema?.length) {
    step = 0;
  } else if (!settings?.sdkInstructionsViewed) {
    step = 1;
  } else if (!data?.features?.length) {
    step = 2;
  }

  return (
    <div className="contents container-fluid pagecontents">
      {modalOpen && (
        <FeatureModal
          close={() => setModalOpen(false)}
          onSuccess={async (feature) => {
            router.push(`/features/${feature.id}`);
            mutate({
              features: [...data.features, feature],
            });
          }}
        />
      )}
      {attributeModalOpen && (
        <EditAttributesModal close={() => setAttributeModalOpen(false)} />
      )}
      {codeModalOpen && (
        <CodeSnippetModal close={() => setCodeModalOpen(false)} />
      )}
      <div className="row mb-3">
        <div className="col">
          <h1>Features</h1>
        </div>
        {data?.features?.length > 0 && (
          <div className="col-auto">
            <button
              className="btn btn-primary float-right"
              onClick={() => setModalOpen(true)}
              type="button"
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Feature
            </button>
          </div>
        )}
      </div>
      <p>
        Features enable you to change your app&apos;s behavior from within the
        GrowthBook UI. For example, turn on/off a sales banner or change the
        title of your pricing page.{" "}
      </p>
      <p>
        You can set a global value for everyone, use advanced targeting to
        assign values to users, or run an experiment to see which value is
        better.
      </p>
      {stepsRequired || showSteps ? (
        <div className="mb-3">
          <h4>
            Setup Steps
            {!stepsRequired && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowSteps(false);
                }}
                style={{ fontSize: "0.8em" }}
                className="ml-3"
              >
                hide
              </a>
            )}
          </h4>
          <div className="list-group">
            <a
              href="#"
              className={clsx("list-group-item list-group-item-action", {
                "list-group-item-light": step !== 0,
              })}
              onClick={(e) => {
                e.preventDefault();
                setAttributeModalOpen(true);
              }}
            >
              {settings?.attributeSchema?.length > 0 ? (
                <FaCheck className="text-success" />
              ) : (
                <FaRegCircle />
              )}{" "}
              <strong>Step 1:</strong> Configure Targeting Attributes
            </a>
            <a
              href="#"
              className={clsx("list-group-item list-group-item-action", {
                "list-group-item-light": step !== 1,
              })}
              onClick={(e) => {
                e.preventDefault();
                setCodeModalOpen(true);
              }}
            >
              {settings?.sdkInstructionsViewed ? (
                <FaCheck className="text-success" />
              ) : (
                <FaRegCircle />
              )}{" "}
              <strong>Step 2:</strong> Install our Javascript or React library
            </a>
            <a
              href="#"
              className={clsx("list-group-item list-group-item-action", {
                "list-group-item-light": step !== 2,
              })}
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(true);
              }}
            >
              {data?.features?.length > 0 ? (
                <FaCheck className="text-success" />
              ) : (
                <FaRegCircle />
              )}{" "}
              <strong>Step 3:</strong> Add your first feature
            </a>
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowSteps(true);
            }}
          >
            Show Setup Steps
          </a>
        </div>
      )}

      {data.features.length > 0 && (
        <div className="appbox p-3">
          <table className="table gbtable table-hover">
            <thead>
              <tr>
                <th>Feature Key</th>
                <th>Default Value</th>
                <th>Has Overrides</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.features.map((feature) => {
                return (
                  <tr key={feature.id}>
                    <td>
                      <Link href={`/features/${feature.id}`}>
                        <a>{feature.id}</a>
                      </Link>
                    </td>
                    <td>
                      <ValueDisplay
                        value={feature.defaultValue}
                        type={feature.valueType}
                      />
                    </td>
                    <td>{feature.rules?.length > 0 ? "yes" : "no"}</td>
                    <td title={datetime(feature.dateUpdated)}>
                      {ago(feature.dateUpdated)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
