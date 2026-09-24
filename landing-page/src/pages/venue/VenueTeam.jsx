import React from 'react';
import { useAuth } from '../../App';
import { Page, PageTitle } from '../../components/portal/ui';
import GymStaffPanel from '../../components/GymStaffPanel';

export default function VenueTeam() {
    const { gym, user, isActingGym } = useAuth();
    return (
        <Page>
            <PageTitle eyebrow="Team" title="Who runs the gym" sub={gym.name} />
            <div className="max-w-3xl">
                <GymStaffPanel
                    partnerId={gym.partner_id}
                    gymName={gym.name}
                    adminView={isActingGym}
                    selfUserId={isActingGym ? null : user?.id}
                />
            </div>
        </Page>
    );
}
