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

/** 정렬: 흐름 순서대로 놓인 Box들 */
export const ArrangeIcon = () => (
  <svg {...common}>
    <rect x="2.5" y="9.5" width="6" height="5" rx="1.3" />
    <rect x="15.5" y="4" width="6" height="5" rx="1.3" />
    <rect x="15.5" y="15" width="6" height="5" rx="1.3" />
    <path d="M8.5 12c3.5 0 3-5.5 7-5.5" />
    <path d="M8.5 12c3.5 0 3 5.5 7 5.5" />
  </svg>
);

export const RouteIcon = () => (
  <svg {...common}>
    <path d="M4 18c3-7 7 1 10-6" />
    <path d="M12.5 7.5 17 6.5l.5 4.6" />
    <path d="M14 12c1-2 2-4 3-5.5" />
  </svg>
);
