-- =============================================================
-- GYM BOARDS — viewing distance
--
-- Jamie (09-11): "it might be on a 50 inch screen that can be seen from a
-- decent distance". The wall was authored at dashboard density; a member
-- across a gym floor sees the podium and the gold numbers and nothing else.
-- One setting per board, read by the screen:
--   near      a monitor, or a screen behind reception (today's density)
--   standard  a 50" in a room — everything about a third bigger, less on
--             screen (default)
--   far       across a gym floor — one idea per scene
-- =============================================================

alter table public.gym_boards
  add column if not exists viewing text not null default 'standard'
    check (viewing in ('near', 'standard', 'far'));

comment on column public.gym_boards.viewing is
  'How far the room stands from the screen: near | standard | far. Drives type scale and how much each scene carries.';
