/** The file name the server picked (Content-Disposition), else `fallback`. */
export function fileNameFrom(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition') || '';
  const m = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return m ? decodeURIComponent(m[1].trim()) : fallback;
}
