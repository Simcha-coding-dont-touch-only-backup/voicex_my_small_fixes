interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className = 'h-9 w-auto' }: BrandLogoProps) {
  return (
    <img
      src="/logo.webp"
      alt="VoiceX"
      width={903}
      height={350}
      className={`block ${className}`}
      draggable={false}
    />
  );
}
