interface BlabberLogoProps {
  size?: number;
  className?: string;
}

export default function BlabberLogo({ size = 32, className = '' }: BlabberLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Blabber"
    >
      <rect width="40" height="40" rx="10.5" fill="#050606" />
      <path
        d="M20.9 12.2c7.3 0 13.2 4.28 13.2 9.55s-5.9 9.55-13.2 9.55c-2.42 0-4.68-.47-6.63-1.3-2.38 1.82-5.16 2.84-7.87 2.86-.7 0-1.07-.81-.62-1.36 1.38-1.68 2.34-3.58 2.75-5.46-.55-1.3-.85-2.73-.85-4.29 0-5.27 5.92-9.55 13.22-9.55Z"
        fill="white"
      />
    </svg>
  );
}
