/**
 * The UI icons: 24×24 strokes in the text color. Each one
 * keeps the size it had where it is used.
 */
const svgProps = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

/** Sound waves: the logo and the Translate entry of the menu. */
export function WaveIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2" />
    </svg>
  );
}

/** A sheet with text: notes. */
export function NoteIcon() {
  return (
    <svg {...svgProps}>
      <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...svgProps}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <path d="M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 017 0v3" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...svgProps} width={16} height={16}>
      <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4" />
    </svg>
  );
}

/** The three-dot menu ⋯. */
export function MoreIcon() {
  return (
    <svg {...svgProps} width={16} height={16}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg {...svgProps} width={15} height={15}>
      <path d="M9 9h11v11H9zM5 15H4V4h11v1" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg {...svgProps} width={16} height={16}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function SwapIcon() {
  return (
    <svg {...svgProps} width={13} height={13}>
      <path d="M7 7h12l-3-3M17 17H5l3 3" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg {...svgProps} width={14} height={14}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** A window with a small one floating on top: picture-in-picture. */
export function FloatIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="11" y="12" width="7" height="4.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SlidersIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg {...svgProps} width={22} height={22} fill="currentColor" stroke="none">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg {...svgProps} width={20} height={20} fill="currentColor" stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

export function VolumeIcon() {
  return (
    <svg {...svgProps} width={16} height={16}>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

/** A video camera: an online meeting. */
export function VideoIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10l6-3v10l-6-3" />
    </svg>
  );
}

/** A screen: the computer's audio. */
export function MonitorIcon() {
  return (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/** A microphone. */
export function MicIcon() {
  return (
    <svg {...svgProps}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** A shield: permissions and privacy. */
export function ShieldIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
    </svg>
  );
}

/** Two arrows in a circle: do again (summarize again). */
export function RefreshIcon() {
  return (
    <svg {...svgProps} width={15} height={15}>
      <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" />
    </svg>
  );
}

/** A letter and a character: a translated conversation. */
export function TranslateIcon() {
  return (
    <svg {...svgProps}>
      <path d="M4 6h8M8 4v2M10 6c-.5 3-2.5 6-6 8M6 10c1 2 3 3.5 5 4M13 20l4-9 4 9M14.5 17h5" />
    </svg>
  );
}
