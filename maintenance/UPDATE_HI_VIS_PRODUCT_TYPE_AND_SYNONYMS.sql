-- Rename the display name of the existing safety-vests product type
-- while keeping the slug stable so current frontend filters continue working.
UPDATE product_types
SET name = 'Hi Vis'
WHERE slug = 'safety-vests';

-- Generic hi-vis searches should behave like broad text search across all
-- hi-vis apparel, not force users into a single product type.
UPDATE search_synonyms
SET synonym_type = 'feature',
    canonical = 'hi vis'
WHERE LOWER(term) IN (
  'hi vis',
  'hi-vis',
  'hivis',
  'hiviz',
  'hi viz',
  'hi-viz',
  'high vis',
  'high-viz',
  'high visibility',
  'hewis'
);

-- Specific vest intent should still narrow to the Hi Vis vest category.
UPDATE search_synonyms
SET synonym_type = 'product_type',
    canonical = 'hi vis'
WHERE LOWER(term) IN (
  'safety vest',
  'safety vests',
  'high visibility vest',
  'high visibility vests'
);

-- Insert any missing synonym rows safely.
INSERT INTO search_synonyms (term, canonical, synonym_type)
SELECT term, canonical, synonym_type
FROM (
  VALUES
    ('hi vis', 'hi vis', 'feature'),
    ('hi-vis', 'hi vis', 'feature'),
    ('hivis', 'hi vis', 'feature'),
    ('hiviz', 'hi vis', 'feature'),
    ('hi viz', 'hi vis', 'feature'),
    ('hi-viz', 'hi vis', 'feature'),
    ('high vis', 'hi vis', 'feature'),
    ('high-viz', 'hi vis', 'feature'),
    ('high visibility', 'hi vis', 'feature'),
    ('hewis', 'hi vis', 'feature'),
    ('safety vest', 'hi vis', 'product_type'),
    ('safety vests', 'hi vis', 'product_type'),
    ('high visibility vest', 'hi vis', 'product_type'),
    ('high visibility vests', 'hi vis', 'product_type')
) AS desired(term, canonical, synonym_type)
WHERE NOT EXISTS (
  SELECT 1
  FROM search_synonyms existing
  WHERE LOWER(existing.term) = LOWER(desired.term)
);
