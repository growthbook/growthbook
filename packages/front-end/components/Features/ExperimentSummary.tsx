import { ExperimentRule, FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Box, Flex } from "@radix-ui/themes";
import { getVariationColor } from "@/services/features";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import ValueDisplay from "./ValueDisplay";
import ExperimentSplitVisual from "./ExperimentSplitVisual";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ExperimentSummary({
  rule,
  experiment,
  feature,
}: {
  feature: FeatureInterface;
  experiment?: ExperimentInterfaceStringDates;
  rule: ExperimentRule;
}) {
  const { namespace, coverage, values, hashAttribute, trackingKey } = rule;
  const type = feature.valueType;
  const { namespaces: allNamespaces } = useOrgSettings();

  const hasNamespace = namespace && namespace.enabled;
  const namespaceRange = hasNamespace
    ? namespace.range[1] - namespace.range[0]
    : 1;
  const effectiveCoverage = namespaceRange * (coverage ?? 1);

  return (
    <Box>
      <Flex mb="3" gap="3">
        <Box>
          <strong className="font-weight-semibold">SPLIT</strong>
        </Box>
        <Box>
          {" "}
          users by{" "}
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {hashAttribute || ""}
          </span>
          {hasNamespace && (
            <>
              {" "}
              <span>in the namespace </span>
              <span className="mr-1 border px-2 py-1 bg-light rounded">
                {allNamespaces?.find((n) => n.name === namespace.name)?.label ||
                  namespace.name}
              </span>
            </>
          )}
        </Box>
      </Flex>
      <Flex mb="3" gap="3">
        <Box>
          <strong className="font-weight-semibold">INCLUDE</strong>
        </Box>
        <Box>
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {percentFormatter.format(effectiveCoverage)}
          </span>{" "}
          of users in the experiment
          {hasNamespace && (
            <>
              <span> (</span>
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(namespaceRange)}
              </span>{" "}
              of the namespace and{" "}
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(coverage ?? 1)}
              </span>
              <span> exposure)</span>
            </>
          )}
        </Box>
      </Flex>
      <strong className="font-weight-semibold">SERVE</strong>

      <table className="table mt-1 mb-3 bg-light gbtable">
        <tbody>
          {values.map((r, j) => (
            <tr key={j}>
              <td
                className="text-muted position-relative"
                style={{ fontSize: "0.9em", width: 25 }}
              >
                <div
                  style={{
                    width: "6px",
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    backgroundColor: getVariationColor(j, true),
                  }}
                />
                {j}.
              </td>
              <td>
                <ValueDisplay value={r.value} type={type} />
                <ValidateValue value={r.value} feature={feature} />
              </td>
              <td>{r?.name}</td>
              <td>
                <div className="d-flex">
                  <div
                    style={{
                      width: "4em",
                      maxWidth: "4em",
                      margin: "0 0 0 auto",
                    }}
                  >
                    {percentFormatter.format(r.weight)}
                  </div>
                </div>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={4}>
              <ExperimentSplitVisual
                values={values}
                coverage={effectiveCoverage}
                label="Traffic split"
                unallocated="Not included (skips this rule)"
                type={type}
                showValues={false}
                stackLeft={true}
                showPercentages={true}
              />
            </td>
          </tr>
        </tbody>
      </table>
      <Flex gap="3">
        <Box>
          <strong className="font-weight-semibold">TRACK</strong>
        </Box>
        <Box>
          {" "}
          the result using the key{" "}
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {trackingKey || feature.id}
          </span>{" "}
        </Box>
        <Box>
          {experiment ? (
            <Link
              href={`/experiment/${experiment.id}#results`}
              className="btn btn-outline-primary"
            >
              View results
            </Link>
          ) : null}
        </Box>
      </Flex>
    </Box>
  );
}
