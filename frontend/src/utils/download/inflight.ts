const running = new Map<string, Promise<string>>();

/**
 * One download per path at a time. react-native-web applies a Pressable's new
 * onPress/disabled only after the screen repaints, so a second click landing
 * before that still ran the old handler — with its `busy` flag still false —
 * and saved the file twice. The repeat now joins the download already running.
 */
export function once(path: string, start: () => Promise<string>): Promise<string> {
  const existing = running.get(path);
  if (existing) return existing;
  const task = start().finally(() => running.delete(path));
  running.set(path, task);
  return task;
}
