import {
  DataSourceType,
  SchemaFormat,
  SchemaOption,
} from "back-end/types/datasource";
import clsx from "clsx";
import { FaArrowRight } from "react-icons/fa";
import { useState } from "react";
import Field from "../Forms/Field";
import { MdKeyboardArrowDown, MdKeyboardArrowUp } from "react-icons/md";

const options: {
  value: SchemaFormat;
  label: string;
  types?: DataSourceType[];
  options?: SchemaOption[];
  logo?: string;
}[] = [
  {
    value: "segment",
    label: "Segment",
    logo: "/images/3rd-party-logos/segment.png",
  },
  {
    value: "ga4",
    label: "Google Analytics v4",
    types: ["bigquery"],
    logo: "/images/3rd-party-logos/ga4.png",
  },
  {
    value: "amplitude",
    label: "Amplitude",
    types: ["snowflake"],
    logo: "/images/3rd-party-logos/amplitude.png",
  },
  {
    value: "matomo",
    label: "Matomo",
    types: ["mysql"],
    logo: "/images/3rd-party-logos/matomo.png",
    options: [
      {
        name: "tablePrefix",
        label: "Table prefix",
        defaultValue: "matomo",
        type: "text",
      },
      {
        name: "siteId",
        label: "Site ID",
        defaultValue: 1,
        type: "number",
      },
      {
        name: "actionPrefix",
        label: "Action Value Prefix",
        defaultValue: "v",
        type: "text",
        helpText: "The prefix to use when setting the event action",
      },
    ],
  },
  {
    value: "snowplow",
    label: "Snowplow",
    logo: "/images/3rd-party-logos/snowplow.png",
  },
  {
    value: "rudderstack",
    label: "RudderStack",
    logo: "/images/3rd-party-logos/rudderstack.png",
  },
];

export default function DataSourceSchemaChooser({
  format,
  setValue,
  datasource,
  setOptionalValues,
}: {
  format?: SchemaFormat;
  setValue: (format: SchemaFormat) => void;
  setOptionalValues?: (name: string, value: string | number) => void;
  datasource?: DataSourceType;
}) {
  const [selectedOptions, setSelectedOptions] = useState(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(null);
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
      <div className="d-flex flex-wrap mb-3 align-items-stretch align-middle">
        {options
          // Some schemas only work with specific data sources
          .filter((o) => !o.types || o.types.includes(datasource))
          .map(({ value, label, options, logo }, i) => (
            <a
              href="#"
              key={value}
              onClick={(e) => {
                e.preventDefault();
                setSelectedOptions(options ?? null);
                if (options) {
                  options.map((o) => {
                    setOptionalValues(o.name, o.defaultValue);
                  });
                } else {
                  setOptionalValues(null, null);
                }
                setValue(value);
              }}
              className={clsx("btn btn-outline-primary mb-3", {
                selected: format === value,
                "ml-auto": i % 2 === 1,
              })}
            >
              <div className="row align-items-center">
                <img
                  src={logo}
                  alt={label}
                  style={{ width: "210px" }}
                  className="px-3 py-2"
                />
              </div>
            </a>
          ))}
      </div>
      {selectedOptions && (
        <div className="form-group mb-4">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowAdvancedOptions(!showAdvancedOptions);
            }}
          >
            <h4>
              Advanced Options{" "}
              {showAdvancedOptions ? (
                <MdKeyboardArrowUp />
              ) : (
                <MdKeyboardArrowDown />
              )}
            </h4>
          </a>
          {showAdvancedOptions && (
            <>
              {selectedOptions.map(
                ({ name, label, defaultValue, type, helpText }) => (
                  <div key={name} className="form-group">
                    <Field
                      label={label}
                      name={name}
                      defaultValue={defaultValue}
                      type={type}
                      onChange={(e) => {
                        setOptionalValues(name, e.target.value);
                      }}
                      helpText={helpText}
                    />
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
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
