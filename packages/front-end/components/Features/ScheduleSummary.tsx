import React from "react";

function DisplayDate({
  label,
  dateString,
}: {
  label: "START DATE" | "END DATE";
  dateString: string;
}) {
  return (
    <div className="row align-items-center">
      <strong className="pr-2">{label}</strong>
      {dateString ? (
        <span>
          {new Date(dateString).toLocaleDateString()} at{" "}
          {new Date(dateString).toLocaleTimeString([], {
            timeStyle: "short",
          })}{" "}
          {new Date(dateString)
            .toLocaleDateString(undefined, {
              day: "2-digit",
              timeZoneName: "short",
            })
            .substring(4)}
        </span>
      ) : (
        <span>No {label.toLocaleLowerCase()}</span>
      )}
    </div>
  );
}

export default function ScheduleSummary({
  startDate,
  endDate,
}: {
  startDate?: string;
  endDate?: string;
}) {
  if (!startDate && !endDate) {
    return null;
  }
  return (
    <div className="col-auto mb-3">
      <DisplayDate label="START DATE" dateString={startDate} />
      <DisplayDate label="END DATE" dateString={endDate} />
    </div>
  );
}
