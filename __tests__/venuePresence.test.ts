import { MAX_FIX_ACCURACY_M, MIN_INSIDE_RADIUS_M, haversineMetres, nearestVenueInside } from '@/lib/venuePresence';

// ~1 m of latitude ≈ 8.99e-6 degrees.
const DEG_PER_M = 1 / 111_320;
const GYM = { id: 'r1', name: 'One LDN', dbId: 'p1', lat: 51.5, lng: -0.1, radius: 25 };
const at = (metresNorth: number, accuracy: number | null = 10) =>
    ({ lat: GYM.lat + metresNorth * DEG_PER_M, lng: GYM.lng, accuracy });

describe('nearestVenueInside', () => {
    it('matches a fix inside the venue (radius floors at MIN_INSIDE_RADIUS_M)', () => {
        expect(haversineMetres(GYM.lat, GYM.lng, at(40).lat, GYM.lng)).toBeCloseTo(40, 0);
        expect(nearestVenueInside([GYM], at(40))).toMatchObject({ partnerId: 'p1', partnerName: 'One LDN' });
        expect(MIN_INSIDE_RADIUS_M).toBe(50);
    });

    it('rejects a fix just outside', () => {
        expect(nearestVenueInside([GYM], at(60))).toBeNull();
    });

    it('honours a larger venue radius', () => {
        expect(nearestVenueInside([{ ...GYM, radius: 120 }], at(100))).not.toBeNull();
    });

    it('never matches on a coarse fix', () => {
        expect(nearestVenueInside([GYM], at(5, MAX_FIX_ACCURACY_M + 1))).toBeNull();
        expect(nearestVenueInside([GYM], at(5, null))).not.toBeNull();
    });

    it('skips entries without usable coordinates and picks the nearest of several', () => {
        const near = { ...GYM, id: 'r2', dbId: 'p2', name: 'Near', lat: GYM.lat + 5 * DEG_PER_M };
        const junk = { id: 'r3', name: 'Junk', lat: 0, lng: 0 };
        const none = { id: 'r4', name: 'None', lat: null, lng: null };
        expect(nearestVenueInside([GYM, near, junk, none], at(0))?.partnerId).toBe('p1');
        expect(nearestVenueInside([GYM, near, junk, none], at(4))?.partnerId).toBe('p2');
    });
});
