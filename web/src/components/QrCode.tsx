import { useMemo } from "react";
import { encode } from "uqr";

/**
 * QR code as an inline SVG, encoded locally (works offline). Always dark modules on a
 * white quiet zone whatever the page theme: phone cameras read inverted codes poorly.
 */
export function QrCode({ text, size = 168, label }: { text: string; size?: number; label?: string }) {
  const { path, modules } = useMemo(() => {
    const qr = encode(text, { ecc: "M", border: 0 });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, modules: qr.size };
  }, [text]);
  const quiet = 4; // the white margin (in modules) the QR spec asks for
  const box = modules + quiet * 2;
  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label ?? `QR code for ${text}`}
      data-qr-text={text}
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
