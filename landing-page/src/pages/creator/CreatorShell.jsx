import React from 'react';
import { Link } from 'react-router-dom';

// The framed, centred card every pre-portal screen sits in: login, setup,
// "not open yet". Same canvas and glow as the portal so the door matches the
// room. Full-bleed on phones (the card IS the screen), boxed on desktop.
export function CreatorShell({ eyebrow, title, sub, children, footer = true }) {
    return (
        <div className="min-h-screen bg-[#F4F4F1] text-[#1A1A1A] font-['Outfit'] relative overflow-x-hidden">
            <div
                aria-hidden
                className="fixed inset-0 pointer-events-none"
                style={{
                    background:
                        'radial-gradient(800px 500px at 50% -10%, rgba(232,210,0,0.14) 0%, transparent 60%),' +
                        'radial-gradient(600px 400px at 100% 100%, rgba(232,210,0,0.05) 0%, transparent 60%)',
                }}
            />
            <div className="relative min-h-screen flex items-center justify-center px-5 py-10 sm:p-8">
                <div className="w-full max-w-md">
                    <div className="flex justify-center mb-8">
                        <img src="/powr-logo-black.png" alt="POWR" className="h-9" />
                    </div>
                    <div className="bg-white border border-[#E6E6E1] rounded-3xl p-6 sm:p-10 shadow-2xl">
                        {(eyebrow || title) && (
                            <div className="text-center mb-8">
                                {eyebrow && <div className="text-[10px] uppercase tracking-[0.4em] text-[#8a7600] font-black mb-3">{eyebrow}</div>}
                                {title && <h1 className="text-3xl sm:text-4xl font-light tracking-tighter leading-none">{title}</h1>}
                                {sub && <p className="text-[13px] text-[#888] font-light leading-relaxed mt-4">{sub}</p>}
                            </div>
                        )}
                        {children}
                    </div>
                    {footer && (
                        <div className="text-center mt-8">
                            <Link to="/" className="text-[10px] uppercase tracking-[0.3em] font-black">
                                <span className="text-[#BBBBBB] hover:text-[#8a7600] transition-colors">Back to powr.life</span>
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
