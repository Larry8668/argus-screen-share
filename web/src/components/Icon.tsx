// Small inline icon set (24×24, stroke = currentColor) so there's no icon dependency.
const PATHS = {
  screen: "M3 5h18v11H3zM8 20h8M12 16v4",
  camera: "M3 7h12v10H3zM15 10l6-3v10l-6-3",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  micOff: "M3 3l18 18M9 9v3a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ear: "M6 9a6 6 0 1 1 12 0c0 3-2 4-3 5.5S14 18 12 19.5 8 20 8 18M10 9a2 2 0 1 1 4 0",
  volume: "M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  volumeOff: "M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  shrink: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  pip: "M3 5h18v14H3zM12 12h7v5h-7z",
  copy: "M8 8h12v12H8zM4 16V4h12",
  check: "M4 12l5 5L20 6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  stop: "M6 6h12v12H6z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  qr: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4",
  zoomIn: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M11 8v6M8 11h6",
  zoomOut: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M8 11h6",
  fit: "M3 5h18v14H3zM8 9l-2 3 2 3M16 9l2 3-2 3",
  fill: "M3 5h18v14H3zM7 9V7h3M17 9V7h-3M7 15v2h3M17 15v2h-3",
  rotate: "M4 5h8v14H4zM15 6a6 6 0 0 1 5 6M20 12l-2.6-1.2M20 12l1.2-2.6",
  tv: "M3 6h18v12H3zM8 21h8M9 2l3 3 3-3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
