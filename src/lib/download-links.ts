// File cards receive their URLs from validated server tool results. Model prose
// is not another authority for download endpoints or generated filenames.
export function suppressModelDownload(href: string | undefined, label: string, fileTurn = false) {
  if (!href) return true;
  let path: string;
  try { path = decodeURIComponent(new URL(href, "https://numbase-ai.vercel.app").pathname); }
  catch { return true; }
  if (/\/(?:api\/(?:documents|assets)|storage\/v1\/object)(?:\/|$)/iu.test(path)) return true;
  if (!fileTurn) return false;
  return /\bdownload\b|\.(?:docx|xlsx|pdf|csv|txt|md|json|js|jsx|ts|tsx|py|java|c|cpp|cs|go|rs|rb|php|sql|html|css)\b/iu.test(label)
    || /\.(?:docx|xlsx|pdf|csv|txt|md|json|py|ts|js)$/iu.test(path)
    || path === "/" || /^(?:blob:|data:|sandbox:|file:)/iu.test(href);
}
