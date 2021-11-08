import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  GrowthBookProvider,
  GrowthBook,
  useExperiment,
} from "@growthbook/growthbook-react";
import { GrowthBookDev } from "..";

const gb = new GrowthBook({
  user: {
    id: "123",
  },
  trackingCallback: (exp, res) => {
    console.log("track", exp, res);
  },
});

const Headline = () => {
  const { value } = useExperiment({
    key: "headline-copy",
    variations: ["Hello World", "Hola Mundo"],
  });
  return <h1>{value}</h1>;
};

const Button = () => {
  const { value: background } = useExperiment({
    key: "button-color",
    variations: ["red", "green", "blue"],
  });

  return (
    <button
      style={{
        background,
        color: "#fff",
        borderRadius: 5,
        borderWidth: 0,
        padding: "6px 15px",
        cursor: "pointer",
      }}
    >
      Click Me
    </button>
  );
};

const NewFeature = () => {
  const { value } = useExperiment({
    key: "new-feature",
    variations: [false, true],
  });

  if (!value) return null;

  return (
    <div style={{ background: "#ddd", padding: 10, marginBottom: 10 }}>
      This is a shiny new feature!
    </div>
  );
};

const Playground = () => {
  return (
    <>
      <GrowthBookProvider growthbook={gb}>
        <Headline />
        <NewFeature />
        <Button />
        <GrowthBookDev />
      </GrowthBookProvider>
    </>
  );
};

ReactDOM.render(<Playground />, document.getElementById("root"));
