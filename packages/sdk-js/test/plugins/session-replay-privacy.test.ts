import { buildRrwebPrivacyOptions } from "../../src/plugins/session-replay/privacy";
import {
  GB_BLOCK_CLASS,
  GB_IGNORE_CLASS,
  GB_MASK_CLASS,
} from "../../src/plugins/utils/privacy";

describe("session replay privacy options", () => {
  it("uses deny-by-default input masking and GrowthBook privacy selectors", () => {
    const options = buildRrwebPrivacyOptions();
    const el = document.createElement("input");

    expect(options).toEqual(
      expect.objectContaining({
        blockClass: GB_BLOCK_CLASS,
        blockSelector: "[data-gb-block], .gb-block",
        maskTextClass: GB_MASK_CLASS,
        maskTextSelector: "[data-gb-mask], .gb-mask",
        ignoreClass: GB_IGNORE_CLASS,
        ignoreSelector: "[data-gb-ignore], .gb-ignore",
        maskAllInputs: true,
      }),
    );
    expect(options.maskInputFn?.("secret", el)).toBe("******");
    expect(options.maskTextFn?.("private", el)).toBe("*******");
  });

  it("composes customer selectors and options with GrowthBook defaults", () => {
    const errorHandler = jest.fn();
    const maskInputOptions = { email: true, password: true };
    const options = buildRrwebPrivacyOptions({
      maskAllInputs: false,
      maskInputOptions,
      blockSelector: ".customer-block",
      maskTextSelector: ".customer-mask",
      ignoreSelector: ".customer-ignore",
      errorHandler,
    });

    expect(options).toEqual(
      expect.objectContaining({
        blockSelector: "[data-gb-block], .gb-block, .customer-block",
        maskTextSelector: "[data-gb-mask], .gb-mask, .customer-mask",
        ignoreSelector: "[data-gb-ignore], .gb-ignore, .customer-ignore",
        maskAllInputs: false,
        maskInputOptions,
        errorHandler,
      }),
    );
  });

  it("wraps custom mask functions but bypasses masking inside gb-allow", () => {
    document.body.innerHTML = `
      <div>
        <input id="masked" />
        <div data-gb-allow>
          <input id="allowed-attr" />
        </div>
        <div class="gb-allow">
          <input id="allowed-class" />
        </div>
        <div class="customer-allow">
          <input id="allowed-custom" />
        </div>
      </div>
    `;

    const userInputMask = jest.fn((text: string) => `input:${text}`);
    const userTextMask = jest.fn((text: string) => `text:${text}`);
    const options = buildRrwebPrivacyOptions({
      maskInputFn: userInputMask,
      maskTextFn: userTextMask,
      allowSelector: ".customer-allow",
    });

    const el = (id: string) => document.getElementById(id) as HTMLElement;

    expect(options.maskInputFn?.("secret", el("masked"))).toBe("input:secret");
    expect(options.maskTextFn?.("private", el("masked"))).toBe("text:private");
    expect(options.maskInputFn?.("safe", el("allowed-attr"))).toBe("safe");
    expect(options.maskTextFn?.("visible", el("allowed-class"))).toBe(
      "visible",
    );
    expect(options.maskInputFn?.("custom", el("allowed-custom"))).toBe(
      "custom",
    );
    expect(userInputMask).toHaveBeenCalledTimes(1);
    expect(userTextMask).toHaveBeenCalledTimes(1);
  });
});
