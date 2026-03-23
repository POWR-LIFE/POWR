/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Theme-switchable CSS variable colours (existing system)
        theme: {
          bg:        'var(--theme-bg)',
          surface:   'var(--theme-surface)',
          primary:   'var(--theme-primary)',
          secondary: 'var(--theme-secondary)',
          text:      'var(--theme-text)',
        },
        // POWR static design tokens
        powr: {
          bg:        '#080808',
          surface1:  '#0F0F0F',
          surface2:  '#141414',
          border:    '#1E1E1E',
          accent:    '#E8D200',
          'on-accent': '#080808',
          'text-primary':   '#F2F2F2',
          'text-secondary': '#888888',
          'text-muted':     '#444444',
          success:   '#00CC66',
          warning:   '#FF9944',
          error:     '#CC3333',
          // Category colours
          fashion:   '#7C3AED',
          gear:      '#0EA5E9',
          nutrition: '#F59E0B',
          gym:       '#EF4444',
        },
      },
      fontFamily: {
        'outfit-extralight': ['Outfit_200ExtraLight'],
        'outfit-light':      ['Outfit_300Light'],
        'outfit-regular':    ['Outfit_400Regular'],
        'outfit-medium':     ['Outfit_500Medium'],
        'outfit-semibold':   ['Outfit_600SemiBold'],
        'outfit-bold':       ['Outfit_700Bold'],
      },
      borderRadius: {
        interactive: '4px',
        card:        '6px',
        sheet:       '12px',
      },
      spacing: {
        page: '20px',
      },
    },
  },
  plugins: [],
};
