import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Rect } from 'react-native-svg';
import { tillBarcode, type BarcodeFormat } from '@/shared/inStore';

/**
 * A chain's own code drawn the way its till expects: EAN-13, Code 128 or QR.
 * Pure SVG from shared/inStore.ts, so it ships by OTA (no barcode module in
 * the binary). Always on white with a quiet zone: tills won't read bars on
 * the app's dark background.
 */
export function TillBarcode({
  code,
  format,
  width,
  barHeight = 110,
}: {
  code: string;
  format: BarcodeFormat;
  width: number;
  barHeight?: number;
}) {
  const { t } = useTranslation();
  const barcode = useMemo(() => tillBarcode(code, format), [code, format]);

  if (format === 'qr' || !barcode) {
    const size = Math.min(width, 240);
    return (
      <View style={[styles.card, { width }]} accessible accessibilityLabel={t('inStore:barcode.qrA11y', { code })}>
        <QRCode value={code} size={size - 32} color="#0a0a0a" backgroundColor="#FFFFFF" />
        <Text style={styles.digits}>{code}</Text>
      </View>
    );
  }

  // Merge neighbouring dark modules into one rect each: fewer nodes, no hairline seams.
  const quiet = 10;
  const total = barcode.modules.length + quiet * 2;
  const unit = (width - 32) / total;
  const bars: { x: number; w: number; guard: boolean }[] = [];
  barcode.modules.forEach((m, i) => {
    if (!m.on) return;
    const prev = bars[bars.length - 1];
    const x = (quiet + i) * unit;
    if (prev && Math.abs(prev.x + prev.w - x) < 0.01 && prev.guard === m.guard) prev.w += unit;
    else bars.push({ x, w: unit, guard: m.guard });
  });
  const guardExtra = barcode.format === 'ean13' ? 10 : 0;

  return (
    <View style={[styles.card, { width }]} accessible accessibilityLabel={t('inStore:barcode.barcodeA11y', { code: barcode.text })}>
      <Svg width={width - 32} height={barHeight + guardExtra}>
        {bars.map((b, i) => (
          <Rect key={i} x={b.x} y={0} width={b.w} height={b.guard ? barHeight + guardExtra : barHeight} fill="#0a0a0a" />
        ))}
      </Svg>
      <Text style={styles.digits}>{barcode.text}</Text>
      {/* Symbology names, the same in every language. */}
      <Text style={styles.format}>{barcode.format === 'ean13' ? 'EAN-13' : 'CODE 128'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  digits: { fontSize: 17, fontWeight: '500', letterSpacing: 3, color: '#0a0a0a' },
  format: {
    fontSize: 9, fontWeight: '600', letterSpacing: 1.5, color: '#555',
    backgroundColor: '#EFEFEC', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden',
  },
});
