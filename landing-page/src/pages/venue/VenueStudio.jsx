import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../App';
import { Micro, Spinner, Empty, BTN_GHOST } from '../../components/portal/ui';
import StudioEditor from '../../studio/StudioEditor';
import { gymStudioData } from '../../studio/gymData';
import { cityOf } from '../../studio/data';
import { fetchGymSummary } from './venueApi';

// The admin Studio, for a gym: the same templates, grade and exports, filled
// from this gym's own events and weekly board (studio/gymData.js). Photos and
// clips never leave the device; the post is drawn and saved in the browser.
// Partners (founding-partner posts, reward vouchers) is POWR's own marketing,
// so it isn't offered here.
const GYM_CATEGORIES = ['Brand', 'Events', 'Challenges'];

export default function VenueStudio() {
    const { gym } = useAuth();
    const [params] = useSearchParams();
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        fetchGymSummary(gym.partner_id)
            .then((s) => { if (alive) setSummary(s); })
            .catch((e) => { if (alive) setError(e.message); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    // "Make a post" on an event page opens here with ?event=<id>: the Ticket
    // template, filled from that event. The Overview's moves open ?board=week:
    // Results, filled from this week's board.
    const eventId = params.get('event');
    const boardWeek = params.get('board') === 'week';
    const start = useMemo(() => (eventId ? { templateId: 'ticket', fill: { kind: 'event', id: eventId } }
        : boardWeek ? { templateId: 'results', fill: { kind: 'board', id: 'week' } }
        : null), [eventId, boardWeek]);

    const name = summary?.gym?.name ?? gym.name;
    const data = useMemo(() => (summary ? gymStudioData({
        partner_id: gym.partner_id,
        name,
        address: summary.gym?.address ?? '',
        weekStart: summary.week_start_at,
    }) : null), [summary, gym.partner_id, name]);

    const venue = useMemo(() => ({ name, city: cityOf(summary?.gym?.address) }), [name, summary]);

    if (error) return <Empty title="Couldn’t open the Studio" action={<button type="button" onClick={() => window.location.reload()} className={BTN_GHOST}>Try again</button>}>{error}</Empty>;
    if (!data) return <Spinner />;

    return (
        <StudioEditor
            data={data}
            categories={GYM_CATEGORIES}
            start={start}
            venue={venue}
            showRefs={false}
            // The portal's header sits outside its scroll area, so the preview
            // sticks nearer the top and gives up the difference in height.
            stickyClass="lg:top-10"
            canvasInset={40}
            intro={(
                <div className="px-1 pb-1">
                    <Micro gold className="mb-3">Studio</Micro>
                    <h1 className="text-3xl sm:text-4xl font-light tracking-tighter text-[#1A1A1A] leading-[1.05]">Posts for {name}</h1>
                    <p className="text-[13px] text-[#888] leading-relaxed mt-3">
                        Pick a template, add a photo or video, and fill it from your events or this week’s board.
                        Everything stays on this device until you download it.
                    </p>
                </div>
            )}
        />
    );
}
