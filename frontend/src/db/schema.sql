-- The workpaper's only table: an append-only log of acts over the immutable packet.
-- Applied idempotently on server start (src/lib/server/db.ts).

create table if not exists acts (
  seq          bigserial    primary key,
  id           uuid         not null unique,
  engagement   text         not null,              -- 'main' or a fresh copy id
  recorded_at  timestamptz  not null,              -- wall clock (audit truth)
  season_at    timestamptz  not null,              -- season clock when written
  actor        text         not null,              -- st-01..st-06 | cu-01 | cu-02 | system
  actor_role   text         not null,              -- resolved on the server, never from the request
  type         text         not null,
  target       text         not null,
  refs         text[]       not null default '{}',
  body         jsonb        not null,
  derived      jsonb        not null default '{}',
  sealed       jsonb,                              -- server-only clear values (e.g. a corrected SSN); never sent to clients
  batch_id     uuid,
  prev_hash    char(64)     not null,
  hash         char(64)     not null               -- sha256(prev_hash || canonical(row without seq/hash))
);
create index if not exists acts_eng_seq on acts (engagement, seq);
create index if not exists acts_refs on acts using gin (refs);

create or replace function acts_append_only() returns trigger language plpgsql as
$$ begin raise exception 'acts is append-only: record a revert act instead'; end $$;

drop trigger if exists acts_no_update on acts;
create trigger acts_no_update before update or delete on acts
  for each row execute function acts_append_only();
drop trigger if exists acts_no_truncate on acts;
create trigger acts_no_truncate before truncate on acts
  for each statement execute function acts_append_only();
