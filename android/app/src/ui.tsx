import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Image, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C, onTheme } from './theme';
import { thumb } from './media';

/** Calm progress ring. */
export function Ring({ pct, size = 120, stroke = 10, color = C.keep, children }: { pct: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill as any}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.line} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${circ} ${circ}`} strokeDashoffset={circ * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      {children}
    </View>
  );
}
export function Btn({ title, onPress, kind = 'plain', disabled, style, testID }: { title: string; onPress: () => void; kind?: 'plain' | 'pri' | 'danger' | 'ghost'; disabled?: boolean; style?: ViewStyle; testID?: string }) {
  const bg = kind === 'pri' ? C.acc : kind === 'danger' ? C.dangerBg : kind === 'ghost' ? 'transparent' : C.card2;
  const fg = kind === 'pri' ? C.onAcc : kind === 'danger' ? C.dangerInk : C.ink;
  return (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', marginVertical: 5, borderWidth: kind === 'ghost' ? 1 : 0, borderColor: C.line }, style]}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}
export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[{ backgroundColor: C.card, borderRadius: 18, padding: 16, marginVertical: 6 }, style]}>{children}</View>;
const mkT = () => ({
  h1: { color: C.ink, fontSize: 26, fontWeight: '800' as const }, h2: { color: C.ink, fontSize: 19, fontWeight: '700' as const },
  b: { color: C.ink, fontSize: 15, lineHeight: 21 }, m: { color: C.mut, fontSize: 13, lineHeight: 18 }, s: { color: C.dim, fontSize: 12 },
});
/** Text styles. Rebuilt when the theme changes (importers read the live binding at render time). */
export let T = mkT();
onTheme(() => { T = mkT(); });
export function Thumb({ uri, size = 360, style, badge }: { uri: string; size?: number; style?: any; badge?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; thumb(uri, size).then(u => on && setSrc(u)); return () => { on = false; }; }, [uri, size]);
  return (
    <View style={[{ backgroundColor: C.thumbBg, overflow: 'hidden' }, style]}>
      {src ? <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
      {badge ? <Text style={{ position: 'absolute', right: 4, bottom: 4, color: '#fff', backgroundColor: 'rgba(0,0,0,.6)', fontSize: 10, paddingHorizontal: 5, borderRadius: 6 }}>{badge}</Text> : null}
    </View>
  );
}
export function Bar({ pct, color = C.acc, h = 6 }: { pct: number; color?: string; h?: number }) {
  return <View style={{ height: h, backgroundColor: C.line, borderRadius: h, overflow: 'hidden' }}><View style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%`, height: '100%', backgroundColor: color }} /></View>;
}
