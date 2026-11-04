import {
  ActionIcon, Chip, CloseButton, Group, Popover, ScrollArea, Stack, TagsInput, Text, Tooltip, type ComboboxItem,
  type OptionsFilter,
} from '@mantine/core';
import { IconListSearch } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import type { TopicCatalog } from '../types';

/** Same matching key as the backend's TopicCatalog.key: case, spacing and punctuation don't matter. */
const key = (topic: string) => topic.toLowerCase().replace(/[^\p{L}\p{N}+#]/gu, '');

interface Props {
  catalog: TopicCatalog | null;
  value: string[];
  onChange: (topics: string[]) => void;
  error?: string;
  description?: string;
}

/**
 * The chosen focus topics (in priority order) as tags, with catalog suggestions as you type (aliases such as "k8s"
 * included) and anything else accepted on Enter. A button at the input's right opens every catalog topic by
 * category, to pick from.
 */
export default function TopicPicker({ catalog, value, onChange, error, description }: Props) {
  const [browsing, setBrowsing] = useState(false);
  const max = catalog?.maxTopics ?? 8;
  const maxChars = catalog?.maxTopicChars ?? 60;
  const chosen = useMemo(() => new Set(value.map(key)), [value]);
  const all = useMemo(() => catalog?.categories.flatMap((c) => c.topics) ?? [], [catalog]);

  // Matching key to catalog spelling, aliases included; mirrors the backend's TopicCatalog.canonical.
  const canonical = useMemo(() => {
    const byKey = new Map(Object.entries(catalog?.aliases ?? {}));
    all.forEach((t) => byKey.set(key(t), t));
    return (t: string) => byKey.get(key(t)) ?? t;
  }, [all, catalog]);

  /** Catalog spelling where it matches, so results line up with other interviews; no duplicates; at most `max`. */
  const normalise = (topics: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of topics) {
      const t = canonical(raw.trim().replace(/\s+/g, ' ').slice(0, maxChars));
      if (t && !seen.has(key(t)) && out.length < max) {
        seen.add(key(t));
        out.push(t);
      }
    }
    return out;
  };

  // An alias ("k8s") suggests its topic first, then anything containing what was typed.
  const filter: OptionsFilter = ({ options, search, limit }) => {
    const q = key(search);
    const items = options as ComboboxItem[];
    if (!q) return items.slice(0, limit);
    const aliased = catalog?.aliases[q];
    const found = items.filter((o) => key(o.value).includes(q) && o.value !== aliased);
    const first = aliased ? items.filter((o) => o.value === aliased) : [];
    return [...first, ...found].slice(0, limit);
  };

  const toggle = (topic: string) => onChange(chosen.has(key(topic))
    ? value.filter((t) => key(t) !== key(topic))
    : normalise([...value, topic]));

  // The whole catalog by category, opened from the button inside the input.
  const browser = catalog && (
    <Popover opened={browsing} onChange={setBrowsing} position="bottom-end" width={440} shadow="md" withArrow>
      <Popover.Target>
        <Tooltip label="Browse topics" disabled={browsing}>
          <ActionIcon variant={browsing ? 'light' : 'subtle'} size="sm" aria-label="Browse topics"
            onClick={() => setBrowsing((b) => !b)}>
            <IconListSearch size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="sm">
        <ScrollArea.Autosize mah={340} type="auto" offsetScrollbars>
          <Stack gap="sm">
            {catalog.categories.map((c) => (
              <div key={c.name}>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>{c.name}</Text>
                <Group gap={6}>
                  {c.topics.map((t) => {
                    const on = chosen.has(key(t));
                    return (
                      <Chip key={t} size="xs" checked={on} disabled={!on && value.length >= max}
                        onChange={() => toggle(t)}>
                        {t}
                      </Chip>
                    );
                  })}
                </Group>
              </div>
            ))}
          </Stack>
        </ScrollArea.Autosize>
        <Text size="xs" c="dimmed" mt="xs">{value.length}/{max} topics chosen</Text>
      </Popover.Dropdown>
    </Popover>
  );

  return (
    <Stack gap={6}>
      <TagsInput label="Focus topics" value={value} onChange={(v) => onChange(normalise(v))}
        data={all.filter((t) => !chosen.has(key(t)))} filter={filter} limit={8} maxTags={max}
        splitChars={[',']} acceptValueOnBlur error={error} description={description}
        rightSectionWidth={value.length ? 60 : 36} rightSectionPointerEvents="all"
        rightSection={(
          <Group gap={2} wrap="nowrap">
            {value.length > 0 && <CloseButton size="sm" aria-label="Clear topics" onClick={() => onChange([])} />}
            {browser}
          </Group>
        )}
        placeholder={value.length >= max ? `Up to ${max} topics` : 'e.g. DSA, Java Core, Kafka'} />
      <Text size="xs" c="dimmed">
        {catalog ? `${value.length}/${max} topics · ` : ''}Pick from the list or type your own and press Enter.
        The first topic has the highest priority.
      </Text>
    </Stack>
  );
}
