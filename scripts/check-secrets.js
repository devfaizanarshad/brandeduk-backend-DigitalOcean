const { execFileSync } = require('child_process');
const fs = require('fs');

const sensitiveNames = [
  'ADMIN_PASSWORD',
  'DB_PASSWORD',
  'GOOGLE_CLIENT_SECRET',
  'JWT_SECRET',
  'PGPASSWORD',
  'REDIS_PASSWORD',
  'RESEND_API_KEY',
  'SESSION_SECRET',
  'SMTP_PASS',
  'STRIPE_PRIVATE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'VECTEEZY_API_KEY',
];

const allowedValuePatterns = [
  /^$/,
  /^<.*>$/,
  /^\$\{\{\s*secrets\./,
  /process\.env/,
  /import\.meta\.env/,
  /sync:\s*false/,
  /(?:example|placeholder|your[_ -]|test[_ -]?key)/i,
  /\boptional\b/i,
  /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s|[,)};]|$)/,
  /crypto\.randomBytes\(/,
];

const providerKeyPatterns = [
  /\bre_[A-Za-z0-9_-]{20,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9_-]{16,}\b/,
  /\bwhsec_[A-Za-z0-9_-]{16,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function isAllowed(value) {
  return allowedValuePatterns.some((pattern) => pattern.test(value.trim()));
}

function scanLine(line) {
  if (/\b(?:grep|sed|printf)\b/.test(line) && /\bJWT_SECRET\b/.test(line)) {
    return providerKeyPatterns.some((pattern) => pattern.test(line));
  }

  for (const name of sensitiveNames) {
    const assignment = new RegExp(`\\b${name}\\b\\s*(?:=|:)\\s*(.+)$`, 'i').exec(line);
    if (!assignment) continue;

    const value = assignment[1].trim().replace(/[,;]$/, '').replace(/^['"]|['"]$/g, '');
    return !isAllowed(value);
  }

  return providerKeyPatterns.some((pattern) => pattern.test(line))
    || /process\.env\.DB_PASSWORD\s*\|\|\s*['"][^'"]+['"]/.test(line)
    || /\bpassword\s*:\s*['"][^'"]+['"]/i.test(line)
    || /getenv\(\s*['"](?:DB_PASSWORD|PGPASSWORD)['"]\s*,\s*['"][^'"]+['"]\s*\)/i.test(line);
}

const findings = [];
for (const file of trackedFiles()) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (content.includes('\0')) continue;
  content.split(/\r?\n/).forEach((line, index) => {
    if (scanLine(line)) findings.push(`${file}:${index + 1}`);
  });
}

if (findings.length > 0) {
  console.error('Potential committed secrets found (values suppressed):');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('No plaintext secrets detected in tracked files');
