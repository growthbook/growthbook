import styles from "./DataSourceDiagram.module.scss";

export default function DataSourceDiagram({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="mb-2">GrowthBook中A/B测试分析的工作原理</h3>
      <ol>
        <li>
          像往常一样将应用程序中的事件跟踪到数据仓库中。
        </li>
        <li>
          将GrowthBook连接到您的仓库，并使用SQL定义指标。
        </li>
        <li>
          GrowthBook会查询您的仓库，并使用统计引擎来分析实验结果。
        </li>
      </ol>
      示例：
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
            <strong className="text-muted">事件跟踪器</strong>
          </div>
        </div>
        <div className={styles.rightArrow}>
          <span>事件</span>
        </div>
        <div
          className="appbox mb-0 p-3 d-flex flex-wrap justify-content-center"
          style={{ maxWidth: 325 }}
        >
          <img
            src="/images/3rd-party-logos/bigquery.svg"
            style={{ width: 40 }}
            alt="GA4"
          />
          <div className="col">
            <h5 className="mb-0">Big Query</h5>
            <strong className="text-muted">数据仓库</strong>
          </div>
        </div>
        <div className={styles.leftArrow}>
          <span>指标SQL查询</span>
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