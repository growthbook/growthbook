import { AspectRatio, Box, Text } from "@radix-ui/themes";
import { CommercialFeature } from "shared/enterprise";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { DocSection, DocLink } from "@/components/DocLink";
import Link from "@/ui/Link";
import styles from "./AdvancedFeaturesCard.module.scss";

type AdvancedFeaturesCardProps = (
  | { docSection: DocSection; href?: never }
  | { docSection?: never; href: string }
) & {
  imgUrl: string;
  title: string;
  description?: string;
  commercialFeature?: CommercialFeature;
};

export default function AdvancedFeaturesCard({
  docSection,
  href,
  imgUrl,
  title,
  description,
  commercialFeature,
}: AdvancedFeaturesCardProps) {
  const card = (
    <div
      className={styles.card}
      style={
        {
          "--bg-advanced-features-card-image": `url("${imgUrl}")`,
        } as React.CSSProperties
      }
    >
      <div className={styles.cardContent}>
        {commercialFeature && (
          <Box className={styles.badgeContainer}>
            <PaidFeatureBadge
              commercialFeature={commercialFeature}
              variant="solid"
            />
          </Box>
        )}
        {title && (
          <Text size="1" weight="medium" className={styles.cardTitle} as="div">
            {title}
          </Text>
        )}
        {description && (
          <Text size="1" weight="medium" className={styles.cardSubtitle}>
            {description}
          </Text>
        )}
      </div>
    </div>
  );

  return (
    <Box width="100%" height="100%">
      <AspectRatio ratio={16 / 9}>
        {docSection ? (
          <DocLink docSection={docSection}>{card}</DocLink>
        ) : (
          <Link href={href}>{card}</Link>
        )}
      </AspectRatio>
    </Box>
  );
}
