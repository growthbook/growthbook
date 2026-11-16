import { Separator } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";

export default function DataSourceTermsCheckbox({
  value,
  setValue,
}: {
  value: boolean;
  setValue: (value: boolean) => void;
}) {
  return (
    <>
      <Separator size="4" my="5" />
      <Checkbox
        value={value}
        setValue={setValue}
        required
        label={
          <>
            I agree to the{" "}
            <Link href="https://www.growthbook.io/legal" external>
              terms and conditions
            </Link>
          </>
        }
        description="Do not include any sensitive or regulated personal data in your analytics events unless it is properly de-identified in accordance with applicable legal standards."
      />
    </>
  );
}
