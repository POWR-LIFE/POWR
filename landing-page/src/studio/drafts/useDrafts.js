import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countDrafts } from './store';

/**
 * What a Studio page needs around StudioEditor and DraftsPanel, the same in
 * admin, a gym's portal and a reward brand's:
 *   - a fresh editor (remounted by `editorKey`) for each draft opened or new
 *     post started, opened on `initial` (the draft, or null);
 *   - the editor's draft status, for the Drafts tab ("Back to it");
 *   - renames and deletes made on the tab, passed on to the editor;
 *   - how many drafts there are, for the tab's count.
 *
 * scope    whose drafts: { partnerId } a gym's, { brand } a reward brand's,
 *          {} POWR's own
 * show     bring the editor back on screen (switch tab, scroll up)
 * onFresh  called before each fresh editor (admin clears a Trends "Try it")
 *
 * Spread `editor` onto StudioEditor (with key={editorKey}) and `panel` onto
 * DraftsPanel.
 */
export function useDrafts({ partnerId = null, brand = null } = {}, { show, onFresh } = {}) {
    const [editorKey, setEditorKey] = useState(0);
    const [initial, setInitial] = useState(null);
    const [editing, setEditing] = useState(null);
    const [count, setCount] = useState(null);
    const [renamed, setRenamed] = useState(null);
    const [deletedId, setDeletedId] = useState(null);

    const recount = useCallback(() => { countDrafts({ partnerId, brand }).then(setCount); }, [partnerId, brand]);
    useEffect(() => { recount(); }, [recount]);

    // The latest show/onFresh, without making the editor's props change each render.
    const hooks = useRef({ show, onFresh });
    hooks.current = { show, onFresh };
    const fresh = useCallback((draft) => {
        hooks.current.onFresh?.();
        setInitial(draft);
        setEditing(null);
        setEditorKey((k) => k + 1);
        hooks.current.show?.();
    }, []);

    const drafts = useMemo(() => ({
        scope: { partnerId, brand },
        renamed,
        deletedId,
        onChange: setEditing,
        onSaved: recount,
        onNew: () => fresh(null),
    }), [partnerId, brand, renamed, deletedId, recount, fresh]);

    return {
        count,
        editorKey,
        editor: { drafts, initial },
        panel: {
            partnerId,
            brand,
            editing,
            onOpened: fresh,
            onShowEditor: () => hooks.current.show?.(),
            onRenamed: setRenamed,
            onDeleted: setDeletedId,
            onCount: setCount,
        },
    };
}
