import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

/**
 * The Core tab of the whiteboard's component panel (ComponentPanel): generic, vendor-neutral system design
 * components and plain shapes, grouped. Each component is one labelled shape, so arrows bind to it and the label
 * can be renamed ("Relational DB" → "Orders (Postgres)"); `customData.component` remembers what it is either way,
 * and `outline()` in src/whiteboard.ts reports it to Claude. Databases are cylinders: a labelled body plus grouped
 * `customData.decoration` parts the outline skips. Basic shapes carry no component: the candidate labels them.
 *
 * Only imported by the lazily loaded editor chunk.
 */

type Shape = 'rectangle' | 'ellipse' | 'diamond' | 'cylinder' | 'queue' | 'person' | 'boundary' | 'stack';

interface Component {
  name: string;
  shape: Shape;
  /** Excalidraw palette fill; the stroke stays the default dark so it exports clearly on white. */
  fill: string;
  width?: number;
  height?: number;
  dashed?: boolean;
  /** Basic shapes: placed without a label or component type. */
  plain?: boolean;
}

export interface CoreItem {
  name: string;
  /** Template elements (fixed ids); ComponentPanel copies them with fresh ids when placing. */
  elements: readonly ExcalidrawElement[];
}

export interface CoreGroup {
  category: string;
  items: CoreItem[];
}

const GROUPS: { category: string; components: Component[] }[] = [
  {
    category: 'Basic shapes',
    components: [
      { name: 'Box', shape: 'rectangle', fill: 'transparent', plain: true },
      { name: 'Circle', shape: 'ellipse', fill: 'transparent', width: 100, height: 100, plain: true },
      { name: 'Decision', shape: 'diamond', fill: 'transparent', width: 140, height: 100, plain: true },
      { name: 'Note', shape: 'rectangle', fill: '#ffec99', width: 160, height: 100 },
      { name: 'Boundary', shape: 'boundary', fill: 'transparent', width: 360, height: 240, dashed: true },
    ],
  },
  {
    category: 'Clients',
    components: [
      { name: 'User', shape: 'person', fill: '#e9ecef', width: 100, height: 60 },
      { name: 'Client', shape: 'rectangle', fill: '#e9ecef' },
      { name: 'Web App', shape: 'rectangle', fill: '#e9ecef' },
      { name: 'Mobile App', shape: 'rectangle', fill: '#e9ecef', width: 90, height: 140 },
      { name: 'External System', shape: 'rectangle', fill: '#f8f9fa', dashed: true },
    ],
  },
  {
    category: 'Edge & networking',
    components: [
      { name: 'DNS', shape: 'ellipse', fill: '#e9ecef', width: 120, height: 70 },
      { name: 'CDN', shape: 'ellipse', fill: '#99e9f2' },
      { name: 'Load Balancer', shape: 'diamond', fill: '#d0bfff', width: 170, height: 100 },
      { name: 'API Gateway', shape: 'rectangle', fill: '#d0bfff' },
      { name: 'Firewall / WAF', shape: 'rectangle', fill: '#ffc9c9' },
      { name: 'Rate Limiter', shape: 'rectangle', fill: '#d0bfff' },
    ],
  },
  {
    category: 'Compute',
    components: [
      { name: 'Service', shape: 'rectangle', fill: '#a5d8ff' },
      { name: 'Worker', shape: 'rectangle', fill: '#a5d8ff', dashed: true },
      { name: 'Service Group', shape: 'stack', fill: '#a5d8ff' },
      { name: 'Worker Group', shape: 'stack', fill: '#a5d8ff', dashed: true },
      { name: 'Function', shape: 'rectangle', fill: '#a5d8ff', width: 140, height: 70 },
      { name: 'Container', shape: 'rectangle', fill: '#a5d8ff' },
      { name: 'Server / VM', shape: 'rectangle', fill: '#a5d8ff' },
      { name: 'Scheduler', shape: 'ellipse', fill: '#a5d8ff', width: 150, height: 80 },
    ],
  },
  {
    category: 'Messaging',
    components: [
      { name: 'Message Queue', shape: 'queue', fill: '#ffec99', width: 200, height: 60 },
      { name: 'Pub/Sub Topic', shape: 'queue', fill: '#ffd8a8', width: 200, height: 60 },
      { name: 'Event Bus', shape: 'rectangle', fill: '#ffec99', width: 260, height: 50 },
      { name: 'Stream', shape: 'queue', fill: '#ffe066', width: 220, height: 60 },
    ],
  },
  {
    category: 'Data',
    components: [
      { name: 'Cache', shape: 'rectangle', fill: '#ffc9c9' },
      { name: 'Relational DB', shape: 'cylinder', fill: '#b2f2bb' },
      { name: 'NoSQL DB', shape: 'cylinder', fill: '#ffd8a8' },
      { name: 'Search Index', shape: 'cylinder', fill: '#eebefa' },
      { name: 'Data Warehouse', shape: 'cylinder', fill: '#96f2d7' },
      { name: 'Object Storage', shape: 'rectangle', fill: '#c3fae8' },
      { name: 'File Storage', shape: 'rectangle', fill: '#c3fae8' },
    ],
  },
  {
    category: 'Security & operations',
    components: [
      { name: 'Identity Provider', shape: 'rectangle', fill: '#ffc9c9' },
      { name: 'Secrets Manager', shape: 'rectangle', fill: '#ffc9c9' },
      { name: 'Monitoring', shape: 'rectangle', fill: '#e9ecef' },
      { name: 'Logging', shape: 'rectangle', fill: '#e9ecef' },
      { name: 'Notification Service', shape: 'rectangle', fill: '#a5d8ff' },
      { name: 'Third-party API', shape: 'rectangle', fill: '#f8f9fa', dashed: true },
    ],
  },
];

const STROKE = '#1e1e1e';
const FONT_SIZE = 16;
/** Height of a cylinder's top and bottom ellipses. */
const CAP = 24;

function skeleton(c: Component, group: string): ExcalidrawElementSkeleton[] {
  const width = c.width ?? 160;
  const height = c.height ?? 80;
  const style = {
    strokeColor: STROKE, backgroundColor: c.fill, fillStyle: 'solid' as const, strokeWidth: 2,
    strokeStyle: c.dashed ? ('dashed' as const) : ('solid' as const), roughness: 1, groupIds: [group],
  };
  const body = c.plain ? { ...style, id: `${group}-body` } : {
    ...style,
    id: `${group}-body`,
    // Explicit colour: a label otherwise takes its container's stroke, which cylinders hide.
    label: { text: c.name, fontSize: FONT_SIZE, strokeColor: STROKE },
    customData: { component: c.name },
  };
  const decoration = { ...style, customData: { decoration: true } };

  switch (c.shape) {
    case 'rectangle':
      return [{ ...body, type: 'rectangle', x: 0, y: 0, width, height, roundness: { type: 3 } }];
    case 'ellipse':
    case 'diamond':
      return [{ ...body, type: c.shape, x: 0, y: 0, width, height }];
    case 'boundary':
      // A dashed zone (VPC, region, trust boundary...) named in its top-left corner, to draw components inside.
      return [{
        ...style, id: `${group}-body`, type: 'rectangle', x: 0, y: 0, width, height, roundness: null,
        label: { text: c.name, fontSize: FONT_SIZE, strokeColor: STROKE, textAlign: 'left', verticalAlign: 'top' },
      }];
    case 'stack':
      // Several instances of one thing (a replicated service, a worker pool): two copies peek out behind the
      // labelled front box, which is what arrows bind to.
      return [
        ...[2, 1].map((i) => ({
          ...decoration, type: 'rectangle' as const, x: i * 10, y: -i * 10, width, height, roundness: { type: 3 },
        })),
        { ...body, type: 'rectangle', x: 0, y: 0, width, height, roundness: { type: 3 } },
      ] as ExcalidrawElementSkeleton[];
    case 'person':
      // A head over a labelled body; the body is what arrows bind to.
      return [
        { ...decoration, type: 'ellipse', x: width / 2 - 18, y: -40, width: 36, height: 36 },
        { ...body, type: 'rectangle', x: 0, y: 0, width, height, roundness: { type: 3 } },
      ] as ExcalidrawElementSkeleton[];
    case 'cylinder':
      // Drawn back to front: bottom cap, the filled body (no outline) hiding the cap's upper half, the two
      // sides, then the top cap over the body's top edge.
      return [
        { ...decoration, type: 'ellipse', x: 0, y: height - CAP / 2, width, height: CAP },
        { ...body, type: 'rectangle', x: 0, y: 0, width, height, strokeColor: 'transparent', roundness: null },
        { ...decoration, type: 'line', x: 0, y: 0, points: [[0, 0], [0, height]] },
        { ...decoration, type: 'line', x: width, y: 0, points: [[0, 0], [0, height]] },
        { ...decoration, type: 'ellipse', x: 0, y: -CAP / 2, width, height: CAP },
      ] as ExcalidrawElementSkeleton[];
    case 'queue':
      // A long box with slots at the end, like messages waiting in line.
      return [
        { ...body, type: 'rectangle', x: 0, y: 0, width, height, roundness: null,
          label: { text: c.name, fontSize: FONT_SIZE, strokeColor: STROKE, textAlign: 'left' } },
        ...[0, 1, 2].map((i) => ({
          ...decoration, type: 'line' as const, x: width - 18 - i * 14, y: 0, points: [[0, 0], [0, height]],
        })),
      ] as ExcalidrawElementSkeleton[];
  }
}

let core: CoreGroup[] | null = null;

export function coreComponents(): CoreGroup[] {
  core ??= GROUPS.map(({ category, components }) => ({
    category,
    items: components.map((c) => {
      const group = `core-${c.name.toLowerCase().replace(/\W+/g, '-')}`;
      return {
        name: c.name,
        // Labels join their component's group, so selecting the component selects all of it.
        elements: convertToExcalidrawElements(skeleton(c, group), { regenerateIds: false })
          .map((e) => (e.type === 'text' && e.containerId ? { ...e, groupIds: [group] } : e)),
      };
    }),
  }));
  return core;
}
