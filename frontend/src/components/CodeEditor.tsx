import { java } from '@codemirror/lang-java';
import { python } from '@codemirror/lang-python';
import { MySQL, PostgreSQL, sql, StandardSQL } from '@codemirror/lang-sql';
import { indentUnit } from '@codemirror/language';
import { Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { Group, SegmentedControl, Select, Text, Tooltip, useComputedColorScheme } from '@mantine/core';
import { IconBulb, IconBulbOff } from '@tabler/icons-react';
import CodeMirror from '@uiw/react-codemirror';
import { useCallback, useMemo, useRef, useState } from 'react';
import { CODE_LANGUAGES, MAX_SOURCE_CHARS } from '../codepad';
import { CODE_SUGGESTIONS, setFlag, useFlag } from '../preferences';
import type { CodeLanguage } from '../types';
import { javaSuggestions, pythonSuggestions } from './codeCompletions';

const DIALECTS = { standard: StandardSQL, postgres: PostgreSQL, mysql: MySQL } as const;
type Dialect = keyof typeof DIALECTS;
const DIALECT_KEY = 'code:sql-dialect';

function languageExtensions(language: CodeLanguage, dialect: Dialect): Extension[] {
  switch (language) {
    case 'JAVA': return [java(), javaSuggestions, indentUnit.of('    ')];
    case 'PYTHON': return [python(), pythonSuggestions, indentUnit.of('    ')];
    case 'SQL': return [sql({ dialect: DIALECTS[dialect], upperCaseKeywords: true }), indentUnit.of('  ')];
  }
}

/**
 * The interview room's code editor (CodeMirror 6, lazy-loaded): Java, Python or SQL with highlighting, and
 * suggestions unless turned off (here or on the Preferences page). The SQL dialect only changes the keywords
 * suggested. Controlled: the room owns the buffer.
 */
export default function CodeEditor({ language, source, onLanguageChange, onSourceChange, onSubmit }: {
  language: CodeLanguage;
  source: string;
  onLanguageChange: (language: CodeLanguage) => void;
  onSourceChange: (source: string) => void;
  /** Ctrl/Cmd + Enter in the editor, as in the answer box. */
  onSubmit?: () => void;
}) {
  const scheme = useComputedColorScheme('light');
  const suggestions = useFlag(CODE_SUGGESTIONS);
  const [dialect, setDialect] = useState<Dialect>(() => {
    const saved = localStorage.getItem(DIALECT_KEY);
    return saved && saved in DIALECTS ? (saved as Dialect) : 'standard';
  });
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const extensions = useMemo(() => [
    ...languageExtensions(language, dialect),
    Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { onSubmitRef.current?.(); return !!onSubmitRef.current; } }])),
  ], [language, dialect]);
  // Memoised: a new object would make CodeMirror reconfigure (and close the suggestion list) on every keystroke.
  const setup = useMemo(() => ({ autocompletion: suggestions, foldGutter: false, tabSize: 4 }), [suggestions]);
  // Stable for the same reason, whatever the parent passes.
  const onChangeRef = useRef(onSourceChange);
  onChangeRef.current = onSourceChange;
  const onChange = useCallback((value: string) => onChangeRef.current(value), []);
  const tooLong = source.length > MAX_SOURCE_CHARS;

  return (
    <div className="code-editor">
      <Group justify="space-between" gap="sm" px="sm" py={6} className="code-toolbar" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <SegmentedControl size="xs" value={language} onChange={(v) => onLanguageChange(v as CodeLanguage)}
            data={CODE_LANGUAGES} />
          {language === 'SQL' && (
            <Select size="xs" w={130} value={dialect} allowDeselect={false} aria-label="SQL dialect"
              onChange={(v) => {
                if (!v) return;
                setDialect(v as Dialect);
                localStorage.setItem(DIALECT_KEY, v);
              }}
              data={[{ value: 'standard', label: 'Standard SQL' }, { value: 'postgres', label: 'PostgreSQL' },
                { value: 'mysql', label: 'MySQL' }]} />
          )}
        </Group>
        <Group gap="sm" wrap="nowrap">
          {tooLong && <Text size="xs" c="red">Too long to send ({source.length} / {MAX_SOURCE_CHARS})</Text>}
          <Tooltip label={suggestions ? 'Suggestions on: click to turn off' : 'Suggestions off: click to turn on'}>
            <SegmentedControl size="xs" value={suggestions ? 'on' : 'off'}
              onChange={(v) => setFlag(CODE_SUGGESTIONS, v === 'on')}
              data={[
                { value: 'on', label: <Group gap={4} wrap="nowrap"><IconBulb size={14} />Suggestions</Group> },
                { value: 'off', label: <Group gap={4} wrap="nowrap"><IconBulbOff size={14} />Off</Group> },
              ]} />
          </Tooltip>
        </Group>
      </Group>
      <div className="code-surface">
        <CodeMirror value={source} onChange={onChange} extensions={extensions} height="100%"
          theme={scheme === 'dark' ? 'dark' : 'light'} autoFocus
          // Start typing below the question comment, not on top of it.
          onCreateEditor={(view) => view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })}
          placeholder={language === 'SQL' ? '-- Write your query here' : language === 'PYTHON'
            ? '# Write your code here' : '// Write your code here'}
          basicSetup={setup} />
      </div>
    </div>
  );
}
