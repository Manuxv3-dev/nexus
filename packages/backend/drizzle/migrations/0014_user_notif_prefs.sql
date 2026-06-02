-- ADR-034 : Préférences de notification par user.
-- 1 booléen par `kind` de notif (cf. NotificationKindSchema dans @nexus/shared),
-- toutes à TRUE par défaut (opt-out). PK = user_id (1 ligne / user, créée
-- paresseusement au premier GET /preferences). Enforcement au choke point
-- d'insertion (repo.insertNotification / insertNotificationsBulk).

CREATE TABLE "user_notif_prefs" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "event_reminder" boolean DEFAULT true NOT NULL,
  "event_rsvp_requested" boolean DEFAULT true NOT NULL,
  "event_rsvp_received" boolean DEFAULT true NOT NULL,
  "expense_added" boolean DEFAULT true NOT NULL,
  "todo_assigned" boolean DEFAULT true NOT NULL,
  "todo_completed" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_notif_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
