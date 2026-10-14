// Which language a reward brand's people read POWR's email in.
//
//   - A portal login reads its own: profiles.language, gated by
//     BUSINESS_LANGUAGES (the partner portal keeps it current).
//   - Someone who isn't a login yet (an invited address) reads the inviter's:
//     a teammate's own language, or English when POWR staff invited them from
//     the admin.
//   - Anyone else (the submission contact POWR invited) reads English.
//
// The brand senders know their recipients by address (the RPCs return emails,
// not user ids), so these map addresses. While English is the only live
// business language nothing here touches the database. Nothing throws: a
// failed read means English for whoever it covered, never a lost email.

import { BUSINESS_LANGUAGES, languagesFor } from "./i18n/index.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const onlyEnglish = () => !BUSINESS_LANGUAGES.some((lang) => lang !== "en");

/**
 * Language per lower-cased address for the logins of the given brands
 * (lower(trim(brand_name)), as the RPCs key them; null = every brand). With
 * `invites`, also each brand's invited addresses that aren't logins (newest
 * invite wins). Addresses it doesn't cover are English: the caller defaults.
 */
export async function brandRecipientLanguages(
  admin: Client,
  brandKeys: string[] | null,
  opts: { invites?: boolean } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (onlyEnglish()) return out;
  try {
    const keys = brandKeys ? new Set(brandKeys.map(norm)) : null;
    const { data: users } = await admin.from("reward_brand_users").select("user_id, brand_name");
    const brandOf = new Map<string, string>();
    for (const u of users ?? []) {
      if (u?.user_id && (!keys || keys.has(norm(u.brand_name)))) brandOf.set(u.user_id, norm(u.brand_name));
    }
    const ids = [...brandOf.keys()];
    const langs = await languagesFor(admin, ids, BUSINESS_LANGUAGES);
    // No email on profiles: the auth admin API, a few at a time (brands have few logins).
    for (let i = 0; i < ids.length; i += 10) {
      await Promise.all(ids.slice(i, i + 10).map(async (id) => {
        try {
          const { data } = await admin.auth.admin.getUserById(id);
          const email = norm(data?.user?.email);
          if (email) out.set(email, langs.get(id) ?? "en");
        } catch {
          // English for this login.
        }
      }));
    }
    if (opts.invites) {
      const { data: invites } = await admin
        .from("reward_brand_invites")
        .select("brand_name, email, created_by, created_at")
        .in("status", ["invited", "used"])
        .not("email", "is", null)
        .order("created_at", { ascending: false });
      for (const inv of invites ?? []) {
        const email = norm(inv?.email);
        const brand = norm(inv?.brand_name);
        if (!email || out.has(email) || (keys && !keys.has(brand))) continue;
        // A teammate's invite (a login of the same brand) reads in their language;
        // one POWR sent from the admin is English.
        const teammate = inv.created_by && brandOf.get(inv.created_by) === brand;
        out.set(email, teammate ? langs.get(inv.created_by) ?? "en" : "en");
      }
    }
  } catch {
    // English for whoever isn't mapped yet.
  }
  return out;
}

/**
 * The language of an email to someone who isn't a user yet: their inviter's.
 * English when POWR staff sent it (`asAdmin`; unknown → looked up in
 * admin_roles), when there is no inviter, or when anything fails.
 */
export async function inviterLanguage(admin: Client, inviterId: string | null | undefined, asAdmin?: boolean): Promise<string> {
  if (!inviterId || asAdmin === true || onlyEnglish()) return "en";
  try {
    if (asAdmin === undefined) {
      const { data } = await admin.from("admin_roles").select("user_id").eq("user_id", inviterId).maybeSingle();
      if (data) return "en";
    }
    return (await languagesFor(admin, [inviterId], BUSINESS_LANGUAGES)).get(inviterId) ?? "en";
  } catch {
    return "en";
  }
}
