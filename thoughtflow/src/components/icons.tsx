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

export const CorrectIcon = () => (
  <svg {...common}>
    <path d="M3 9c1.2-1.6 2.2 1.6 3.4 0s2.2 1.6 3.4 0 2.2 1.6 3.4 0" strokeWidth={1.4} opacity={0.55} />
    <path d="M3 16c4-3.2 8-3.2 12 0s4.5 1.2 6-.8" />
  </svg>
);
