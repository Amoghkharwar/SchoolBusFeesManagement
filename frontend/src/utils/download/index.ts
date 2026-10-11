// Native download (Metro picks index.web.ts on web).
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { apiFileFetch } from '@/src/auth';

import { fileNameFrom } from './filename';

/** A blob's contents as base64, via the FileReader React Native provides. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the downloaded file'));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves a report from the API into the app's cache and opens the share sheet,
 * so it can go to Files, Drive or WhatsApp. Fetched with the token in a header —
 * never in the URL. Resolves to the file name.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  const res = await apiFileFetch(path);
  const name = fileNameFrom(res, fallbackName);
  const blob = await res.blob();
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(await blobToBase64(blob), { encoding: 'base64' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: blob.type || undefined, dialogTitle: name });
  }
  return name;
}
