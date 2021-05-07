import React from "react";

export default function Finished({
  showForm,
}: {
  showForm: boolean;
}): React.ReactElement {
  if (!showForm) return <></>;

  return (
    <>
      <div>
        <h5>Presentation successfully updated</h5>
        <p></p>
      </div>
    </>
  );
}
