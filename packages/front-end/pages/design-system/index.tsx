import { Flex } from "@radix-ui/themes";
import React, { useState } from "react";
import { FaDownload } from "react-icons/fa";
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

export default function DesignSystemPage() {
  const [checked, setChecked] = useState(false);
  const [size, setSize] = useState<Size>("md");
  const [buttonLoadError, setButtonLoadError] = useState<string | null>(null);
  const [radioSelected, setRadioSelected] = useState("k1");

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
          <Button size={size} aria-label="Aria">
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
        <h3>HelperText</h3>
        <Flex direction="column" gap="3">
          <HelperText status="info">This is an info message</HelperText>
          <HelperText status="warning">This is a warning message</HelperText>
          <HelperText status="error">This is an error message</HelperText>
          <HelperText status="success">This is a success message</HelperText>
        </Flex>
      </div>

      <div className="appbox p-3">
        <h3>Radio Group</h3>
        <Flex direction="column" gap="3">
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
                label: "Radio 4, with error",
                error: "This is an error",
                errorLevel: "error",
              },
              {
                value: "k5",
                label: "Radio 5, with warning",
                error: "This is a warning",
                errorLevel: "warning",
              },
              {
                value: "k6",
                label: "Radio 6, disabled",
                description: "This is a description",
                disabled: true,
              },
              {
                value: "k7",
                label: "Radio 7, disabled with error",
                description: "This is a description",
                disabled: true,
                error: "This is an error",
                errorLevel: "error",
              },
            ]}
          />
        </Flex>
      </div>
    </div>
  );
}
DesignSystemPage.preAuth = true;
DesignSystemPage.preAuthTopNav = true;
