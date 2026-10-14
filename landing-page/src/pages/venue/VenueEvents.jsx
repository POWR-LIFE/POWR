import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Users, ChevronRight, RotateCcw, Lock } from 'lucide-react';
import { useAuth } from '../../App';
import { Page, Card, Micro, PageTitle, Spinner, Empty, BTN_GOLD, BTN_GHOST } from '../../components/portal/ui';
import { fetchGymEvents } from './venueApi';
import { StatusPill, statusKey, scoringRange } from './eventUi';
import { Locked, usePackage } from './packages';
import { serverErrorText } from '../../lib/serverErrors';

const GROUPS = [
    { key: 'on',       title: 'venueEvents:list.groups.on',       keys: ['pending', 'scheduled', 'live', 'locked'] },
    { key: 'drafts',   title: 'venueEvents:list.groups.drafts',   keys: ['draft', 'rejected'] },
    { key: 'finished', title: 'venueEvents:list.groups.finished', keys: ['revealed', 'settled', 'cancelled', 'pulled'] },
];

function EventRow({ ev, canRun }) {
    const { t } = useTranslation();
    const k = statusKey(ev);
    const finished = ['revealed', 'settled'].includes(k);
    return (
        <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
                <Link to={`/venue/events/${ev.id}`} className="flex-1 min-w-0 group">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <StatusPill ev={ev} />
                        {ev.managed_by === 'powr' && (
                            <span className="inline-flex items-center h-7 px-3 rounded-full border border-[#E6E6E1] text-[9px] font-black uppercase tracking-[0.2em] text-[#AAAAAA]">{t('venueEvents:list.runByPowr')}</span>
                        )}
                    </div>
                    <div className="text-lg font-bold text-[#1A1A1A] truncate group-hover:text-[#8a7600] transition-colors">{ev.name}</div>
                    <div className="text-[12px] text-[#999] mt-1">
                        {ev.template?.name ? `${ev.template.name} · ` : ''}{scoringRange(ev)}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold text-[#888] mt-3">
                        <Users size={12} /> {ev.prizes?.length
                            ? t('venueEvents:list.joinedWithPrize', { count: ev.participants ?? 0, prize: ev.prizes[0].label })
                            : t('venueEvents:list.joined', { count: ev.participants ?? 0 })}
                    </div>
                </Link>
                <div className="flex flex-col items-end gap-2 shrink-0">
                    <ChevronRight size={16} className="text-[#CCCCCC]" />
                    {finished && canRun && ev.managed_by === 'gym' && (
                        <Link to={`/venue/events/new?from=${ev.id}`} className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] font-black mt-6">
                            <RotateCcw size={11} className="text-[#8a7600]" /><span className="text-[#8a7600]">{t('venueEvents:list.runAgain')}</span>
                        </Link>
                    )}
                </div>
            </div>
        </Card>
    );
}

export default function VenueEvents() {
    const { t } = useTranslation();
    const { gym } = useAuth();
    const { pkg } = usePackage();
    const canRun = !!pkg?.features?.events;
    const [events, setEvents] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        fetchGymEvents(gym.partner_id)
            .then(e => { if (alive) setEvents(e ?? []); })
            .catch(err => { if (alive) setError(serverErrorText(err)); });
        return () => { alive = false; };
    }, [gym.partner_id]);

    if (error) return <Empty title={t('venueEvents:list.loadError')} action={<button type="button" onClick={() => window.location.reload()} className={BTN_GHOST}>{t('common:actions.retry')}</button>}>{error}</Empty>;
    if (!events) return <Spinner />;

    const newBtn = canRun ? (
        <Link to="/venue/events/new" className={BTN_GOLD} style={{ color: '#080808' }}>
            <Plus size={14} /> {t('venueEvents:list.newEvent')}
        </Link>
    ) : (
        <Link to="/venue/package" className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-black text-[#8a7600]">
            <Lock size={12} /> {t('venueEvents:list.newNeedsClash')}
        </Link>
    );

    return (
        <Page>
            <PageTitle eyebrow={t('venueEvents:list.eyebrow')} title={t('venueEvents:list.title')} sub={gym.name} right={events.length ? newBtn : null} />

            {events.length === 0 && !canRun ? (
                <Locked feature="events" />
            ) : events.length === 0 ? (
                <Card>
                    <Empty title={t('venueEvents:list.emptyTitle')} action={newBtn}>
                        {t('venueEvents:list.emptyBody')}
                    </Empty>
                </Card>
            ) : GROUPS.map(g => {
                const list = events.filter(ev => g.keys.includes(statusKey(ev)));
                if (!list.length) return null;
                return (
                    <div key={g.key} className="space-y-3">
                        <Micro>{t(g.title)}</Micro>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                            {list.map(ev => <EventRow key={ev.id} ev={ev} canRun={canRun} />)}
                        </div>
                    </div>
                );
            })}
        </Page>
    );
}
