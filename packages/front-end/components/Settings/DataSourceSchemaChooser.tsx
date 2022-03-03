import { SchemaFormat } from "back-end/types/datasource";
import clsx from "clsx";

const options: { value: SchemaFormat; label: string }[] = [
  {
    value: "segment",
    label: "Segment",
  },
  {
    value: "ga4",
    label: "Google Analytics v4",
  },
  /*
  {
    value: "jitsu",
    label: "Jitsu",
  },
  {
    value: "matomo",
    label: "Matomo",
  },
  {
    value: "rudderstack",
    label: "RudderStack",
  },
  {
    value: "snowplow",
    label: "Snowplow",
  },
  {
    value: "amplitude",
    label: "Amplitude",
  },
  {
    value: "custom",
    label: "Custom",
  },
  */
];

export default function DataSourceSchemaChooser({
  format,
  setValue,
}: {
  format?: SchemaFormat;
  setValue: (format: SchemaFormat) => void;
}) {
  return (
    <div>
      <h4>Database Schema</h4>
      <p>
        GrowthBook has out-of-the-box support for a number of database schemas.
        Choose one below.
      </p>
      <div className="d-flex flex-wrap">
        {options
          .filter((o) => o.value !== "custom")
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
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setValue("custom");
          }}
        >
          None of the above
        </a>
      </p>
    </div>
  );
}
