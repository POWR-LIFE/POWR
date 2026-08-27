-- ===========================================================================
-- User country — derived, never asked for.
--
-- WHY. Nothing in the product knows what country a member is in, so every
-- geo question (which markets are we actually in? which rewards/events belong
-- in front of whom? is this signup real?) has to be guessed from a display
-- name. We already hold two signals that answer it without adding a single
-- prompt to onboarding:
--
--   1. profiles.timezone — already written on push registration
--      (lib/api/notifications.ts). Free, needs NO permission, and covers
--      every user who has ever enabled notifications. IANA zone → ISO country
--      is a 1:1 lookup for all but a handful of zones.
--   2. A reverse-geocode of the location fix the app ALREADY samples for
--      accuracy telemetry (lib/locationPermission.ts). Higher confidence —
--      it is where the phone physically is, not where its clock is set — but
--      only available on a granted location permission.
--
-- So country is stored with its PROVENANCE, and the two sources rank:
-- 'gps' outranks 'timezone', except once the gps reading has gone stale
-- (COUNTRY_GPS_STALE below), at which point a fresh timezone signal is the
-- better evidence — that is the shape of a member who moved.
--
-- ⚠ profiles IS WORLD-READABLE. Verified 2026-08-22: policy "Profiles are
-- publicly readable" — SELECT, roles {public}, qual `true`. A two-letter
-- country code is the coarsest possible location fact (and sits alongside
-- location_permission, which is already there), but it IS public. Nothing
-- finer than a country code may be added to this table — a city, a postcode
-- or a coordinate on profiles is a public home address.
--
-- ⚠ NOT A SOURCE OF TRUTH FOR ANYTHING THAT PAYS OUT. Users can UPDATE their
-- own profiles row directly (policy "Users can update their own profile"), so
-- a determined client can write whatever country it likes. record_user_country
-- below exists to enforce the precedence rule, not to make the value
-- tamper-proof. Treat country as analytics/segmentation, never as eligibility.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- iana_timezone_countries — tzdb zone.tab, one row per zone.
--
-- Sourced from the IANA tzdb (public domain), plus the legacy "backward"
-- aliases phones still report ("Europe/Kiev", "Asia/Calcutta", "US/Pacific").
-- Deliberately a TABLE, not a CASE in a function: the mapping changes when
-- borders do, and a row is an UPDATE rather than a redeploy.
--
-- Region-less zones ('UTC', 'GMT', every 'Etc/*') are ABSENT ON PURPOSE. They
-- describe an offset, not a place — a lookup miss must leave country null, not
-- guess. One live profile reports 'UTC' today for exactly this reason.
-- ---------------------------------------------------------------------------
create table if not exists public.iana_timezone_countries (
  timezone     text primary key,
  country_code text not null check (country_code ~ '^[A-Z]{2}$')
);

comment on table public.iana_timezone_countries is
  'IANA timezone → ISO 3166-1 alpha-2, from tzdb zone.tab + backward aliases. Offset-only zones (UTC, Etc/*) are intentionally absent: a miss means "unknown", never a guess.';

alter table public.iana_timezone_countries enable row level security;

-- Reference data, not user data — readable by anyone, writable by no one but
-- a migration (no INSERT/UPDATE/DELETE policy exists, and RLS is on).
create policy iana_timezone_countries_read
  on public.iana_timezone_countries for select
  using (true);

insert into public.iana_timezone_countries (timezone, country_code) values
  ('Africa/Abidjan','CI'),
  ('Africa/Accra','GH'),
  ('Africa/Addis_Ababa','ET'),
  ('Africa/Algiers','DZ'),
  ('Africa/Asmara','ER'),
  ('Africa/Bamako','ML'),
  ('Africa/Bangui','CF'),
  ('Africa/Banjul','GM'),
  ('Africa/Bissau','GW'),
  ('Africa/Blantyre','MW'),
  ('Africa/Brazzaville','CG'),
  ('Africa/Bujumbura','BI'),
  ('Africa/Cairo','EG'),
  ('Africa/Casablanca','MA'),
  ('Africa/Ceuta','ES'),
  ('Africa/Conakry','GN'),
  ('Africa/Dakar','SN'),
  ('Africa/Dar_es_Salaam','TZ'),
  ('Africa/Djibouti','DJ'),
  ('Africa/Douala','CM'),
  ('Africa/El_Aaiun','EH'),
  ('Africa/Freetown','SL'),
  ('Africa/Gaborone','BW'),
  ('Africa/Harare','ZW'),
  ('Africa/Johannesburg','ZA'),
  ('Africa/Juba','SS'),
  ('Africa/Kampala','UG'),
  ('Africa/Khartoum','SD'),
  ('Africa/Kigali','RW'),
  ('Africa/Kinshasa','CD'),
  ('Africa/Lagos','NG'),
  ('Africa/Libreville','GA'),
  ('Africa/Lome','TG'),
  ('Africa/Luanda','AO'),
  ('Africa/Lubumbashi','CD'),
  ('Africa/Lusaka','ZM'),
  ('Africa/Malabo','GQ'),
  ('Africa/Maputo','MZ'),
  ('Africa/Maseru','LS'),
  ('Africa/Mbabane','SZ'),
  ('Africa/Mogadishu','SO'),
  ('Africa/Monrovia','LR'),
  ('Africa/Nairobi','KE'),
  ('Africa/Ndjamena','TD'),
  ('Africa/Niamey','NE'),
  ('Africa/Nouakchott','MR'),
  ('Africa/Ouagadougou','BF'),
  ('Africa/Porto-Novo','BJ'),
  ('Africa/Sao_Tome','ST'),
  ('Africa/Tripoli','LY'),
  ('Africa/Tunis','TN'),
  ('Africa/Windhoek','NA'),
  ('America/Adak','US'),
  ('America/Anchorage','US'),
  ('America/Anguilla','AI'),
  ('America/Antigua','AG'),
  ('America/Araguaina','BR'),
  ('America/Argentina/Buenos_Aires','AR'),
  ('America/Argentina/Catamarca','AR'),
  ('America/Argentina/Cordoba','AR'),
  ('America/Argentina/Jujuy','AR'),
  ('America/Argentina/La_Rioja','AR'),
  ('America/Argentina/Mendoza','AR'),
  ('America/Argentina/Rio_Gallegos','AR'),
  ('America/Argentina/Salta','AR'),
  ('America/Argentina/San_Juan','AR'),
  ('America/Argentina/San_Luis','AR'),
  ('America/Argentina/Tucuman','AR'),
  ('America/Argentina/Ushuaia','AR'),
  ('America/Aruba','AW'),
  ('America/Asuncion','PY'),
  ('America/Atikokan','CA'),
  ('America/Bahia','BR'),
  ('America/Bahia_Banderas','MX'),
  ('America/Barbados','BB'),
  ('America/Belem','BR'),
  ('America/Belize','BZ'),
  ('America/Blanc-Sablon','CA'),
  ('America/Boa_Vista','BR'),
  ('America/Bogota','CO'),
  ('America/Boise','US'),
  ('America/Cambridge_Bay','CA'),
  ('America/Campo_Grande','BR'),
  ('America/Cancun','MX'),
  ('America/Caracas','VE'),
  ('America/Cayenne','GF'),
  ('America/Cayman','KY'),
  ('America/Chicago','US'),
  ('America/Chihuahua','MX'),
  ('America/Ciudad_Juarez','MX'),
  ('America/Costa_Rica','CR'),
  ('America/Coyhaique','CL'),
  ('America/Creston','CA'),
  ('America/Cuiaba','BR'),
  ('America/Curacao','CW'),
  ('America/Danmarkshavn','GL'),
  ('America/Dawson','CA'),
  ('America/Dawson_Creek','CA'),
  ('America/Denver','US'),
  ('America/Detroit','US'),
  ('America/Dominica','DM'),
  ('America/Edmonton','CA'),
  ('America/Eirunepe','BR'),
  ('America/El_Salvador','SV'),
  ('America/Fort_Nelson','CA'),
  ('America/Fortaleza','BR'),
  ('America/Glace_Bay','CA'),
  ('America/Goose_Bay','CA'),
  ('America/Grand_Turk','TC'),
  ('America/Grenada','GD'),
  ('America/Guadeloupe','GP'),
  ('America/Guatemala','GT'),
  ('America/Guayaquil','EC'),
  ('America/Guyana','GY'),
  ('America/Halifax','CA'),
  ('America/Havana','CU'),
  ('America/Hermosillo','MX'),
  ('America/Indiana/Indianapolis','US'),
  ('America/Indiana/Knox','US'),
  ('America/Indiana/Marengo','US'),
  ('America/Indiana/Petersburg','US'),
  ('America/Indiana/Tell_City','US'),
  ('America/Indiana/Vevay','US'),
  ('America/Indiana/Vincennes','US'),
  ('America/Indiana/Winamac','US'),
  ('America/Inuvik','CA'),
  ('America/Iqaluit','CA'),
  ('America/Jamaica','JM'),
  ('America/Juneau','US'),
  ('America/Kentucky/Louisville','US'),
  ('America/Kentucky/Monticello','US'),
  ('America/Kralendijk','BQ'),
  ('America/La_Paz','BO'),
  ('America/Lima','PE'),
  ('America/Los_Angeles','US'),
  ('America/Lower_Princes','SX'),
  ('America/Maceio','BR'),
  ('America/Managua','NI'),
  ('America/Manaus','BR'),
  ('America/Marigot','MF'),
  ('America/Martinique','MQ'),
  ('America/Matamoros','MX'),
  ('America/Mazatlan','MX'),
  ('America/Menominee','US'),
  ('America/Merida','MX'),
  ('America/Metlakatla','US'),
  ('America/Mexico_City','MX'),
  ('America/Miquelon','PM'),
  ('America/Moncton','CA'),
  ('America/Monterrey','MX'),
  ('America/Montevideo','UY'),
  ('America/Montserrat','MS'),
  ('America/Nassau','BS'),
  ('America/New_York','US'),
  ('America/Nome','US'),
  ('America/Noronha','BR'),
  ('America/North_Dakota/Beulah','US'),
  ('America/North_Dakota/Center','US'),
  ('America/North_Dakota/New_Salem','US'),
  ('America/Nuuk','GL'),
  ('America/Ojinaga','MX'),
  ('America/Panama','PA'),
  ('America/Paramaribo','SR'),
  ('America/Phoenix','US'),
  ('America/Port-au-Prince','HT'),
  ('America/Port_of_Spain','TT'),
  ('America/Porto_Velho','BR'),
  ('America/Puerto_Rico','PR'),
  ('America/Punta_Arenas','CL'),
  ('America/Rankin_Inlet','CA'),
  ('America/Recife','BR'),
  ('America/Regina','CA'),
  ('America/Resolute','CA'),
  ('America/Rio_Branco','BR'),
  ('America/Santarem','BR'),
  ('America/Santiago','CL'),
  ('America/Santo_Domingo','DO'),
  ('America/Sao_Paulo','BR'),
  ('America/Scoresbysund','GL'),
  ('America/Sitka','US'),
  ('America/St_Barthelemy','BL'),
  ('America/St_Johns','CA'),
  ('America/St_Kitts','KN'),
  ('America/St_Lucia','LC'),
  ('America/St_Thomas','VI'),
  ('America/St_Vincent','VC'),
  ('America/Swift_Current','CA'),
  ('America/Tegucigalpa','HN'),
  ('America/Thule','GL'),
  ('America/Tijuana','MX'),
  ('America/Toronto','CA'),
  ('America/Tortola','VG'),
  ('America/Vancouver','CA'),
  ('America/Whitehorse','CA'),
  ('America/Winnipeg','CA'),
  ('America/Yakutat','US'),
  ('Antarctica/Casey','AQ'),
  ('Antarctica/Davis','AQ'),
  ('Antarctica/DumontDUrville','AQ'),
  ('Antarctica/Macquarie','AU'),
  ('Antarctica/Mawson','AQ'),
  ('Antarctica/McMurdo','AQ'),
  ('Antarctica/Palmer','AQ'),
  ('Antarctica/Rothera','AQ'),
  ('Antarctica/Syowa','AQ'),
  ('Antarctica/Troll','AQ'),
  ('Antarctica/Vostok','AQ'),
  ('Arctic/Longyearbyen','SJ'),
  ('Asia/Aden','YE'),
  ('Asia/Almaty','KZ'),
  ('Asia/Amman','JO'),
  ('Asia/Anadyr','RU'),
  ('Asia/Aqtau','KZ'),
  ('Asia/Aqtobe','KZ'),
  ('Asia/Ashgabat','TM'),
  ('Asia/Atyrau','KZ'),
  ('Asia/Baghdad','IQ'),
  ('Asia/Bahrain','BH'),
  ('Asia/Baku','AZ'),
  ('Asia/Bangkok','TH'),
  ('Asia/Barnaul','RU'),
  ('Asia/Beirut','LB'),
  ('Asia/Bishkek','KG'),
  ('Asia/Brunei','BN'),
  ('Asia/Chita','RU'),
  ('Asia/Colombo','LK'),
  ('Asia/Damascus','SY'),
  ('Asia/Dhaka','BD'),
  ('Asia/Dili','TL'),
  ('Asia/Dubai','AE'),
  ('Asia/Dushanbe','TJ'),
  ('Asia/Famagusta','CY'),
  ('Asia/Gaza','PS'),
  ('Asia/Hebron','PS'),
  ('Asia/Ho_Chi_Minh','VN'),
  ('Asia/Hong_Kong','HK'),
  ('Asia/Hovd','MN'),
  ('Asia/Irkutsk','RU'),
  ('Asia/Jakarta','ID'),
  ('Asia/Jayapura','ID'),
  ('Asia/Jerusalem','IL'),
  ('Asia/Kabul','AF'),
  ('Asia/Kamchatka','RU'),
  ('Asia/Karachi','PK'),
  ('Asia/Kathmandu','NP'),
  ('Asia/Khandyga','RU'),
  ('Asia/Kolkata','IN'),
  ('Asia/Krasnoyarsk','RU'),
  ('Asia/Kuala_Lumpur','MY'),
  ('Asia/Kuching','MY'),
  ('Asia/Kuwait','KW'),
  ('Asia/Macau','MO'),
  ('Asia/Magadan','RU'),
  ('Asia/Makassar','ID'),
  ('Asia/Manila','PH'),
  ('Asia/Muscat','OM'),
  ('Asia/Nicosia','CY'),
  ('Asia/Novokuznetsk','RU'),
  ('Asia/Novosibirsk','RU'),
  ('Asia/Omsk','RU'),
  ('Asia/Oral','KZ'),
  ('Asia/Phnom_Penh','KH'),
  ('Asia/Pontianak','ID'),
  ('Asia/Pyongyang','KP'),
  ('Asia/Qatar','QA'),
  ('Asia/Qostanay','KZ'),
  ('Asia/Qyzylorda','KZ'),
  ('Asia/Riyadh','SA'),
  ('Asia/Sakhalin','RU'),
  ('Asia/Samarkand','UZ'),
  ('Asia/Seoul','KR'),
  ('Asia/Shanghai','CN'),
  ('Asia/Singapore','SG'),
  ('Asia/Srednekolymsk','RU'),
  ('Asia/Taipei','TW'),
  ('Asia/Tashkent','UZ'),
  ('Asia/Tbilisi','GE'),
  ('Asia/Tehran','IR'),
  ('Asia/Thimphu','BT'),
  ('Asia/Tokyo','JP'),
  ('Asia/Tomsk','RU'),
  ('Asia/Ulaanbaatar','MN'),
  ('Asia/Urumqi','CN'),
  ('Asia/Ust-Nera','RU'),
  ('Asia/Vientiane','LA'),
  ('Asia/Vladivostok','RU'),
  ('Asia/Yakutsk','RU'),
  ('Asia/Yangon','MM'),
  ('Asia/Yekaterinburg','RU'),
  ('Asia/Yerevan','AM'),
  ('Atlantic/Azores','PT'),
  ('Atlantic/Bermuda','BM'),
  ('Atlantic/Canary','ES'),
  ('Atlantic/Cape_Verde','CV'),
  ('Atlantic/Faroe','FO'),
  ('Atlantic/Madeira','PT'),
  ('Atlantic/Reykjavik','IS'),
  ('Atlantic/South_Georgia','GS'),
  ('Atlantic/St_Helena','SH'),
  ('Atlantic/Stanley','FK'),
  ('Australia/Adelaide','AU'),
  ('Australia/Brisbane','AU'),
  ('Australia/Broken_Hill','AU'),
  ('Australia/Darwin','AU'),
  ('Australia/Eucla','AU'),
  ('Australia/Hobart','AU'),
  ('Australia/Lindeman','AU'),
  ('Australia/Lord_Howe','AU'),
  ('Australia/Melbourne','AU'),
  ('Australia/Perth','AU'),
  ('Australia/Sydney','AU'),
  ('Europe/Amsterdam','NL'),
  ('Europe/Andorra','AD'),
  ('Europe/Astrakhan','RU'),
  ('Europe/Athens','GR'),
  ('Europe/Belgrade','RS'),
  ('Europe/Berlin','DE'),
  ('Europe/Bratislava','SK'),
  ('Europe/Brussels','BE'),
  ('Europe/Bucharest','RO'),
  ('Europe/Budapest','HU'),
  ('Europe/Busingen','DE'),
  ('Europe/Chisinau','MD'),
  ('Europe/Copenhagen','DK'),
  ('Europe/Dublin','IE'),
  ('Europe/Gibraltar','GI'),
  ('Europe/Guernsey','GG'),
  ('Europe/Helsinki','FI'),
  ('Europe/Isle_of_Man','IM'),
  ('Europe/Istanbul','TR'),
  ('Europe/Jersey','JE'),
  ('Europe/Kaliningrad','RU'),
  ('Europe/Kirov','RU'),
  ('Europe/Kyiv','UA'),
  ('Europe/Lisbon','PT'),
  ('Europe/Ljubljana','SI'),
  ('Europe/London','GB'),
  ('Europe/Luxembourg','LU'),
  ('Europe/Madrid','ES'),
  ('Europe/Malta','MT'),
  ('Europe/Mariehamn','AX'),
  ('Europe/Minsk','BY'),
  ('Europe/Monaco','MC'),
  ('Europe/Moscow','RU'),
  ('Europe/Oslo','NO'),
  ('Europe/Paris','FR'),
  ('Europe/Podgorica','ME'),
  ('Europe/Prague','CZ'),
  ('Europe/Riga','LV'),
  ('Europe/Rome','IT'),
  ('Europe/Samara','RU'),
  ('Europe/San_Marino','SM'),
  ('Europe/Sarajevo','BA'),
  ('Europe/Saratov','RU'),
  ('Europe/Simferopol','UA'),
  ('Europe/Skopje','MK'),
  ('Europe/Sofia','BG'),
  ('Europe/Stockholm','SE'),
  ('Europe/Tallinn','EE'),
  ('Europe/Tirane','AL'),
  ('Europe/Ulyanovsk','RU'),
  ('Europe/Vaduz','LI'),
  ('Europe/Vatican','VA'),
  ('Europe/Vienna','AT'),
  ('Europe/Vilnius','LT'),
  ('Europe/Volgograd','RU'),
  ('Europe/Warsaw','PL'),
  ('Europe/Zagreb','HR'),
  ('Europe/Zurich','CH'),
  ('Indian/Antananarivo','MG'),
  ('Indian/Chagos','IO'),
  ('Indian/Christmas','CX'),
  ('Indian/Cocos','CC'),
  ('Indian/Comoro','KM'),
  ('Indian/Kerguelen','TF'),
  ('Indian/Mahe','SC'),
  ('Indian/Maldives','MV'),
  ('Indian/Mauritius','MU'),
  ('Indian/Mayotte','YT'),
  ('Indian/Reunion','RE'),
  ('Pacific/Apia','WS'),
  ('Pacific/Auckland','NZ'),
  ('Pacific/Bougainville','PG'),
  ('Pacific/Chatham','NZ'),
  ('Pacific/Chuuk','FM'),
  ('Pacific/Easter','CL'),
  ('Pacific/Efate','VU'),
  ('Pacific/Fakaofo','TK'),
  ('Pacific/Fiji','FJ'),
  ('Pacific/Funafuti','TV'),
  ('Pacific/Galapagos','EC'),
  ('Pacific/Gambier','PF'),
  ('Pacific/Guadalcanal','SB'),
  ('Pacific/Guam','GU'),
  ('Pacific/Honolulu','US'),
  ('Pacific/Kanton','KI'),
  ('Pacific/Kiritimati','KI'),
  ('Pacific/Kosrae','FM'),
  ('Pacific/Kwajalein','MH'),
  ('Pacific/Majuro','MH'),
  ('Pacific/Marquesas','PF'),
  ('Pacific/Midway','UM'),
  ('Pacific/Nauru','NR'),
  ('Pacific/Niue','NU'),
  ('Pacific/Norfolk','NF'),
  ('Pacific/Noumea','NC'),
  ('Pacific/Pago_Pago','AS'),
  ('Pacific/Palau','PW'),
  ('Pacific/Pitcairn','PN'),
  ('Pacific/Pohnpei','FM'),
  ('Pacific/Port_Moresby','PG'),
  ('Pacific/Rarotonga','CK'),
  ('Pacific/Saipan','MP'),
  ('Pacific/Tahiti','PF'),
  ('Pacific/Tarawa','KI'),
  ('Pacific/Tongatapu','TO'),
  ('Pacific/Wake','UM'),
  ('Pacific/Wallis','WF'),
  ('Africa/Asmera','ER'),
  ('Africa/Timbuktu','ML'),
  ('America/Argentina/ComodRivadavia','AR'),
  ('America/Atka','US'),
  ('America/Buenos_Aires','AR'),
  ('America/Catamarca','AR'),
  ('America/Coral_Harbour','CA'),
  ('America/Cordoba','AR'),
  ('America/Ensenada','MX'),
  ('America/Fort_Wayne','US'),
  ('America/Godthab','GL'),
  ('America/Indianapolis','US'),
  ('America/Jujuy','AR'),
  ('America/Knox_IN','US'),
  ('America/Louisville','US'),
  ('America/Mendoza','AR'),
  ('America/Montreal','CA'),
  ('America/Nipigon','CA'),
  ('America/Porto_Acre','BR'),
  ('America/Rainy_River','CA'),
  ('America/Rosario','AR'),
  ('America/Santa_Isabel','MX'),
  ('America/Shiprock','US'),
  ('America/Thunder_Bay','CA'),
  ('America/Virgin','VI'),
  ('America/Yellowknife','CA'),
  ('Antarctica/South_Pole','AQ'),
  ('Asia/Ashkhabad','TM'),
  ('Asia/Calcutta','IN'),
  ('Asia/Chongqing','CN'),
  ('Asia/Chungking','CN'),
  ('Asia/Dacca','BD'),
  ('Asia/Harbin','CN'),
  ('Asia/Istanbul','TR'),
  ('Asia/Kashgar','CN'),
  ('Asia/Katmandu','NP'),
  ('Asia/Macao','MO'),
  ('Asia/Rangoon','MM'),
  ('Asia/Saigon','VN'),
  ('Asia/Tel_Aviv','IL'),
  ('Asia/Thimbu','BT'),
  ('Asia/Ujung_Pandang','ID'),
  ('Asia/Ulan_Bator','MN'),
  ('Atlantic/Faeroe','FO'),
  ('Atlantic/Jan_Mayen','SJ'),
  ('Australia/ACT','AU'),
  ('Australia/Canberra','AU'),
  ('Australia/LHI','AU'),
  ('Australia/NSW','AU'),
  ('Australia/North','AU'),
  ('Australia/Queensland','AU'),
  ('Australia/South','AU'),
  ('Australia/Tasmania','AU'),
  ('Australia/Victoria','AU'),
  ('Australia/West','AU'),
  ('Australia/Yancowinna','AU'),
  ('Brazil/Acre','BR'),
  ('Brazil/DeNoronha','BR'),
  ('Brazil/East','BR'),
  ('Brazil/West','BR'),
  ('Canada/Atlantic','CA'),
  ('Canada/Central','CA'),
  ('Canada/Eastern','CA'),
  ('Canada/Mountain','CA'),
  ('Canada/Newfoundland','CA'),
  ('Canada/Pacific','CA'),
  ('Canada/Saskatchewan','CA'),
  ('Canada/Yukon','CA'),
  ('Chile/Continental','CL'),
  ('Chile/EasterIsland','CL'),
  ('Cuba','CU'),
  ('Egypt','EG'),
  ('Eire','IE'),
  ('Europe/Belfast','GB'),
  ('Europe/Kiev','UA'),
  ('Europe/Nicosia','CY'),
  ('Europe/Tiraspol','MD'),
  ('Europe/Uzhgorod','UA'),
  ('Europe/Zaporozhye','UA'),
  ('GB','GB'),
  ('GB-Eire','GB'),
  ('Hongkong','HK'),
  ('Iceland','IS'),
  ('Iran','IR'),
  ('Israel','IL'),
  ('Jamaica','JM'),
  ('Japan','JP'),
  ('Kwajalein','MH'),
  ('Libya','LY'),
  ('Mexico/BajaNorte','MX'),
  ('Mexico/BajaSur','MX'),
  ('Mexico/General','MX'),
  ('NZ','NZ'),
  ('NZ-CHAT','NZ'),
  ('Navajo','US'),
  ('PRC','CN'),
  ('Pacific/Enderbury','KI'),
  ('Pacific/Johnston','UM'),
  ('Pacific/Ponape','FM'),
  ('Pacific/Samoa','AS'),
  ('Pacific/Truk','FM'),
  ('Pacific/Yap','FM'),
  ('Poland','PL'),
  ('Portugal','PT'),
  ('ROC','TW'),
  ('ROK','KR'),
  ('Singapore','SG'),
  ('Turkey','TR'),
  ('US/Alaska','US'),
  ('US/Aleutian','US'),
  ('US/Arizona','US'),
  ('US/Central','US'),
  ('US/East-Indiana','US'),
  ('US/Eastern','US'),
  ('US/Hawaii','US'),
  ('US/Indiana-Starke','US'),
  ('US/Michigan','US'),
  ('US/Mountain','US'),
  ('US/Pacific','US'),
  ('US/Samoa','AS'),
  ('W-SU','RU')
on conflict (timezone) do update set country_code = excluded.country_code;

-- ---------------------------------------------------------------------------
-- profiles.country_code / country_source / country_updated_at
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists country_code       text,
  add column if not exists country_source     text,
  add column if not exists country_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_country_code_check') then
    alter table public.profiles
      add constraint profiles_country_code_check check (country_code ~ '^[A-Z]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_country_source_check') then
    alter table public.profiles
      add constraint profiles_country_source_check check (country_source in ('gps', 'timezone'));
  end if;
end $$;

comment on column public.profiles.country_code is
  'ISO 3166-1 alpha-2, DERIVED — never asked for. See country_source for how it was reached.';
comment on column public.profiles.country_source is
  '''gps'' = reverse-geocoded from a real location fix. ''timezone'' = looked up from profiles.timezone. gps outranks timezone until it goes stale — see resolve_user_country.';
comment on column public.profiles.country_updated_at is
  'When country_code was last WRITTEN (a re-confirmation of the same value refreshes it — that is what keeps a gps reading from going stale).';

-- Segmentation reads are "everyone in GB", so the index is on the code and
-- skips the long tail of nulls.
create index if not exists profiles_country_code_idx
  on public.profiles (country_code) where country_code is not null;

-- ---------------------------------------------------------------------------
-- country_from_timezone — the lookup, null-safe.
-- ---------------------------------------------------------------------------
create or replace function public.country_from_timezone(p_timezone text)
returns text
language sql
stable
set search_path = public
as $$
  select c.country_code
  from public.iana_timezone_countries c
  where c.timezone = btrim(coalesce(p_timezone, ''))
$$;

-- ---------------------------------------------------------------------------
-- resolve_user_country — the ONE place the precedence rule lives.
--
-- Every writer (the client RPC, the timezone trigger, the backfill) goes
-- through this, so none of them can disagree about which signal wins.
--
--   · a 'gps' observation always applies — it is the best evidence we get
--   · a 'timezone' observation applies when there is no gps reading, when the
--     stored value came from a timezone itself, or when the gps reading has
--     gone stale (90 days). That last clause is the one that lets someone who
--     moved country be re-read correctly instead of being pinned forever by
--     one old fix.
--   · re-confirming the SAME country refreshes country_updated_at, which is
--     what stops a still-accurate gps reading from ageing into staleness on
--     a user who never leaves.
--   · a null/unmappable code is a NO-OP, never a clear. "We couldn't tell
--     this time" is not "they have no country" — an offline reverse-geocode
--     or a 'UTC' timezone must never erase a good reading.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_user_country(
  p_user_id      uuid,
  p_country_code text,
  p_source       text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code    text := nullif(upper(btrim(coalesce(p_country_code, ''))), '');
  v_current record;
begin
  if p_user_id is null or v_code is null or v_code !~ '^[A-Z]{2}$' then
    return false;
  end if;
  if p_source not in ('gps', 'timezone') then
    raise exception 'invalid country source: %', p_source;
  end if;

  select country_code, country_source, country_updated_at
    into v_current
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  if p_source = 'timezone'
     and v_current.country_source = 'gps'
     and v_current.country_code is distinct from v_code
     and v_current.country_updated_at > now() - interval '90 days'
  then
    return false;  -- a live gps reading beats the phone's clock setting
  end if;

  update public.profiles
  set country_code       = v_code,
      country_source     = p_source,
      country_updated_at = now()
  where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.resolve_user_country(uuid, text, text) from public;
revoke execute on function public.resolve_user_country(uuid, text, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_user_country — what the app calls. Always for the CALLER, so a
-- client can never write a country onto somebody else's profile.
-- ---------------------------------------------------------------------------
create or replace function public.record_user_country(
  p_country_code text,
  p_source       text default 'gps'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  perform public.resolve_user_country(v_user_id, p_country_code, p_source);
end;
$$;

revoke all on function public.record_user_country(text, text) from public;
-- ⚠ `revoke from public` does NOT remove Supabase's default grant to `anon`.
-- The function raises on a null auth.uid() anyway, but the grant must be
-- revoked by name. See project_security_definer_lint.
revoke execute on function public.record_user_country(text, text) from anon;
grant execute on function public.record_user_country(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The timezone path needs no client change at all: profiles.timezone is
-- already written on push registration, so a trigger turns every one of those
-- writes into a country for free — including for users who never grant
-- location, which is the half of the table the gps path can never reach.
-- ---------------------------------------------------------------------------
-- Deliberately NOT security definer: it only rewrites columns on the row
-- already being written, and its one read (iana_timezone_countries) is
-- world-readable reference data. Elevation here would be surface for nothing.
create or replace function public.profiles_country_from_timezone()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_code text;
begin
  -- ⚠ OLD is unassigned on INSERT — referencing old.timezone there raises
  -- "record old is not assigned yet", so the TG_OP guard is load-bearing.
  if new.timezone is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.timezone is not distinct from old.timezone then
    return new;
  end if;

  v_code := public.country_from_timezone(new.timezone);
  if v_code is null then
    return new;  -- 'UTC', 'Etc/*', anything unmapped: leave the reading alone
  end if;

  -- Same precedence as resolve_user_country, applied inline: the row is
  -- already being written, so re-entering via UPDATE would recurse.
  if new.country_source = 'gps'
     and new.country_code is distinct from v_code
     and new.country_updated_at > now() - interval '90 days'
  then
    return new;
  end if;

  new.country_code       := v_code;
  new.country_source     := 'timezone';
  new.country_updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_country_from_timezone_trg on public.profiles;
create trigger profiles_country_from_timezone_trg
  before insert or update of timezone on public.profiles
  for each row execute function public.profiles_country_from_timezone();

-- ---------------------------------------------------------------------------
-- Backfill. Everyone who already reported a timezone gets a country now,
-- without waiting for their next app open.
-- ---------------------------------------------------------------------------
update public.profiles p
set country_code       = c.country_code,
    country_source     = 'timezone',
    country_updated_at = now()
from public.iana_timezone_countries c
where c.timezone = p.timezone
  and p.country_code is null;

-- ===========================================================================
-- admin_get_users v7 — + country_code / country_source / country_updated_at
-- ===========================================================================
-- ⚠ DROP discards the function's ACL. Supabase's default privileges then grant
-- EXECUTE to anon and PUBLIC on the recreated function — the grants at the
-- bottom put the lockdown back. Any future signature change must repeat them.
drop function if exists public.admin_get_users();

create or replace function public.admin_get_users()
returns table (
  id uuid, username text, display_name text, avatar_url text,
  is_admin boolean, is_pro boolean, location_granted boolean,
  created_at timestamptz, email text, connected_providers text[],
  activity_types text[], session_count bigint, last_active_at timestamptz,
  total_points bigint, total_earned bigint, seen_devices text[],
  location_permission text, location_accuracy_m integer,
  background_verdict text, background_checked_at timestamptz,
  permission_regressed_at timestamptz,
  member_id text,
  country_code text, country_source text, country_updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not is_admin() then
    raise exception 'Access denied: admin only';
  end if;

  return query
    select
      p.id, p.username, p.display_name, p.avatar_url,
      p.is_admin, p.is_pro, p.location_granted, p.created_at,
      u.email::text,
      coalesce(prov.providers, '{}'::text[]) as connected_providers,
      coalesce(act.types, '{}'::text[])      as activity_types,
      coalesce(act.session_count, 0)         as session_count,
      act.last_active_at,
      coalesce(pts.balance, 0)               as total_points,
      coalesce(pts.earned, 0) + coalesce(vlt.pending, 0) as total_earned,
      coalesce(dev.devices, '{}'::text[])    as seen_devices,
      p.location_permission,
      p.location_accuracy_m,
      bg.verdict,
      bg.observed_at,
      reg.regressed_at,
      p.referral_code                        as member_id,
      p.country_code, p.country_source, p.country_updated_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join lateral (
      select array_agg(distinct prov_name) as providers
      from (
        select lower(tc.provider) as prov_name
        from public.terra_connections tc
        where tc.user_id = p.id and tc.deauthed_at is null
        union
        select hpc.key from jsonb_each(coalesce(p.health_provider_connections, '{}'::jsonb)) hpc
      ) s
    ) prov on true
    left join lateral (
      select array_agg(distinct a.type::text) as types, count(*) as session_count, max(a.started_at) as last_active_at
      from public.activity_sessions a where a.user_id = p.id
    ) act on true
    left join lateral (
      select sum(pt.amount)::bigint as balance, sum(pt.amount) filter (where pt.amount > 0)::bigint as earned
      from public.point_transactions pt where pt.user_id = p.id
    ) pts on true
    left join lateral (
      select sum(vd.amount)::bigint as pending
      from public.vault_deposits vd where vd.user_id = p.id and vd.released_at is null
    ) vlt on true
    left join lateral (
      select array_agg(distinct trim(t.token) order by trim(t.token)) as devices
      from public.health_snapshots hs
      cross join lateral unnest(string_to_array(hs.source_detail, ',')) as t(token)
      where hs.user_id = p.id and hs.source_detail is not null and trim(t.token) <> ''
    ) dev on true
    left join lateral (
      -- ONE row: the most recent sweep, graded (see v5 for why it never counts rows).
      select
        case e.detail->>'outcome'
          when 'no_permission' then 'broken'
          when 'handoff'       then 'ok'
          when 'exit_backstop' then 'ok'
          else 'unknown'
        end as verdict,
        e.created_at as observed_at
      from public.geofence_region_events e
      where e.user_id = p.id and e.event = 'sweep'
      order by e.created_at desc
      limit 1
    ) bg on true
    left join lateral (
      select max(r.created_at) as regressed_at
      from public.location_permission_regressions r
      where r.user_id = p.id
    ) reg on true
    order by p.created_at desc;
end;
$function$;

revoke execute on function public.admin_get_users() from public, anon;
grant execute on function public.admin_get_users() to authenticated;
