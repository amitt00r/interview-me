import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';

/**
 * The interview whiteboard's data, kept apart from the Excalidraw component so the room can export, outline and
 * save a board without loading the editor. Excalidraw itself is only imported on demand (it is a large bundle).
 */

/** A board: its live (non-deleted) elements and the images they use. Saved in Excalidraw's own file format. */
export interface Scene {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
}

/** What is sent with an answer: the PNG (base64) Claude looks at, the scene to reopen, and a text outline. */
export interface WhiteboardSnapshot {
  png: string;
  scene: string;
  outline: string;
}

/** Claude downsizes anything larger than this on its long edge, so there is no point exporting more. */
const MAX_IMAGE_EDGE = 1568;

export const liveElements = (elements: readonly ExcalidrawElement[]) => elements.filter((e) => !e.isDeleted);

export const isEmpty = (scene: Scene | null) => !scene || liveElements(scene.elements).length === 0;

/** Changes whenever the drawing does (Excalidraw bumps an element's version on every edit). */
export const sceneVersion = (scene: Scene | null) =>
  scene ? scene.elements.reduce((sum, e) => sum + e.version, scene.elements.length) : 0;

export const serializeScene = (scene: Scene) => {
  const elements = liveElements(scene.elements);
  const used = new Set<string>(elements.flatMap((e) => (e.type === 'image' && e.fileId ? [e.fileId] : [])));
  const files = Object.fromEntries(Object.entries(scene.files).filter(([id]) => used.has(id)));
  return JSON.stringify({ type: 'excalidraw', version: 2, source: 'mock-interviewer', elements, files });
};

export const parseScene = (json: string): Scene | null => {
  try {
    const data = JSON.parse(json);
    return Array.isArray(data?.elements) ? { elements: data.elements, files: data.files ?? {} } : null;
  } catch {
    return null;
  }
};

/**
 * A plain-text reading of the board for Claude, next to the image: components from the library (with their type,
 * even when renamed), other labelled shapes, arrows between them (by label) and free text. Hand-drawn diagrams
 * are easy to misread; the labels and connections are exact.
 */
export function outline(scene: Scene): string {
  // Cylinder caps and queue slots are drawing detail, not things on the board.
  const elements = liveElements(scene.elements).filter((e) => !e.customData?.decoration);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  // Text bound to a shape or an arrow is its label.
  const labels = new Map<string, string>();
  for (const e of elements) {
    if (e.type === 'text' && e.containerId) labels.set(e.containerId, clean(e.text));
  }
  // Cloud icons (ComponentPanel): the label is a separate text in the component's group.
  for (const e of elements) {
    if (e.type !== 'text' || !e.customData?.iconLabel || !e.groupIds.length) continue;
    const icon = elements.find((i) => i.customData?.component && i.groupIds[0] === e.groupIds[0]);
    if (icon) labels.set(icon.id, clean(e.text));
  }
  // A library component: "Orders" (Relational DB) when renamed, else just its type.
  const component = (e: (typeof elements)[number]) => {
    const type = typeof e.customData?.component === 'string' ? e.customData.component as string : null;
    if (!type) return null;
    const label = labels.get(e.id);
    // A cloud icon's label is its service name, sometimes without the provider ("Elastic Load Balancing").
    return label && !type.toLowerCase().endsWith(label.toLowerCase()) ? `"${label}" (${type})` : type;
  };
  const name = (id: string | undefined) => {
    if (!id) return '(nothing)';
    const target = byId.get(id);
    if (!target) return '(nothing)';
    if (target.type === 'text') return `"${clean(target.text)}"`;
    return component(target) ?? (labels.has(id) ? `"${labels.get(id)}"` : `unlabelled ${target.type}`);
  };

  const components: string[] = [];
  const shapes: string[] = [];
  let unlabelled = 0;
  const arrows: string[] = [];
  const notes: string[] = [];
  const frames: string[] = [];
  let strokes = 0;
  let images = 0;
  for (const e of elements) {
    switch (e.type) {
      case 'rectangle':
      case 'ellipse':
      case 'diamond':
        if (component(e)) components.push(component(e)!);
        else if (labels.has(e.id)) shapes.push(`"${labels.get(e.id)}" (${e.type})`);
        else unlabelled++;
        break;
      case 'arrow':
      case 'line': {
        const both = e.type === 'arrow' && e.startArrowhead && e.endArrowhead;
        const link = e.type === 'line' ? '—' : both ? '<->' : '->';
        const label = labels.get(e.id);
        arrows.push(`${name(e.startBinding?.elementId)} ${link} ${name(e.endBinding?.elementId)}`
          + (label ? ` labelled "${label}"` : ''));
        break;
      }
      case 'text':
        if (!e.containerId && !e.customData?.iconLabel && clean(e.text)) notes.push(`"${clean(e.text)}"`);
        break;
      case 'frame':
      case 'magicframe':
        if (e.name) frames.push(`"${clean(e.name)}"`);
        break;
      case 'freedraw':
        strokes++;
        break;
      case 'image':
        images++;
        break;
    }
  }
  const lines: string[] = [];
  if (frames.length) lines.push(`Frames: ${frames.join('; ')}`);
  if (components.length) lines.push(`Components: ${components.join('; ')}`);
  if (shapes.length) lines.push(`Labelled shapes: ${shapes.join('; ')}`);
  if (unlabelled) lines.push(`Unlabelled shapes: ${unlabelled}`);
  if (arrows.length) lines.push(`Connections:\n${arrows.map((a) => `- ${a}`).join('\n')}`);
  if (notes.length) lines.push(`Free text: ${notes.join('; ')}`);
  if (strokes) lines.push(`Freehand strokes: ${strokes}`);
  if (images) lines.push(`Pasted images: ${images}`);
  return lines.join('\n');
}

/** Exports the board on a white background (Claude reads dark-on-light best), at most MAX_IMAGE_EDGE px. */
export async function snapshot(scene: Scene): Promise<WhiteboardSnapshot> {
  const { exportToBlob } = await import('@excalidraw/excalidraw');
  const blob = await exportToBlob({
    elements: liveElements(scene.elements),
    files: scene.files,
    mimeType: 'image/png',
    exportPadding: 24,
    appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
    // Small sketches are scaled up (to 2x) so their text stays legible; big ones down to the limit.
    getDimensions: (width: number, height: number) => {
      const scale = Math.min(2, MAX_IMAGE_EDGE / Math.max(width, height, 1));
      return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
    },
  });
  return { png: await base64(blob), scene: serializeScene(scene), outline: outline(scene) };
}

const base64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/**
 * Unsent work survives a reload: the board for each main question is saved per browser, with the version last
 * submitted so an unchanged board isn't sent again.
 */
interface Draft {
  scene: string;
  submittedVersion: number;
}

const draftKey = (interviewId: number, questionTurnId: number) => `whiteboard:${interviewId}:${questionTurnId}`;

export function loadDraft(interviewId: number, questionTurnId: number): { scene: Scene; submittedVersion: number } | null {
  try {
    const raw = localStorage.getItem(draftKey(interviewId, questionTurnId));
    const draft = raw ? (JSON.parse(raw) as Draft) : null;
    const scene = draft ? parseScene(draft.scene) : null;
    return scene && draft ? { scene, submittedVersion: draft.submittedVersion } : null;
  } catch {
    return null;
  }
}

export function saveDraft(interviewId: number, questionTurnId: number, scene: Scene, submittedVersion: number) {
  try {
    localStorage.setItem(draftKey(interviewId, questionTurnId),
      JSON.stringify({ scene: serializeScene(scene), submittedVersion } satisfies Draft));
  } catch {
    // Storage full (large pasted images): the board still works, it just won't survive a reload.
  }
}

/** Drops the saved boards of an interview once it has ended. */
export function clearDrafts(interviewId: number) {
  const prefix = `whiteboard:${interviewId}:`;
  Object.keys(localStorage).filter((k) => k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k));
}

/** The standalone practice board (/whiteboard): one per browser, saved on every change. */
const SCRATCH_KEY = 'whiteboard:scratch';

export function loadScratch(): Scene | null {
  try {
    const raw = localStorage.getItem(SCRATCH_KEY);
    return raw ? parseScene(raw) : null;
  } catch {
    return null;
  }
}

export function saveScratch(scene: Scene) {
  try {
    localStorage.setItem(SCRATCH_KEY, serializeScene(scene));
  } catch {
    // Storage full: the board still works, it just won't survive a reload.
  }
}
