import { Flex, Slider } from "@radix-ui/themes";
import React, { useState } from "react";
import { FaDownload, FaExternalLinkAlt } from "react-icons/fa";
import { BsArrowRepeat } from "react-icons/bs";
import { PiInfoFill } from "react-icons/pi";
import HelperText from "@/components/Radix/HelperText";
import Checkbox from "@/components/Radix/Checkbox";
import RadioGroup from "@/components/Radix/RadioGroup";
import Badge from "@/components/Radix/Badge";
import Button, { Size } from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import SelectField from "@/components/Forms/SelectField";
import LinkButton from "@/components/Radix/LinkButton";
import Avatar from "@/components/Radix/Avatar";
import Field from "@/components/Forms/Field";
import {
  Dropdown,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/components/Radix/Dropdown";
import RadioCards from "@/components/Radix/RadioCards";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import DataList from "@/components/Radix/DataList";
import Stepper from "@/components/Stepper/Stepper";

export default function DesignSystemPage() {
  const [checked, setChecked] = useState<"indeterminate" | boolean>(false);
  const [size, setSize] = useState<Size>("md");
  const [buttonLoadError, setButtonLoadError] = useState<string | null>(null);
  const [radioSelected, setRadioSelected] = useState("k1");
  const [radioCardSelected, setRadioCardSelected] = useState("");
  const [radioCardColumns, setRadioCardColumns] = useState<
    "1" | "2" | "3" | "4" | "5" | "6"
  >("1");
  const [sliderVal, setSliderVal] = useState(10);
  const [stepperStep, setStepperStep] = useState(0);

  return (
    <div className="pagecontents container-fluid">
      <h1>GrowthBook Design System</h1>
      <p>
        This page is a work in progress to document the GrowthBook design
        system.
      </p>

      <h2>Components</h2>

      <div className="appbox p-3">
        <h3>Avatar</h3>
        <Flex direction="row" gap="3">
          <Avatar>BF</Avatar>
          <Avatar color="green">
            <PiInfoFill size={25} />
          </Avatar>
          <Avatar size="lg" radius="small">
            <img src="https://app.growthbook.io/logo/growth-book-logomark-white.svg" />
          </Avatar>
          <Avatar color="orange" variant="soft" size="sm">
            sm
          </Avatar>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Badge</h3>
        <Flex direction="column" gap="3">
          <Flex>
            <Badge label="Label" />
          </Flex>
          <Flex>
            <Badge color="indigo" label="Label" />
          </Flex>
          <Flex>
            <Badge color="cyan" label="Label" />
          </Flex>
          <Flex>
            <Badge color="orange" label="Label" />
          </Flex>
          <Flex>
            <Badge color="crimson" label="Label" />
          </Flex>
          <Flex>
            <Badge variant="solid" label="Label" />
          </Flex>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Button</h3>
        <div className="mb-2 w-200px">
          <SelectField
            value={size}
            options={[
              { label: "extra sm", value: "xs" },
              { label: "small", value: "sm" },
              { label: "medium", value: "md" },
              { label: "large", value: "lg" },
            ]}
            sort={false}
            onChange={(v: Size) => setSize(v)}
          />
        </div>
        <Flex direction="row" gap="3" className="my-3">
          <Button size={size}>Primary</Button>
          <Button size={size} aria-label="Aria" variant="outline">
            Aria
          </Button>
          <Button size={size} color="red">
            Danger
          </Button>
          <Button size={size} variant="soft">
            Primary soft
          </Button>
          <Button size={size} color="red" variant="outline">
            Danger outline
          </Button>
          <Button size={size} variant="ghost">
            Primary ghost
          </Button>
          <Button size={size} icon={<FaDownload />}>
            Download
          </Button>
        </Flex>
        <Flex direction="row" gap="3" className="my-3">
          <Button
            size={size}
            icon={<BsArrowRepeat />}
            onClick={async () =>
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          >
            Click to load...
          </Button>
          <div>
            <Button
              size={size}
              color="red"
              variant="outline"
              mb="2"
              icon={<BsArrowRepeat />}
              onClick={async () =>
                await new Promise((resolve, reject) =>
                  setTimeout(() => {
                    if (Math.random() < 0.5) {
                      resolve();
                    } else {
                      reject(new Error("Something went wrong."));
                    }
                  }, 1000)
                )
              }
              setError={setButtonLoadError}
            >
              This might fail...
            </Button>
            {!!buttonLoadError && (
              <HelperText status="error">{buttonLoadError}</HelperText>
            )}
          </div>
        </Flex>
        <b>LinkButton</b>
        <Flex direction="row" gap="3" className="my-3">
          <LinkButton size={size} variant="ghost" href="https://growthbook.io">
            A button link
          </LinkButton>
          <LinkButton
            size={size}
            disabled
            variant="ghost"
            color="red"
            href="https://growthbook.io"
          >
            A disabled link
          </LinkButton>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Callout</h3>
        <Flex direction="column" gap="3">
          <Callout status="info">This is an informational callout.</Callout>
          <Callout status="warning">This is a warning callout.</Callout>
          <Callout status="error">This is an error callout.</Callout>
          <Callout status="success">This is a success callout.</Callout>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Checkbox</h3>
        <Flex direction="column" gap="3">
          <Checkbox
            label="Checkbox Label"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
          />
          <Checkbox
            label="Checkbox With Description"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            description="This is a description"
          />
          <Checkbox
            label="Checkbox in Indeterminate State"
            value={"indeterminate"}
            setValue={(v) => {
              setChecked(v);
            }}
          />
          <Checkbox
            label="Checkbox With Warning (and description)"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            description="This is a description"
            error="This is a warning message"
            errorLevel="warning"
          />
          <Checkbox
            label="Checkbox With Error"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            error="This is an error message"
          />
          <Checkbox
            label="Disabled"
            value={checked}
            setValue={(v) => {
              setChecked(v);
            }}
            disabled
          />
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3 className="mb-4">DataList</h3>
        <DataList
          header="Header"
          columns={4}
          data={[
            { label: "Label 1", value: "Value 1" },
            {
              label: "Label 2",
              value: "A very long value that will wrap to multiple lines",
            },
            {
              label: "With Tooltip",
              value: "Value 3",
              tooltip: "This is a label tooltip",
            },
            {
              label: "Label 4",
              value: (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                >
                  Link Value <FaExternalLinkAlt />
                </a>
              ),
            },
            {
              label: "Label 5",
              value: (
                <>
                  <em>Other</em> value{" "}
                  <span className="text-muted">formatting</span>
                </>
              ),
            },
            { label: "Label 6", value: "Value 6" },
          ]}
        />
      </div>

      <div className="appbox p-3">
        <h3>HelperText</h3>
        <Flex direction="column" gap="3">
          <HelperText status="info">This is an info message</HelperText>
          <HelperText status="warning">This is a warning message</HelperText>
          <HelperText status="error">This is an error message</HelperText>
          <HelperText status="success">This is a success message</HelperText>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Dropdown</h3>
        <Dropdown trigger="Dropdown button">
          <DropdownMenuLabel>Menu Label</DropdownMenuLabel>
          <DropdownSubMenu trigger="Item 1">
            <DropdownMenuItem>Item 1.1</DropdownMenuItem>
          </DropdownSubMenu>
          <DropdownMenuItem
            onClick={function (): void {
              alert("Item 2");
            }}
          >
            Item 2
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Item 3</DropdownMenuItem>
          <DropdownMenuItem> Item 4</DropdownMenuItem>
          <DropdownMenuItem color="red">Item 5</DropdownMenuItem>
        </Dropdown>
      </div>
      <div className="appbox p-3">
        <h3>Radio Card</h3>
        <div className="mb-2 w-100px">
          <SelectField
            label="columns"
            value={radioCardColumns}
            options={[
              { label: "1", value: "1" },
              { label: "2", value: "2" },
              { label: "3", value: "3" },
              { label: "4", value: "4" },
              { label: "5", value: "5" },
              { label: "6", value: "6" },
            ]}
            sort={false}
            onChange={(v: "1" | "2" | "3" | "4" | "5" | "6") =>
              setRadioCardColumns(v)
            }
          />
        </div>
        <RadioCards
          columns={radioCardColumns}
          width={radioCardColumns === "1" ? "400px" : undefined}
          value={radioCardSelected}
          setValue={(v) => {
            setRadioCardSelected(v);
          }}
          options={[
            {
              value: "k1",
              label: "Radio Card 1",
            },
            {
              value: "k2",
              label: "Radio Card 2 with avatar",
              avatar: <Avatar radius="small">BF</Avatar>,
            },
            {
              value: "k3",
              label: "Radio Card 3, with description",
              description: "This is a description",
              avatar: (
                <Avatar radius="small">
                  <img src="https://app.growthbook.io/logo/growth-book-logomark-white.svg" />
                </Avatar>
              ),
            },
            {
              value: "k4",
              label: "Radio Card 4, disabled",
              description: "This is a description",
              disabled: true,
            },
            {
              value: "k5",
              label: "Radio Card 5, long title, long description",
              description:
                "This is a description. It is very long. It should wrap around without changing the width of the parent container.",
            },
            {
              value: "k6",
              label: (
                <PremiumTooltip
                  // @ts-expect-error - fake feature that nobody has
                  commercialFeature="unobtanium"
                  body="This is an expensive popup message"
                  usePortal={true}
                >
                  Premium Card 6
                </PremiumTooltip>
              ),
              description: "You can't afford this",
            },
          ]}
        />
      </div>

      <div className="appbox p-3">
        <h3>Radio Group</h3>
        <RadioGroup
          value={radioSelected}
          setValue={(v) => {
            setRadioSelected(v);
          }}
          options={[
            {
              value: "k1",
              label: "Radio 1",
            },
            {
              value: "k2",
              label: "Radio 2",
            },
            {
              value: "k3",
              label: "Radio 3, with description",
              description: "This is a description",
            },
            {
              value: "k4",
              label: "Progressive disclosure",
              description: "Click to render element",
              renderOnSelect: <Field label="Another field" />,
            },
            {
              value: "k5",
              label: "Radio 4, with error",
              error: "This is an error",
              errorLevel: "error",
            },
            {
              value: "k6",
              label: "Radio 5, with warning",
              error:
                "When making multiple changes at the same time, it can be difficult to control for the impact of each change." +
                "              The risk of introducing experimental bias increases. Proceed with caution.",
              errorLevel: "warning",
            },
            {
              value: "k7",
              label: "Radio 6, disabled",
              description: "This is a description",
              disabled: true,
            },
            {
              value: "k8",
              label: "Radio 7, disabled with error",
              description: "This is a description",
              disabled: true,
              error: "This is an error",
              errorLevel: "error",
            },
          ]}
        />
      </div>

      <div className="appbox p-3">
        <h3>Slider</h3>
        <Flex direction="column" gap="3" maxWidth="300px">
          <div>
            <label>Slider</label>
            <Slider
              value={[sliderVal]}
              min={0}
              max={100}
              step={1}
              onValueChange={(e) => {
                setSliderVal(e[0]);
              }}
            />
            <span className="col-auto" style={{ fontSize: "1.3em" }}>
              {sliderVal}%
            </span>
          </div>
          <div>
            <label>Slider in cyan (high contrast) </label>
            <Slider defaultValue={[35]} color="cyan" highContrast />
          </div>
          <div>
            <label>Slider with no Radius</label>
            <Slider defaultValue={[75]} radius="none" />
          </div>
          <div>
            <label>Range Slider with Soft visual style</label>
            <Slider defaultValue={[25, 75]} variant="soft" />
          </div>
          <div>
            <label>Large Slider Disabled</label>
            <Slider defaultValue={[25]} size="3" disabled={true} />
          </div>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Stepper</h3>
        <Stepper
          step={stepperStep}
          setStep={setStepperStep}
          setError={() => {}}
          steps={[
            { label: "Step 1", enabled: true },
            { label: "Step 2", enabled: true },
            { label: "Step 3", enabled: true },
          ]}
        />
      </div>
    </div>
  );
}
DesignSystemPage.preAuth = true;
DesignSystemPage.preAuthTopNav = true;
