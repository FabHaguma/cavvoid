import React from "react";

export function Icon({ name, size = 22, ...props }) {
  const paths = {
    void: (
      <>
        <circle cx="12" cy="12" r="7" />
        <ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-35 12 12)" />
      </>
    ),
    kept: (
      <>
        <path d="M7 3h10v18l-5-3-5 3z" />
      </>
    ),
    settings: (
      <>
        <path
          d="m9 3-.7 2.1-2.2.5-1.7-1.1-2 3.5 1.5 1.5-.1 2.3-1.7 1.2 2 3.5 2.1-.5 1.9 1.3.2 2.2h4l.7-2.1 2.2-.5 1.7 1.1 2-3.5-1.5-1.5.1-2.3 1.7-1.2-2-3.5-2.1.5-1.9-1.3L13 3z"
          transform="translate(1 1) scale(.95)"
        />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V4H4v12h4" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
      </>
    ),
    link: (
      <>
        <path
          d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"
          transform="translate(2 0) scale(.85)"
        />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-14-5L3 9M3 4v5h5M4 13a8 8 0 0 0 14 5l3-3M21 20v-5h-5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M7 17 17 7M7 7h10v10" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </>
    ),
    text: (
      <>
        <path d="M5 5h14M12 5v14M8 19h8" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H6v18h13V8zM14 3v6h5M9 14h6M9 17h4" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    devices: (
      <>
        <rect x="2" y="4" width="14" height="11" rx="2" />
        <path d="M5 19h8M9 15v4" />
        <rect x="16" y="9" width="6" height="12" rx="1.5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
