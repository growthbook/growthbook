import { FC, Fragment, HTMLProps } from "react";
import { MetricType } from "shared/types/metric";

const GoogleAnalyticsMetrics: FC<{
  type: MetricType;
  inputProps: HTMLProps<HTMLSelectElement>;
}> = ({ type, inputProps }) => {
  return (
    <div className="form-group">
      GA Metric
      <select required className="form-control" {...inputProps}>
        <option value="">Choose...</option>
        {type === "binomial" && (
          <>
            <option value="ga:bounceRate">Bounce Rate</option>
            {new Array(20).fill(1).map((_, i) => (
              <Fragment key={"goal" + i}>
                <option value={`ga:goal${i + 1}Starts`}>
                  Goal {i + 1} Starts
                </option>
                <option value={`ga:goal${i + 1}Completions`}>
                  Goal {i + 1} Completions
                </option>
              </Fragment>
            ))}
          </>
        )}
        {type === "count" && (
          <>
            <option value="ga:adsenseAdsViewed">AdSense Impressions</option>
            <option value="ga:adsenseAdsClicks">AdSense Clicks</option>
            <option value="ga:adsenseRevenue">AdSense Revenue</option>
            <option value="ga:impressions">Adwords Impressions</option>
            <option value="ga:adClicks">Adwords Clicks</option>
            <option value="ga:pageviews">Page Views</option>
            <option value="ga:uniquePageviews">Page Views (Unique)</option>
            <option value="ga:productCheckouts">Product Checkouts</option>
            <option value="ga:searchUniques">Searches (Unique)</option>
            <option value="ga:sessions">Sessions</option>
            <option value="ga:goalValueAll">Total Goal Value</option>
            <option value="ga:transactions">Transactions</option>
            <option value="ga:transactionRevenue">Transaction Revenue</option>
          </>
        )}
        {type === "duration" && (
          <>
            <option value="ga:avgPageLoadTime">Page Load Time</option>
            <option value="ga:avgSessionDuration">Session Duration</option>
            <option value="ga:avgTimeOnPage">Time on Page</option>
          </>
        )}
      </select>
    </div>
  );
};

export default GoogleAnalyticsMetrics;
