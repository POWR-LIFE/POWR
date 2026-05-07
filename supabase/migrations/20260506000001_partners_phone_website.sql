alter table partners
  add column if not exists phone   text,
  add column if not exists website text;
