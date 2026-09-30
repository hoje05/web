const common = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const BoxIcon = () => (
  <svg {...common}>
    <rect x="4" y="6" width="16" height="12" rx="2.5" />
  </svg>
);

export const RouteIcon = () => (
  <svg {...common}>
    <path d="M4 18c3-7 7 1 10-6" />
    <path d="M12.5 7.5 17 6.5l.5 4.6" />
    <path d="M14 12c1-2 2-4 3-5.5" />
  </svg>
);
