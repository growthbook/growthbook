import { Flex } from "@radix-ui/themes";
import { useState } from "react";
import { PiInfoFill } from "react-icons/pi";
import HelperText from "@/components/Radix/HelperText";
import Checkbox from "@/components/Radix/Checkbox";
import Badge from "@/components/Radix/Badge";
import Callout from "@/components/Radix/Callout";
import Avatar from "@/components/Radix/Avatar";

export default function DesignSystemPage() {
  const [checked, setChecked] = useState(false);

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
        <h3>Callout</h3>
        <Flex direction="column" gap="3">
          <Callout status="info">This is an informational callout.</Callout>
          <Callout status="warning">This is a warning callout.</Callout>
          <Callout status="error">This is an error callout.</Callout>
          <Callout status="success">This is a success callout.</Callout>
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
    </div>
  );
}
DesignSystemPage.preAuth = true;
DesignSystemPage.preAuthTopNav = true;
