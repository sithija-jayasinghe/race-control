ALTER TABLE "events" ADD COLUMN "repo_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "repo_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "repo_root" text;--> statement-breakpoint
CREATE INDEX "events_team_repo_target_created_idx" ON "events" USING btree ("team_id","repo_key","target","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Existing sessions and events keep matching by folder name, as before.
UPDATE "sessions" SET "repo_key" = 'local:' || "repo_name" WHERE "repo_name" IS NOT NULL;--> statement-breakpoint
UPDATE "events" SET "repo_key" = "sessions"."repo_key" FROM "sessions" WHERE "sessions"."team_id" = "events"."team_id" AND "sessions"."id" = "events"."session_id" AND "events"."target" IS NOT NULL;
