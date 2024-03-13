import { SchemaFormat } from "back-end/types/datasource";
import React from "react";
import { eventSchema, eventSchemas } from "@front-end/services/eventSchema";
import styles from "./EventSourceList.module.scss";

export interface Props {
  selected?: SchemaFormat;
  onSelect: (schema: eventSchema) => void;
}

export default function EventSourceList({ onSelect, selected }: Props) {
  return (
    <>
      <div
        className="d-flex flex-wrap align-items-stretch align-middle row mb-3"
        style={{
          maxHeight: 999,
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
        <div className="d-flex flex-column col-12">
          <div className="my-2">
            <strong style={{ fontSize: "1.2em" }}>
              Don&apos;t see your event tracker?
            </strong>
          </div>
          <div className={`row`}>
            <div className="col-4">
              <a
                className={`btn btn-light-hover btn-outline-primary
               mb-3 py-3`}
                onClick={(e) => {
                  e.preventDefault();
                  onSelect({
                    value: "custom",
                    label: "Custom",
                  });
                }}
              >
                <h4>Use Custom Source</h4>
                <p className="mb-0 text-dark">
                  We&apos;ll guide you through how to manually configure a Data
                  Source.
                </p>
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
