// Web download (Metro picks index.ts on native).
import { apiFileFetch } from '@/src/auth';

import { fileNameFrom } from './filename';

/**
 * Saves a report from the API as a real file in the browser's Downloads.
 *
 * Fetched with the token in a header, then handed to the browser as a blob —
 * opening the URL instead put the token in history and only ever showed the
 * PDF in an untitled background tab, with nothing saved.
 * Resolves to the file name once the download has started.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  const res = await apiFileFetch(path);
  const blob = await res.blob();
  const name = fileNameFrom(res, fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked later rather than now: some browsers read the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}
