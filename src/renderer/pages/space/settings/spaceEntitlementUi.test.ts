import { describe, expect, it } from "vitest";

import {
  formatQuotaValue,
  formatStorageQuota,
  quotaExceeded,
  quotaReached,
} from "./spaceEntitlementUi";

describe("Space entitlement presentation", () => {
  it("renders null as an explicit unlimited limit with localized usage", () => {
    expect(formatQuotaValue(2_342_342, null, "不限制", "zh-CN")).toBe(
      "2,342,342 / 不限制",
    );
    expect(
      formatStorageQuota(1_024, null, "Unlimited", (value) => `${value} B`),
    ).toBe("1024 B / Unlimited");
  });

  it("keeps missing limits distinct from unlimited limits", () => {
    expect(formatQuotaValue(5, undefined, "Unlimited", "en-US")).toBe("-");
    expect(formatQuotaValue(undefined, null, "Unlimited", "en-US")).toBe("-");
  });

  it("never blocks or marks overage for an unlimited resource", () => {
    expect(quotaReached(10_000_000, null)).toBe(false);
    expect(quotaExceeded(10_000_000, null)).toBe(false);
    expect(quotaReached(20, 20)).toBe(true);
    expect(quotaExceeded(21, 20)).toBe(true);
  });
});
