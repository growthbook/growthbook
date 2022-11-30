import React from "react";

// function DisplayDate({
//   label,
//   dateString,
// }: {
//   label: "START DATE" | "END DATE";
//   dateString: string;
// }) {
//   return (
//     <div className="row align-items-center">
//       <strong className="pr-2">{label}</strong>
//       {dateString ? (
//         <span>
//           {new Date(dateString).toLocaleDateString()} at{" "}
//           {new Date(dateString).toLocaleTimeString([], {
//             timeStyle: "short",
//           })}{" "}
//           {new Date(dateString)
//             .toLocaleDateString(undefined, {
//               day: "2-digit",
//               timeZoneName: "short",
//             })
//             .substring(4)}
//         </span>
//       ) : (
//         <span>No {label.toLocaleLowerCase()}</span>
//       )}
//     </div>
//   );
// }

export default function ScheduleSummary({
  hasConditions,
  startDate,
  endDate,
}: {
  hasConditions: boolean;
  startDate?: string;
  endDate?: string;
}) {
  if (!startDate && !endDate) {
    return null;
  }
  return (
    // <div className="col-auto mb-3">
    //   <DisplayDate label="START DATE" dateString={startDate} />
    //   <DisplayDate label="END DATE" dateString={endDate} />
    // </div>
    <div className="col-auto mb-3">
      <div className="row">
        <strong className="pr-2">{hasConditions ? "AND" : "IF"}</strong>
        {startDate && (
          <>
            <span className="mr-1 border px-2 bg-light rounded">
              current date/time
            </span>
            <span className="pr-1">is after</span>
            <span className="mr-1 border px-2 bg-light rounded">
              {new Date(startDate).toLocaleDateString()} at{" "}
              {new Date(startDate).toLocaleTimeString([], {
                timeStyle: "short",
              })}{" "}
              {new Date(startDate)
                .toLocaleDateString(undefined, {
                  day: "2-digit",
                  timeZoneName: "short",
                })
                .substring(4)}
            </span>
          </>
        )}
        {startDate && endDate && <span className="pl-2 pr-2">AND</span>}
        {endDate && (
          <>
            <span className="mr-1 border px-2 bg-light rounded">
              current date/time
            </span>
            <span className="pr-1">is before</span>
            <span className="mr-1 border px-2 bg-light rounded">
              {new Date(endDate).toLocaleDateString()} at{" "}
              {new Date(endDate).toLocaleTimeString([], {
                timeStyle: "short",
              })}{" "}
              {new Date(endDate)
                .toLocaleDateString(undefined, {
                  day: "2-digit",
                  timeZoneName: "short",
                })
                .substring(4)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
