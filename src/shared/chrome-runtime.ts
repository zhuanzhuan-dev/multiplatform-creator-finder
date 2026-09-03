export interface RuntimeResponse {
  ok: boolean;
  error?: string;
}

export function sendRuntime<T extends RuntimeResponse>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (!response?.ok) reject(new Error(response?.error || "操作失败"));
      else resolve(response);
    });
  });
}
