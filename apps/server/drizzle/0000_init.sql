CREATE TYPE "public"."agent" AS ENUM('claude_code', 'codex');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."event_decision" AS ENUM('allow', 'deny', 'ask', 'none', 'pending');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('lead', 'developer');--> statement-breakpoint
CREATE TYPE "public"."rule_action" AS ENUM('block', 'approve');--> statement-breakpoint
CREATE TYPE "public"."rule_mode" AS ENUM('enforce', 'shadow');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'idle', 'ended');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "approvals_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "dev_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "dev_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"tool_name" text,
	"target" text,
	"summary" text,
	"payload_redacted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision" "event_decision" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_team_id_key" UNIQUE("team_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tool" text NOT NULL,
	"pattern" text NOT NULL,
	"action" "rule_action" NOT NULL,
	"mode" "rule_mode" DEFAULT 'shadow' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_team_id_key" UNIQUE("team_id","id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"agent" "agent" NOT NULL,
	"agent_session_id" text NOT NULL,
	"repo_name" text,
	"cwd" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "sessions_team_id_key" UNIQUE("team_id","id"),
	CONSTRAINT "sessions_agent_session_key" UNIQUE("team_id","agent","agent_session_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_session_fk" FOREIGN KEY ("team_id","session_id") REFERENCES "public"."sessions"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_event_fk" FOREIGN KEY ("team_id","event_id") REFERENCES "public"."events"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_rule_fk" FOREIGN KEY ("team_id","rule_id") REFERENCES "public"."rules"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_tokens" ADD CONSTRAINT "dev_tokens_membership_fk" FOREIGN KEY ("team_id","user_id") REFERENCES "public"."memberships"("team_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_fk" FOREIGN KEY ("team_id","session_id") REFERENCES "public"."sessions"("team_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_team_status_idx" ON "approvals" USING btree ("team_id","status","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_team_created_idx" ON "events" USING btree ("team_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_session_created_idx" ON "events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "events_team_target_created_idx" ON "events" USING btree ("team_id","target","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_team_started_idx" ON "sessions" USING btree ("team_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));