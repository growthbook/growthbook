import { SchemaFormat } from "back-end/types/datasource";
import React, { useState } from "react";
import { MdKeyboardArrowDown } from "react-icons/md";
import { eventSchema, eventSchemas } from "@/services/eventSchema";
import styles from "./EventSourceList.module.scss";

export interface Props {
  selected?: SchemaFormat;
  onSelect: (schema: eventSchema) => void;
}

export default function EventSourceList({ onSelect, selected }: Props) {
  const [expand, setExpand] = useState(false);

  return (
    <>
      <div
        className="d-flex flex-wrap align-items-stretch align-middle row mb-3"
        style={{
          maxHeight: expand ? 999 : 240,
          overflow: "hidden",
          position: "relative",
          transition: "max-height 0.5s",
        }}
      >
        {eventSchemas.map((s, i) => (
          <div className={`col-4 relative`} key={i + s.value}>
            {s?.beta && (
              <span
                className={`badge badge-purple text-uppercase mr-2 position-absolute`}
                style={{ top: 1, right: 1 }}
              >
                Beta
              </span>
            )}
            <a
              href="#"
              title={s.label}
              onClick={(e) => {
                e.preventDefault();
                onSelect(s);
              }}
              className={`${styles.eventCard} btn btn-light-hover btn-outline-${
                s.value === selected ? "selected" : "primary"
              } mb-3`}
              style={{
                backgroundImage: `url(${s.logo})`,
              }}
            />
          </div>
        ))}
        <div className="my-2">
          <h4>Don&apos;t see yours?</h4>
          <p>
            If your organization doesn&apos;t use one of the event trackers
            listed above, select the <strong>Start from Scratch</strong> option
            below and we&apos;ll guide you through the setup process.
          </p>
        </div>
        <div className={`row`}>
          <div className="col-4">
            <a
              className={`btn btn-light-hover btn-outline-${
                "custom" === schema ? "selected" : "primary"
              } mb-3 py-3`}
              onClick={(e) => {
                e.preventDefault();
                setSchema("custom");
                setDatasource({
                  name: "My Datasource",
                  settings: {},
                  projects: project ? [project] : [],
                });
                // no options for custom:
                form.setValue(`settings.schemaOptions`, {});

                // set to all possible types:
                setPossibleTypes(dataSourceConnections.map((o) => o.type));
                // jump to next step
                setStep(1);
              }}
            >
              <h4>Set up Manually</h4>
              <p className="mb-0 text-dark">
                Manually configure your data schema and analytics queries.
              </p>
            </a>
          </div>
          {importSampleData && (
            <div className="col-4">
              <a
                className={`btn btn-light-hover btn-outline-${
                  "custom" === schema ? "selected" : "primary"
                } mb-3 py-3 ml-auto`}
                onClick={async (e) => {
                  e.preventDefault();
                  await importSampleData("new data source form");
                }}
              >
                <h4>Use Sample Dataset</h4>
                <p className="mb-0 text-dark">
                  Explore GrowthBook with a pre-loaded sample dataset.
                </p>
              </a>
            </div>
          )}
        </div>
        {!expand && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 50,
              textAlign: "center",
              background:
                "linear-gradient(transparent, var(--surface-background-color))",
              cursor: "pointer",
            }}
            className="text-primary"
            onClick={(e) => {
              e.preventDefault();
              setExpand(true);
            }}
          />
        )}
      </div>
      {!expand && (
        <div
          className="text-center mb-3 cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            setExpand(true);
          }}
        >
          <a href="#" className="display-block">
            Show All <MdKeyboardArrowDown />
          </a>
        </div>
      )}
    </>
  );
}
