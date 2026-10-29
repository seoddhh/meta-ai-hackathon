import type { Point } from '@/lib/types';

// Camera state shared between the 3D scene and the HUD minimap, in world units.
export type CameraView = { center: Point; footprint: Point[] };
type Listener = () => void;

let view: CameraView = { center: [2500, 2500], footprint: [] };
const viewListeners = new Set<Listener>();
const focusListeners = new Set<(point: Point) => void>();

export const cameraBus = {
  getView: () => view,
  setView(next: CameraView) { view = next; viewListeners.forEach(l => l()); },
  subscribe(listener: Listener) { viewListeners.add(listener); return () => { viewListeners.delete(listener); }; },
  focus(point: Point) { focusListeners.forEach(l => l(point)); },
  onFocus(listener: (point: Point) => void) { focusListeners.add(listener); return () => { focusListeners.delete(listener); }; },
};
