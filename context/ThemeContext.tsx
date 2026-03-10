import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type ThemeName = 'volt' | 'stealth-cobalt' | 'modern-forest' | 'acid-gold' | 'cyber-mint';

interface ThemeContextType {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const THEMES: { name: ThemeName; label: string; primary: string }[] = [
    { name: 'volt', label: 'Volt', primary: '#CEFF00' },
    { name: 'stealth-cobalt', label: 'Stealth Cobalt', primary: '#D7FF00' },
    { name: 'modern-forest', label: 'Modern Forest', primary: '#B6FF33' },
    { name: 'acid-gold', label: 'Acid Gold', primary: '#F5FF40' },
    { name: 'cyber-mint', label: 'Cyber Mint', primary: '#4AF2A1' },
];

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
    const [theme, setThemeState] = useState<ThemeName>('stealth-cobalt');
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const loadTheme = async () => {
            try {
                // Temporarily disabling saved theme to enforce standard
                const savedTheme = await AsyncStorage.getItem('app-theme');
                if (savedTheme) {
                    setThemeState(savedTheme as ThemeName);
                }
            } catch (e) {
                console.error('Failed to load theme', e);
            } finally {
                setIsReady(true);
            }
        };
        loadTheme();
    }, []);

    const setTheme = async (newTheme: ThemeName) => {
        setThemeState(newTheme);
        try {
            await AsyncStorage.setItem('app-theme', newTheme);
        } catch (e) {
            console.error('Failed to save theme', e);
        }
    };

    if (!isReady) return null;

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useAppTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useAppTheme must be used within a ThemeProvider');
    }
    return context;
};
