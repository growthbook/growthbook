import { Trans } from "@lingui/react/macro";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import useOrgSettings from "@/hooks/useOrgSettings";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";

type Props = {
  disableStickyBucketing: boolean;
  setDisableStickyBucketing: (value: boolean) => void;
  description: string;
} & MarginProps;

export default function StickyBucketingToggle({
  disableStickyBucketing,
  setDisableStickyBucketing,
  description,
  ...marginProps
}: Props) {
  const { stickyBucketingOnByDefault } = useOrgSettings();
  return (
    <Switch
      {...marginProps}
      label={
        <>
          <Text weight="medium" color="text-high">
            <Trans>Sticky Bucketing</Trans>
          </Text>{" "}
          <Text color="text-high">
            {stickyBucketingOnByDefault ? (
              <Trans>(Organization default: Enabled)</Trans>
            ) : (
              <Trans>(Organization default: Disabled)</Trans>
            )}
          </Text>
        </>
      }
      description={description}
      value={!disableStickyBucketing}
      onChange={(v) => setDisableStickyBucketing(!v)}
    />
  );
}
