#!/bin/bash
# This script runs in the DEVELOPMENT environment after a task is merged.
# DATABASE_URL here points to the development database, never production.
set -e
pnpm install --frozen-lockfile
# Push schema changes to the dev database (fast iteration)
pnpm --filter db push
# Generate migration files so production can apply the same changes safely
pnpm --filter db generate
