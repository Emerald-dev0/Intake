-- Phase: the developer workspace — projects, forms and form versions.
--
-- Intake for Developers is a second capability inside the same product, the same account and the
-- same database. Nothing here alters an existing table: a project belongs to a user, a form belongs
-- to a project, and a form has versions.
--
-- The versioning is the point. A published version is immutable, so a submission can always be
-- checked against the definition that was live when it was accepted, and editing a live form
-- cannot rewrite what respondents already answered. A form has at most one published version;
-- the partial unique index below is what enforces that.
--
-- Ownership is explicit: a user owns projects, a project owns forms, a form owns versions. Every
-- read and write in the server follows that chain, so a form can never be reached by someone who
-- does not own the project it belongs to.
--
-- Rollback: DROP TABLE dev_form_version, dev_form, dev_project; — nothing outside the developer
-- workspace reads these tables, and the workspace pages say the capability is still being built.

CREATE TABLE IF NOT EXISTS dev_project (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  -- The account that owns this project. Deleting the account deletes the project with it.
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- Readable, stable, and unique per account rather than globally: two people may both have a
  -- project called "Website".
  slug text NOT NULL CHECK (char_length(slug) BETWEEN 3 AND 60 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text CHECK (description IS NULL OR char_length(description) <= 400),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS dev_project_user_idx ON dev_project (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS dev_form (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  project_id text NOT NULL REFERENCES dev_project(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- The permanent public address of the hosted form, unique inside its project.
  slug text NOT NULL CHECK (char_length(slug) BETWEEN 3 AND 60 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'paused', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug)
);

CREATE INDEX IF NOT EXISTS dev_form_project_idx ON dev_form (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS dev_form_version (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
  form_id text NOT NULL REFERENCES dev_form(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  -- The field list, the theme and the form settings, as one document. It is written and read as
  -- JSON, never as SQL, so a field type added later does not need a migration.
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (form_id, version)
);

CREATE INDEX IF NOT EXISTS dev_form_version_form_idx ON dev_form_version (form_id, version DESC);

-- At most one published version per form. The next one supersedes it.
CREATE UNIQUE INDEX IF NOT EXISTS dev_form_version_published_idx
  ON dev_form_version (form_id) WHERE state = 'published';
