'use strict';

const fs = require('fs');
const { StringDecoder } = require('string_decoder');

/**
 * RFC-4180 compatible streaming CSV reader.
 *
 * It supports quoted commas, escaped quotes, CRLF files and line breaks inside
 * quoted fields without loading the supplier feed into memory.
 */
async function* parseCsvRows(filePath) {
  const stream = fs.createReadStream(filePath);
  const decoder = new StringDecoder('utf8');

  let field = '';
  let row = [];
  let quoted = false;
  let pendingQuote = false;
  let skipLf = false;
  let firstCharacter = true;

  const consume = function* (text) {
    for (let index = 0; index < text.length; index += 1) {
      let char = text[index];

      if (firstCharacter) {
        firstCharacter = false;
        if (char === '\uFEFF') continue;
      }

      if (skipLf) {
        skipLf = false;
        if (char === '\n') continue;
      }

      if (pendingQuote) {
        pendingQuote = false;
        if (char === '"') {
          field += '"';
          continue;
        }
        quoted = false;
        // The current character terminates the quoted field and still needs
        // to be interpreted as a delimiter/newline below.
      }

      if (quoted) {
        if (char === '"') pendingQuote = true;
        else field += char;
        continue;
      }

      if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        row.push(field);
        field = '';
        if (char === '\r') skipLf = true;
        if (row.length > 1 || row[0] !== '') yield row;
        row = [];
      } else {
        field += char;
      }
    }
  };

  for await (const chunk of stream) {
    for (const parsedRow of consume(decoder.write(chunk))) yield parsedRow;
  }
  for (const parsedRow of consume(decoder.end())) yield parsedRow;

  if (pendingQuote) {
    pendingQuote = false;
    quoted = false;
  }
  if (quoted) throw new Error(`Unclosed quoted field in ${filePath}`);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') yield row;
  }
}

async function* parseCsvObjects(filePath, options = {}) {
  const { strictColumns = true } = options;
  let headers = null;
  let rowNumber = 0;

  for await (const row of parseCsvRows(filePath)) {
    rowNumber += 1;
    if (!headers) {
      headers = row.map(value => value.trim());
      continue;
    }

    if (strictColumns && row.length !== headers.length) {
      throw new Error(
        `CSV column mismatch in ${filePath} at logical row ${rowNumber}: expected ${headers.length}, received ${row.length}`
      );
    }

    const record = {};
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index]] = row[index] ?? '';
    }
    yield { record, rowNumber };
  }

  if (!headers) throw new Error(`CSV is empty: ${filePath}`);
}

module.exports = { parseCsvRows, parseCsvObjects };

