-- =============================================================
-- PRO USER SEED DATA
-- 15 demo pro athletes for development & UI testing.
-- Inserts into auth.users then updates profiles via the
-- existing handle_new_user() trigger.
-- Safe to run multiple times (ON CONFLICT DO NOTHING).
-- =============================================================

DO $$
DECLARE
  v_instance_id uuid;
  v_uid         uuid;
  u             RECORD;
BEGIN
  -- Inherit instance_id from an existing user (fallback: zero UUID)
  SELECT COALESCE(
    (SELECT instance_id FROM auth.users LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ) INTO v_instance_id;

  FOR u IN SELECT * FROM (VALUES
    --  email                               username           display_name        lvl  bio
    ('kai.thompson@powr-demo.com',    'kai_thompson',    'Kai Thompson',    11, 'Ironman triathlete & coach. 3× podium finishes at 70.3 events. Training smarter, racing harder every week.'),
    ('sofia.reyes@powr-demo.com',     'sofia_reyes',     'Sofia Reyes',     10, 'CrossFit athlete & movement specialist. Regional competitor 4 years running. Obsessed with the barbell.'),
    ('zara.patel@powr-demo.com',      'zara_patel',      'Zara Patel',       8, 'Yoga teacher & mindfulness coach. 200hrs certified. Helping athletes perform with intention.'),
    ('marcus.webb@powr-demo.com',     'marcus_webb',     'Marcus Webb',     12, 'IPF powerlifter. 3× national qualifier. Current total 810kg. Eat. Lift. Recover. Repeat.'),
    ('aiko.nakamura@powr-demo.com',   'aiko_nakamura',   'Aiko Nakamura',    9, 'Open-water swimmer & ocean lover. Completed the English Channel crossing 2024. Cold water is home.'),
    ('liam.obrien@powr-demo.com',     'liam_obrien',     'Liam O''Brien',   10, 'Road cyclist chasing KOM glory. 8,000km banked this year. Coffee-fuelled, wind-chased.'),
    ('priya.sharma@powr-demo.com',    'priya_sharma',    'Priya Sharma',    11, 'Sub-3hr marathon runner & running coach. Berlin, Chicago, Tokyo finisher. Let''s run far together.'),
    ('jordan.blake@powr-demo.com',    'jordan_blake',    'Jordan Blake',     8, 'Basketball player & performance trainer. Playing in the EU leagues. Built in the gym, proven on the court.'),
    ('nina.rodriguez@powr-demo.com',  'nina_rodriguez',  'Nina Rodriguez',   9, 'Rhythmic gymnast turned fitness creator. Former national team. Flexibility is my superpower.'),
    ('felix.zhang@powr-demo.com',     'felix_zhang',     'Felix Zhang',      8, 'Rock climber & outdoor explorer. V10 boulderer. If there''s a wall, I''m climbing it.'),
    ('amara.osei@powr-demo.com',      'amara_osei',      'Amara Osei',      12, 'Professional sprinter. 100m PB: 10.72. Chasing tenths of seconds, living in moments.'),
    ('declan.murphy@powr-demo.com',   'declan_murphy',   'Declan Murphy',   10, 'Rugby union flanker. Pro contract since 2022. Strength, speed, and a love of the scrum.'),
    ('luna.park@powr-demo.com',       'luna_park',       'Luna Park',        7, 'Pilates instructor & rehabilitation specialist. Helping people move pain-free since 2019.'),
    ('rafael.torres@powr-demo.com',   'rafael_torres',   'Rafael Torres',   11, 'MMA fighter & S&C coach. Professional record 14–3. Training the next generation between fights.'),
    ('ingrid.hansen@powr-demo.com',   'ingrid_hansen',   'Ingrid Hansen',    9, 'Alpine ski racer & off-season gym nerd. FIS World Cup circuit. The mountain is my gym.')
  ) AS t(email, username, display_name, level, bio) LOOP

    -- Create the auth user only if it doesn't already exist
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = u.email) THEN
      INSERT INTO auth.users (
        id, instance_id, aud, role,
        email, encrypted_password, email_confirmed_at,
        created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data
      )
      VALUES (
        gen_random_uuid(),
        v_instance_id,
        'authenticated',
        'authenticated',
        u.email,
        '',           -- no password → account cannot be logged into
        now(),        -- mark as confirmed
        now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', u.display_name)
      );
    END IF;

    -- Resolve the user id (either just inserted or already existed)
    SELECT id INTO v_uid FROM auth.users WHERE email = u.email;

    -- Populate pro profile fields (trigger may have beat us to the basic row)
    UPDATE public.profiles SET
      username     = u.username,
      display_name = u.display_name,
      level        = u.level,
      is_pro       = true,
      bio          = u.bio
    WHERE id = v_uid;

  END LOOP;
END $$;
