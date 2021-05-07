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
        <h5>New presentation successfully saved</h5>
        <p></p>
      </div>
    </>
  );
}
