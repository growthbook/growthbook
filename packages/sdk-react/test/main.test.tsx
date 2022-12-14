import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  GrowthBook,
  GrowthBookProvider,
  useExperiment,
  withRunExperiment,
  WithRunExperimentProps,
} from "../src";

const TestedComponent = () => {
  const { value } = useExperiment({
    key: "my-test",
    variations: [0, 1],
  });
  return <h1>{value}</h1>;
};

const TestedClassComponent = withRunExperiment(
  class TestedClassComponent extends React.Component<WithRunExperimentProps> {
    render() {
      const { value } = this.props.runExperiment({
        key: "my-test",
        variations: [0, 1],
      });
      return <h1>{value}</h1>;
    }
  }
);

describe("GrowthBookProvider", () => {
  it("renders without crashing and doesn't add additional html", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    render(
      <GrowthBookProvider growthbook={growthbook}>
        <h1>Hello World</h1>
      </GrowthBookProvider>
    );
    expect(screen.getByText(/Hello World/i)).toBeInTheDocument();
    growthbook.destroy();
  });

  it("runs an experiment with the useExperiment hook", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>
    );
    expect(screen.getByText(/1/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    growthbook.destroy();
  });

  it("works using the withRunExperiment HoC", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedClassComponent />
      </GrowthBookProvider>
    );
    expect(screen.getByText(/1/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    growthbook.destroy();
  });

  it("returns the control when there is no user", () => {
    const growthbook = new GrowthBook({});
    render(
      <GrowthBookProvider growthbook={growthbook}>
        <TestedComponent />
      </GrowthBookProvider>
    );
    expect(screen.getByText(/0/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    growthbook.destroy();
  });

  it("returns the control when there is no growthbook instance", () => {
    render(
      <GrowthBookProvider>
        <TestedComponent />
      </GrowthBookProvider>
    );
    expect(screen.getByText(/0/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
