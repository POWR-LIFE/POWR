import React, { createContext, useContext, useState } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const addToast = (msg, type) => {
        const id = crypto.randomUUID();
        setToasts(prev => [...prev, { id, msg, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    };

    const cfg = {
        success: { border: 'border-green-500/25', icon: CheckCircle2, color: 'text-green-400' },
        error:   { border: 'border-red-500/25',   icon: XCircle,       color: 'text-red-400'   },
        info:    { border: 'border-[#E8D200]/25',  icon: Info,          color: 'text-[#E8D200]' },
    };

    return (
        <ToastContext.Provider value={addToast}>
            {children}
            <div className="fixed bottom-6 right-6 z-[500] flex flex-col gap-2 pointer-events-none">
                {toasts.map(({ id, msg, type }) => {
                    const { border, icon: Icon, color } = cfg[type] || cfg.info;
                    return (
                        <div key={id} className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-[#111] ${border} text-sm shadow-2xl pointer-events-auto min-w-72`}>
                            <Icon size={15} className={`shrink-0 ${color}`} />
                            <span className="text-[#CCC] font-medium">{msg}</span>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

export function useToast() {
    const add = useContext(ToastContext);
    return {
        success: msg => add(msg, 'success'),
        error:   msg => add(msg, 'error'),
        info:    msg => add(msg, 'info'),
    };
}
