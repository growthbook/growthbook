import { Box, Flex } from "@radix-ui/themes";
import { PiArrowLeft, PiArrowSquareOut } from "react-icons/pi";
import { CommercialFeature, ProBillingModel } from "shared/enterprise";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

export default function CloudProPricing({
  billingModel,
  onBillingModelChange,
  showBillingModelChoice,
  numOfCurrentMembers,
  commercialFeature,
  onSeeRecentUsage,
  onTalkToSales,
}: {
  billingModel: ProBillingModel;
  onBillingModelChange: (model: ProBillingModel) => void;
  showBillingModelChoice: boolean;
  numOfCurrentMembers: number;
  commercialFeature: CommercialFeature | null;
  onSeeRecentUsage: () => void;
  onTalkToSales: () => void;
}) {
  return (
    <>
      {billingModel === "usage" ? (
        <Box
          className="mb-4"
          style={{
            backgroundColor: "var(--violet-2)",
            padding: "20px 20px 24px 20px",
          }}
        >
          <Flex align="center" justify="between" mb={"1"}>
            <Text size="lg" weight="semibold" color="text-high">
              Base price
            </Text>
            <Text size="lg" weight="semibold" color="text-high">
              $150 / month
            </Text>
          </Flex>
          <Box mb="5">
            <Text size="md">Base fee plus usage</Text>
          </Box>

          <table className="table table-sm border-bottom mb-3">
            <thead>
              <tr>
                <th>Usage Breakdown</th>
                <th>
                  Included <small>(per month)</small>
                </th>
                <th>Additional</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Tracked events{" "}
                  <Tooltip body="A tracked event is an event tracked by our event ingestor via Managed Warehouse or Event Forwarder." />
                </td>
                <td>5 million tracked events</td>
                <td>$50 per million</td>
              </tr>
              <tr style={{ borderBottom: 0 }}>
                <td rowSpan={2}>
                  Global CDN{" "}
                  <Tooltip body="Stream feature flags to users with minimal latency. You also have the option to cache locally to reduce usage and costs." />
                </td>
                <td>2 million requests</td>
                <td>$10 per million</td>
              </tr>
              <tr>
                <td>20GB bandwidth</td>
                <td>$1 per GB</td>
              </tr>
            </tbody>
          </table>
          <p className="mb-0">
            <a
              href="/settings/usage"
              className="text-decoration-none pl-1 link-purple"
              target="_blank"
              rel="noopener noreferrer"
              onClick={onSeeRecentUsage}
            >
              <Text size="sm" weight="semibold">
                See your recent usage{" "}
                <PiArrowSquareOut
                  style={{ position: "relative", top: "-2px" }}
                />
              </Text>
            </a>
          </p>
        </Box>
      ) : (
        <Box
          className="mb-4"
          style={{
            backgroundColor: "var(--violet-2)",
            padding: "20px 20px 24px 20px",
          }}
        >
          <Flex align="center" justify="between" mb={"1"}>
            <Text size="lg" weight="semibold" color="text-high">
              Base price
            </Text>
            <Text size="lg" weight="semibold" color="text-high">
              ${numOfCurrentMembers * 40} / month
            </Text>
          </Flex>
          <Box mb="5">
            <Text size="md">
              $40 per seat per month, {numOfCurrentMembers} current seat
              {numOfCurrentMembers > 1 ? "s" : ""}
            </Text>
          </Box>

          <table className="table table-sm border-bottom mb-3">
            <thead>
              <tr>
                <th>Usage Breakdown</th>
                <th>
                  Included <small>(per month)</small>
                </th>
                <th>Additional</th>
              </tr>
            </thead>
            <tbody>
              {commercialFeature === "unlimited-managed-warehouse-usage" && (
                <tr>
                  <td>
                    Managed Warehouse{" "}
                    <Tooltip
                      body={
                        <>
                          <div className="mb-2">
                            Use our fully-managed data warehouse and event
                            pipeline.
                          </div>
                          <div>
                            OR bring your own for free (no usage charges).
                          </div>
                        </>
                      }
                    />
                  </td>
                  <td>2 million tracked events</td>
                  <td>$0.03 per thousand</td>
                </tr>
              )}
              <tr style={{ borderBottom: 0 }}>
                <td rowSpan={2}>
                  Global CDN{" "}
                  <Tooltip body="Stream feature flags to users with minimal latency. You also have the option to cache locally to reduce usage and costs." />
                </td>
                <td>2 million requests</td>
                <td>$10 per million</td>
              </tr>
              <tr>
                <td>20GB bandwidth</td>
                <td>$1 per GB</td>
              </tr>
            </tbody>
          </table>
          <p className="mb-0">
            <a
              href="/settings/usage"
              className="text-decoration-none pl-1 link-purple"
              target="_blank"
              rel="noopener noreferrer"
              onClick={onSeeRecentUsage}
            >
              <Text size="sm" weight="semibold">
                See your recent usage{" "}
                <PiArrowSquareOut
                  style={{ position: "relative", top: "-2px" }}
                />
              </Text>
            </a>
          </p>
        </Box>
      )}
      <Callout status="info">
        Interested in an Enterprise Plan with volume discounts?
        <a
          href="https://www.growthbook.io/demo"
          className="text-decoration-none pl-1"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onTalkToSales}
        >
          <strong className="a link-purple">
            Talk to Sales{" "}
            <PiArrowSquareOut
              style={{ position: "relative", top: "-2px" }}
            />{" "}
          </strong>
        </a>
      </Callout>
      {showBillingModelChoice ? (
        <Flex justify="center" mt="4" width="100%">
          <Link
            color="gray"
            onClick={() =>
              onBillingModelChange(billingModel === "usage" ? "seats" : "usage")
            }
          >
            {billingModel === "usage" ? (
              <>
                <PiArrowLeft /> Switch to seat-based pricing
              </>
            ) : (
              <>
                <PiArrowLeft /> Switch to our new, usage-based pricing
              </>
            )}
          </Link>
        </Flex>
      ) : null}
    </>
  );
}
