// The link an event's registration QR encodes — shared by the public promo
// page and the admin download so the two can never drift. app.html forwards
// params beyond `to` into the deep link: this opens powr://league?event=<slug>,
// pinning the League tab to the scanned event.
export const eventRegisterUrl = (slug) =>
    `https://powr.life/app?to=league&event=${encodeURIComponent(slug)}`;
