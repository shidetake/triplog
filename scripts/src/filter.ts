import type { NoiseFilters } from "./types.ts";

export type MessageMeta = {
  messageId: string;
  from: string;
  subject: string;
};

export type FilterDecision = {
  keep: MessageMeta[];
  drop: Array<MessageMeta & { reason: string }>;
};

export function applyNoiseFilters(
  messages: MessageMeta[],
  filters: NoiseFilters | undefined,
): FilterDecision {
  const keep: MessageMeta[] = [];
  const drop: Array<MessageMeta & { reason: string }> = [];

  if (!filters) {
    return { keep: [...messages], drop: [] };
  }

  const domains = filters.fromDomains ?? [];
  const patterns = (filters.subjectPatterns ?? []).map((p) => new RegExp(p, "i"));

  for (const m of messages) {
    const fromLc = m.from.toLowerCase();
    const matchedDomain = domains.find((d) => fromLc.includes(d.toLowerCase()));
    if (matchedDomain) {
      drop.push({ ...m, reason: `fromDomain:${matchedDomain}` });
      continue;
    }
    const matchedPattern = patterns.find((re) => re.test(m.subject));
    if (matchedPattern) {
      drop.push({ ...m, reason: `subject:${matchedPattern.source}` });
      continue;
    }
    keep.push(m);
  }

  return { keep, drop };
}
