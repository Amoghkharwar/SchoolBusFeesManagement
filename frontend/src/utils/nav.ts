import { router } from 'expo-router';

/**
 * Back, or `fallback` when there is nothing to go back to. router.back()
 * quietly does nothing without history — and a page opened by refresh, a link
 * or a typed URL on the web build starts a fresh one, so its back arrow was
 * dead. replace() rather than push(), so Back from the fallback can't loop here.
 */
export function goBack(fallback: string) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback as any);
}
