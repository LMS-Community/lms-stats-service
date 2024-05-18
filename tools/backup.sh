#!/bin/sh

cd "$(dirname "$0")"

rm -f lms-stats.db
npx wrangler d1 export lms-stats --remote --output lms-stats-backup.sql
cat lms-stats-backup.sql | sqlite3 lms-stats.db