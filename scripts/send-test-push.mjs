#!/usr/bin/env node
// End-to-end push tester: sends a real notification to a device via Expo's
// push service. Confirms the full pipeline — EAS push credentials → APNs/FCM →
// device delivery → notification display → deep-link routing when tapped.
//
// Usage:
//   node scripts/send-test-push.mjs <ExpoPushToken> [type]
//   EXPO_PUSH_TOKEN=ExponentPushToken[...] node scripts/send-test-push.mjs [type]
//
// Get the token: it's stored in the `user_push_tokens` table (column
// `expo_push_token`) after the device signs in. Copy it from the Supabase
// dashboard for your user row.
//
// Types: check_in_reminder | session_completed | reward_unlocked |
//        streak_at_risk | points_milestone   (default: check_in_reminder)

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const args = process.argv.slice(2);
let token = process.env.EXPO_PUSH_TOKEN ?? '';
let type = 'check_in_reminder';

for (const arg of args) {
  if (arg.startsWith('ExponentPushToken[') || arg.startsWith('ExpoPushToken[')) token = arg;
  else type = arg;
}

if (!token) {
  console.error('Error: no Expo push token provided.\n');
  console.error('  node scripts/send-test-push.mjs <ExpoPushToken> [type]');
  console.error('  EXPO_PUSH_TOKEN=... node scripts/send-test-push.mjs [type]');
  process.exit(1);
}
if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
  console.error(`Error: "${token}" is not a valid Expo push token (expected ExponentPushToken[...]).`);
  process.exit(1);
}

// Mirrors the copy + deep-link routes the app uses for each type, so a tap
// exercises the same getRouteFromNotification path as a production push.
const MESSAGES = {
  check_in_reminder: {
    title: 'POWR',
    body: "You're in. Every minute counts.",
    data: { type: 'check_in_reminder', route: '/(tabs)/index' },
    channelId: 'powr_default_v2',
  },
  session_completed: {
    title: '+25 pts earned! 🔥',
    body: 'POWR Test Gym · Day 3 streak',
    data: { type: 'session_completed', route: '/share-stats?mode=check-in&sessionId=TEST' },
    channelId: 'powr_rewards_v2',
  },
  reward_unlocked: {
    title: 'New reward unlocked 🎁',
    body: 'You\'ve unlocked "Test Reward". Redeem it before it expires.',
    data: { type: 'reward_unlocked', route: '/(tabs)/rewards' },
    channelId: 'powr_rewards_v2',
  },
  streak_at_risk: {
    title: 'Your 5-day streak is at risk 🔥',
    body: 'Log any activity before midnight to keep it alive.',
    data: { type: 'streak_at_risk', route: '/(tabs)/index' },
    channelId: 'powr_streak_v2',
  },
  points_milestone: {
    title: '1,000 POWR points 🏆',
    body: "You're crushing it. Check your rewards — something new might be waiting.",
    data: { type: 'points_milestone', route: '/(tabs)/rewards' },
    channelId: 'powr_default_v2',
  },
};

const preset = MESSAGES[type];
if (!preset) {
  console.error(`Error: unknown type "${type}". Valid: ${Object.keys(MESSAGES).join(', ')}`);
  process.exit(1);
}

const message = { to: token, sound: 'default', priority: 'high', ...preset };

console.log(`Sending "${type}" to ${token.slice(0, 24)}…`);

const res = await fetch(EXPO_PUSH_URL, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(message),
});

const result = await res.json();
const ticket = result?.data;

if (ticket?.status === 'ok') {
  console.log('✓ Accepted by Expo. Watch your device — it should arrive shortly.');
  console.log(`  Receipt id: ${ticket.id}`);
} else {
  console.error('✗ Expo rejected the push:');
  console.error(JSON.stringify(result, null, 2));
  if (ticket?.details?.error === 'DeviceNotRegistered') {
    console.error('\n  → This token is stale. Re-open the app to register a fresh one.');
  }
  process.exit(1);
}
