import { useEffect, useRef, useState } from "react";
import { ThemePicker } from "../shared/ThemePicker";

export function PreferencesMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector("select")?.focus();
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="preferences-menu" ref={root}>
      <button ref={trigger} className="icon-button" aria-label="设置" title="设置" aria-haspopup="dialog"
        aria-expanded={open} aria-controls="preferencesPopover" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9.5 3-.6 2.3-1.8 1.1-2.3-.6-2.5 4.4L4 12v2l-1.7 1.8 2.5 4.4 2.3-.6 1.8 1.1.6 2.3h5l.6-2.3 1.8-1.1 2.3.6 2.5-4.4L20 14v-2l1.7-1.8-2.5-4.4-2.3.6-1.8-1.1L14.5 3Z" transform="translate(1.2 .3) scale(.9)" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      <div id="preferencesPopover" className="preferences-popover" role="dialog" aria-labelledby="preferencesTitle" hidden={!open}>
        <div className="preferences-heading">
          <h2 id="preferencesTitle">设置</h2>
          <button className="icon-button" aria-label="关闭设置" onClick={close}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <ThemePicker />
      </div>
    </div>
  );
}
