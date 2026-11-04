import { CaptureUpdateAction, convertToExcalidrawElements, exportToSvg, serializeLibraryAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import {
  Accordion, Badge, CloseButton, Image, SegmentedControl, SimpleGrid, Stack, Text, TextInput, UnstyledButton,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { coreComponents } from './whiteboardLibrary';

/**
 * The whiteboard's component panel (a tab of Excalidraw's sidebar): Core (generic components and shapes,
 * whiteboardLibrary.ts) and the official AWS and Azure architecture icons (public/whiteboard-icons, listed in
 * cloudIcons.json), each grouped by category, with search. Click places a component in the middle of the visible
 * board; dragging drops it where it is released (as Excalidraw library data, which the editor accepts on drop).
 *
 * Cloud icons are placed as an image, an invisible box over it (arrows bind to it; it carries
 * `customData.component`, e.g. "Amazon DynamoDB") and a label below (`customData.iconLabel`), grouped, so
 * `outline()` in src/whiteboard.ts names them and their connections.
 */

type Provider = 'Core' | 'AWS' | 'Azure';

interface CloudIcon {
  provider: 'AWS' | 'Azure';
  category: string;
  name: string;
  file: string;
}

interface Item {
  key: string;
  name: string;
  /** Template elements, copied with fresh ids each time the item is placed. */
  elements: () => readonly ExcalidrawElement[];
  icon?: CloudIcon;
}

interface Group {
  category: string;
  items: Item[];
}

const ICON_BASE = `${import.meta.env.BASE_URL}whiteboard-icons/`;

/**
 * The cloud icon list, written next to the icons by scripts/import-cloud-icons.py. The icons are not in the
 * repository (their licences cover diagrams, not redistribution), so a fresh clone has none: then this is empty
 * and the AWS/Azure tabs explain how to add them. Fetched once and shared.
 */
let cloudIconsPromise: Promise<CloudIcon[]> | null = null;
function loadCloudIcons(): Promise<CloudIcon[]> {
  cloudIconsPromise ??= fetch(`${ICON_BASE}index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (Array.isArray(list) ? (list as CloudIcon[]) : []))
    .catch(() => []);
  return cloudIconsPromise;
}
const ICON_SIZE = 64;
const STROKE = '#1e1e1e';

function coreGroups(): Group[] {
  return coreComponents().map(({ category, items }) => ({
    category,
    items: items.map((c) => ({ key: `core:${c.name}`, name: c.name, elements: () => c.elements })),
  }));
}

function cloudGroups(icons: CloudIcon[], provider: 'AWS' | 'Azure'): Group[] {
  const groups = new Map<string, Item[]>();
  for (const icon of icons) {
    if (icon.provider !== provider) continue;
    const items = groups.get(icon.category) ?? [];
    let template: readonly ExcalidrawElement[] | null = null;
    items.push({ key: icon.file, name: icon.name, icon, elements: () => (template ??= iconTemplate(icon)) });
    groups.set(icon.category, items);
  }
  return [...groups].map(([category, items]) => ({ category, items }));
}

/** What the outline calls the icon: its service name, with the provider when the name doesn't say. */
function componentName(icon: CloudIcon) {
  if (icon.provider === 'AWS') return /^(AWS|Amazon)\b/.test(icon.name) ? icon.name : `AWS ${icon.name}`;
  return /^(Azure|Microsoft)\b/i.test(icon.name) ? icon.name : `Azure ${icon.name}`;
}

/** Breaks long service names over lines of about 22 characters, so labels stay near the icon's width. */
function wrap(name: string) {
  const lines: string[] = [];
  for (const word of name.split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && (lines[last] + ' ' + word).length <= 22) lines[last] += ' ' + word;
    else lines.push(word);
  }
  return lines.join('\n');
}

const fileId = (icon: CloudIcon) => `icon:${icon.file}` as FileId;

function iconTemplate(icon: CloudIcon): readonly ExcalidrawElement[] {
  const group = 'icon';
  const [image, body, label] = convertToExcalidrawElements([
    {
      type: 'image', x: 0, y: 0, width: ICON_SIZE, height: ICON_SIZE, fileId: fileId(icon), status: 'saved',
      groupIds: [group], customData: { decoration: true },
    },
    // Excalidraw doesn't bind arrows to images, so an invisible box over the icon is what arrows attach to and
    // what the outline reports. Filled (at zero opacity): arrows only bind from inside shapes with a fill.
    {
      type: 'rectangle', x: 0, y: 0, width: ICON_SIZE, height: ICON_SIZE, strokeColor: 'transparent',
      backgroundColor: '#ffffff', fillStyle: 'solid', opacity: 0, groupIds: [group],
      customData: { component: componentName(icon) },
    },
    {
      type: 'text', x: 0, y: ICON_SIZE + 8, text: wrap(icon.name), fontSize: 14, textAlign: 'center',
      strokeColor: STROKE, groupIds: [group], customData: { iconLabel: true },
    },
  ], { regenerateIds: false });
  return [image, body, { ...label, x: ICON_SIZE / 2 - label.width / 2 }];
}

/** Each icon's SVG, fetched once and handed to the editor as an image file. */
const files = new Map<string, Promise<BinaryFileData>>();

function iconFile(icon: CloudIcon): Promise<BinaryFileData> {
  let file = files.get(icon.file);
  if (!file) {
    file = fetch(ICON_BASE + icon.file)
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load the ${icon.name} icon`);
        return res.arrayBuffer();
      })
      .then((bytes) => new Promise<BinaryFileData>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          id: fileId(icon), mimeType: 'image/svg+xml', dataURL: reader.result as DataURL, created: Date.now(),
        });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([bytes], { type: 'image/svg+xml' }));
      }));
    file.catch(() => files.delete(icon.file));
    files.set(icon.file, file);
  }
  return file;
}

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);

/** Copies a template with fresh ids (shapes, groups and label links), centred on (cx, cy). */
function instantiate(template: readonly ExcalidrawElement[], cx: number, cy: number): ExcalidrawElement[] {
  const ids = new Map<string, string>();
  const id = (old: string) => ids.get(old) ?? ids.set(old, newId()).get(old)!;
  const groups = new Map<string, string>();
  const group = (old: string) => groups.get(old) ?? groups.set(old, newId()).get(old)!;
  const minX = Math.min(...template.map((e) => e.x));
  const minY = Math.min(...template.map((e) => e.y));
  const maxX = Math.max(...template.map((e) => e.x + e.width));
  const maxY = Math.max(...template.map((e) => e.y + e.height));
  const dx = cx - (minX + maxX) / 2;
  const dy = cy - (minY + maxY) / 2;
  const now = Date.now();
  return template.map((e) => ({
    ...e,
    id: id(e.id),
    x: e.x + dx,
    y: e.y + dy,
    groupIds: e.groupIds.map(group),
    boundElements: e.boundElements?.map((b) => ({ ...b, id: id(b.id) })) ?? null,
    ...('containerId' in e && e.containerId ? { containerId: id(e.containerId) } : {}),
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: now,
  }) as ExcalidrawElement);
}

/** Places an item in the middle of the part of the board not covered by the sidebar, nudging repeats apart. */
let lastPlace: { x: number; y: number; n: number } | null = null;

async function place(api: ExcalidrawImperativeAPI, item: Item) {
  if (item.icon) api.addFiles([await iconFile(item.icon)]);
  const { scrollX, scrollY, zoom, width, height } = api.getAppState();
  const sidebar = document.querySelector('.excalidraw .sidebar')?.getBoundingClientRect().width ?? 0;
  let x = (sidebar + width) / 2 / zoom.value - scrollX;
  let y = height / 2 / zoom.value - scrollY;
  const n = lastPlace && Math.abs(lastPlace.x - x) < 1 && Math.abs(lastPlace.y - y) < 1 ? lastPlace.n + 1 : 0;
  lastPlace = { x, y, n };
  x += n * 24;
  y += n * 24;

  const elements = instantiate(item.elements(), x, y);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...elements],
    appState: {
      selectedElementIds: Object.fromEntries(elements.map((e) => [e.id, true as const])),
      selectedGroupIds: Object.fromEntries(elements.flatMap((e) => e.groupIds.slice(0, 1)).map((g) => [g, true])),
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

function onDragStart(event: React.DragEvent, api: ExcalidrawImperativeAPI, item: Item) {
  // The drop only carries elements; the image file has to be in the editor by the time it renders them.
  if (item.icon) iconFile(item.icon).then((file) => api.addFiles([file])).catch(() => {});
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/vnd.excalidrawlib+json', serializeLibraryAsJSON([
    { id: item.key, status: 'unpublished', created: Date.now(), elements: item.elements() },
  ]));
}

/** A Core component's preview, drawn by Excalidraw itself so it looks like what gets placed. */
const previews = new Map<string, Promise<string>>();

function preview(item: Item) {
  let url: Promise<string> | undefined = previews.get(item.key);
  if (!url) {
    const svg: Promise<SVGSVGElement> = exportToSvg({
      elements: item.elements(), files: null, exportPadding: 4, skipInliningFonts: true,
      appState: { exportBackground: false, viewBackgroundColor: 'transparent' },
    });
    url = svg.then((el) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(el.outerHTML)}`);
    previews.set(item.key, url);
  }
  return url;
}

function Tile({ item, api }: { item: Item; api: ExcalidrawImperativeAPI | null }) {
  const [src, setSrc] = useState(item.icon ? ICON_BASE + item.icon.file : null);
  useEffect(() => {
    if (item.icon) return;
    let live = true;
    preview(item).then((url) => live && setSrc(url));
    return () => { live = false; };
  }, [item]);

  return (
    <UnstyledButton
      className="component-tile"
      title={item.icon ? componentName(item.icon) : item.name}
      draggable={!!api}
      disabled={!api}
      onClick={() => api && place(api, item)}
      onDragStart={(e) => api && onDragStart(e, api, item)}
    >
      <Stack gap={4} align="center">
        <div className={item.icon ? 'component-thumb' : 'component-thumb core'}>
          {src && <Image src={src} alt="" loading="lazy" fit="contain" h="100%" draggable={false} />}
        </div>
        <Text size="xs" ta="center" lineClamp={2} lh={1.2}>{item.name}</Text>
      </Stack>
    </UnstyledButton>
  );
}

const PROVIDERS: Provider[] = ['Core', 'AWS', 'Azure'];

export default function ComponentPanel({ api }: { api: ExcalidrawImperativeAPI | null }) {
  const [provider, setProvider] = useState<Provider>('Core');
  const [query, setQuery] = useState('');
  const [icons, setIcons] = useState<CloudIcon[] | null>(null);
  useEffect(() => {
    let live = true;
    loadCloudIcons().then((list) => live && setIcons(list));
    return () => { live = false; };
  }, []);
  const groups = useMemo(
    () => (provider === 'Core' ? coreGroups() : cloudGroups(icons ?? [], provider)), [provider, icons]);
  const missingIcons = provider !== 'Core' && icons !== null && groups.length === 0;
  // Which categories are expanded, per provider: Core starts fully open, the long cloud lists closed.
  const [open, setOpen] = useState<Record<Provider, string[]>>(() => ({
    Core: coreGroups().map((g) => g.category), AWS: [], Azure: [],
  }));

  const q = query.trim().toLowerCase();
  const shown = q
    ? groups
      .map((g) => ({ ...g, items: g.items.filter((i) => `${i.name} ${g.category}`.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length)
    : groups;

  return (
    <Stack gap="xs" p="xs" className="component-panel">
      <SegmentedControl fullWidth size="xs" data={PROVIDERS} value={provider}
        onChange={(v) => setProvider(v as Provider)} />
      <TextInput
        size="xs"
        placeholder={`Search ${provider === 'Core' ? 'components' : `${provider} icons`}`}
        leftSection={<IconSearch size={14} />}
        rightSection={query && <CloseButton size="xs" aria-label="Clear search" onClick={() => setQuery('')} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <div className="component-list">
        {provider !== 'Core' && icons === null && <Text size="sm" c="dimmed" ta="center" mt="md">Loading icons…</Text>}
        {missingIcons && (
          <Text size="sm" c="dimmed" ta="center" mt="md">
            {provider} icons aren't installed. Download the official icon packages and run
            {' '}<code>scripts/import-cloud-icons.py</code> (see <code>public/whiteboard-icons/README.md</code>).
          </Text>
        )}
        {!missingIcons && q && shown.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" mt="md">Nothing matches "{query}".</Text>
        )}
        <Accordion
          multiple
          // Closed groups unmount, so only open ones render (and load) their icons.
          keepMounted={false}
          variant="default"
          chevronPosition="left"
          // While searching, every group with a match is open.
          value={q ? shown.map((g) => g.category) : open[provider]}
          onChange={(value) => !q && setOpen((o) => ({ ...o, [provider]: value }))}
        >
          {shown.map((g) => (
            <Accordion.Item key={g.category} value={g.category}>
              <Accordion.Control py={4}>
                <Text size="sm" fw={500} span>{g.category}</Text>{' '}
                <Badge size="xs" variant="light" color="gray">{g.items.length}</Badge>
              </Accordion.Control>
              <Accordion.Panel>
                <SimpleGrid cols={3} spacing={4} verticalSpacing={4}>
                  {g.items.map((item) => <Tile key={item.key} item={item} api={api} />)}
                </SimpleGrid>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </div>
      <Text size="xs" c="dimmed" ta="center">Click to add, or drag onto the board</Text>
    </Stack>
  );
}
