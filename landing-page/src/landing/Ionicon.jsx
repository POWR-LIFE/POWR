/**
 * Exact app icons: renders glyphs from the same Ionicons.ttf the app ships
 * (@expo/vector-icons). Codepoints taken from its glyphmap. The @font-face
 * for 'Ionicons' is declared in LandingV2's style block.
 */
const GLYPHS = {
  'home': 0xf382, 'home-outline': 0xf383,
  'bar-chart': 0xf16f, 'bar-chart-outline': 0xf170,
  'trophy': 0xf601, 'trophy-outline': 0xf602,
  'bag': 0xf157, 'bag-outline': 0xf161,
  'compass': 0xf283, 'compass-outline': 0xf284,
  'barbell': 0xf172, 'barbell-outline': 0xf173,
  'footsteps': 0xf32e, 'footsteps-outline': 0xf32f,
  'bicycle': 0xf196, 'bicycle-outline': 0xf197,
  'moon': 0xf460, 'moon-outline': 0xf461,
  'flame': 0xf313, 'flame-outline': 0xf314,
  'search': 0xf55f, 'search-outline': 0xf563,
  'options-outline': 0xf48b,
  'star': 0xf595, 'star-outline': 0xf599,
  'chevron-forward': 0xf23b,
  'location': 0xf3c4, 'location-outline': 0xf3c5,
  'navigate': 0xf46c,
  'shield-checkmark': 0xf578,
  'checkmark': 0xf21d, 'checkmark-circle': 0xf21e,
  'chevron-down': 0xf232, 'chevron-up': 0xf241,
  'wallet': 0xf625, 'wallet-outline': 0xf626,
  'people': 0xf49f, 'people-outline': 0xf4a3,
  'person-add': 0xf4a6, 'person-add-outline': 0xf4a7,
  'gift': 0xf337, 'gift-outline': 0xf338,
  'notifications': 0xf475, 'notifications-outline': 0xf47f,
  'watch': 0xf62b, 'watch-outline': 0xf62c,
  'lock-closed': 0xf3c7, 'lock-closed-outline': 0xf3c8,
  'copy-outline': 0xf290,
  'sparkles': 0xf58c,
  'close': 0xf24a,
};

export default function Ion({ name, size = 16, color = '#F2F2F2', style }) {
  const cp = GLYPHS[name];
  return (
    <span
      aria-hidden
      style={{
        fontFamily: 'Ionicons',
        fontSize: size,
        color,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontStyle: 'normal',
        ...style,
      }}
    >
      {cp ? String.fromCodePoint(cp) : '?'}
    </span>
  );
}
