import { DataSourceType, SchemaFormat } from "back-end/types/datasource";
import clsx from "clsx";
import { FaArrowRight } from "react-icons/fa";

const options: {
  value: SchemaFormat;
  label: string;
  types?: DataSourceType[];
}[] = [
  {
    value: "segment",
    label: "Segment",
  },
  {
    value: "ga4",
    label: "Google Analytics v4",
    types: ["bigquery"],
  },
  {
    value: "amplitude",
    label: "Amplitude",
    types: ["snowflake"],
  },
  {
    value: "snowplow",
    label: "Snowplow",
  },
  {
    value: "rudderstack",
    label: "RudderStack",
  },
];

export default function DataSourceSchemaChooser({
  format,
  setValue,
  datasource,
}: {
  format?: SchemaFormat;
  setValue: (format: SchemaFormat) => void;
  datasource?: DataSourceType;
}) {
  return (
    <div>
      <div className="alert alert-success mb-4">
        <strong>Connection successful!</strong>
      </div>
      <h4>Database Schema</h4>
      <p>
        GrowthBook has out-of-the-box support for a number of database schemas.
        Choose one below.
      </p>
      <div className="d-flex flex-wrap mb-3">
        {options
          // Some schemas only work with specific data sources
          .filter((o) => !o.types || o.types.includes(datasource))
          .map(({ value, label }) => (
            <a
              href="#"
              key={value}
              onClick={(e) => {
                e.preventDefault();
                setValue(value);
              }}
              className={clsx("btn btn-outline-primary mr-3 mb-3", {
                active: format === value,
              })}
            >
              {label}
            </a>
          ))}
      </div>
      <p>
        Don&apos;t see your schema or use something custom?
        <br />
        <br />
        <a
          href="#"
          className="btn btn-outline-primary"
          onClick={(e) => {
            e.preventDefault();
            setValue("custom");
          }}
        >
          Enter SQL Manually <FaArrowRight />
        </a>
      </p>
    </div>
  );
}
