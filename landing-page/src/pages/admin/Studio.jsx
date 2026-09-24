import React from 'react';
import { Palette } from 'lucide-react';
import StudioEditor from '../../studio/StudioEditor';

/**
 * Studio — social posts from a single photo. The templates, grade and type
 * live in src/studio/; this page is the admin shell around the editor.
 */
export default function Studio() {
    // The intro sits at the top of the controls column, not above the whole
    // grid, so the sticky preview starts level with it and is fully on screen
    // from the first paint.
    return (
        <StudioEditor
            intro={(
                <div className="px-1">
                    <div className="flex items-center gap-3 mb-1">
                        <Palette size={22} className="text-[#E8D200]" />
                        <h1 className="text-xl font-bold text-[#111]">Studio</h1>
                    </div>
                    <p className="text-sm text-[#777]">
                        Social posts from a single photo. Pick a template, drop the photo in, change the
                        words — the grade, crop and type are handled.
                    </p>
                </div>
            )}
        />
    );
}
