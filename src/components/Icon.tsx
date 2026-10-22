import type { CSSProperties } from 'react';

const paths = {
  plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm9 5 7 7-7 7', folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  history: 'M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2',
  collection: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18Z',
  send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
  copy: 'M9 9h12v12H9zM15 5V3H3v12h2',
  download: 'M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5', upload: 'M12 16V4m-5 5 5-5 5 5M3 16v5h18v-5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18', lock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
  check: 'm5 12 4 4L19 6', arrow: 'M5 12h14m-6-6 6 6-6 6', terminal: 'm4 6 6 6-6 6M13 18h7',
  file: 'M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 13h8M8 17h6',
  moon: 'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z',
  sun: 'M12 3V1M12 23v-2M3 12H1M23 12h-2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  menu: 'M4 6h16M4 12h16M4 18h16', alert: 'M12 3 2 21h20L12 3ZM12 9v5M12 17v1',
  layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
} as const;

export default function Icon({ name, size = 18, style, className = '' }: { name: keyof typeof paths; size?: number; style?: CSSProperties; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
