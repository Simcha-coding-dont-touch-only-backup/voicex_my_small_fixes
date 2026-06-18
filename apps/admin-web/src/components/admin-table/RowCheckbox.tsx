export function RowCheckbox({
  checked,
  disabled = false,
  onChange,
  ariaLabel = 'Select row',
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  ariaLabel?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={ariaLabel}
    />
  );
}
