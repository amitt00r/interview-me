import { completeAnyWord, completeFromList, snippetCompletion, type Completion } from '@codemirror/autocomplete';
import { javaLanguage } from '@codemirror/lang-java';
import { pythonLanguage } from '@codemirror/lang-python';
import type { Extension } from '@codemirror/state';

/*
 * Suggestions for the code editor beyond what the language packages give. Python's package already completes
 * built-ins and names defined in the file, and SQL's completes keywords per dialect; Java's has none, so it gets
 * keywords, common types and words already in the file here. Both Java and Python get interview-style snippets.
 */

const JAVA_KEYWORDS = ('abstract assert boolean break byte case catch char class continue default do double else enum '
  + 'extends final finally float for if implements import instanceof int interface long new null package private '
  + 'protected public return short static super switch synchronized this throw throws transient true false try var '
  + 'void volatile while record yield').split(' ');

const JAVA_TYPES = ('String StringBuilder Integer Long Double Boolean Character Object Math System List ArrayList '
  + 'LinkedList Map HashMap TreeMap LinkedHashMap Set HashSet TreeSet LinkedHashSet Queue Deque ArrayDeque '
  + 'PriorityQueue Stack Iterator Iterable Comparator Comparable Collections Arrays Optional Stream IntStream '
  + 'Collectors Objects Exception RuntimeException IllegalArgumentException IllegalStateException '
  + 'CompletableFuture ExecutorService Executors ConcurrentHashMap AtomicInteger Function BiFunction Supplier '
  + 'Consumer Predicate Runnable Thread').split(' ');

const javaSnippets: Completion[] = [
  snippetCompletion('public static void main(String[] args) {\n\t${}\n}', { label: 'main', detail: 'main method', type: 'keyword' }),
  snippetCompletion('for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', { label: 'for', detail: 'indexed loop', type: 'keyword' }),
  snippetCompletion('for (${var} ${item} : ${items}) {\n\t${}\n}', { label: 'foreach', detail: 'for-each loop', type: 'keyword' }),
  snippetCompletion('while (${condition}) {\n\t${}\n}', { label: 'while', detail: 'loop', type: 'keyword' }),
  snippetCompletion('if (${condition}) {\n\t${}\n}', { label: 'if', detail: 'block', type: 'keyword' }),
  snippetCompletion('if (${condition}) {\n\t${}\n} else {\n\t\n}', { label: 'ifelse', detail: 'if / else', type: 'keyword' }),
  snippetCompletion('try {\n\t${}\n} catch (${Exception} e) {\n\t\n}', { label: 'try', detail: 'try / catch', type: 'keyword' }),
  snippetCompletion('public class ${Name} {\n\t${}\n}', { label: 'class', detail: 'class', type: 'keyword' }),
  snippetCompletion('public record ${Name}(${}) {\n}', { label: 'record', detail: 'record', type: 'keyword' }),
  snippetCompletion('switch (${value}) {\n\tcase ${a} -> ${};\n\tdefault -> ;\n}', { label: 'switch', detail: 'switch', type: 'keyword' }),
  snippetCompletion('Map<${K}, ${V}> ${map} = new HashMap<>();', { label: 'HashMap', detail: 'new map', type: 'class' }),
  snippetCompletion('List<${T}> ${list} = new ArrayList<>();', { label: 'ArrayList', detail: 'new list', type: 'class' }),
  snippetCompletion('Set<${T}> ${set} = new HashSet<>();', { label: 'HashSet', detail: 'new set', type: 'class' }),
  snippetCompletion('Deque<${T}> ${deque} = new ArrayDeque<>();', { label: 'ArrayDeque', detail: 'new stack / queue', type: 'class' }),
  snippetCompletion('PriorityQueue<${T}> ${heap} = new PriorityQueue<>(${});', { label: 'PriorityQueue', detail: 'new heap', type: 'class' }),
  snippetCompletion('System.out.println(${});', { label: 'sout', detail: 'print', type: 'function' }),
  snippetCompletion('.stream().map(${x} -> ${}).collect(Collectors.toList())', { label: 'stream map', detail: 'stream', type: 'method' }),
  snippetCompletion('.stream().filter(${x} -> ${}).collect(Collectors.toList())', { label: 'stream filter', detail: 'stream', type: 'method' }),
  snippetCompletion('getOrDefault(${key}, ${0})', { label: 'getOrDefault', type: 'method' }),
  snippetCompletion('computeIfAbsent(${key}, k -> new ArrayList<>())', { label: 'computeIfAbsent', type: 'method' }),
  snippetCompletion('merge(${key}, 1, Integer::sum)', { label: 'merge count', detail: 'count', type: 'method' }),
];

const javaCompletions: Completion[] = [
  ...JAVA_KEYWORDS.map((label) => ({ label, type: 'keyword' })),
  ...JAVA_TYPES.map((label) => ({ label, type: 'class', boost: -1 })),
  ...javaSnippets,
];

const pythonSnippets: Completion[] = [
  snippetCompletion('def ${name}(${args}):\n\t${pass}', { label: 'def', detail: 'function', type: 'keyword' }),
  snippetCompletion('class ${Name}:\n\tdef __init__(self${}):\n\t\t${pass}', { label: 'class', detail: 'class', type: 'keyword' }),
  snippetCompletion('for ${item} in ${items}:\n\t${pass}', { label: 'for', detail: 'loop', type: 'keyword' }),
  snippetCompletion('for ${i}, ${item} in enumerate(${items}):\n\t${pass}', { label: 'for enumerate', detail: 'loop with index', type: 'keyword' }),
  snippetCompletion('while ${condition}:\n\t${pass}', { label: 'while', detail: 'loop', type: 'keyword' }),
  snippetCompletion('if __name__ == "__main__":\n\t${main()}', { label: 'ifmain', detail: 'script entry point', type: 'keyword' }),
  snippetCompletion('with open(${path}) as ${f}:\n\t${pass}', { label: 'with open', detail: 'file', type: 'keyword' }),
  snippetCompletion('try:\n\t${pass}\nexcept ${Exception} as e:\n\t${raise}', { label: 'try', detail: 'try / except', type: 'keyword' }),
  snippetCompletion('[${x} for ${x} in ${items}]', { label: 'listcomp', detail: 'list comprehension', type: 'keyword' }),
  snippetCompletion('{${k}: ${v} for ${k}, ${v} in ${items}}', { label: 'dictcomp', detail: 'dict comprehension', type: 'keyword' }),
  snippetCompletion('from collections import defaultdict, Counter, deque', { label: 'import collections', detail: 'defaultdict, Counter, deque', type: 'namespace' }),
  snippetCompletion('import heapq', { label: 'import heapq', detail: 'heap', type: 'namespace' }),
  snippetCompletion('import bisect', { label: 'import bisect', detail: 'binary search', type: 'namespace' }),
  snippetCompletion('import itertools', { label: 'import itertools', type: 'namespace' }),
  snippetCompletion('from functools import lru_cache', { label: 'import lru_cache', detail: 'memoisation', type: 'namespace' }),
  snippetCompletion('from dataclasses import dataclass', { label: 'import dataclass', type: 'namespace' }),
  snippetCompletion('from typing import ${List, Dict, Optional}', { label: 'import typing', type: 'namespace' }),
  snippetCompletion('@lru_cache(maxsize=None)\ndef ${name}(${args}):\n\t${pass}', { label: 'memo', detail: 'cached function', type: 'keyword' }),
  snippetCompletion('heapq.heappush(${heap}, ${item})', { label: 'heappush', type: 'function' }),
  snippetCompletion('heapq.heappop(${heap})', { label: 'heappop', type: 'function' }),
  snippetCompletion('defaultdict(${list})', { label: 'defaultdict', type: 'class' }),
  snippetCompletion('Counter(${items})', { label: 'Counter', type: 'class' }),
  snippetCompletion('deque(${})', { label: 'deque', type: 'class' }),
];

/** Extra completion sources per language; only active when the editor's autocompletion is on. */
export const javaSuggestions: Extension = [
  javaLanguage.data.of({ autocomplete: completeFromList(javaCompletions) }),
  javaLanguage.data.of({ autocomplete: completeAnyWord }),
];

export const pythonSuggestions: Extension = pythonLanguage.data.of({ autocomplete: completeFromList(pythonSnippets) });
