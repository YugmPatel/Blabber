import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

interface BrandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';

const variants: Record<Variant, string> = {
  primary:
    'text-white bg-teal-600 hover:bg-teal-700 focus-visible:ring-teal-400 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400 dark:focus-visible:ring-teal-300',
  secondary:
    'border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-teal-300 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
  ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-teal-300 dark:text-slate-300 dark:hover:bg-slate-800',
};

/** The app's single reusable button — primary (brand gradient in dark mode), secondary, or ghost. */
const BrandButton = forwardRef<HTMLButtonElement, BrandButtonProps>(function BrandButton(
  { variant = 'primary', className = '', ...rest },
  ref
) {
  return <button ref={ref} type="button" className={`${base} px-4 py-2 ${variants[variant]} ${className}`.trim()} {...rest} />;
});

export default BrandButton;
