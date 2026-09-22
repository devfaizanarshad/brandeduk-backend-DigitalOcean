const { STATUSES, METHODS, FALLBACK_PRIORITY } = require('./customizationCapabilityRules');

const WEIGHT = { [STATUSES.AVAILABLE]: 0, [STATUSES.POA]: 1, [STATUSES.UNAVAILABLE]: 2, [STATUSES.HIDDEN]: 3 };

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeMethod(value) {
  const method = normalizeKey(value);
  if (method === 'screen' || method === 'screenprinting') return 'screen_print';
  if (method === 'dtf_print' || method === 'print') return 'dtf';
  return method;
}

function mostRestrictive(...statuses) {
  return statuses.filter(status => Object.hasOwn(WEIGHT, status)).reduce(
    (current, status) => WEIGHT[status] > WEIGHT[current] ? status : current,
    STATUSES.AVAILABLE,
  );
}

function behaviour(status) {
  return {
    buttonEnabled: status === STATUSES.AVAILABLE || status === STATUSES.POA,
    allowAddToBasket: status === STATUSES.AVAILABLE,
    requiresApproval: status === STATUSES.POA,
    visible: status !== STATUSES.HIDDEN,
  };
}

function message(status) {
  if (status === STATUSES.AVAILABLE) return 'This decoration method is available for online purchase.';
  if (status === STATUSES.POA) return 'This option may be available depending on the garment, artwork and quantity. Please contact us for confirmation.';
  if (status === STATUSES.UNAVAILABLE) return 'This decoration method is not available for the selected product and position.';
  return 'This decoration method is not shown for the selected product and position.';
}

function resolveFromStatuses(input) {
  const method = normalizeMethod(input.method);
  if (!METHODS[method]) {
    const error = new Error(`Unknown decoration method: ${method || '(empty)'}`);
    error.status = 400;
    throw error;
  }
  const productStatus = input.productStatus || STATUSES.POA;
  const positionStatus = input.positionStatus || STATUSES.POA;
  const status = mostRestrictive(METHODS[method].globalStatus, productStatus, positionStatus, input.skuStatus);
  return {
    method,
    methodLabel: METHODS[method].label,
    status,
    ...behaviour(status),
    message: message(status),
    sources: { global: METHODS[method].globalStatus, product: productStatus, position: positionStatus, skuOverride: input.skuStatus || null },
  };
}

function addAlternatives(results) {
  const byMethod = Object.fromEntries(results.map(result => [result.method, result]));
  results.forEach(result => {
    result.alternatives = (FALLBACK_PRIORITY[result.method] || [])
      .map(method => byMethod[method])
      .filter(candidate => candidate?.status === STATUSES.AVAILABLE && candidate.visible)
      .map(candidate => ({ method: candidate.method, label: candidate.methodLabel, status: candidate.status }));
  });
  return byMethod;
}

module.exports = { normalizeKey, normalizeMethod, mostRestrictive, resolveFromStatuses, addAlternatives };
