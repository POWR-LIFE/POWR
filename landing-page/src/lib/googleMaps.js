// Loads the Google Maps JS API exactly once and resolves with `google.maps`.
// Reused across the admin panel; safe to call repeatedly.
let mapsPromise = null;

export function loadGoogleMaps(apiKey) {
    if (typeof window !== 'undefined' && window.google?.maps) {
        return Promise.resolve(window.google.maps);
    }
    if (mapsPromise) return mapsPromise;

    mapsPromise = new Promise((resolve, reject) => {
        if (!apiKey) {
            reject(new Error('Missing Google Maps API key (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)'));
            return;
        }
        const cbName = '__gmapsReady_' + Math.random().toString(36).slice(2);
        window[cbName] = () => {
            resolve(window.google.maps);
            delete window[cbName];
        };
        const script = document.createElement('script');
        // `places` powers the address/venue search box on the placement map.
        // If the Places API isn't enabled on the key, search fails soft — the
        // grid map itself still loads fine.
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=${cbName}&loading=async`;
        script.async = true;
        script.defer = true;
        script.onerror = () => {
            mapsPromise = null; // allow a retry
            reject(new Error('Failed to load the Google Maps script'));
        };
        document.head.appendChild(script);
    });
    return mapsPromise;
}
