const EXACT_TEMPLATES = {
  blouses: ['blouses', 'blouse'],
  'chef-jackets': ['chef-jackets', 'chef-jacket'],
  tunics: ['tunics', 'tunic-scrub-top'],
  tabards: ['tabards', 'tabard'],
  'laptop-cases': ['laptop-cases', 'laptop-sleeve'],
  dungarees: ['dungarees', 'bib-brace'],
  coveralls: ['coveralls', 'coverall-overall'],
  'sports-overtops': ['sports-overtops', 'sports-jersey'],
  'rugby-shirts': ['rugby-shirts', 'rugby-shirt'],
  bodysuits: ['bodysuits', 'baby-bodysuit'],
  bibs: ['bibs', 'baby-bib'],
  towels: ['towels', 'towel'],
  blankets: ['blankets', 'blanket'],
  umbrellas: ['umbrellas', 'umbrella'],
  'dog-t-shirts': ['dog-t-shirts', 'dog-tshirt'],
  'dog-hoodies': ['dog-hoodies', 'dog-hoodie'],
  'dog-jackets': ['dog-jackets', 'dog-jacket'],
  'vests-t-shirt': ['vests-t-shirt', 'sports-vest'],
};

const TYPE_ALIASES = {
  'gilets-and-body-warmers': 'gilets-body-warmers',
  't-shirts': 'tshirts',
  'tee-shirts': 'tshirts',
  'chef-wear': 'chef-jackets',
  'chefs-wear': 'chef-jackets',
};

const CONFIGURED_TYPES = new Set([
  'aprons', 'bags', 'beanies', 'bibs', 'blankets', 'blouses', 'bodysuits',
  'caps', 'chef-jackets', 'coveralls', 'dog-hoodies', 'dog-jackets',
  'dog-t-shirts', 'dungarees', 'fleece', 'gilets-body-warmers', 'hats',
  'hoodies', 'jackets', 'laptop-cases', 'polos', 'rugby-shirts',
  'safety-vests', 'shirts', 'shorts', 'softshells', 'sports-overtops',
  'sweatpants', 'sweatshirts', 'tabards', 'towels', 'trousers', 'tshirts',
  'tunics', 'umbrellas', 'vests-t-shirt',
]);

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveProductTypeSlug(name, productType) {
  const normalizedType = normalizeSlug(productType);
  const aliasedType = TYPE_ALIASES[normalizedType] || normalizedType;
  if (EXACT_TEMPLATES[aliasedType]) return EXACT_TEMPLATES[aliasedType][0];
  if (CONFIGURED_TYPES.has(aliasedType)) return aliasedType;

  const text = `${productType || ''} ${name || ''}`.toLowerCase();
  const hiVis = /\bhi[\s-]?vis(?:ibility)?\b|\bhigh[\s-]?vis(?:ibility)?\b|\bsafety\b/.test(text);
  if (/\bdog\b/.test(text) && /hood/.test(text)) return 'dog-hoodies';
  if (/\bdog\b/.test(text) && /t[\s-]?shirt|\btee\b/.test(text)) return 'dog-t-shirts';
  if (/\bdog\b/.test(text)) return 'dog-jackets';
  if (/baby|toddler|infant/.test(text) && /\bbib\b/.test(text)) return 'bibs';
  if (/baby|toddler|infant/.test(text) && /bodysuit|body suit|onesie/.test(text)) return 'bodysuits';
  if (/baby|toddler|infant/.test(text)) return 'tshirts';
  if (/umbrella/.test(text)) return 'umbrellas';
  if (/blanket/.test(text)) return 'blankets';
  if (/towel/.test(text)) return 'towels';
  if (/chef/.test(text) && /jacket|coat/.test(text)) return 'chef-jackets';
  if (/tunic|scrub/.test(text)) return 'tunics';
  if (/tabard/.test(text)) return 'tabards';
  if (/bib[\s&-]*(?:and[\s&-]*)?brace|dungaree/.test(text)) return 'dungarees';
  if (/coverall|overall|boilersuit|boiler suit/.test(text)) return 'coveralls';
  if (/rugby/.test(text)) return 'rugby-shirts';
  if (/sports? jersey|teamwear jersey|football jersey/.test(text)) return 'sports-overtops';
  if (/sports? vest|running vest|racerback|tank top/.test(text)) return 'vests-t-shirt';
  if (/laptop sleeve|notebook sleeve/.test(text)) return 'laptop-cases';
  if (/\bblouse\b/.test(text)) return 'blouses';
  if (hiVis && /body[\s-]?warmer|gilet/.test(text)) return 'gilets-body-warmers';
  if (hiVis && /\bjacket\b|\bcoat\b|\bbomber\b/.test(text)) return 'jackets';
  if (hiVis && /hood/.test(text)) return 'hoodies';
  if (hiVis && /sweatshirt|sweater/.test(text)) return 'sweatshirts';
  if (hiVis && /polo/.test(text)) return 'polos';
  if (hiVis && /t[\s-]?shirt|\btee\b/.test(text)) return 'tshirts';
  if (hiVis) return 'safety-vests';
  if (/gilet|body[\s-]?warmer/.test(text)) return 'gilets-body-warmers';
  if (/soft[\s-]?shell/.test(text)) return 'softshells';
  if (/sweat[\s-]?pant|jogger|jog[\s-]?(?:pant|bottom)|jogging bottom/.test(text)) return 'sweatpants';
  if (/sweatshirt|\bsweats?\b|crew neck sweat|raglan sweat/.test(text)) return 'sweatshirts';
  if (/beanie|bobble hat|knit(?:ted)? hat|wool hat/.test(text)) return 'beanies';
  if (/fedora|trilby|bucket hat|outback hat|wide[\s-]?brim|sun hat|safari hat|bush hat|legionnaire/.test(text)) return 'hats';
  if (/\bcap\b|baseball cap|snapback|trucker|visor/.test(text)) return 'caps';
  if (/\bapron/.test(text)) return 'aprons';
  if (/laptop[\s-]?case|laptop[\s-]?bag|computer[\s-]?case|tablet[\s-]?case/.test(text)) return 'bags';
  if (/\bhoodie|hooded|zoodie/.test(text)) return 'hoodies';
  if (/\bfleece|microfleece/.test(text)) return 'fleece';
  if (/\bpolo/.test(text)) return 'polos';
  if (/\bvests?\b|\btanks?\b|tank top|racer[\s-]?back|sleeveless t[\s-]?shirt/.test(text)) return 'vests-t-shirt';
  if (/t[\s-]?shirt|\btee\b/.test(text)) return 'tshirts';
  if (/\bjacket|\bparka|\bcoat|\banorak|windbreaker/.test(text)) return 'jackets';
  if (/\btrouser|\bchino|\bpants?\b/.test(text)) return 'trousers';
  if (/\bshorts?\b/.test(text) && !/\bshirt/.test(text)) return 'shorts';
  if (/\bbag\b|rucksack|backpack|holdall|duffle|duffel|tote|shopper|shopping|gymsac|gym[\s-]?sac|drawstring/.test(text)) return 'bags';
  if (/\bshirt|\bblouse/.test(text)) return 'shirts';
  if (/\bhat\b|headwear/.test(text)) return 'hats';
  return '';
}

function resolveSubtypeKey(name, productType, productTypeSlug, explicitSubtypeKey = '') {
  const explicit = normalizeSlug(explicitSubtypeKey);
  const text = `${productType || ''} ${name || ''}`.toLowerCase();
  const hiVis = /\bhi[\s-]?vis(?:ibility)?\b|\bhigh[\s-]?vis(?:ibility)?\b|\bsafety\b/.test(text);
  const normalizedType = TYPE_ALIASES[normalizeSlug(productType)] || normalizeSlug(productType);
  const exactTemplate = EXACT_TEMPLATES[normalizedType];
  if (exactTemplate) return exactTemplate[1];
  const resolvedTemplate = Object.values(EXACT_TEMPLATES).find(
    ([configuredSlug]) => configuredSlug === productTypeSlug,
  );
  if (resolvedTemplate) return resolvedTemplate[1];
  if (explicit) return explicit;
  if (productTypeSlug === 'aprons') return /\b(?:short\s+)?waist(?:er)?\b|\bbar apron\b|\bbistro apron\b|\bserver apron\b|\bmoney pouch\b|\b(?:three|3)[\s-]?pocket apron\b|\bpocket apron\b/.test(text) ? 'waist' : 'bib';
  if (productTypeSlug === 'bags') {
    if (/boot bag|shoe bag/.test(text)) return 'boot-bag';
    if (/messenger|shoulder bag|reporter|courier/.test(text)) return 'messenger';
    if (/back[\s-]?pack|ruck[\s-]?sack|sackpack|knapsack|daypack|haversack|roll[\s-]?top|\b(?:commuter|sonic|pulse|access) pack\b/.test(text)) return 'backpack';
    if (/holdall|duffle|duffel|barrel|roll bag|gym bag|sports bag|travel bag|weekend|kit bag|cargo bag|locker bag|haul bag|traveller|airporter|team bag/.test(text)) return 'holdall';
    if (/book bag/.test(text)) return 'book-bag';
    if (/draw[\s-]?(?:string|cord)|gymsac|gym[\s-]?sac|drytube/.test(text)) return 'drawstring-gymsac';
    if (/laptop|document|briefcase|portfolio|conference|computer|tech organiser|business bag|record bag|despatch bag|digital case|tablet case/.test(text)) return 'laptop-document';
    return 'tote';
  }
  if (productTypeSlug === 'caps') return /trucker/.test(text) ? 'trucker' : 'baseball';
  if (productTypeSlug === 'beanies') return /bobble|pom[\s-]?pom|pom beanie/.test(text) ? 'bobble' : 'cuffed';
  if (productTypeSlug === 'fleece') return /quarter[\s-]?zip|1\/4[\s-]?zip|half[\s-]?zip/.test(text) ? 'quarter-zip' : 'full-zip';
  if (productTypeSlug === 'gilets-body-warmers') {
    if (hiVis) return 'hi-vis-bodywarmer';
    return /padded|puffer|quilted|insulated|thermal/.test(text) ? 'padded' : 'standard';
  }
  if (productTypeSlug === 'hats') return 'bucket';
  if (productTypeSlug === 'safety-vests') return 'waistcoat';
  if (productTypeSlug === 'hoodies') {
    if (hiVis) return 'hi-vis-hoodie';
    return /full[\s-]?zip|zip[\s-]?through|zipped|zip hoodie/.test(text) ? 'full-zip' : 'pullover';
  }
  if (productTypeSlug === 'jackets') {
    if (hiVis) return 'hi-vis-jacket';
    if (/puffer|padded|quilted|insulated|down jacket/.test(text)) return 'padded-puffer';
    if (/waterproof|parka|rain|storm|anorak|long coat/.test(text)) return 'waterproof-parka';
    if (/bomber/.test(text)) return 'bomber';
    return 'workwear';
  }
  if (productTypeSlug === 'polos') {
    if (hiVis) return 'hi-vis-polo';
    return /long[\s-]?sleeve|long sleeved|l\/s\b/.test(text) ? 'long-sleeve' : 'short-sleeve';
  }
  if (productTypeSlug === 'shirts') return /long[\s-]?sleeve|long sleeved|l\/s\b/.test(text) ? 'long-sleeve' : 'short-sleeve';
  if (productTypeSlug === 'shorts') return 'shorts';
  if (productTypeSlug === 'softshells') return 'softshell-jacket';
  if (productTypeSlug === 'sweatpants') return 'joggers';
  if (productTypeSlug === 'sweatshirts') {
    if (hiVis) return 'hi-vis-sweatshirt';
    return /quarter[\s-]?zip|1\/4[\s-]?zip|half[\s-]?zip/.test(text) ? 'quarter-zip' : 'crewneck';
  }
  if (productTypeSlug === 'trousers') return 'work-trousers';
  if (productTypeSlug === 'tshirts') {
    if (/baby|toddler|infant/.test(text)) return 'baby-toddler';
    if (hiVis) return 'hi-vis-tshirt';
    return /long[\s-]?sleeve|long sleeved|l\/s\b/.test(text) ? 'long-sleeve' : 'short-sleeve';
  }
  return '';
}

function resolveCustomizationTemplate({ name = '', productType = '', subtypeKey = '' } = {}) {
  const productTypeSlug = resolveProductTypeSlug(name, productType);
  return {
    productTypeSlug,
    subtypeKey: resolveSubtypeKey(name, productType, productTypeSlug, subtypeKey),
  };
}

module.exports = {
  normalizeSlug,
  resolveCustomizationTemplate,
  resolveProductTypeSlug,
  resolveSubtypeKey,
};
