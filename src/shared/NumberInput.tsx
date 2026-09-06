import { useId, type InputHTMLAttributes } from "react";

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "type"> {
  value: number | "";
}

export function inputNumber(value: string): number | "" {
  return value === "" ? "" : Number(value);
}

export function NumberInput({ value, disabled, min, max, step = "any", ...props }: NumberInputProps) {
  const hintId = useId();
  const error = disabled ? "" : value === "" ? "请输入数值"
    : !Number.isFinite(value) ? "请输入有效数字"
      : min != null && value < Number(min) ? `最小为 ${min}`
        : max != null && value > Number(max) ? `最大为 ${max}`
          : step === "1" && !Number.isInteger(value) ? "请输入整数" : "";
  return <>
    <input {...props} type="number" value={value} disabled={disabled} min={min} max={max} step={step}
      aria-invalid={Boolean(error)} aria-describedby={error ? hintId : undefined} />
    {error ? <span className="field-error" id={hintId}>{error}</span> : null}
  </>;
}
