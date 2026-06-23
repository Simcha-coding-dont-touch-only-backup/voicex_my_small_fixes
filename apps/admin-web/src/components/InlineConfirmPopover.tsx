import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

interface InlineConfirmPopoverProps {
  open: boolean;
  confirmLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  side?: Side;
  align?: Align;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

function computePosition(
  anchor: DOMRect,
  popover: DOMRect,
  side: Side,
  align: Align,
): { top: number; left: number } {
  const gap = 6;
  let top = 0;
  let left = 0;

  if (side === 'bottom') {
    top = anchor.bottom + gap;
    if (align === 'start') left = anchor.left;
    else if (align === 'center') left = anchor.left + anchor.width / 2 - popover.width / 2;
    else left = anchor.right - popover.width;
  } else if (side === 'top') {
    top = anchor.top - popover.height - gap;
    if (align === 'start') left = anchor.left;
    else if (align === 'center') left = anchor.left + anchor.width / 2 - popover.width / 2;
    else left = anchor.right - popover.width;
  } else if (side === 'right') {
    left = anchor.right + gap;
    if (align === 'start') top = anchor.top;
    else if (align === 'center') top = anchor.top + anchor.height / 2 - popover.height / 2;
    else top = anchor.bottom - popover.height;
  } else {
    left = anchor.left - popover.width - gap;
    if (align === 'start') top = anchor.top;
    else if (align === 'center') top = anchor.top + anchor.height / 2 - popover.height / 2;
    else top = anchor.bottom - popover.height;
  }

  const margin = 8;
  left = Math.max(margin, Math.min(left, window.innerWidth - popover.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - popover.height - margin));

  return { top, left };
}

export function InlineConfirmPopover({
  open,
  confirmLabel = 'Delete',
  busyLabel,
  cancelLabel = 'Cancel',
  side = 'bottom',
  align = 'end',
  busy: busyProp = false,
  onCancel,
  onConfirm,
}: InlineConfirmPopoverProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const busy = busyProp || confirming;

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const anchorEl = anchorRef.current?.parentElement;
    const popoverEl = popoverRef.current;
    if (!anchorEl || !popoverEl) return;

    const update = () => {
      const next = computePosition(
        anchorEl.getBoundingClientRect(),
        popoverEl.getBoundingClientRect(),
        side,
        align,
      );
      setPosition(next);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };

    const onPointerDown = (event: PointerEvent) => {
      const root = anchorRef.current?.parentElement;
      if (root?.contains(event.target as Node)) return;
      onCancel();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onCancel]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <span ref={anchorRef} className="sr-only" aria-hidden />
      {open && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Confirm ${confirmLabel.toLowerCase()}`}
          style={position ? { top: position.top, left: position.left } : { top: -9999, left: -9999 }}
          className="fixed z-[100] flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-lg"
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? busyLabel ?? `${confirmLabel}…` : confirmLabel}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
