import { forwardRef, type ButtonHTMLAttributes } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — icon-only buttons must always have an accessible name. */
  'aria-label': string;
  active?: boolean;
}

/** Accessible icon-only button with a visible focus ring and quiet hover state. */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { active = false, className = '', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-teal-50 text-teal-700 dark:bg-slate-800 dark:text-white'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
      } ${className}`.trim()}
      {...rest}
    />
  );
});

export default IconButton;
