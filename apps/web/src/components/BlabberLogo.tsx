interface BlabberLogoProps {
  size?: number;
  className?: string;
}

/**
 * Official Blabber logo: dark rounded square with a white speech-bubble icon.
 * Matches the brand reference — no external images required.
 */
export default function BlabberLogo({ size = 32, className = '' }: BlabberLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Blabber"
    >
      {/* Background: near-black rounded square */}
      <rect width="32" height="32" rx="8" fill="#0f0f0f" />
      {/* White speech bubble with bottom-left tail */}
      <path
        d="M9 7H23C24.657 7 26 8.343 26 10V18C26 19.657 24.657 21 23 21H16.5L12.5 25.5V21H9C7.343 21 6 19.657 6 18V10C6 8.343 7.343 7 9 7Z"
        fill="white"
      />
    </svg>
  );
}
