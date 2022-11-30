import React, { useEffect, useState } from "react";
import { UseFormReturn } from "react-hook-form";

const getLocalDateTime = (rawDateTime: string) => {
  if (!rawDateTime) {
    return "";
  }
  const utcDateTime = new Date(rawDateTime);

  // We need to adjust for timezone/daylight savings time before converting to ISO String to pass into datetime-local field
  utcDateTime.setHours(
    utcDateTime.getHours() - new Date(rawDateTime).getTimezoneOffset() / 60
  );
  return utcDateTime.toISOString().substring(0, 16);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ScheduleInputs({ form }: { form: UseFormReturn<any> }) {
  const validAfter = getLocalDateTime(form.watch("validAfter"));
  const validBefore = getLocalDateTime(form.watch("validBefore"));

  const [showInputs, setShowInputs] = useState(() => {
    return !!validAfter || !!validBefore;
  });

  useEffect(() => {
    if (!validBefore && !validAfter) {
      setShowInputs(false);
    }
  }, [validAfter, validBefore, form]);

  return (
    <div>
      <label className="mb-0">Scheduling Conditions (optional)</label>
      {!showInputs ? (
        <div className="m-2">
          <em className="text-muted mr-3">Applied everyday by default.</em>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setShowInputs(true);
            }}
          >
            Add scheduling conditions
          </a>
        </div>
      ) : (
        <div className="bg-light p-3 border mt-2 mb-2">
          <div className="pb-2">
            <span className="pr-2">Start Date</span>
            <input
              type="datetime-local"
              value={validAfter || ""}
              onChange={(e) => form.setValue("validAfter", e.target.value)}
            />
            {validAfter && (
              <>
                <span
                  className="pl-2 pr-2 font-italic font-weight-light"
                  style={{ fontSize: "12px" }}
                >
                  Time displayed in{" "}
                  {new Date(validAfter)
                    .toLocaleDateString(undefined, {
                      day: "2-digit",
                      timeZoneName: "short",
                    })
                    .substring(4)}
                </span>
                <button
                  className="btn btn-link text-danger"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    form.setValue("validAfter", null);
                  }}
                >
                  {" "}
                  remove
                </button>
              </>
            )}
          </div>
          <div>
            <span className="pr-2">End Date</span>
            <input
              type="datetime-local"
              value={validBefore || ""}
              onChange={(e) => form.setValue("validBefore", e.target.value)}
            />
            {validBefore && (
              <>
                <span
                  className="pl-2 pr-2 font-italic font-weight-light"
                  style={{ fontSize: "12px" }}
                >
                  Time displayed in{" "}
                  {new Date(validBefore)
                    .toLocaleDateString(undefined, {
                      day: "2-digit",
                      timeZoneName: "short",
                    })
                    .substring(4)}
                </span>
                <button
                  className="btn btn-link text-danger"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    form.setValue("validBefore", null);
                  }}
                >
                  remove
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
