'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCsvObjects } = require('../maintenance/lib/stream-csv');

test('streaming CSV parser handles commas, escaped quotes and embedded newlines', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brandeduk-csv-'));
  const source = path.join(directory, 'sample.csv');
  fs.writeFileSync(source, '\uFEFFCode,Name,Description\r\nA1,"Tee, Adult","First line\nSecond ""quoted"" line"\r\n', 'utf8');
  try {
    const rows = [];
    for await (const item of parseCsvObjects(source)) rows.push(item.record);
    assert.deepEqual(rows, [{ Code: 'A1', Name: 'Tee, Adult', Description: 'First line\nSecond "quoted" line' }]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
