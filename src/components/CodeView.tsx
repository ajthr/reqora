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

export default function CodeView({ text, highlight }: { text: string; highlight: boolean }) {
  const lines = text.slice(0, 100_000).split('\n').slice(0, 2000);
  const truncated = text.length > 100_000 || text.split('\n').length > 2000;
  return <div className="code-view" aria-label="Response body" tabIndex={0}>
    {lines.map((line, index) => <div className="code-line" key={index}><span className="line-number" aria-hidden="true">{index + 1}</span><code>{highlight ? <SyntaxLine text={line} /> : line || ' '}</code></div>)}
    {truncated && <p className="preview-notice">Preview limited to 100 KB / 2,000 lines. Download the complete response.</p>}
  </div>;
}
