import type { DOMAttributes } from 'react';

// Decorative branding should not start mouse selections or native image drags.
export const brandingInteractionProps = {
  onMouseDown: event => { if (event.button === 0) event.preventDefault(); },
  onDoubleClick: event => event.preventDefault(),
  onDragStart: event => event.preventDefault(),
} satisfies Pick<DOMAttributes<HTMLElement>, 'onMouseDown' | 'onDoubleClick' | 'onDragStart'>;
