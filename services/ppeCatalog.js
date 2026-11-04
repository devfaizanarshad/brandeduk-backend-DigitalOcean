const PPE_CATEGORY_SLUGS = Object.freeze(['ppe-safety-wear', 'safetywear']);

// These terms are catalogue intents, not evidence that an individual product is PPE.
// Product inclusion still requires membership of the curated PPE database category.
const PPE_INTENT_PATTERN = /\b(?:ppe(?:\s*(?:&|and)\s*safety(?:\s*wear)?)?|safety[\s-]*wear|protective\s+clothing|work\s+safety|safty)\b/i;

function parsePpeSearchIntent(rawQuery) {
  const query = String(rawQuery || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!query || !PPE_INTENT_PATTERN.test(query)) {
    return { isPpe: false, remainingQuery: query || null };
  }

  const remainingQuery = query
    .replace(PPE_INTENT_PATTERN, ' ')
    .replace(/^[\s,;:|&+\-/]+|[\s,;:|&+\-/]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { isPpe: true, remainingQuery: remainingQuery || null };
}

module.exports = { PPE_CATEGORY_SLUGS, parsePpeSearchIntent };
