-- 'touch' is a positional record of a finger landing, written for every touch
-- by the root-level observer. It is deliberately a separate type from 'tap':
-- a 'tap' is a NAMED button press with product meaning ('redeem_confirm'),
-- while a 'touch' is anonymous geometry that only means something once it is
-- painted onto a screenshot. Mixing them would make the taps KPI count
-- scrolling as engagement.
alter table public.app_events drop constraint if exists app_events_event_type_check;
alter table public.app_events add constraint app_events_event_type_check
  check (event_type in ('screen_view', 'tap', 'touch', 'custom'));
