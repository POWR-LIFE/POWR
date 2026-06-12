import { supabase } from './supabase';

// supabase.functions.invoke wraps non-2xx responses in a FunctionsHttpError whose
// .message is just "Edge Function returned a non-2xx status code" — the real
// error is in the response body. This unwraps it.
export async function invokeFn(name, body) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
        let msg = error.message ?? 'Request failed';
        if (error.context && typeof error.context.json === 'function') {
            try {
                const payload = await error.context.json();
                if (payload?.error) msg = payload.error;
            } catch { /* keep generic message */ }
        }
        throw new Error(msg);
    }
    return data;
}
