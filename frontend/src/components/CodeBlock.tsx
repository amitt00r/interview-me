import { CodeHighlight, CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import '@mantine/code-highlight/styles.css';
import type { BoxProps } from '@mantine/core';
import hljs from 'highlight.js/lib/core';
import java from 'highlight.js/lib/languages/java';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import { languageLabel } from '../codepad';
import type { CodeSubmission } from '../types';

// Only the languages the code editor offers, to keep the bundle small. Token colours are in styles.css.
hljs.registerLanguage('java', java);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
const adapter = createHighlightJsAdapter(hljs);

/** Highlights a fenced block's language name if it is one we load, else shows it plain. */
const hljsName = (language: string) => {
  const name = language.toLowerCase();
  return hljs.getLanguage(name) ? name : 'plaintext';
};

/**
 * Read-only, highlighted code: what the candidate submitted (chat, report, Ask AI) or code in a model answer.
 * `compact` collapses long code (over 8 lines) behind an expand button; short code always shows in full.
 */
export function CodeBlock({ code, language, compact = false, ...box }: BoxProps & {
  code: CodeSubmission | string;
  /** For a plain string: the fenced block's language, e.g. "java". */
  language?: string;
  compact?: boolean;
}) {
  const source = typeof code === 'string' ? code : code.source;
  const lang = typeof code === 'string' ? hljsName(language ?? '') : code.language.toLowerCase();
  const collapse = compact && source.split('\n').length > 8;
  return (
    <CodeHighlightAdapterProvider adapter={adapter}>
      <CodeHighlight {...box} code={source} language={lang} withBorder withExpandButton={collapse}
        defaultExpanded={!collapse} maxCollapsedHeight={160} radius="md" className="code-block"
        copyLabel={typeof code === 'string' ? 'Copy code' : `Copy ${languageLabel(code.language)}`}
        withFirstLineIndentation />
    </CodeHighlightAdapterProvider>
  );
}

/** Splits text on ``` fences: prose parts and code parts (with the fence's language, if any). */
export function splitFences(text: string): { code: boolean; text: string; language: string }[] {
  const parts: { code: boolean; text: string; language: string }[] = [];
  const fence = /```([\w+#-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index), language: '' });
    parts.push({ code: true, text: m[2].replace(/\n$/, ''), language: m[1] });
    last = fence.lastIndex;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last), language: '' });
  return parts;
}
