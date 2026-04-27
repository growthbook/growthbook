import { ReactNode } from "react";
import { FeatureValueType } from "shared/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Button from "@/ui/Button";
import OpenVisualEditorLink from "@/components/OpenVisualEditorLink";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Avatar from "@/ui/Avatar";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import { ICON_PROPERTIES } from "./constants";

type Props = {
  changeType: "flag" | "visual" | "redirect";
  feature?: { id: string; valueType: FeatureValueType };
  additionalBadge?: ReactNode;
  changes?: string[];
  vc?: VisualChangesetInterface;
  experiment?: ExperimentInterfaceStringDates;
  children?: ReactNode;
  heading: string;
  headingLink?: string;
  onEdit?: () => void;
  onDelete?: () => void | Promise<void>;
  canEdit?: boolean;
};

const joinWithOxfordComma = (array) => {
  if (array.length <= 1) {
    return array.join("");
  } else if (array.length === 2) {
    return array.join(" and ");
  } else {
    const allButLast = array.slice(0, -1).join(", ");
    const last = array.slice(-1);
    return `${allButLast}, and ${last}`;
  }
};

const CHANGE_TYPE_TO_ICON_TYPE = {
  flag: "feature-flag",
  visual: "visual-editor",
  redirect: "redirects",
};

const CHANGE_TO_DELETE_DISPLAY_NAME = {
  flag: "Feature Flag",
  visual: "Visual Changes",
  redirect: "URL Redirect",
};

export default function LinkedChange({
  changeType,
  feature,
  changes,
  vc,
  experiment,
  canEdit = false,
  additionalBadge,
  children,
  heading,
  headingLink,
  onDelete,
  onEdit,
}: Props) {
  const { component: Icon, radixColor } =
    ICON_PROPERTIES[CHANGE_TYPE_TO_ICON_TYPE[changeType]];

  return (
    <Box className="my-3" p="1">
      <Box>
        <Flex gap="3" justify="between">
          <Flex gap="3" align="center">
            <Avatar radius="small" color={radixColor} size="md" variant="soft">
              <Icon />
            </Avatar>
            {changeType === "flag" ? (
              <Link href={`/features/${feature?.id}`}>
                <Heading as="h4" size="small" weight="medium" mb="0">
                  {heading}
                  <PiArrowSquareOut className="ml-2" />
                </Heading>
              </Link>
            ) : headingLink ? (
              <Link href={headingLink}>
                <Heading as="h4" size="small" weight="medium" mb="0">
                  {heading}
                  <PiArrowSquareOut className="ml-2" />
                </Heading>
              </Link>
            ) : (
              <Heading as="h4" size="small" weight="medium" mb="0">
                {heading}
              </Heading>
            )}
            {additionalBadge && <Box>{additionalBadge}</Box>}
            {changeType === "visual" && (
              <>
                <Box>&middot;</Box>
                <Text color="text-low">
                  {(changes?.length || 0) > 0
                    ? joinWithOxfordComma(changes) + " changes"
                    : "no changes"}
                </Text>
              </>
            )}
          </Flex>
          {canEdit && (
            <Box>
              {onDelete && (
                <DeleteButton
                  className="btn-sm ml-4"
                  useRadix={true}
                  text="Remove"
                  stopPropagation={true}
                  onClick={() => onDelete()}
                  displayName={CHANGE_TO_DELETE_DISPLAY_NAME[changeType]}
                />
              )}
              {onEdit && (
                <Button variant="ghost" onClick={() => onEdit()}>
                  Edit
                </Button>
              )}
              {vc && experiment?.status === "draft" && (
                <OpenVisualEditorLink
                  visualChangeset={vc}
                  useLink={true}
                  button={<Button variant="ghost">Launch Visual Editor</Button>}
                />
              )}
            </Box>
          )}
        </Flex>
      </Box>
      <Box mt="4">{children}</Box>
    </Box>
  );
}
