import React from 'react';

interface LogoProps {
  variant?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

export const FikaBodaLogo: React.FC<LogoProps> = ({
  variant = 'dark',
  size = 'md',
  showTagline = false,
}) => {
  const iconSize = size === 'sm' ? 28 : size === 'lg' ? 40 : 34;
  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';
  const primaryText = variant === 'light' ? 'text-white' : 'text-[#123C32]';
  const secondaryText = variant === 'light' ? 'text-[#D5FF70]' : 'text-[#17231F]';
  const mutedText = variant === 'light' ? 'text-white/70' : 'text-[#77827B]';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="64" height="64" rx="14" fill="#123C32" />
        <path
          d="M14 23H34L30 30H18L14 23Z"
          fill="#D5FF70"
        />
        <path
          d="M17 34H37L43 20H50"
          stroke="#A6E65B"
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="21" cy="45" r="6" stroke="#FFFFFF" strokeWidth="3.8" />
        <circle cx="44" cy="45" r="6" stroke="#D5FF70" strokeWidth="3.8" />
        <path
          d="M27 45H38"
          stroke="#FFFFFF"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
      <div className="leading-none">
        <div className={`font-display font-bold tracking-tight ${textSize}`}>
          <span className={primaryText}>Fika</span>
          <span className={secondaryText}>Boda</span>
        </div>
        {showTagline && (
          <p className={`text-[11px] font-medium tracking-wide mt-0.5 ${mutedText}`}>
            Your Shop. Our Riders. Fika!
          </p>
        )}
      </div>
    </div>
  );
};
