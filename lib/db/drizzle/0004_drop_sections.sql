-- Drop section_versions and sections tables (removed from schema)
-- Also clean up any stale knowledge_chunks rows that referenced sections
DROP TABLE IF EXISTS "section_versions" CASCADE;
DROP TABLE IF EXISTS "sections" CASCADE;
DELETE FROM "knowledge_chunks" WHERE source_type = 'section';
