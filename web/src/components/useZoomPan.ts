import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

// Zoom and pan for the viewer's video, for reading small text on a shared screen.
// The video keeps its normal layout box; a CSS transform (translate, then scale around
// the box centre) moves the picture, and the player's overflow:hidden crops it.
// Touch: pinch to zoom, drag to pan, double-tap to zoom in / back out.
// Mouse: ctrl+wheel (or a trackpad pinch) zooms at the cursor, drag pans when zoomed.

export interface Zoom {
  scale: number;
  x: number; // px offset of the picture centre from the box centre
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
const IDENTITY: Zoom = { scale: 1, x: 0, y: 0 };
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const TAP_SLOP_PX = 10;

type Point = { x: number; y: number };

const clampScale = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));

/** Keep the zoomed picture covering the box: no panning past its edges. */
export function clampZoom(z: Zoom, width: number, height: number): Zoom {
  const scale = clampScale(z.scale);
  if (scale === 1) return IDENTITY;
  const maxX = ((scale - 1) * width) / 2;
  const maxY = ((scale - 1) * height) / 2;
  return { scale, x: Math.min(maxX, Math.max(-maxX, z.x)), y: Math.min(maxY, Math.max(-maxY, z.y)) };
}

/**
 * Zoom to `scale` so the content that was under `from` (relative to the box centre)
 * ends up under `to`. A screen point q shows content point p = (q - t) / s.
 */
function anchor(z: Zoom, scale: number, from: Point, to: Point = from): Zoom {
  const px = (from.x - z.x) / z.scale;
  const py = (from.y - z.y) / z.scale;
  return { scale, x: to.x - scale * px, y: to.y - scale * py };
}

export function zoomAround(z: Zoom, factor: number, at: Point): Zoom {
  return anchor(z, clampScale(z.scale * factor), at);
}

type Gesture =
  | { kind: "drag"; start: Point; from: Zoom }
  | { kind: "pinch"; dist: number; mid: Point; from: Zoom };

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function useZoomPan(areaRef: RefObject<HTMLElement | null>, opts: { wheelAlwaysZooms: boolean; onChange?: () => void }) {
  const [zoom, setZoomState] = useState<Zoom>(IDENTITY);
  const [gesturing, setGesturing] = useState(false);
  const zoomRef = useRef(zoom);
  const pointers = useRef(new Map<number, Point>());
  const downAt = useRef(new Map<number, Point>());
  const multiTouch = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ t: number; p: Point } | null>(null);
  const lastPointerType = useRef("mouse");
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  function box() {
    return areaRef.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
  }
  /** Client coordinates → offset from the box centre. */
  function local(clientX: number, clientY: number): Point {
    const r = box();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }
  function set(next: Zoom) {
    const r = box();
    const clamped = clampZoom(next, r.width, r.height);
    zoomRef.current = clamped;
    setZoomState(clamped);
    optsRef.current.onChange?.();
  }

  const zoomBy = (factor: number, at: Point = { x: 0, y: 0 }) => set(zoomAround(zoomRef.current, factor, at));
  const reset = () => set(IDENTITY);
  const zoomed = zoom.scale > 1.001;

  // Non-passive so ctrl+wheel doesn't also zoom the whole page.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof HTMLVideoElement)) return;
      const z = zoomRef.current;
      if (!e.ctrlKey && z.scale <= 1.001 && !optsRef.current.wheelAlwaysZooms) return; // let the page scroll
      e.preventDefault();
      // Trackpad pinches send many small deltas, mouse wheels ~100 per notch: clamp so
      // one notch is a modest step rather than a jump to max zoom.
      const delta = Math.max(-40, Math.min(40, e.deltaY));
      set(zoomAround(z, Math.exp(-delta * 0.01), local(e.clientX, e.clientY)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }); // re-binds each render; cheap, and keeps the helpers in the closure current

  // Entering/leaving fullscreen or rotating changes the box; keep the pan in bounds.
  useEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (zoomRef.current.scale > 1.001) set(zoomRef.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function begin() {
    const pts = [...pointers.current.values()];
    const from = zoomRef.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: midpoint(a, b), from };
    } else if (pts.length === 1 && from.scale > 1.001) {
      gesture.current = { kind: "drag", start: pts[0], from };
    } else {
      gesture.current = null;
    }
    setGesturing(gesture.current !== null);
  }

  // Touch double-tap: zoom in at the tap, or back out to fit. Mouse double-click stays
  // with the player (fullscreen), which is why only touch is handled here.
  function tap(p: Point) {
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      if (zoomRef.current.scale > 1.001) reset();
      else zoomBy(2.5, p);
    } else {
      lastTap.current = { t: now, p };
    }
  }

  const handlers = {
    onPointerDown(e: ReactPointerEvent) {
      lastPointerType.current = e.pointerType;
      if (!(e.target instanceof HTMLVideoElement)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.target.setPointerCapture?.(e.pointerId);
      const p = local(e.clientX, e.clientY);
      if (pointers.current.size === 0) multiTouch.current = false;
      pointers.current.set(e.pointerId, p);
      downAt.current.set(e.pointerId, p);
      if (pointers.current.size > 1) multiTouch.current = true;
      begin();
    },
    onPointerMove(e: ReactPointerEvent) {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
      const g = gesture.current;
      if (!g) return;
      const pts = [...pointers.current.values()];
      if (g.kind === "drag") {
        set({ ...g.from, x: g.from.x + pts[0].x - g.start.x, y: g.from.y + pts[0].y - g.start.y });
      } else if (pts.length >= 2) {
        const [a, b] = pts;
        const scale = clampScale((g.from.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist);
        // The content under the starting midpoint follows the fingers' current midpoint.
        set(anchor(g.from, scale, g.mid, midpoint(a, b)));
      }
    },
    onPointerUp(e: ReactPointerEvent) {
      const down = downAt.current.get(e.pointerId);
      downAt.current.delete(e.pointerId);
      if (!pointers.current.delete(e.pointerId)) return;
      begin(); // a pinch that drops to one finger carries on as a drag
      const p = local(e.clientX, e.clientY);
      const still = !!down && Math.hypot(p.x - down.x, p.y - down.y) < TAP_SLOP_PX;
      if (e.type === "pointerup" && e.pointerType === "touch" && still && !multiTouch.current && pointers.current.size === 0) tap(p);
    },
  };

  /** True when the last press was a finger, whose double-tap this hook already handled. */
  const lastWasTouch = () => lastPointerType.current === "touch";

  const style: CSSProperties = {
    transform: zoomed ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` : undefined,
    transition: gesturing ? "none" : "transform .15s ease-out",
    touchAction: zoomed ? "none" : "pan-y",
    cursor: zoomed ? (gesturing ? "grabbing" : "grab") : undefined,
  };

  return { zoom, zoomed, zoomBy, reset, handlers, lastWasTouch, style };
}
