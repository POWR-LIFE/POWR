// Where tapping a pushed notification lands ("Opens" on the Broadcast and
// Campaigns pages). One list so the two pages can't drift apart.
//
// Keep to long-standing routes so older app builds don't dead-end (the
// notification itself shows on any version): an unknown query param is simply
// ignored by a build that predates it.
export const ROUTE_PRESETS = [
    { label: 'Home',     value: '' },
    { label: 'Rewards',  value: '/(tabs)/rewards' },
    { label: 'Progress', value: '/(tabs)/progress' },
    { label: 'Friends',  value: '/friends' },
    // The Series is the League tab's home while it is on for the member, so the
    // tab is the Series page. `focus=series` closes any event page the tab was
    // left on (older builds ignore it and just open the tab). Same route family
    // as the Series' own pushes (series_rival / series_passed / series_moment).
    { label: 'Series',   value: '/(tabs)/league?focus=series' },
];
