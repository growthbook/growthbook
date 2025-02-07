import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { DailyUsage } from "back-end/types/organization";
import { FaAngleLeft, FaAngleRight } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import Callout from "@/components/Radix/Callout";
import Frame from "@/components/Radix/Frame";
import SelectField from "@/components/Forms/SelectField";
import LoadingOverlay from "@/components/LoadingOverlay";

// Formatter for numbers
const requestsFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
});

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function CloudUsage() {
  const [monthsAgo, setMonthsAgo] = useState(0);

  const { data, error } = useApi<{ cdnUsage: DailyUsage[] }>(
    `/billing/usage?monthsAgo=${monthsAgo}`,
    {
      // This data doesn't change frequently and runs a db query, so don't refresh it
      autoRevalidate: false,
    }
  );

  if (error) {
    return (
      <Callout status="error">
        Failed to get usage data: {error.message}
      </Callout>
    );
  }

  const usage = data?.cdnUsage || [];
  const totalRequests = usage.reduce((sum, u) => sum + u.requests, 0);
  const totalBandwidth = usage.reduce((sum, u) => sum + u.bandwidth, 0);

  const monthOptions: { value: string; label: string }[] = Array.from(
    { length: 12 },
    (_, i) => {
      const date = new Date();
      date.setUTCMonth(date.getUTCMonth() - i);
      const month = date.toLocaleString("default", {
        month: "short",
        timeZone: "UTC",
      });
      const year = date.getUTCFullYear();
      return {
        value: i + "",
        label: `${month} ${year}`,
      };
    }
  );

  return (
    <Frame style={{ position: "relative" }}>
      {!data && <LoadingOverlay />}
      <Flex gap="2" align="center" mb="4">
        <h3 className="mr-4 mb-0">CDN Usage</h3>

        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (monthsAgo >= 11) return;
            setMonthsAgo(monthsAgo + 1);
          }}
          className={monthsAgo >= 11 ? "text-secondary cursor-default" : ""}
        >
          <FaAngleLeft />
        </a>
        <SelectField
          options={monthOptions}
          value={monthsAgo + ""}
          onChange={(value) => setMonthsAgo(parseInt(value))}
          sort={false}
        />
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (monthsAgo <= 0) return;
            setMonthsAgo(monthsAgo - 1);
          }}
          className={monthsAgo <= 0 ? "text-secondary cursor-default" : ""}
        >
          <FaAngleRight />
        </a>
      </Flex>
      <Flex gap="3" align="center">
        <div>
          <strong>Total Requests: </strong>
          <span>{requestsFormatter.format(totalRequests)}</span>
        </div>
        <div>
          <strong>Total Bandwidth: </strong>
          <span>{formatBytes(totalBandwidth)}</span>
        </div>
      </Flex>
    </Frame>
  );
}
