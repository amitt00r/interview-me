import '@excalidraw/excalidraw/index.css';

import { CaptureUpdateAction, Excalidraw, Sidebar } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { Button, useComputedColorScheme } from '@mantine/core';
import { IconComponents, IconEraser } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { confirmAction } from '../feedback';
import { isEmpty, liveElements, sceneVersion, type Scene } from '../whiteboard';
import ComponentPanel from './ComponentPanel';

/**
 * Our own sidebar, holding only the component palette. It replaces Excalidraw's default one (Search and Library
 * tabs), whose top-right Library button styles.css hides; the palette's button sits top left instead.
 */
const PALETTE = 'components';

/**
 * The Excalidraw editor for the interview room and the standalone /whiteboard page (WhiteboardPage). Loaded lazily
 * because Excalidraw is a large bundle. `initial` is the board to start from; `onChange` fires only when the drawing
 * itself changes, not on selection, scrolling or zooming, so the room can treat it as the candidate being active.
 * The Components sidebar (ComponentPanel) holds ready-made components, grouped: Core (generic system design
 * components and shapes, whiteboardLibrary.ts), AWS and Azure (official icons). It opens, docked, on an empty
 * board so it is found and stays open while the candidate places components; the Components button top left
 * reopens it. Excalidraw's menu (top left) is hidden; a Clear button beside Undo/Redo empties the board (undoable).
 * The palette docks on the left and the shape settings sit on the right (styles.css), so `swapUiOffsets` corrects
 * Excalidraw's idea of where its panels are.
 */
export default function Whiteboard({ initial, onChange, topRight }: {
  initial: Scene | null;
  onChange: (scene: Scene) => void;
  /** Extra controls in Excalidraw's top-right corner (the standalone page's close button). */
  topRight?: React.ReactNode;
}) {
  const scheme = useComputedColorScheme('light');
  const lastVersion = useRef(sceneVersion(initial));
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const startEmpty = useRef(isEmpty(initial));
  const editors = useRef<ExcalidrawImperativeAPI[]>([]);
  // Docked, the palette stays open while components are placed; undocked it overlays the board.
  const [docked, setDocked] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(!isEmpty(initial));

  const clear = async (editor: ExcalidrawImperativeAPI) => {
    const ok = await confirmAction({
      title: 'Clear the whiteboard?',
      message: 'Everything on the board is removed. You can still undo it (Ctrl+Z).',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (ok) editor.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  };
  const host = useRef<HTMLDivElement>(null);
  // Clear sits in Excalidraw's bottom-left bar, after Undo/Redo, so it moves with the bar when the palette docks.
  // Excalidraw has no slot there, so it is portalled into the bar, looked up again whenever the editor changes.
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const findFooter = () => {
    const bar = host.current?.querySelector<HTMLElement>('.undo-redo-buttons')?.parentElement ?? null;
    setFooter((current) => (current === bar ? current : bar));
  };

  return (
    <div ref={host} className="whiteboard-host">
      <Excalidraw
        initialData={{
          elements: initial?.elements ?? [], files: initial?.files, scrollToContent: true,
        }}
        excalidrawAPI={(editor) => {
          // Called from the editor's constructor, and in development twice (StrictMode builds a throwaway copy):
          // once mounted, use the one that is on the page.
          editors.current.push(editor);
          setTimeout(() => {
            const app = swapUiOffsets(host.current);
            const mounted = editors.current.find((e) => e.id === app?.id) ?? editors.current.at(-1)!;
            editors.current = [mounted];
            setApi(mounted);
            findFooter();
            if (!startEmpty.current) return;
            startEmpty.current = false;
            mounted.toggleSidebar({ name: PALETTE, force: true });
          });
        }}
        theme={scheme}
        renderTopRightUI={topRight ? () => <>{topRight}</> : undefined}
        onChange={(elements, _appState, files) => {
          setHasDrawing(liveElements(elements).length > 0);
          findFooter();
          const scene = { elements, files };
          const version = sceneVersion(scene);
          if (version === lastVersion.current) return;
          lastVersion.current = version;
          onChange(scene);
        }}
        UIOptions={{
          canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false },
          tools: { image: true },
          // The board is narrower than the window (the chat sits beside it), so allow docking below Excalidraw's
          // default width; on narrower boards the library overlays the canvas instead.
          dockedSidebarBreakpoint: 700,
        }}
      >
        <Sidebar name={PALETTE} docked={docked} onDock={setDocked}
          onStateChange={(state) => setPaletteOpen(state?.name === PALETTE)}>
          <Sidebar.Header>Components</Sidebar.Header>
          <ComponentPanel api={api} />
        </Sidebar>
      </Excalidraw>
      {api && !paletteOpen && (
        <Button className="palette-trigger" variant="default" size="xs" leftSection={<IconComponents size={16} />}
          onClick={() => api.toggleSidebar({ name: PALETTE, force: true })}>
          Components
        </Button>
      )}
      {api && footer?.isConnected && createPortal(
        <Button className="board-clear" variant="default" size="xs" leftSection={<IconEraser size={16} />}
          disabled={!hasDrawing} onClick={() => clear(api)}>
          Clear
        </Button>,
        footer,
      )}
    </div>
  );
}

interface UiOffsets { top: number; right: number; bottom: number; left: number }

/**
 * Excalidraw keeps zoom-to-fit, scroll-to-content and flowchart navigation clear of its panels by measuring them,
 * assuming the sidebar is on the right and the shape settings on the left. With them swapped (styles.css) it would
 * leave no room at all, so replace that measurement on the editor's instance. Excalidraw doesn't expose it, so this
 * reaches the class component through React's fiber; if that ever fails, the swap still works and only fitting is
 * off while a panel is open. Returns the mounted editor instance (its `id` matches its API's), if found.
 */
function swapUiOffsets(host: HTMLElement | null): { id: string } | null {
  const container = host?.querySelector<HTMLElement>('.excalidraw');
  const fiberKey = container && Object.keys(container).find((k) => k.startsWith('__reactFiber$'));
  if (!container || !fiberKey) return null;
  type Fiber = { return: Fiber | null; stateNode: unknown };
  type App = { id: string; getEditorUIOffsets: () => UiOffsets };
  let fiber: Fiber | null = (container as unknown as Record<string, Fiber>)[fiberKey];
  for (let i = 0; fiber && i < 50; i++, fiber = fiber.return) {
    const app = fiber.stateNode as Partial<App> | null;
    if (typeof app?.getEditorUIOffsets !== 'function') continue;
    const gap = 16;
    (app as App).getEditorUIOffsets = () => {
      const box = container.getBoundingClientRect();
      const toolbar = container.querySelector('.App-toolbar')?.getBoundingClientRect();
      const sidebar = container.querySelector('.sidebar')?.getBoundingClientRect();
      const settings = container.querySelector('.App-menu__left')?.getBoundingClientRect();
      return {
        top: (toolbar ? toolbar.bottom - box.top : 0) + gap,
        left: (sidebar ? Math.max(sidebar.right - box.left, 0) : 0) + gap,
        right: (settings ? Math.max(box.right - settings.left, 0) : 0) + gap,
        bottom: gap,
      };
    };
    return app as App;
  }
  return null;
}
