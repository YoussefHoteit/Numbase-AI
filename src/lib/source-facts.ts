import { z } from "zod";

export const SOURCE_FACT_LIMIT = 64;
export const sourceFactSchema = z.strictObject({
  section: z.number().int().min(1).max(800),
  location: z.string().min(1).max(1000),
  quote: z.string().min(1).max(240),
});
export type SourceFact = z.infer<typeof sourceFactSchema>;

// Retain exact passages separately from generated prose. Condensation must not
// be the only place an amount, identifier or exception survives.
export function selectSourceFacts(chunks: { index: number; location: string; text: string }[]): SourceFact[] {
  const candidates: (SourceFact & { score: number })[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const ranked: (SourceFact & { score: number })[] = [];
    for (const match of chunk.text.matchAll(/[^.!?\n]+[.!?]?/gu)) {
      const quote = match[0].trim().slice(0, 240).trim();
      const words = quote.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
      if (words.length < 2 || new Set(words).size / words.length < 0.45) continue;
      const score = Number(/(?:[$€£]|\b(?:USD|EUR|GBP|AED|LBP)\s*\d)/iu.test(quote)) * 5
        + Number(/\b(?:total|amount|budget|invoice|supplier|customer|project|approved|deadline|exception|must|shall|prohibited)\b/iu.test(quote)) * 3
        + Number(/\b[\p{L}]+[-_]\d[\p{L}\p{N}_-]*/u.test(quote)) * 2
        + Number(/\d/u.test(quote));
      if (!score) continue;
      ranked.push({ section: chunk.index + 1, location: chunk.location, quote, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    for (const fact of ranked.slice(0, 20)) {
      const key = fact.quote.toLocaleLowerCase();
      if (!seen.has(key)) { seen.add(key); candidates.push(fact); }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.section - b.section);
  const selected = new Set<(typeof candidates)[number]>();
  // Reserve room throughout the source; many facts at the start cannot crowd
  // every middle/end passage out of the retained evidence.
  const total = Math.max(1, chunks.at(-1)?.index === undefined ? 1 : chunks.at(-1)!.index + 1);
  for (let bucket = 0; bucket < 8; bucket++) {
    const local = candidates.filter((fact) => Math.min(7, Math.floor((fact.section - 1) * 8 / total)) === bucket);
    local.slice(0, SOURCE_FACT_LIMIT / 8).forEach((fact) => selected.add(fact));
  }
  for (const fact of candidates) { if (selected.size >= SOURCE_FACT_LIMIT) break; selected.add(fact); }
  return [...selected].sort((a, b) => a.section - b.section).map(({ section, location, quote }) => ({ section, location, quote }));
}
