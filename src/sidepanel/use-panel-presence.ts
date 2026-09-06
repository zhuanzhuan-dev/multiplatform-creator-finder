import { useEffect } from 'react';

// Ports work on Chrome 120 too; hidden and closed panels release their presence.
export function usePanelPresence() {
  useEffect(() => {
    let disposed = false;
    let port: chrome.runtime.Port | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      clearTimeout(retry);
      if (disposed || document.visibilityState !== 'visible' || port) return;
      const window = await chrome.windows.getCurrent();
      if (disposed || document.visibilityState !== 'visible' || port) return;
      try {
        const current = chrome.runtime.connect({ name: `dra-panel:${window.id}` });
        port = current;
        current.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (port === current) port = null;
          if (!disposed) retry = setTimeout(() => void connect(), 1000);
        });
      } catch { if (!disposed) retry = setTimeout(() => void connect(), 1000); }
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void connect();
      else { const old = port; port = null; old?.disconnect(); }
    };
    void connect();
    document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; clearTimeout(retry); document.removeEventListener('visibilitychange', visibility); port?.disconnect(); };
  }, []);
}
