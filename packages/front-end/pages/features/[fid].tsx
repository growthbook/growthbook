import Link from "next/link";
import { useRouter } from "next/router";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  FeatureInterface,
  FeatureValueType,
  RolloutValue,
} from "back-end/types/feature";
import MoreMenu from "../../components/Dropdown/MoreMenu";
import ValueDisplay from "../../components/Features/ValueDisplay";
import { GBAddCircle, GBCircleArrowLeft } from "../../components/Icons";
import LoadingOverlay from "../../components/LoadingOverlay";
import Markdown from "../../components/Markdown/Markdown";
import useApi from "../../hooks/useApi";
import { useState } from "react";
import FeatureModal from "../../components/Features/FeatureModal";
import DeleteButton from "../../components/DeleteButton";
import { useAuth } from "../../services/auth";
import RuleModal from "../../components/Features/RuleModal";
import ConditionDisplay from "../../components/Features/ConditionDisplay";
import Button from "../../components/Button";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function ForceSummary({
  value,
  type,
}: {
  value: string;
  type: FeatureValueType;
}) {
  return (
    <div className="row align-items-center">
      <div className="col-auto">&bull; SERVE</div>
      <div className="col">
        <ValueDisplay value={value} type={type} />
      </div>
    </div>
  );
}

function RolloutSummary({
  rollout,
  type,
  hashAttribute,
  trackingKey,
}: {
  rollout: RolloutValue[];
  type: FeatureValueType;
  hashAttribute: string;
  trackingKey: string;
}) {
  const totalPercent = rollout.reduce((sum, w) => sum + w.weight, 0);

  return (
    <div>
      <div className="mb-3">
        &bull; Split users by{" "}
        <span className="mr-1 border px-2 py-1 bg-light rounded">
          {hashAttribute}
        </span>
      </div>
      &bull; SERVE
      <table className="table mt-1 mb-3 ml-3">
        <tbody>
          {rollout.map((r, j) => (
            <tr key={j}>
              <td>
                <ValueDisplay value={r.value} type={type} />
              </td>
              <td>
                <div className="d-flex">
                  <div style={{ width: "4em", maxWidth: "4em" }}>
                    {percentFormatter.format(r.weight)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="progress">
                      <div
                        className="progress-bar bg-info"
                        style={{
                          width: r.weight * 100 + "%",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          ))}
          {totalPercent < 1 && (
            <tr>
              <td>
                <em className="text-muted">unallocated</em>
              </td>
              <td>
                <div className="d-flex">
                  <div style={{ width: "4em", maxWidth: "4em" }}>
                    {percentFormatter.format(1 - totalPercent)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="progress">
                      <div
                        className="progress-bar"
                        style={{
                          width: (1 - totalPercent) * 100 + "%",
                          backgroundColor: "#ccc",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div>
        &bull; Fire event tracking with the key{" "}
        <span className="mr-1 border px-2 py-1 bg-light rounded">
          {trackingKey}
        </span>
      </div>
    </div>
  );
}

export default function FeaturePage() {
  const router = useRouter();
  const { fid } = router.query;

  const [edit, setEdit] = useState(false);

  const [ruleModal, setRuleModal] = useState<number | null>(null);

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    feature: FeatureInterface;
    experiments: { [key: string]: ExperimentInterfaceStringDates };
  }>(`/feature/${fid}`);

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

  const type = data.feature.valueType;

  return (
    <div className="contents container-fluid pagecontents">
      {edit && (
        <FeatureModal
          close={() => setEdit(false)}
          existing={data.feature}
          onSuccess={async (feature) => {
            mutate({ feature, experiments: data.experiments });
          }}
        />
      )}
      {ruleModal !== null && (
        <RuleModal
          feature={data.feature}
          close={() => setRuleModal(null)}
          i={ruleModal}
          mutate={mutate}
        />
      )}
      <div className="row align-items-center">
        <div className="col-auto">
          <Link href="/features">
            <a>
              <GBCircleArrowLeft /> Back to all features
            </a>
          </Link>
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          <MoreMenu id="feature-more-menu">
            <button
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                setEdit(true);
              }}
            >
              edit feature
            </button>
            <DeleteButton
              useIcon={false}
              displayName="Feature"
              onClick={async () => {
                await apiCall(`/feature/${data.feature.id}`, {
                  method: "DELETE",
                });
                router.push("/features");
              }}
              className="dropdown-item"
              text="delete feature"
            />
          </MoreMenu>
        </div>
      </div>

      <h1>{fid}</h1>
      <div className="mb-3">
        <Markdown>{data.feature.description || "*no description*"}</Markdown>
      </div>

      <div className="mb-3">
        <h3>Default Behavior</h3>
        <div className="appbox p-3 position-relative">
          <div className="row">
            <div className="col-auto">SERVE</div>
            <div className="col-auto">
              <ValueDisplay type={type} value={data.feature.defaultValue} />
            </div>
          </div>
        </div>
      </div>

      <h3 className="mb-2">Override Rules</h3>
      <p className="mb-3">The first matching rule will be applied</p>
      {data.feature.rules?.map((rule, i) => {
        return (
          <div key={i} className="appbox p-3 mb-4 position-relative">
            <div
              className="position-absolute text-light border"
              style={{
                top: -12,
                left: -1,
                width: 35,
                height: 24,
                lineHeight: "24px",
                textAlign: "center",
                background: "#7C45EA",
                opacity: !rule.enabled ? 0.5 : 1,
              }}
            >
              {i + 1}
            </div>
            {!rule.enabled && (
              <div
                className="position-absolute bg-secondary text-light border"
                style={{
                  top: -12,
                  right: 0,
                  width: 90,
                  height: 24,
                  lineHeight: "24px",
                  textAlign: "center",
                }}
              >
                DISABLED
              </div>
            )}
            <div className="d-flex">
              <div style={{ flex: 1 }} className="pt-1 position-relative">
                {!rule.enabled && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 99,
                      background: "rgba(255,255,255,.7)",
                      display: "flex",
                      flexDirection: "column",
                      fontSize: 25,
                    }}
                  ></div>
                )}
                {rule.description && (
                  <Markdown className="mb-3">{rule.description}</Markdown>
                )}
                {rule.condition && rule.condition !== "{}" && (
                  <div className="row mb-3 align-items-top">
                    <div className="col-auto">
                      <span>IF</span>
                    </div>
                    <div className="col">
                      <ConditionDisplay condition={rule.condition} />
                    </div>
                  </div>
                )}
                {rule.type === "force" && (
                  <ForceSummary value={rule.value} type={type} />
                )}
                {rule.type === "rollout" && (
                  <RolloutSummary
                    rollout={rule.values}
                    type={type}
                    hashAttribute={rule.hashAttribute || ""}
                    trackingKey={rule.trackingKey || data.feature.id}
                  />
                )}
              </div>
              <div>
                <MoreMenu id={"edit_rule_" + i}>
                  <a
                    href="#"
                    className="dropdown-item"
                    onClick={(e) => {
                      e.preventDefault();
                      setRuleModal(i);
                    }}
                  >
                    Edit
                  </a>
                  <Button
                    color=""
                    className="dropdown-item"
                    onClick={async () => {
                      const rules = [...data.feature.rules];
                      rules[i] = { ...rules[i] };
                      rules[i].enabled = !rules[i].enabled;
                      await apiCall(`/feature/${fid}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          rules,
                        }),
                      });
                      mutate();
                    }}
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </Button>
                  <DeleteButton
                    className="dropdown-item"
                    displayName="Rule"
                    useIcon={false}
                    text="Delete"
                    onClick={async () => {
                      const rules = [...data.feature.rules];
                      rules.splice(i, 1);
                      await apiCall(`/feature/${fid}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          rules,
                        }),
                      });
                      mutate();
                    }}
                  />
                </MoreMenu>
              </div>
            </div>
          </div>
        );
      })}

      <button
        className="btn btn-primary"
        onClick={() => setRuleModal(data?.feature?.rules?.length || 0)}
      >
        <span className="h4 pr-2 m-0 d-inline-block align-top">
          <GBAddCircle />
        </span>
        Add Rule
      </button>
    </div>
  );
}
