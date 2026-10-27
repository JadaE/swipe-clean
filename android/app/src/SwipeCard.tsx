import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Animated, PanResponder, View, Text, Pressable, Image, Dimensions, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C, G } from './theme';
import { thumb } from './media';
import { Media, fmtBytes, fmtDay, fmtTime, fmtDur, fmtRes } from './logic';

const W = Dimensions.get('window').width;
export type CardHandle = { fling: (d: 'remove' | 'keep' | 'later') => void };

/**
 * Video card body. The VideoView never receives touches (pointerEvents="none", no native controls, textureView so it moves
 * with the card). A transparent layer on top takes taps (play/pause); horizontal drags are captured by the card's PanResponder.
 * Audio: volume 1, not mixed with other apps, muted only if she chose mute (remembered in settings).
 */
function VideoBody({ uri, soundOn, onSound }: { uri: string; soundOn: boolean; onSound: (on: boolean) => void }) {
  const player = useVideoPlayer({ uri }, p => { p.loop = true; p.volume = 1; p.audioMixingMode = 'doNotMix'; p.muted = !soundOn; p.play(); });
  const [playing, setPlaying] = useState(true), [rate, setRate] = useState(1), [t, setT] = useState(0), [dur, setDur] = useState(0), [muted, setMuted] = useState(!soundOn);
  useEffect(() => { const iv = setInterval(() => { try { setT(player.currentTime || 0); setDur(player.duration || 0); } catch {} }, 400); return () => clearInterval(iv); }, [player]);
  const toggle = () => { if (player.playing) { player.pause(); setPlaying(false); } else { player.play(); setPlaying(true); } };
  const setSound = (on: boolean) => { player.muted = !on; player.volume = 1; setMuted(!on); onSound(on); if (on && !player.playing) { player.play(); setPlaying(true); } };
  const seek = (dt: number) => { try { player.currentTime = Math.max(0, Math.min((player.duration || 0) - 0.2, (player.currentTime || 0) + dt)); } catch {} };
  return (
    <View style={{ flex: 1 }}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} surfaceType="textureView" />
      </View>
      {/* transparent gesture layer above the player: taps play/pause, drags fall through to the card swipe */}
      <View testID="video-gesture-layer" style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} onResponderRelease={toggle} accessibilityLabel={playing ? 'Pause video' : 'Play video'} />
      {!playing ? <View style={s.playBadge} pointerEvents="none"><Text style={{ color: '#fff', fontSize: 30 }}>▶</Text></View> : null}
      <View style={s.vbar}>
        <Pressable onPress={() => setSound(muted)} style={s.vbtn} hitSlop={8} accessibilityLabel={muted ? 'Turn sound on' : 'Mute'}><Text style={s.vtxt}>{muted ? '🔇 Sound off' : '🔊 Sound on'}</Text></Pressable>
        <Pressable onPress={() => seek(-10)} style={s.vbtn} hitSlop={6}><Text style={s.vtxt}>−10s</Text></Pressable>
        <Pressable onPress={() => seek(10)} style={s.vbtn} hitSlop={6}><Text style={s.vtxt}>+10s</Text></Pressable>
        <Pressable onPress={() => { const r = rate === 1 ? 2 : 1; player.playbackRate = r; setRate(r); }} style={[s.vbtn, rate === 2 && { backgroundColor: C.acc }]} hitSlop={6}><Text style={[s.vtxt, rate === 2 && { color: '#0e1020' }]}>2×</Text></Pressable>
        <Text style={[s.vtxt, { marginLeft: 'auto' }]}>{fmtDur(t * 1000)} / {fmtDur(dur * 1000)}</Text>
      </View>
      <View style={s.track} pointerEvents="none"><View style={[s.trackFill, { width: `${dur ? Math.min(100, (t / dur) * 100) : 0}%` }]} /></View>
    </View>
  );
}
function PhotoBody({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; thumb(uri, 1280).then(u => on && setSrc(u || uri)); return () => { on = false; }; }, [uri]);
  return src ? <Image source={{ uri: src }} style={{ flex: 1 }} resizeMode="contain" /> : <View style={{ flex: 1 }} />;
}
function Poster({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; thumb(uri, 720).then(u => on && setSrc(u)); return () => { on = false; }; }, [uri]);
  return src ? <Image source={{ uri: src }} style={{ flex: 1 }} resizeMode="contain" /> : <View style={{ flex: 1 }} />;
}

type Props = { item: Media; top: boolean; label?: string; recent: boolean; soundOn: boolean; onSound: (on: boolean) => void; onDecide: (d: 'remove' | 'keep' | 'later') => void };
export const SwipeCard = forwardRef<CardHandle, Props>(function SwipeCard({ item, top, label, recent, soundOn, onSound, onDecide }, ref) {
  const pos = useRef(new Animated.ValueXY()).current;
  const done = useRef(false);
  const decideRef = useRef(onDecide); decideRef.current = onDecide;
  const fling = (d: 'remove' | 'keep' | 'later') => {
    if (done.current) return; done.current = true;
    const to = d === 'later' ? { x: 0, y: -900 } : { x: (d === 'keep' ? 1 : -1) * W * 1.4, y: 30 };
    Animated.timing(pos, { toValue: to, duration: 220, useNativeDriver: false }).start(() => decideRef.current(d));
  };
  useImperativeHandle(ref, () => ({ fling }));
  const pan = useRef(PanResponder.create({
    // capture horizontal drags BEFORE children (video gesture layer, buttons) can keep them
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, g) => {
      if (g.dx > W * 0.28 || (g.vx > 0.8 && g.dx > 30)) fling('keep');
      else if (g.dx < -W * 0.28 || (g.vx < -0.8 && g.dx < -30)) fling('remove');
      else Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(),
  })).current;
  const rot = pos.x.interpolate({ inputRange: [-W, 0, W], outputRange: ['-12deg', '0deg', '12deg'] });
  const keepO = pos.x.interpolate({ inputRange: [0, W * 0.25], outputRange: [0, 1], extrapolate: 'clamp' });
  const remO = pos.x.interpolate({ inputRange: [-W * 0.25, 0], outputRange: [1, 0], extrapolate: 'clamp' });
  const meta = [fmtDay(item.takenAt) + ', ' + fmtTime(item.takenAt), fmtBytes(item.size), item.type === 'VIDEO' && item.durationMs ? fmtDur(item.durationMs) : null, fmtRes(item), item.bucket].filter(Boolean).join(' · ');
  return (
    <Animated.View {...(top ? pan.panHandlers : {})}
      style={[s.card, top ? { transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate: rot }] } : { transform: [{ scale: 0.95 }, { translateY: 10 }], opacity: 0.55 }]}>
      {item.type === 'VIDEO' ? (top ? <VideoBody uri={item.uri} soundOn={soundOn} onSound={onSound} /> : <Poster uri={item.uri} />) : <PhotoBody uri={item.uri} />}
      {top ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: keepO }]}><LinearGradient colors={G.keep} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} /></Animated.View> : null}
      {top ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: remO }]}><LinearGradient colors={G.remove} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} /></Animated.View> : null}
      {label ? <Text style={s.label} pointerEvents="none">{label}</Text> : null}
      {item.type === 'VIDEO' ? <Text style={s.tag} pointerEvents="none">video</Text> : null}
      <View style={[s.meta, item.type === 'VIDEO' && { bottom: 58 }]} pointerEvents="none">
        {recent ? <Text style={s.recent}>🕒 Recent: Google Photos may not have backed this up yet</Text> : null}
        <Text style={s.fn} numberOfLines={1}>{item.filename}</Text>
        <Text style={s.mt}>{meta}</Text>
      </View>
      {top ? <Animated.Text pointerEvents="none" style={[s.stamp, s.keepStamp, { opacity: keepO }]}>KEEP</Animated.Text> : null}
      {top ? <Animated.Text pointerEvents="none" style={[s.stamp, s.remStamp, { opacity: remO }]}>REMOVE PILE</Animated.Text> : null}
    </Animated.View>
  );
});
const s = StyleSheet.create({
  card: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#07081a', borderRadius: 24, overflow: 'hidden', elevation: 8, borderWidth: 1, borderColor: '#2e3352' },
  meta: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, paddingTop: 22, backgroundColor: 'rgba(8,9,24,0.6)' },
  fn: { color: '#fff', fontWeight: '700', fontSize: 15 }, mt: { color: '#d7dbef', fontSize: 13, marginTop: 2 },
  recent: { color: C.warn, fontSize: 12, marginBottom: 4 },
  tag: { position: 'absolute', top: 12, right: 12, color: '#fff', backgroundColor: 'rgba(111,211,208,0.35)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontSize: 12 },
  label: { position: 'absolute', top: 12, left: 12, color: '#fff', backgroundColor: 'rgba(143,178,255,0.3)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, fontSize: 12, maxWidth: '70%' },
  vbar: { position: 'absolute', left: 0, right: 0, bottom: 4, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, gap: 6, backgroundColor: 'rgba(8,9,24,0.75)' },
  vbtn: { backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 }, vtxt: { color: '#fff', fontSize: 12 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.15)' }, trackFill: { height: 4, backgroundColor: C.teal },
  playBadge: { position: 'absolute', top: '42%', alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.45)', width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  stamp: { position: 'absolute', top: 70, fontSize: 26, fontWeight: '900', paddingHorizontal: 12, paddingVertical: 4, borderWidth: 3, borderRadius: 10, letterSpacing: 1 },
  keepStamp: { left: 20, color: C.keep, borderColor: C.keep, transform: [{ rotate: '-10deg' }] },
  remStamp: { right: 20, color: C.remove, borderColor: C.remove, transform: [{ rotate: '10deg' }] },
});
