import { useLayoutEffect, useRef, type RefObject } from "react";

const dialogs: HTMLElement[] = [];
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

export function useSessionDialog({ active, dialogRef, bodyClass, onClose, busy, onKeyDown }: {
  active: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  bodyClass?: string;
  onClose: () => void;
  busy?: boolean | (() => boolean);
  onKeyDown?: (event: KeyboardEvent) => void;
}) {
  const latest = useRef({ onClose, busy, onKeyDown });
  latest.current = { onClose, busy, onKeyDown };
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!active || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const previousInert = root?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    const scroll = { x: window.scrollX, y: window.scrollY };
    if (root && !root.contains(dialog)) root.inert = true;
    document.body.style.overflow = "hidden";
    if (bodyClass) document.body.classList.add(bodyClass);
    const parentDialog = dialogs.at(-1);
    const parentInert = parentDialog?.inert ?? false;
    if (parentDialog) parentDialog.inert = true;
    dialogs.push(dialog);
    const targets = () => {
      const elements = [...dialog.querySelectorAll<HTMLElement>(focusableSelector), ...document.querySelectorAll<HTMLElement>(`.word-hover-popover ${focusableSelector.split(", ").join(", .word-hover-popover ")}`)];
      return elements.filter(element => element.getClientRects().length > 0 && !element.closest("[inert]"));
    };
    (targets()[0] ?? dialog).focus({ preventScroll: true });
    const blocked = () => typeof latest.current.busy === "function" ? latest.current.busy() : latest.current.busy;
    const dismiss = (event: Event) => {
      if (dialogs.at(-1) !== dialog) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const popoverClose = document.querySelector<HTMLButtonElement>(".popover-close");
      if (popoverClose) popoverClose.click();
      else if (!blocked()) latest.current.onClose();
    };
    const keydown = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== dialog) return;
      if (event.key === "Escape") { dismiss(event); return; }
      if (event.key === "Tab") {
        const elements = targets();
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (!elements.length) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); elements.at(-1)!.focus(); }
        else if (!event.shiftKey && (index < 0 || index === elements.length - 1)) { event.preventDefault(); elements[0].focus(); }
      }
      latest.current.onKeyDown?.(event);
    };
    const focusin = (event: FocusEvent) => {
      if (dialogs.at(-1) !== dialog) return;
      const target = event.target as HTMLElement;
      if (!dialog.contains(target) && !target.closest?.(".word-hover-popover")) (targets()[0] ?? dialog).focus({ preventScroll: true });
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("cyword-back", dismiss, true);
    document.addEventListener("focusin", focusin);
    return () => {
      dialogs.splice(dialogs.indexOf(dialog), 1);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("cyword-back", dismiss, true);
      document.removeEventListener("focusin", focusin);
      if (bodyClass) document.body.classList.remove(bodyClass);
      if (root) root.inert = previousInert;
      if (parentDialog) parentDialog.inert = parentInert;
      document.body.style.overflow = previousOverflow;
      window.scrollTo(scroll.x, scroll.y);
      const fallback = ['.word-search-input-row input', '.vocabulary-filters button.active', '.floating-study-start', '.sidebar [aria-current="page"]']
        .map(selector => root?.querySelector<HTMLElement>(selector)).find(element => element && element.getClientRects().length > 0);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      else fallback?.focus({ preventScroll: true });
    };
  }, [active, dialogRef, bodyClass]);
}
