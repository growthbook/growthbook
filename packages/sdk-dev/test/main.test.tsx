import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  GrowthBook,
  GrowthBookProvider,
  useExperiment,
} from "@growthbook/growthbook-react";
import { GrowthBookDev, GrowthBookAutoLoad } from "../src";
import { act } from "@testing-library/react";

const TestedComponent = () => {
  const { value } = useExperiment({
    key: "my-test",
    variations: [0, 1],
  });
  return <h1>{value}</h1>;
};

function sleep(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("GrowthBookProvider", () => {
  it("does not render variation switcher until the useExperiment hook is used", async () => {
    await act(async () => {
      const growthbook = new GrowthBook({ user: { id: "1" } });
      const div = document.createElement("div");
      ReactDOM.render(
        <GrowthBookProvider growthbook={growthbook}>
          <h1>foo</h1>
          <GrowthBookDev />
        </GrowthBookProvider>,
        div
      );
      await sleep(250);
      expect(div.innerHTML).toEqual("<h1>foo</h1>");
      ReactDOM.unmountComponentAtNode(div);
      growthbook.destroy();
    });
  });

  it("renders the variation switcher when useExperiment hook is used", async () => {
    await act(async () => {
      const growthbook = new GrowthBook({ user: { id: "1" } });
      const div = document.createElement("div");

      ReactDOM.render(
        <GrowthBookProvider growthbook={growthbook}>
          <TestedComponent />
          <GrowthBookDev />
        </GrowthBookProvider>,
        div
      );
      await sleep(250);
      const switcher = div.querySelector(".growthbook_dev");
      expect(switcher).toBeTruthy();
      ReactDOM.unmountComponentAtNode(div);

      growthbook.destroy();
    });
  });

  it("renders outside of a GrowthBookProvider context", async () => {
    await act(async () => {
      const growthbook = new GrowthBook({ user: { id: "1" } });
      const div = document.createElement("div");
      ReactDOM.render(
        <>
          <GrowthBookProvider growthbook={growthbook}>
            <TestedComponent />
          </GrowthBookProvider>
          <GrowthBookDev growthbook={growthbook} />
        </>,
        div
      );
      await sleep(250);
      const switcher = div.querySelector(".growthbook_dev");
      expect(switcher).toBeTruthy();
      ReactDOM.unmountComponentAtNode(div);

      growthbook.destroy();
    });
  });

  it("does not render if no GrowthBook object exists", async () => {
    await act(async () => {
      const growthbook = new GrowthBook({ user: { id: "1" } });
      const div = document.createElement("div");
      ReactDOM.render(
        <>
          <GrowthBookProvider growthbook={growthbook}>
            <TestedComponent />
          </GrowthBookProvider>
          <GrowthBookDev />
        </>,
        div
      );
      await sleep(250);
      const switcher = div.querySelector(".growthbook_dev");
      expect(switcher).toBeFalsy();
      ReactDOM.unmountComponentAtNode(div);

      growthbook.destroy();
    });
  });

  it("detects global growthbook object via autoloading", async () => {
    await act(async () => {
      const growthbook = new GrowthBook({ user: { id: "1" } });
      const div = document.createElement("div");
      ReactDOM.render(
        <>
          <GrowthBookProvider growthbook={growthbook}>
            <TestedComponent />
          </GrowthBookProvider>
          <GrowthBookAutoLoad />
        </>,
        div
      );
      await sleep(250);
      const switcher = div.querySelector(".growthbook_dev");
      expect(switcher).toBeTruthy();
      ReactDOM.unmountComponentAtNode(div);

      growthbook.destroy();
    });
  });

  it("re-renders when switching variations", async () => {
    await act(async () => {
      const growthbook = new GrowthBook({ user: { id: "1" } });
      const div = document.createElement("div");
      ReactDOM.render(
        <GrowthBookProvider growthbook={growthbook}>
          <TestedComponent />
          <GrowthBookDev />
        </GrowthBookProvider>,
        div
      );
      await sleep(250);
      expect(div.querySelector("h1")?.innerHTML).toEqual("1");

      // Click to switch to the first variation
      (div.querySelector(
        ".growthbook_dev tr:first-child"
      ) as HTMLElement)?.click();
      await sleep();

      expect(div.querySelector("h1")?.innerHTML).toEqual("0");

      ReactDOM.unmountComponentAtNode(div);
      growthbook.destroy();
    });
  });

  it("starts variation switcher collapsed and expands when clicked", async () => {
    await act(async () => {
      const growthbook = new GrowthBook({ user: { id: "1" } });
      const div = document.createElement("div");

      act(() => {
        ReactDOM.render(
          <GrowthBookProvider growthbook={growthbook}>
            <TestedComponent />
            <GrowthBookDev />
          </GrowthBookProvider>,
          div
        );
      });
      await sleep(250);

      expect(div.querySelector(".growthbook_dev")?.className).not.toMatch(
        /open/
      );

      // Click to expand the variation switcher
      (div.querySelector(".growthbook_dev .toggle") as HTMLElement)?.click();

      expect(div.querySelector(".growthbook_dev")?.className).toMatch(/open/);

      ReactDOM.unmountComponentAtNode(div);
      growthbook.destroy();
    });
  });
});
