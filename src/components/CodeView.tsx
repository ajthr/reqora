import { useEffect, useMemo, useRef, useState } from 'react';
import { responseMatches, responsePreview } from '../lib/responses';

function SyntaxLine({ text }: { text: string }) {
  const parts = [];
  let position = 0;
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b(?:true|false|null)\b/g)) {
    const index = token.index;
    parts.push(text.slice(position, index));
    const kind = token[0].startsWith('"') ? (/^\s*:/.test(text.slice(index + token[0].length)) ? 'key' : 'string') : 'number';
    parts.push(<span key={index} className={`syntax-${kind}`}>{token[0]}</span>);
    position = index + token[0].length;
  }
  parts.push(text.slice(position));
  return <>{parts}</>;
}

export default function CodeView({ text, highlight, search = '' }: { text: string; highlight: boolean; search?: string }) {
  const preview = useMemo(() => responsePreview(text), [text]);
  const found = useMemo(() => responseMatches(preview.text, search), [preview.text, search]);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setActive(0); }, [text, search]);
  useEffect(() => { if (search) root.current?.querySelector('.active-match')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, text, search]);
  const byLine = useMemo(() => {
    const result = new Map<number, { start: number; end: number; id: number }[]>();
    let line = 0, offset = 0;
    found.matches.forEach((match, id) => {
      while (line < preview.lines.length - 1 && offset + preview.lines[line].length < match.start) { offset += preview.lines[line].length + 1; line++; }
      const parts = result.get(line) || [];
      parts.push({ start: match.start - offset, end: match.end - offset, id }); result.set(line, parts);
    });
    return result;
  }, [found, preview]);
  return <>
    {search && <div className="response-search-navigation"><span role="status">{found.matches.length ? `${Math.min(active + 1, found.matches.length)} of ${found.matches.length}${found.limited ? '+' : ''}` : 'No matches'} in displayed body</span><button className="text-button" aria-label="Previous response match" disabled={!found.matches.length} onClick={() => setActive((active - 1 + found.matches.length) % found.matches.length)}>Previous</button><button className="text-button" aria-label="Next response match" disabled={!found.matches.length} onClick={() => setActive((active + 1) % found.matches.length)}>Next</button></div>}
    <div ref={root} className="code-view" aria-label="Response body" tabIndex={0}>
      {preview.lines.map((line, index) => {
        const ranges = byLine.get(index) || [];
        let offset = 0;
        const parts = [];
        for (const range of ranges) {
          parts.push(line.slice(offset, range.start));
          parts.push(<mark key={range.id} className={range.id === active ? 'active-match' : undefined}>{line.slice(range.start, range.end)}</mark>);
          offset = range.end;
        }
        parts.push(line.slice(offset));
        return <div className="code-line" key={index}><span className="line-number" aria-hidden="true">{index + 1}</span><code>{search ? parts : highlight ? <SyntaxLine text={line} /> : line || ' '}</code></div>;
      })}
      {preview.truncated && <p className="preview-notice">Preview limited to 100,000 characters / 2,000 lines. Search covers this preview. Download the complete response.</p>}
    </div>
  </>;
}
