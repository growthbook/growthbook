import styles from "./DataSourceDiagram.module.scss";

export default function DataSourceDiagram({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="mb-2">How A/B Test Analysis Works at GrowthBook</h3>
      <ol>
        <li>
          Track events from your app into your data warehouse, just like you
          normally would
        </li>
        <li>
          Connect GrowthBook to your warehouse and define metrics using SQL
        </li>
        <li>
          GrowthBook queries your warehouse and uses a stats engine to analyze
          experiment results
        </li>
      </ol>
      Example:
      <div className="d-flex align-items-center position-relative mt-3">
        <div
          className="appbox mb-0 p-3 d-flex flex-wrap justify-content-center"
          style={{ maxWidth: 325 }}
        >
          <img
            src="/images/3rd-party-logos/datasource-logos/ga4.svg"
            style={{ width: 30 }}
            alt="GA4"
          />
          <div className="col">
            <h5 className="mb-0">Google Analytics v4</h5>
            <strong className="text-muted">Event Tracker</strong>
          </div>
        </div>
        <div className={styles.rightArrow}>
          <span>Events</span>
        </div>
        <div
          className="appbox mb-0  p-3 d-flex flex-wrap justify-content-center"
          style={{ maxWidth: 325 }}
        >
          <img
            src="/images/3rd-party-logos/bigquery.svg"
            style={{ width: 40 }}
            alt="GA4"
          />
          <div className="col">
            <h5 className="mb-0">Big Query</h5>
            <strong className="text-muted">Data Warehouse</strong>
          </div>
        </div>
        <div className={styles.leftArrow}>
          <span>Metric SQL queries</span>
        </div>
        <div
          className="appbox mb-0 p-3 d-flex align-items-center flex-wrap justify-content-center"
          style={{ maxWidth: 325 }}
        >
          <img
            src="/logo/Logo-mark.png"
            style={{ width: 40 }}
            alt="GrowthBook"
          />
          <div className="col">
            <h5 className="mb-0">GrowthBook</h5>
          </div>
        </div>
      </div>
    </div>
  );
}
