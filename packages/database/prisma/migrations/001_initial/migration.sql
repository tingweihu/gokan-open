
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE activity_status AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE staff_role AS ENUM ('SYSTEM_ADMIN', 'REGISTRATION_FINANCE', 'CHECKIN_EXPORT');
CREATE TYPE organization_member_role AS ENUM ('LEADER', 'DEPUTY');
CREATE TYPE participant_gender AS ENUM ('MALE', 'FEMALE');
CREATE TYPE participant_grade AS ENUM ('GRADE_1', 'GRADE_2', 'GRADE_3');
CREATE TYPE league_status AS ENUM ('PENDING_CONFIRMATION', 'ACTIVE', 'DISSOLVED');
CREATE TYPE league_member_status AS ENUM ('PENDING', 'CONFIRMED');
CREATE TYPE registration_status AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'CONFIRMED');
CREATE TYPE schedule_version_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE event_entry_source AS ENUM ('REGISTRATION', 'LEADER_MEETING');
CREATE TYPE payment_status AS ENUM ('SUBMITTED', 'CONFIRMED', 'REJECTED');
CREATE TYPE refund_status AS ENUM ('REQUESTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE attachment_purpose AS ENUM ('PAYMENT_PROOF');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status user_status NOT NULL DEFAULT 'ACTIVE',
  first_login_required BOOLEAN NOT NULL DEFAULT TRUE,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sessions_user_id_expires_at_idx ON sessions(user_id, expires_at);

CREATE TABLE policy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_document_id UUID NOT NULL REFERENCES policy_documents(id),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_consents_user_policy_key UNIQUE(user_id, policy_document_id)
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  year INTEGER NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  status activity_status NOT NULL DEFAULT 'DRAFT',
  registration_opens_at TIMESTAMPTZ,
  registration_closes_at TIMESTAMPTZ,
  payment_due_at TIMESTAMPTZ,
  leader_meeting_starts_at TIMESTAMPTZ,
  leader_meeting_ends_at TIMESTAMPTZ,
  competition_starts_at TIMESTAMPTZ,
  competition_ends_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT activities_row_version_check CHECK (row_version >= 1),
  CONSTRAINT activities_registration_window_check CHECK (
    registration_opens_at IS NULL OR registration_closes_at IS NULL OR registration_opens_at < registration_closes_at
  ),
  CONSTRAINT activities_leader_meeting_window_check CHECK (
    leader_meeting_starts_at IS NULL OR leader_meeting_ends_at IS NULL OR leader_meeting_starts_at < leader_meeting_ends_at
  ),
  CONSTRAINT activities_competition_window_check CHECK (
    competition_starts_at IS NULL OR competition_ends_at IS NULL OR competition_starts_at < competition_ends_at
  )
);

CREATE TABLE activity_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role staff_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT activity_staff_activity_user_key UNIQUE(activity_id, user_id)
);
CREATE INDEX activity_staff_user_activity_revoked_idx ON activity_staff(user_id, activity_id, revoked_at);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT organizations_activity_code_key UNIQUE(activity_id, code),
  CONSTRAINT organizations_row_version_check CHECK (row_version >= 1)
);
CREATE INDEX organizations_activity_active_idx ON organizations(activity_id, active);

CREATE TABLE organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role organization_member_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT organization_memberships_organization_user_key UNIQUE(organization_id, user_id)
);
CREATE INDEX organization_memberships_user_revoked_idx ON organization_memberships(user_id, revoked_at);

CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  source_organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  gender participant_gender NOT NULL,
  grade participant_grade NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT participants_row_version_check CHECK (row_version >= 1)
);
CREATE INDEX participants_activity_source_active_idx ON participants(activity_id, source_organization_id, active);

CREATE TABLE league_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL UNIQUE REFERENCES activities(id) ON DELETE CASCADE,
  minimum_member_clubs INTEGER NOT NULL DEFAULT 2,
  maximum_member_clubs INTEGER,
  minimum_participants INTEGER,
  maximum_participants INTEGER,
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT league_rules_minimum_member_clubs_check CHECK (minimum_member_clubs >= 2),
  CONSTRAINT league_rules_maximum_member_clubs_check CHECK (maximum_member_clubs IS NULL OR maximum_member_clubs >= minimum_member_clubs),
  CONSTRAINT league_rules_minimum_participants_check CHECK (minimum_participants IS NULL OR minimum_participants >= 0),
  CONSTRAINT league_rules_maximum_participants_check CHECK (
    maximum_participants IS NULL OR (maximum_participants >= 0 AND (minimum_participants IS NULL OR maximum_participants >= minimum_participants))
  ),
  CONSTRAINT league_rules_row_version_check CHECK (row_version >= 1)
);

CREATE TABLE leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_organization_id UUID NOT NULL REFERENCES organizations(id),
  status league_status NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT leagues_activity_name_key UNIQUE(activity_id, name),
  CONSTRAINT leagues_row_version_check CHECK (row_version >= 1)
);
CREATE INDEX leagues_activity_status_idx ON leagues(activity_id, status);

CREATE TABLE league_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  status league_member_status NOT NULL DEFAULT 'PENDING',
  confirmed_by_user_id UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT league_members_league_organization_key UNIQUE(league_id, organization_id),
  CONSTRAINT league_members_confirmation_check CHECK (
    (status = 'PENDING' AND confirmed_at IS NULL AND confirmed_by_user_id IS NULL)
    OR
    (status = 'CONFIRMED' AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL)
  )
);
CREATE INDEX league_members_organization_status_idx ON league_members(organization_id, status);

CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id),
  league_id UUID REFERENCES leagues(id),
  status registration_status NOT NULL DEFAULT 'DRAFT',
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  return_reason TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT registrations_owner_xor_check CHECK (
    (organization_id IS NOT NULL AND league_id IS NULL)
    OR
    (organization_id IS NULL AND league_id IS NOT NULL)
  ),
  CONSTRAINT registrations_row_version_check CHECK (row_version >= 1),
  CONSTRAINT registrations_state_fields_check CHECK (
    (status = 'DRAFT')
    OR (status = 'SUBMITTED' AND submitted_at IS NOT NULL)
    OR (status = 'RETURNED' AND returned_at IS NOT NULL AND return_reason IS NOT NULL AND length(btrim(return_reason)) > 0)
    OR (status = 'CONFIRMED' AND confirmed_at IS NOT NULL)
  )
);
ALTER TABLE registrations ADD CONSTRAINT registrations_activity_organization_key UNIQUE(activity_id, organization_id);
ALTER TABLE registrations ADD CONSTRAINT registrations_activity_league_key UNIQUE(activity_id, league_id);
CREATE INDEX registrations_activity_status_idx ON registrations(activity_id, status);

CREATE TABLE competition_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_team_size INTEGER,
  max_team_size INTEGER,
  max_teams_per_registration INTEGER NOT NULL DEFAULT 1,
  allow_club BOOLEAN NOT NULL DEFAULT TRUE,
  allow_league BOOLEAN NOT NULL DEFAULT TRUE,
  gender_rule participant_gender,
  allowed_grades participant_grade[] NOT NULL DEFAULT ARRAY[]::participant_grade[],
  rules_json JSONB,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT competition_events_activity_code_key UNIQUE(activity_id, code),
  CONSTRAINT competition_events_display_order_check CHECK (display_order >= 0),
  CONSTRAINT competition_events_min_team_size_check CHECK (min_team_size IS NULL OR min_team_size >= 1),
  CONSTRAINT competition_events_max_team_size_check CHECK (max_team_size IS NULL OR max_team_size >= 1),
  CONSTRAINT competition_events_team_size_range_check CHECK (min_team_size IS NULL OR max_team_size IS NULL OR max_team_size >= min_team_size),
  CONSTRAINT competition_events_max_teams_check CHECK (max_teams_per_registration >= 1),
  CONSTRAINT competition_events_registration_unit_check CHECK (allow_club OR allow_league),
  CONSTRAINT competition_events_row_version_check CHECK (row_version >= 1)
);
CREATE INDEX competition_events_activity_enabled_display_idx ON competition_events(activity_id, enabled, display_order);

CREATE TABLE schedule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status schedule_version_status NOT NULL DEFAULT 'DRAFT',
  created_by_id UUID NOT NULL REFERENCES users(id),
  published_by_id UUID REFERENCES users(id),
  published_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT schedule_versions_activity_version_key UNIQUE(activity_id, version),
  CONSTRAINT schedule_versions_version_check CHECK (version >= 1),
  CONSTRAINT schedule_versions_row_version_check CHECK (row_version >= 1),
  CONSTRAINT schedule_versions_publish_fields_check CHECK (
    (status = 'DRAFT' AND published_at IS NULL AND published_by_id IS NULL)
    OR
    (status IN ('PUBLISHED', 'ARCHIVED') AND published_at IS NOT NULL AND published_by_id IS NOT NULL)
  )
);
CREATE INDEX schedule_versions_activity_status_idx ON schedule_versions(activity_id, status);
CREATE UNIQUE INDEX schedule_versions_one_published_per_activity_idx
  ON schedule_versions(activity_id)
  WHERE status = 'PUBLISHED';

CREATE TABLE event_time_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  schedule_version_id UUID NOT NULL REFERENCES schedule_versions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 1,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  venue TEXT,
  label TEXT,
  CONSTRAINT event_time_windows_schedule_event_ordinal_key UNIQUE(schedule_version_id, event_id, ordinal),
  CONSTRAINT event_time_windows_ordinal_check CHECK (ordinal >= 1),
  CONSTRAINT event_time_windows_time_range_check CHECK (start_at < end_at)
);
CREATE INDEX event_time_windows_activity_event_time_idx ON event_time_windows(activity_id, event_id, start_at, end_at);

CREATE TABLE event_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES competition_events(id),
  source event_entry_source NOT NULL DEFAULT 'REGISTRATION',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT event_entries_registration_event_key UNIQUE(registration_id, event_id),
  CONSTRAINT event_entries_row_version_check CHECK (row_version >= 1)
);
CREATE INDEX event_entries_activity_event_active_idx ON event_entries(activity_id, event_id, active);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_entry_id UUID NOT NULL REFERENCES event_entries(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  name TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT teams_event_entry_ordinal_key UNIQUE(event_entry_id, ordinal),
  CONSTRAINT teams_ordinal_check CHECK (ordinal >= 1),
  CONSTRAINT teams_row_version_check CHECK (row_version >= 1)
);

CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  event_entry_id UUID NOT NULL REFERENCES event_entries(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  removed_at TIMESTAMPTZ,
  CONSTRAINT team_members_event_entry_participant_key UNIQUE(event_entry_id, participant_id),
  CONSTRAINT team_members_row_version_check CHECK (row_version >= 1),
  CONSTRAINT team_members_removed_state_check CHECK (
    (active = TRUE AND removed_at IS NULL)
    OR
    (active = FALSE AND removed_at IS NOT NULL)
  )
);
CREATE INDEX team_members_activity_participant_active_idx ON team_members(activity_id, participant_id, active);

CREATE TABLE participant_event_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  event_entry_id UUID NOT NULL REFERENCES event_entries(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT participant_event_claims_activity_event_participant_key UNIQUE(activity_id, event_id, participant_id),
  CONSTRAINT participant_event_claims_event_entry_participant_key UNIQUE(event_entry_id, participant_id)
);
CREATE INDEX participant_event_claims_registration_event_idx ON participant_event_claims(registration_id, event_id);

CREATE TABLE fee_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL UNIQUE REFERENCES activities(id) ON DELETE CASCADE,
  registration_base_fee INTEGER NOT NULL,
  participant_fee INTEGER NOT NULL,
  default_team_entry_fee INTEGER NOT NULL,
  updated_by_id UUID NOT NULL REFERENCES users(id),
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT fee_schedules_registration_base_fee_check CHECK (registration_base_fee >= 0),
  CONSTRAINT fee_schedules_participant_fee_check CHECK (participant_fee >= 0),
  CONSTRAINT fee_schedules_default_team_entry_fee_check CHECK (default_team_entry_fee >= 0),
  CONSTRAINT fee_schedules_row_version_check CHECK (row_version >= 1)
);

CREATE TABLE event_fee_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  fee_schedule_id UUID NOT NULL REFERENCES fee_schedules(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
  team_entry_fee INTEGER NOT NULL,
  CONSTRAINT event_fee_overrides_fee_schedule_event_key UNIQUE(fee_schedule_id, event_id),
  CONSTRAINT event_fee_overrides_team_entry_fee_check CHECK (team_entry_fee >= 0)
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  uploaded_by_id UUID NOT NULL REFERENCES users(id),
  purpose attachment_purpose NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attachments_size_bytes_check CHECK (size_bytes > 0),
  CONSTRAINT attachments_sha256_check CHECK (sha256 ~ '^[0-9A-Fa-f]{64}$'),
  CONSTRAINT attachments_payment_proof_mime_check CHECK (
    purpose <> 'PAYMENT_PROOF'
    OR mime_type IN ('application/pdf', 'image/jpeg', 'image/png')
  )
);
CREATE INDEX attachments_activity_purpose_created_idx ON attachments(activity_id, purpose, created_at);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL,
  payer_name TEXT,
  bank_account_last_five TEXT,
  reference TEXT,
  status payment_status NOT NULL DEFAULT 'SUBMITTED',
  proof_attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL,
  submitted_by_user_id UUID NOT NULL REFERENCES users(id),
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT payments_amount_check CHECK (amount > 0),
  CONSTRAINT payments_bank_account_last_five_check CHECK (
    bank_account_last_five IS NULL OR bank_account_last_five ~ '^[0-9]{5}$'
  ),
  CONSTRAINT payments_row_version_check CHECK (row_version >= 1),
  CONSTRAINT payments_review_state_check CHECK (
    (status = 'SUBMITTED')
    OR
    (status IN ('CONFIRMED', 'REJECTED') AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL)
  )
);
CREATE INDEX payments_registration_status_paid_idx ON payments(registration_id, status, paid_at);
CREATE INDEX payments_activity_status_idx ON payments(activity_id, status);

CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status refund_status NOT NULL DEFAULT 'REQUESTED',
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  completed_by_user_id UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT refunds_amount_check CHECK (amount > 0),
  CONSTRAINT refunds_reason_check CHECK (length(btrim(reason)) > 0),
  CONSTRAINT refunds_row_version_check CHECK (row_version >= 1),
  CONSTRAINT refunds_completion_state_check CHECK (
    (status IN ('REQUESTED', 'CANCELLED') AND completed_at IS NULL AND completed_by_user_id IS NULL)
    OR
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL)
  )
);
CREATE INDEX refunds_registration_status_idx ON refunds(registration_id, status);
CREATE INDEX refunds_activity_status_idx ON refunds(activity_id, status);


CREATE OR REPLACE FUNCTION gokan_check_participant_activity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = NEW.source_organization_id AND o.activity_id = NEW.activity_id
  ) THEN
    RAISE EXCEPTION 'Participant source organization must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER participants_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, source_organization_id ON participants
FOR EACH ROW EXECUTE FUNCTION gokan_check_participant_activity();

CREATE OR REPLACE FUNCTION gokan_check_league_activity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = NEW.owner_organization_id AND o.activity_id = NEW.activity_id
  ) THEN
    RAISE EXCEPTION 'League owner organization must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leagues_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, owner_organization_id ON leagues
FOR EACH ROW EXECUTE FUNCTION gokan_check_league_activity();

CREATE OR REPLACE FUNCTION gokan_check_league_member_activity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leagues l WHERE l.id = NEW.league_id AND l.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'League member league must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id AND o.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'League member organization must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER league_members_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, league_id, organization_id ON league_members
FOR EACH ROW EXECUTE FUNCTION gokan_check_league_member_activity();

CREATE OR REPLACE FUNCTION gokan_check_registration_activity() RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organization_id AND o.activity_id = NEW.activity_id
  ) THEN
    RAISE EXCEPTION 'Registration organization must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  IF NEW.league_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM leagues l WHERE l.id = NEW.league_id AND l.activity_id = NEW.activity_id
  ) THEN
    RAISE EXCEPTION 'Registration league must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER registrations_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, organization_id, league_id ON registrations
FOR EACH ROW EXECUTE FUNCTION gokan_check_registration_activity();

CREATE OR REPLACE FUNCTION gokan_check_event_time_window_activity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schedule_versions s WHERE s.id = NEW.schedule_version_id AND s.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Schedule version must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM competition_events e WHERE e.id = NEW.event_id AND e.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Competition event must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER event_time_windows_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, schedule_version_id, event_id ON event_time_windows
FOR EACH ROW EXECUTE FUNCTION gokan_check_event_time_window_activity();

CREATE OR REPLACE FUNCTION gokan_check_event_entry_activity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = NEW.registration_id AND r.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Event entry registration must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM competition_events e WHERE e.id = NEW.event_id AND e.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Event entry event must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER event_entries_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, registration_id, event_id ON event_entries
FOR EACH ROW EXECUTE FUNCTION gokan_check_event_entry_activity();

CREATE OR REPLACE FUNCTION gokan_check_team_member_links() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM event_entries ee WHERE ee.id = NEW.event_entry_id AND ee.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Team member event entry must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM participants p WHERE p.id = NEW.participant_id AND p.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Team member participant must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = NEW.team_id AND t.event_entry_id = NEW.event_entry_id) THEN
    RAISE EXCEPTION 'Team must belong to the team member event entry' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER team_members_link_guard
BEFORE INSERT OR UPDATE OF activity_id, event_entry_id, team_id, participant_id ON team_members
FOR EACH ROW EXECUTE FUNCTION gokan_check_team_member_links();

CREATE OR REPLACE FUNCTION gokan_check_participant_event_claim_links() RETURNS trigger AS $$
DECLARE
  entry_registration UUID;
  entry_event UUID;
  entry_activity UUID;
BEGIN
  SELECT registration_id, event_id, activity_id
    INTO entry_registration, entry_event, entry_activity
  FROM event_entries WHERE id = NEW.event_entry_id;

  IF entry_activity IS NULL OR entry_activity <> NEW.activity_id
     OR entry_registration <> NEW.registration_id OR entry_event <> NEW.event_id THEN
    RAISE EXCEPTION 'Participant event claim must match its event entry' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM participants p WHERE p.id = NEW.participant_id AND p.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Claim participant must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER participant_event_claims_link_guard
BEFORE INSERT OR UPDATE OF activity_id, event_id, participant_id, registration_id, event_entry_id ON participant_event_claims
FOR EACH ROW EXECUTE FUNCTION gokan_check_participant_event_claim_links();

CREATE OR REPLACE FUNCTION gokan_check_event_fee_override_activity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fee_schedules f WHERE f.id = NEW.fee_schedule_id AND f.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Fee schedule must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM competition_events e WHERE e.id = NEW.event_id AND e.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Fee override event must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER event_fee_overrides_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, fee_schedule_id, event_id ON event_fee_overrides
FOR EACH ROW EXECUTE FUNCTION gokan_check_event_fee_override_activity();

CREATE OR REPLACE FUNCTION gokan_check_payment_activity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = NEW.registration_id AND r.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Payment registration must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  IF NEW.proof_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM attachments a WHERE a.id = NEW.proof_attachment_id AND a.activity_id = NEW.activity_id
  ) THEN
    RAISE EXCEPTION 'Payment proof attachment must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, registration_id, proof_attachment_id ON payments
FOR EACH ROW EXECUTE FUNCTION gokan_check_payment_activity();

CREATE OR REPLACE FUNCTION gokan_check_refund_activity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id = NEW.registration_id AND r.activity_id = NEW.activity_id) THEN
    RAISE EXCEPTION 'Refund registration must belong to the same activity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER refunds_activity_guard
BEFORE INSERT OR UPDATE OF activity_id, registration_id ON refunds
FOR EACH ROW EXECUTE FUNCTION gokan_check_refund_activity();


CREATE TYPE league_qualification_mode AS ENUM ('ANY', 'ALL');

ALTER TABLE league_rules
  ADD COLUMN low_participant_qualification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN low_participant_threshold INTEGER DEFAULT 15,
  ADD COLUMN gender_imbalance_qualification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN minority_gender_ratio_percent INTEGER DEFAULT 25,
  ADD COLUMN qualification_mode league_qualification_mode NOT NULL DEFAULT 'ANY',
  ADD COLUMN single_gender_exception_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN single_gender_exception_maximum_member_clubs INTEGER,
  ADD COLUMN single_gender_exception_maximum_participants INTEGER DEFAULT 35;

ALTER TABLE league_rules
  ADD CONSTRAINT league_rules_low_participant_threshold_check
    CHECK (low_participant_threshold IS NULL OR low_participant_threshold >= 0),
  ADD CONSTRAINT league_rules_minority_gender_ratio_percent_check
    CHECK (minority_gender_ratio_percent IS NULL OR (minority_gender_ratio_percent >= 0 AND minority_gender_ratio_percent <= 50)),
  ADD CONSTRAINT league_rules_single_gender_max_clubs_check
    CHECK (single_gender_exception_maximum_member_clubs IS NULL OR single_gender_exception_maximum_member_clubs >= 2),
  ADD CONSTRAINT league_rules_single_gender_max_participants_check
    CHECK (single_gender_exception_maximum_participants IS NULL OR single_gender_exception_maximum_participants >= 0);


ALTER TABLE sessions
  ADD COLUMN acknowledged_policy_document_id UUID,
  ADD COLUMN acknowledged_at TIMESTAMPTZ;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_acknowledged_policy_document_id_fkey
  FOREIGN KEY (acknowledged_policy_document_id) REFERENCES policy_documents(id);

CREATE INDEX sessions_acknowledged_policy_document_idx
  ON sessions (acknowledged_policy_document_id);


CREATE TYPE team_admission_status AS ENUM ('PENDING', 'ADMITTED', 'REJECTED');

ALTER TABLE competition_events
  ADD COLUMN team_capacity INTEGER;

ALTER TABLE teams
  ADD COLUMN admission_status team_admission_status NOT NULL DEFAULT 'ADMITTED';

ALTER TABLE competition_events
  ADD CONSTRAINT competition_events_team_capacity_check
  CHECK (team_capacity IS NULL OR team_capacity > 0);


CREATE TYPE leader_meeting_status AS ENUM ('SCHEDULED', 'ENTRY_OPEN', 'ENTRY_CLOSED_PARTICIPANT_OPEN', 'CLOSED');
CREATE TYPE leader_meeting_snapshot_kind AS ENUM ('BASELINE', 'FINAL');

CREATE TABLE leader_meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL,
  status leader_meeting_status NOT NULL DEFAULT 'SCHEDULED',
  row_version INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ,
  entry_closed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  started_by_id UUID,
  entry_closed_by_id UUID,
  closed_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT leader_meetings_pkey PRIMARY KEY (id),
  CONSTRAINT leader_meetings_activity_id_key UNIQUE (activity_id),
  CONSTRAINT leader_meetings_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
  CONSTRAINT leader_meetings_started_by_id_fkey FOREIGN KEY (started_by_id) REFERENCES users(id),
  CONSTRAINT leader_meetings_entry_closed_by_id_fkey FOREIGN KEY (entry_closed_by_id) REFERENCES users(id),
  CONSTRAINT leader_meetings_closed_by_id_fkey FOREIGN KEY (closed_by_id) REFERENCES users(id)
);
CREATE INDEX leader_meetings_activity_id_status_idx ON leader_meetings(activity_id, status);

CREATE TABLE leader_meeting_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  leader_meeting_id UUID NOT NULL,
  kind leader_meeting_snapshot_kind NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  amount_due INTEGER NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload JSONB NOT NULL,
  created_by_id UUID NOT NULL,
  CONSTRAINT leader_meeting_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT leader_meeting_snapshots_meeting_kind_key UNIQUE (leader_meeting_id, kind),
  CONSTRAINT leader_meeting_snapshots_meeting_fkey FOREIGN KEY (leader_meeting_id) REFERENCES leader_meetings(id) ON DELETE CASCADE,
  CONSTRAINT leader_meeting_snapshots_created_by_fkey FOREIGN KEY (created_by_id) REFERENCES users(id)
);
CREATE INDEX leader_meeting_snapshots_meeting_captured_idx ON leader_meeting_snapshots(leader_meeting_id, captured_at);


ALTER TYPE attachment_purpose ADD VALUE 'TOTAL_ROSTER';

ALTER TABLE activities
  ADD COLUMN remittance_instructions TEXT;

ALTER TABLE registrations
  ADD COLUMN total_roster_attachment_id UUID;

CREATE UNIQUE INDEX registrations_total_roster_attachment_id_key
  ON registrations(total_roster_attachment_id);

ALTER TABLE registrations
  ADD CONSTRAINT registrations_total_roster_attachment_id_fkey
  FOREIGN KEY (total_roster_attachment_id) REFERENCES attachments(id)
  ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;

CREATE TABLE login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX login_attempts_account_created_idx ON login_attempts(account_key, created_at);
CREATE INDEX login_attempts_source_created_idx ON login_attempts(source_key, created_at);
CREATE INDEX login_attempts_created_idx ON login_attempts(created_at);
