import {
  postSdkConnectionValidator,
  putSdkConnectionValidator,
} from "shared/validators";

// The old boolean is still part of the public API. Custom integrations send it,
// and this change must not break them.
describe("sdk-connection savedGroupFormat over the REST API", () => {
  // POST needs the required fields; PUT is a partial of the same shape.
  const required = {
    name: "conn",
    language: "javascript",
    environment: "production",
  };
  const validators = [
    { method: "POST", validator: postSdkConnectionValidator, base: required },
    { method: "PUT", validator: putSdkConnectionValidator, base: {} },
  ];

  validators.forEach(({ method, validator, base }) => {
    describe(method, () => {
      it("accepts the new format", () => {
        (["inline", "referencesV1", "referencesV2"] as const).forEach(
          (savedGroupFormat) => {
            expect(
              validator.bodySchema.safeParse({ ...base, savedGroupFormat })
                .success,
            ).toBe(true);
          },
        );
      });

      it("still accepts the deprecated boolean", () => {
        expect(
          validator.bodySchema.safeParse({
            ...base,
            savedGroupReferencesEnabled: true,
          }).success,
        ).toBe(true);
      });

      it("accepts both together", () => {
        expect(
          validator.bodySchema.safeParse({
            ...base,
            savedGroupFormat: "referencesV2",
            savedGroupReferencesEnabled: true,
          }).success,
        ).toBe(true);
      });

      it("rejects a format that is not one of the three", () => {
        expect(
          validator.bodySchema.safeParse({ ...base, savedGroupFormat: "v2" })
            .success,
        ).toBe(false);
        expect(
          validator.bodySchema.safeParse({ ...base, savedGroupFormat: true })
            .success,
        ).toBe(false);
      });
    });
  });
});
