import type { HttpResponse } from '../../shared/types.ts';
import type { ResponseExample } from '../../shared/workspace.ts';

export function responsePreview(text: string) {
  const lines = text.slice(0, 100_000).split('\n').slice(0, 2000);
  const displayed = lines.join('\n');
  return { text: displayed, lines, truncated: displayed.length < text.length };
}

export function responseMatches(text: string, search: string) {
  const matches: { start: number; end: number }[] = [];
  if (!search) return { matches, limited: false };
  const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  for (const match of text.matchAll(pattern)) {
    if (matches.length === 5000) return { matches, limited: true };
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return { matches, limited: false };
}

export function displayValue(value: unknown, limit = 2000): string {
  try {
    const text = value === undefined ? 'undefined' : JSON.stringify(value);
    return text.length > limit ? text.slice(0, limit) + '… (truncated)' : text;
  } catch { return '[Value too deeply nested to display]'; }
}

export interface ResponseDifference { path: string; before: string; after: string }
export function compareResponses(current: HttpResponse, baseline: ResponseExample) {
  const differences: ResponseDifference[] = [];
  let limited = false, visited = 0;
  const add = (path: string, before: unknown, after: unknown) => {
    if (differences.length === 100) { limited = true; return; }
    differences.push({ path, before: displayValue(before), after: displayValue(after) });
  };
  if (current.status !== baseline.status) add('Status', baseline.status, current.status);
  if (current.statusText !== baseline.statusText) add('Status text', baseline.statusText, current.statusText);
  const headers = (values: HttpResponse['headers']) => {
    const result: Record<string, string[]> = Object.create(null);
    for (const header of values) (result[header.name.toLowerCase()] ??= []).push(header.value);
    return result;
  };
  const walk = (before: unknown, after: unknown, path: string, depth = 0) => {
    if (++visited > 10_000 || depth > 40 || differences.length >= 100) { limited = true; return; }
    if (Object.is(before, after)) return;
    if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
      const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        if (limited) break;
        walk(Object.hasOwn(left, key) ? left[key] : undefined, Object.hasOwn(right, key) ? right[key] : undefined, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1);
      }
    } else add(path, before, after);
  };
  walk(headers(baseline.headers), headers(current.headers), 'Headers');
  if (!baseline.truncated) {
    let before: unknown = baseline.body, after: unknown = current.body;
    if (baseline.encoding === 'utf8' && current.encoding === 'utf8') {
      try { before = JSON.parse(baseline.body); after = JSON.parse(current.body); } catch { before = baseline.body; after = current.body; }
    }
    if (baseline.encoding !== current.encoding) add('Body encoding', baseline.encoding, current.encoding);
    walk(before, after, 'Body');
  }
  return { differences, limited, bodySkipped: !!baseline.truncated };
}

export function sandboxedHtml(body: string): string {
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; form-action \'none\'; base-uri \'none\'">' + body;
}
