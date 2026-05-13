interface BrandLogoProps {
  className?: string;
}

export function BrandLogo({ className = 'h-9 w-auto' }: BrandLogoProps) {
  return (
    <img
      src="/logo-small.png"
      alt="VoiceX"
      width={255}
      height={105}
      className={`block ${className}`}
      draggable={false}
    />
  );
}
