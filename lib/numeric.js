// Empty form drafts must never silently become an effective zero threshold.
export function numericValue(value) {
  if (value == null || (typeof value === "string" && !value.trim())) return Number.NaN;
  return Number(value);
}
