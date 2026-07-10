interface SegmentedTabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  'aria-label': string;
  className?: string;
}

/** Reusable segmented tab control (Featured/Following, Mine/Created by Me, All/Direct/Groups, ...). */
export default function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  className = '',
  ...rest
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      className={`inline-flex rounded-xl border border-[color:var(--bl-border)] bg-[color:var(--bl-panel)] p-1 ${className}`.trim()}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
            value === option.value
              ? 'bg-teal-600 text-white shadow-sm dark:bg-teal-500 dark:text-slate-950'
              : 'text-[color:var(--bl-text-secondary)] hover:bg-[color:var(--bl-hover)]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
