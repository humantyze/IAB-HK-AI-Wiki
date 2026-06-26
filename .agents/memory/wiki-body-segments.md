---
name: Wiki page body model (per-source segments)
description: Invariants for how a wiki page body is composed and how concurrency/lifecycle stays safe in the upload→wiki pipeline.
---

# Invariant: wiki body is DERIVED, never authored on merge

`wiki_pages.body_markdown` is rendered from `wiki_pages.body_segments` (one
segment per contributing source). Never append prose straight into
`body_markdown` on a merge — write/replace the source's segment and re-render.

**Why:** the original merge appended each upload's prose into `body_markdown`
with no attribution, so deleting/reverting an upload could only strip its
`sources[]` citation — its prose stayed searchable forever. Segments make every
contribution individually removable and make reprocess idempotent.

**How to apply:**
- Keep segments keyed by source `ref`; replace-in-place when the ref already
  exists so re-running extraction is idempotent.
- Any add/remove of a source must re-derive `body_markdown` from the surviving
  segments in lockstep (the rendering helper is the single source of truth).
- Legacy pages predate segments and are reconstructed lazily from the old body —
  best-effort, no migration sweep. Don't assume a backfill pass ran.
- The column was added additively (ADD COLUMN IF NOT EXISTS at startup, not a
  drizzle migration) to honor the additive-only data-safety constraint.

# Invariant: per-slug writes must be lock-serialized

`wiki_pages.slug` is UNIQUE. Concurrent uploads can extract the SAME new slug;
unsynchronized read→insert races the UNIQUE constraint and the loser's content
was silently dropped ("Wiki extraction failed"). Wrap per-slug read-merge-write
in a transaction + `pg_advisory_xact_lock(hashtext(slug))`.

# Invariant: upload finalize is fire-and-forget → needs a recovery net

Upload finalize (extract→status→index) runs after the 201 response, so a crash
strands uploads in `pending` forever. A startup + periodic sweep must re-drive
stale pending uploads from their stored `rawText`. Keep the single per-upload
reprocess pipeline shared between the admin reprocess endpoint and the sweep so
behavior can't diverge.
