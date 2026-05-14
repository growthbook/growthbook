import { DataSourceType, SchemaFormat } from "shared/types/datasource";
import clsx from "clsx";
import { FaArrowRight } from "react-icons/fa";
import { useState } from "react";
import { MdKeyboardArrowDown, MdKeyboardArrowUp } from "react-icons/md";
import { eventSchemas } from "@/services/eventSchema";
import Field from "@/components/Forms/Field";

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
        {eventSchemas
          // Some schemas only work with specific data sources
          // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'DataSourceType | undefined' is n... Remove this comment to see the full error message
          .filter((o) => !o.types || o.types.includes(datasource))
          .map(({ value, label, options, logo }, i) => (
            <div
              key={value}
              style={{
                minWidth: "50%",
                paddingRight: `${i % 2 === 0 ? "20px" : "0px"}`,
              }}
            >
              <a
                href="#"
                title={label}
                onClick={(e) => {
                  e.preventDefault();
                  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'SchemaOption[] | null' is not as... Remove this comment to see the full error message
                  setSelectedOptions(options ?? null);
                  if (options) {
                    options.map((o) => {
                      // @ts-expect-error TS(2722) If you come across this, please fix it!: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
                      setOptionalValues(o.name, o.defaultValue);
                    });
                  } else {
                    // @ts-expect-error TS(2722) If you come across this, please fix it!: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
                    setOptionalValues(null, null);
                  }
                  setValue(value);
                }}
                className={clsx("btn btn-outline-primary mb-3", {
                  selected: format === value,
                  "ml-auto": i % 2 === 1,
                })}
                style={{
                  minHeight: "75px",
                  minWidth: "100%",
                  backgroundImage: `url(${logo})`,
                  backgroundSize: "85%",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "center center",
                }}
              />
            </div>
          ))}
      </div>
      {selectedOptions && (
        <div className="form-group mb-4">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'true' is not assignable to param... Remove this comment to see the full error message
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
              {/* @ts-expect-error TS(2339) If you come across this, please fix it!: Property 'map' does not exist on type 'never'. */}
              {selectedOptions.map(
                ({ name, label, defaultValue, type, helpText }) => (
                  <div key={name} className="form-group">
                    <Field
                      label={label}
                      name={name}
                      defaultValue={defaultValue}
                      type={type}
                      onChange={(e) => {
                        // @ts-expect-error TS(2722) If you come across this, please fix it!: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
                        setOptionalValues(name, e.target.value);
                      }}
                      helpText={helpText}
                    />
                  </div>
                ),
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
