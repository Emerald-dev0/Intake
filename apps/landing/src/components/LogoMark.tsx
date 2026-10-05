export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="currentColor" opacity="0.08" />
      <circle cx="32" cy="19" r="7" fill="#ff5a1f" />
      <rect x="18" y="32" width="28" height="7" rx="3.5" fill="currentColor" />
      <rect x="18" y="44" width="18" height="7" rx="3.5" fill="currentColor" opacity=".45" />
    </svg>
  );
}
