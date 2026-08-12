import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_LINES = 5_000;
const MAX_LINE_CHARS = 8_192;
const SECTION_RX = /^[A-Za-z0-9_.-]+$/;
const KEY_RX = /^[A-Za-z0-9_.-]+$/;

const EXAMPLE_PATHS = {
  worker: resolve(REPO_ROOT, 'apps/email-worker/wrangler.toml.example'),
  web: resolve(REPO_ROOT, 'apps/web/wrangler.toml.example'),
};
const ACTIVE_PATHS = {
  worker: resolve(REPO_ROOT, 'apps/email-worker/wrangler.toml'),
  web: resolve(REPO_ROOT, 'apps/web/wrangler.toml'),
};

const failures = [];

function relativeLabel(file) {
  return file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
}

function fail(file, field, message) {
  failures.push(`${relativeLabel(file)}: ${field} ${message}`);
}

function stripComment(line) {
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
    } else if (quote === "'") {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '#') {
      return line.slice(0, index);
    }
  }
  if (quote) throw new Error('unterminated string');
  return line;
}

function splitArray(raw) {
  const values = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
    } else if (quote === "'") {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ',') {
      values.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote) throw new Error('unterminated array string');
  values.push(raw.slice(start).trim());
  return values.filter(Boolean);
}

function parseValue(raw) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner ? splitArray(inner).map(parseValue) : [];
  }
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  throw new Error('unsupported value syntax');
}

function parseToml(file) {
  const size = statSync(file).size;
  if (size > MAX_CONFIG_BYTES) throw new Error(`exceeds ${MAX_CONFIG_BYTES} bytes`);
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_LINES) throw new Error(`exceeds ${MAX_LINES} lines`);

  const tables = new Map([['', new Map()]]);
  const arrays = new Map();
  let current = tables.get('');
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index];
    if (source.length > MAX_LINE_CHARS) throw new Error(`line ${index + 1} is too long`);
    let line;
    try {
      line = stripComment(source).trim();
    } catch (error) {
      throw new Error(`line ${index + 1}: ${error.message}`);
    }
    if (!line) continue;

    const arrayHeader = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayHeader) {
      const path = arrayHeader[1].trim();
      if (!SECTION_RX.test(path)) throw new Error(`line ${index + 1}: invalid array-table path`);
      const entries = arrays.get(path) || [];
      current = new Map();
      entries.push(current);
      arrays.set(path, entries);
      continue;
    }

    const tableHeader = line.match(/^\[([^\]]+)\]$/);
    if (tableHeader) {
      const path = tableHeader[1].trim();
      if (!SECTION_RX.test(path)) throw new Error(`line ${index + 1}: invalid table path`);
      if (tables.has(path)) throw new Error(`line ${index + 1}: duplicate table`);
      current = new Map();
      tables.set(path, current);
      continue;
    }

    const assignment = line.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (!assignment) throw new Error(`line ${index + 1}: unsupported statement`);
    const key = assignment[1].trim();
    if (!KEY_RX.test(key)) throw new Error(`line ${index + 1}: invalid key`);
    if (current.has(key)) throw new Error(`line ${index + 1}: duplicate key`);
    try {
      current.set(key, parseValue(assignment[2]));
    } catch {
      // Never echo a malformed value: active ignored configs may contain
      // operator data even though secrets belong in Cloudflare secret stores.
      throw new Error(`line ${index + 1}: invalid or unsupported value`);
    }
  }

  return {
    file,
    table(path = '') {
      return tables.get(path) || new Map();
    },
    entries(path) {
      return arrays.get(path) || [];
    },
  };
}

function stringValue(record, key) {
  const value = record?.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireFalse(config, tablePath, key) {
  if (config.table(tablePath).get(key) !== false) {
    fail(config.file, tablePath ? `${tablePath}.${key}` : key, 'must be false');
  }
}

function requireEmptyArray(config, tablePath, key) {
  const value = config.table(tablePath).get(key);
  if (!Array.isArray(value) || value.length !== 0) {
    fail(config.file, tablePath ? `${tablePath}.${key}` : key, 'must be an explicit empty array');
  }
}

function requireSingleBinding(config, path, bindingKey, bindingValue) {
  const matches = config.entries(path).filter((entry) => stringValue(entry, bindingKey) === bindingValue);
  if (matches.length !== 1) {
    fail(config.file, path, `must contain exactly one ${bindingKey}=${bindingValue} entry`);
    return null;
  }
  return matches[0];
}

function requireNamed(config, entry, path, key) {
  const value = stringValue(entry, key);
  if (!value) fail(config.file, `${path}.${key}`, 'must be a non-empty string');
  return value;
}

function requirePositiveIntegerString(config, entry, path, key) {
  const value = requireNamed(config, entry, path, key);
  if (!value) return null;
  try {
    if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error('invalid');
  } catch {
    fail(config.file, `${path}.${key}`, 'must be a positive integer string');
    return null;
  }
  return value;
}

function requireDistinct(config, path, previewValue, productionValue) {
  if (previewValue && productionValue && previewValue === productionValue) {
    fail(config.file, path, 'must differ from the production resource');
  }
}

function validateDistinctEntries(config, previewPath, productionPath, keys) {
  const production = config.entries(productionPath);
  const preview = config.entries(previewPath);
  for (const key of keys) {
    const productionValues = new Set(production.map((entry) => stringValue(entry, key)).filter(Boolean));
    for (const entry of preview) {
      const value = requireNamed(config, entry, previewPath, key);
      if (value && productionValues.has(value)) {
        fail(config.file, `${previewPath}.${key}`, 'must not reuse a production resource');
      }
    }
  }
}

function validateRateLimitBindings(config) {
  const paths = ['ratelimits', 'env.preview.ratelimits'];
  const expectedNames = ['INBOUND_ACTOR_RATE_LIMITER', 'INBOUND_GLOBAL_RATE_LIMITER', 'INBOUND_ABUSE_ALERT_RATE_LIMITER'];
  const namespaceIds = new Set();

  for (const path of paths) {
    const entries = config.entries(path);
    for (const name of expectedNames) {
      const entry = requireSingleBinding(config, path, 'name', name);
      if (!entry) continue;
      const namespaceId = requirePositiveIntegerString(config, entry, path, 'namespace_id');
      if (namespaceId) {
        if (namespaceIds.has(namespaceId)) {
          fail(config.file, `${path}.namespace_id`, 'must not reuse another inbound rate-limit namespace');
        }
        namespaceIds.add(namespaceId);
      }
      const limit = entry.get('simple.limit');
      const period = entry.get('simple.period');
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        fail(config.file, `${path}.simple.limit`, 'must be a positive integer');
      }
      if (period !== 10 && period !== 60) {
        fail(config.file, `${path}.simple.period`, 'must be 10 or 60 seconds');
      }
    }
  }
}

function validateWorker(config) {
  const root = config.table();
  const preview = config.table('env.preview');
  requireFalse(config, '', 'workers_dev');
  requireFalse(config, '', 'preview_urls');
  requireEmptyArray(config, '', 'routes');

  const sendBindings = config.entries('send_email');
  if (sendBindings.length !== 1 || stringValue(sendBindings[0], 'name') !== 'EMAIL') {
    fail(config.file, 'send_email', 'must contain only the EMAIL production binding');
  }

  const productionName = stringValue(root, 'name');
  const previewName = stringValue(preview, 'name');
  if (!productionName) fail(config.file, 'name', 'must be a non-empty string');
  if (!previewName) fail(config.file, 'env.preview.name', 'must be a non-empty string');
  requireDistinct(config, 'env.preview.name', previewName, productionName);
  requireFalse(config, 'env.preview', 'workers_dev');
  requireFalse(config, 'env.preview', 'preview_urls');
  requireEmptyArray(config, 'env.preview', 'routes');
  requireEmptyArray(config, 'env.preview', 'send_email');
  if (config.entries('env.preview.send_email').length) {
    fail(config.file, 'env.preview.send_email', 'must not contain preview send bindings');
  }

  const productionDb = requireSingleBinding(config, 'd1_databases', 'binding', 'DB');
  const previewDb = requireSingleBinding(config, 'env.preview.d1_databases', 'binding', 'DB');
  const productionR2 = requireSingleBinding(config, 'r2_buckets', 'binding', 'STORAGE');
  const previewR2 = requireSingleBinding(config, 'env.preview.r2_buckets', 'binding', 'STORAGE');
  if (productionDb) {
    requireNamed(config, productionDb, 'd1_databases', 'database_name');
    requireNamed(config, productionDb, 'd1_databases', 'database_id');
  }
  if (productionR2) requireNamed(config, productionR2, 'r2_buckets', 'bucket_name');
  validateDistinctEntries(config, 'env.preview.d1_databases', 'd1_databases', ['database_name', 'database_id']);
  validateDistinctEntries(config, 'env.preview.r2_buckets', 'r2_buckets', ['bucket_name']);
  validateRateLimitBindings(config);

  return { productionName, previewName, productionDb, previewDb, productionR2, previewR2 };
}

function validateWeb(config) {
  const productionDb = requireSingleBinding(config, 'd1_databases', 'binding', 'DB');
  const previewDb = requireSingleBinding(config, 'env.preview.d1_databases', 'binding', 'DB');
  const productionR2 = requireSingleBinding(config, 'r2_buckets', 'binding', 'STORAGE');
  const previewR2 = requireSingleBinding(config, 'env.preview.r2_buckets', 'binding', 'STORAGE');
  const productionService = requireSingleBinding(config, 'services', 'binding', 'EMAIL_SERVICE');
  const previewService = requireSingleBinding(config, 'env.preview.services', 'binding', 'EMAIL_SERVICE');
  if (productionDb) {
    requireNamed(config, productionDb, 'd1_databases', 'database_name');
    requireNamed(config, productionDb, 'd1_databases', 'database_id');
  }
  if (productionR2) requireNamed(config, productionR2, 'r2_buckets', 'bucket_name');
  if (productionService) requireNamed(config, productionService, 'services', 'service');
  validateDistinctEntries(config, 'env.preview.d1_databases', 'd1_databases', ['database_name', 'database_id']);
  validateDistinctEntries(config, 'env.preview.r2_buckets', 'r2_buckets', ['bucket_name']);
  validateDistinctEntries(config, 'env.preview.services', 'services', ['service']);
  if (config.table('env.preview.vars').get('OUTBOUND_PROVIDER') !== 'none') {
    fail(config.file, 'env.preview.vars.OUTBOUND_PROVIDER', 'must be "none"');
  }

  return { productionDb, previewDb, productionR2, previewR2, productionService, previewService };
}

function sameResource(left, right, keys) {
  return Boolean(left && right && keys.every((key) => stringValue(left, key) === stringValue(right, key)));
}

function validatePair(workerConfig, worker, webConfig, web) {
  if (!sameResource(worker.productionDb, web.productionDb, ['database_name', 'database_id'])) {
    fail(webConfig.file, 'd1_databases', 'must match the email Worker production DB resource');
  }
  if (!sameResource(worker.previewDb, web.previewDb, ['database_name', 'database_id'])) {
    fail(webConfig.file, 'env.preview.d1_databases', 'must match the email Worker preview DB resource');
  }
  if (!sameResource(worker.productionR2, web.productionR2, ['bucket_name'])) {
    fail(webConfig.file, 'r2_buckets', 'must match the email Worker production R2 resource');
  }
  if (!sameResource(worker.previewR2, web.previewR2, ['bucket_name'])) {
    fail(webConfig.file, 'env.preview.r2_buckets', 'must match the email Worker preview R2 resource');
  }
  if (stringValue(web.productionService, 'service') !== worker.productionName) {
    fail(webConfig.file, 'services.service', 'must target the production email Worker name');
  }
  if (stringValue(web.previewService, 'service') !== worker.previewName) {
    fail(webConfig.file, 'env.preview.services.service', 'must target the preview email Worker name');
  }
}

function loadAndValidate(paths, label, required) {
  const present = Object.values(paths).filter(existsSync);
  if (required && present.length !== Object.keys(paths).length) {
    failures.push(`${label}: required example configuration is missing`);
    return null;
  }
  if (!present.length) return null;

  const parsed = {};
  for (const [kind, file] of Object.entries(paths)) {
    if (!existsSync(file)) continue;
    try {
      parsed[kind] = parseToml(file);
    } catch (error) {
      failures.push(`${relativeLabel(file)}: could not be safely parsed (${error.message})`);
    }
  }
  if (parsed.worker) parsed.workerResult = validateWorker(parsed.worker);
  if (parsed.web) parsed.webResult = validateWeb(parsed.web);
  if (parsed.worker && parsed.web) {
    validatePair(parsed.worker, parsed.workerResult, parsed.web, parsed.webResult);
  }
  return parsed;
}

const examples = loadAndValidate(EXAMPLE_PATHS, 'examples', true);
const active = loadAndValidate(ACTIVE_PATHS, 'active', false);
const checkedCount = [examples?.worker, examples?.web, active?.worker, active?.web].filter(Boolean).length;

if (failures.length) {
  console.error('Wrangler configuration safety check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Wrangler configuration safety check passed (${checkedCount} fixed-path files checked).`);
}
