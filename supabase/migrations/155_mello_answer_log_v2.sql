-- Answer-contract observability (Phase 8/13): record what each answer used and whether it changed the
-- Company Brain, so "why did Mello say this + did it learn anything?" is answerable without the transcript.
-- Additive to mig 154; safe to run before or after it (guards for the table existing).
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'mello_answer_log') then
    alter table mello_answer_log add column if not exists created_memory boolean default false;  -- did this turn extract a durable memory?
    alter table mello_answer_log add column if not exists conflict boolean default false;         -- did a belief conflict get flagged?
    alter table mello_answer_log add column if not exists confidence text;                         -- high | medium | low
  end if;
end $$;
