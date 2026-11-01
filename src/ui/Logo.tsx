/** Pixie peering out of a glass box: the Glassbox Studio mark. */
export function Logo({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} shapeRendering="geometricPrecision">
      {title ? <title>{title}</title> : null}
      <path d="M6 9 L12 4 H28 L22 9 Z" fill="var(--glass)" fillOpacity="0.35" stroke="var(--glass)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M22 9 L28 4 V22 L22 27 Z" fill="var(--glass)" fillOpacity="0.18" stroke="var(--glass)" strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="6" y="9" width="16" height="18" rx="1.5" fill="#d97757" stroke="var(--glass)" strokeWidth="1.2" />
      <rect x="9.2" y="13.5" width="3.2" height="4.2" fill="#2b2a27" />
      <rect x="15.6" y="13.5" width="3.2" height="4.2" fill="#2b2a27" />
      <rect x="10.8" y="14" width="1.1" height="1.1" fill="#f7f4ec" />
      <rect x="17.2" y="14" width="1.1" height="1.1" fill="#f7f4ec" />
      <rect x="12.6" y="21.4" width="2.8" height="1.1" fill="#b85d40" />
    </svg>
  );
}
