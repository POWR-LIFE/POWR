// Tracker → Slack. Invoked by _tracker_slack_notify() (pg_net) with
// x-webhook-secret from Vault (db_webhook_secret), like notify-gym-event.
// Deployed verify_jwt=false; the header check IS the access control. pg_net
// sends after commit, so a rolled-back change never posts.
//
// Two ways to reach Slack, best first:
//   SLACK_BOT_TOKEN (xoxb-, scopes chat:write + chat:write.public) — posts with
//     chat.postMessage, so each issue gets ONE thread in its home channel
//     (#issues for bugs and incidents, #development for planned work) that
//     every later move replies in, and the thread's link shows in the Tracker.
//   SLACK_ISSUES_WEBHOOK_URL + SLACK_DEV_WEBHOOK_URL — incoming webhooks, one
//     per channel. No threads: the home channel hears filed, P0 and resolved.
// Channels default to #issues and #development; SLACK_ISSUES_CHANNEL /
// SLACK_DEV_CHANNEL override (bot token only — a webhook is its channel).
// SLACK_BOT_NAME (e.g. "POWR Tracker") posts under that name instead of the
// app's own — the app is shared with the #new-users alerts. Needs the bot
// scope chat:write.customize; unset, posts keep the app's name.
//
// What goes where: supabase/functions/_shared/trackerSlack.ts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { planPosts, sprintPosts, type SlackPost, type SprintEvent, type TrackerEvent } from "../_shared/trackerSlack.ts";

const SECRET = Deno.env.get("DB_WEBHOOK_SECRET")!;
const BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") ?? "";
// Only ever set to point a local run at a fake Slack.
const SLACK_API = Deno.env.get("SLACK_API_BASE") ?? "https://slack.com/api";
const BOT_NAME = Deno.env.get("SLACK_BOT_NAME") ?? "";
const CHANNELS = {
  issues: Deno.env.get("SLACK_ISSUES_CHANNEL") ?? "C0AJKNTHW6M", // #issues
  dev: Deno.env.get("SLACK_DEV_CHANNEL") ?? "C0AJKNSUA2V", // #development
};
const WEBHOOKS = {
  issues: Deno.env.get("SLACK_ISSUES_WEBHOOK_URL") ?? "",
  dev: Deno.env.get("SLACK_DEV_WEBHOOK_URL") ?? "",
};

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function slackApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${BOT_TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `http ${res.status}` }));
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json;
}

async function postWithBot(issueId: string, post: SlackPost) {
  let channel = CHANNELS[post.channel];
  let threadTs: string | undefined;
  if (post.thread) {
    const { data } = await admin.from("tracker_slack_threads").select("channel, ts").eq("issue_id", issueId).maybeSingle();
    // Reply where the thread is — an issue whose type changed after filing
    // keeps the thread it started in.
    if (data) { threadTs = data.ts; channel = data.channel; }
    // Filed before Slack was linked (or seeded quietly): no thread to reply
    // in. Worth-seeing posts go to the channel and become the thread.
    else if (!post.broadcast) return;
  }
  const sent = await slackApi("chat.postMessage", {
    channel,
    text: post.text,
    blocks: post.blocks,
    unfurl_links: false,
    ...(BOT_NAME ? { username: BOT_NAME } : {}),
    ...(threadTs ? { thread_ts: threadTs, reply_broadcast: !!post.broadcast } : {}),
  });
  if (post.saveThread || (post.thread && !threadTs)) {
    const link = await slackApi("chat.getPermalink", { channel: sent.channel, message_ts: sent.ts }).catch(() => null);
    await admin.from("tracker_slack_threads").upsert(
      { issue_id: issueId, channel: sent.channel, ts: sent.ts, permalink: link?.permalink ?? null },
      { onConflict: "issue_id", ignoreDuplicates: true },
    );
  }
}

async function postWithWebhook(post: SlackPost) {
  const url = WEBHOOKS[post.channel];
  if (!url) return;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: post.text, blocks: post.blocks, unfurl_links: false }),
  });
  if (!res.ok) throw new Error(`webhook ${post.channel}: ${res.status} ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!BOT_TOKEN && !WEBHOOKS.issues && !WEBHOOKS.dev) {
    console.warn("[tracker-slack] no SLACK_BOT_TOKEN or webhook URLs set");
    return new Response("no slack configured", { status: 200 });
  }

  const event = (await req.json()) as TrackerEvent | SprintEvent;
  const posts = event.kind === "sprint" ? sprintPosts(event) : planPosts(event, { threaded: !!BOT_TOKEN });
  const issueId = event.kind === "sprint" ? "" : event.issue.id;
  const label = event.kind === "sprint" ? event.sprint.name : `POWR-${event.issue.number}`;
  const errors: string[] = [];
  // In order: the filed post must exist before anything threads under it.
  for (const post of posts) {
    try {
      if (BOT_TOKEN) await postWithBot(issueId, post);
      else await postWithWebhook(post);
    } catch (e) {
      errors.push(String((e as Error).message ?? e));
    }
  }
  if (errors.length) {
    console.error("[tracker-slack]", label, errors.join(" | "));
    return new Response(errors.join("\n"), { status: 502 });
  }
  return new Response(`ok ${posts.length}`, { status: 200 });
});
