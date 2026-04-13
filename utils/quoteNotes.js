function collapseBlankLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasValue(value) {
  if (value == null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return true;
}

function isRichContentObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return ['text', 'children', 'content', 'nodes', 'items', 'paragraphs'].some((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function joinRichContent(values, separator = '\n') {
  return collapseBlankLines(
    values
      .map((entry) => extractTextFromRichContent(entry))
      .filter(Boolean)
      .join(separator)
  );
}

function extractTextFromRichContent(value) {
  if (!hasValue(value)) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return joinRichContent(value);
  }

  if (typeof value === 'object') {
    const parts = [];
    const hasNestedContent = hasValue(value.children) ||
      hasValue(value.content) ||
      hasValue(value.nodes) ||
      hasValue(value.items) ||
      hasValue(value.paragraphs);

    if (typeof value.text === 'string' && value.text.trim()) {
      parts.push(value.text);
    }

    if (typeof value.value === 'string' && value.value.trim()) {
      parts.push(value.value);
    }

    if (!hasNestedContent && parts.length > 0) {
      return parts.join('');
    }

    if (Array.isArray(value.children)) {
      parts.push(joinRichContent(value.children, ''));
    } else if (hasValue(value.children)) {
      parts.push(extractTextFromRichContent(value.children));
    }

    ['content', 'nodes', 'items', 'paragraphs'].forEach((key) => {
      if (Array.isArray(value[key])) {
        parts.push(joinRichContent(value[key]));
      } else if (hasValue(value[key])) {
        parts.push(extractTextFromRichContent(value[key]));
      }
    });

    return collapseBlankLines(parts.filter(Boolean).join('\n'));
  }

  return '';
}

function normalizeNotesText(value) {
  if (!hasValue(value)) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return collapseBlankLines(
      value
        .map((entry) => normalizeNotesText(entry))
        .filter(Boolean)
        .join('\n')
    );
  }

  if (typeof value === 'object') {
    if (isRichContentObject(value)) {
      return extractTextFromRichContent(value);
    }

    return '';
  }

  return '';
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (hasValue(value)) {
      return value;
    }
  }
  return null;
}

function extractQuoteNotes(source = {}) {
  if (!source || typeof source !== 'object') {
    return { notes: null, notesNodes: null };
  }

  const rawNotesValue = firstNonEmpty([
    source.notes,
    source.note,
    source.customerNotes,
    source.emailNotes,
    source.customer?.notes,
    source.customer?.note,
    source.customer?.customerNotes,
  ]);

  let notesNodes = firstNonEmpty([
    source.notesNodes,
    source.noteNodes,
    source.notes_nodes,
    source.note_nodes,
    source.nodes,
    source.customer?.notesNodes,
    source.customer?.noteNodes,
    source.customer?.nodes,
  ]);

  if (!notesNodes && (Array.isArray(rawNotesValue) || isRichContentObject(rawNotesValue))) {
    notesNodes = rawNotesValue;
  }

  const notes =
    normalizeNotesText(rawNotesValue) ||
    extractTextFromRichContent(notesNodes) ||
    null;

  return {
    notes,
    notesNodes: notesNodes || null,
  };
}

module.exports = {
  extractQuoteNotes,
  extractTextFromRichContent,
  normalizeNotesText,
};
