export function formatQuotaValue(
  used: number | undefined,
  max: number | null | undefined,
  unlimitedLabel: string,
  locale?: string,
): string {
  if (typeof used !== "number" || typeof max === "undefined") return "-";
  const number = new Intl.NumberFormat(locale);
  return `${number.format(used)} / ${max === null ? unlimitedLabel : number.format(max)}`;
}

export function formatStorageQuota(
  used: number | undefined,
  max: number | null | undefined,
  unlimitedLabel: string,
  formatBytes: (value: number) => string,
): string {
  if (typeof used !== "number" || typeof max === "undefined") return "-";
  return `${formatBytes(used)} / ${max === null ? unlimitedLabel : formatBytes(max)}`;
}

export function quotaReached(
  used: number | undefined,
  max: number | null | undefined,
): boolean {
  return typeof used === "number" && typeof max === "number" && used >= max;
}

export function quotaExceeded(
  used: number | undefined,
  max: number | null | undefined,
): boolean {
  return typeof used === "number" && typeof max === "number" && used > max;
}
