// Lil Guy on screen. Every animation runs on the native driver (transform + opacity only), so swiping and video playback
// never wait on it. All sprites are bundled and kept mounted (stacked, only one visible), so switching poses never decodes.
import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, View, AccessibilityInfo, AppState } from 'react-native';
import { IdleTimer, IdlePose, MascotAction, Reaction, pickReaction, mascotBus, LIL_A11Y } from './mascot';

const SPRITES = {
  main: require('../assets/lil/lil.png'), blink: require('../assets/lil/lil-blink.png'), yawn: require('../assets/lil/lil-yawn.png'),
  lookL: require('../assets/lil/lil-look-left.png'), lookR: require('../assets/lil/lil-look-right.png'),
  camera: require('../assets/lil/lil-camera.png'), filmroll: require('../assets/lil/lil-filmroll.png'), polaroid: require('../assets/lil/lil-polaroid.png'),
  strap: require('../assets/lil/lil-strap.png'), frame: require('../assets/lil/lil-frame.png'),
};
type Sprite = keyof typeof SPRITES;
const KEYS = Object.keys(SPRITES) as Sprite[];
const OUTLINE = [[-1, 0], [1, 0], [0, -1], [0, 1.2]] as const; // 1dp keyline, a touch heavier below like a shadow
const HEART = require('../assets/lil/heart.png'), SPARKLE = require('../assets/lil/sparkle.png');

/** System "Remove animations" / reduce motion. */
export function useReduceMotion() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true; AccessibilityInfo.isReduceMotionEnabled().then(v => live && setOn(!!v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => setOn(!!v));
    return () => { live = false; sub.remove(); };
  }, []);
  return on;
}

const ND = true; // useNativeDriver everywhere
const tm = (v: Animated.Value, toValue: number, duration: number, easing = Easing.out(Easing.quad)) => Animated.timing(v, { toValue, duration, easing, useNativeDriver: ND });
const sp = (v: Animated.Value, toValue: number, friction = 4, tension = 120) => Animated.spring(v, { toValue, friction, tension, useNativeDriver: ND });

type Props = { size?: number; calm?: boolean; testID?: string; outline?: string };
/**
 * outline: a soft keyline colour drawn behind Lil (used on the light theme, where guy's cream edge meets a cream background).
 * size: dp. calm: still except tiny reactions. The parent leaves ~0.43 x size of headroom above Lil for hops and hearts.
 * Reacts to mascotBus.react(action) from anywhere, and to taps. Idle poses after 8–12 s untouched (not in calm / reduce motion).
 */
export const Mascot = memo(function Mascot({ size = 40, calm = false, testID, outline }: Props) {
  const reduce = useReduceMotion();
  const still = calm || reduce;
  const [sprite, setSpriteState] = useState<Sprite>('main');
  const spriteRef = useRef<Sprite>('main');
  const setSprite = (k: Sprite) => { spriteRef.current = k; setSpriteState(k); };
  const [fx, setFx] = useState<'hearts' | 'sparkles' | null>(null);
  const bob = useRef(new Animated.Value(0)).current, ty = useRef(new Animated.Value(0)).current;
  const sx = useRef(new Animated.Value(1)).current, sy = useRef(new Animated.Value(1)).current;
  const wig = useRef(new Animated.Value(0)).current, spin = useRef(new Animated.Value(0)).current;
  const fxA = useRef(new Animated.Value(0)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const lastR = useRef<Reaction | undefined>(undefined);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (f: () => void, ms: number) => { timers.current.push(setTimeout(f, ms)); };
  const clearLater = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  // gentle bounce loop
  useEffect(() => {
    if (still) { bob.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([tm(bob, 1, 1100, Easing.inOut(Easing.sin)), tm(bob, 0, 1100, Easing.inOut(Easing.sin))]));
    loop.start(); return () => loop.stop();
  }, [still]);

  const reset = () => { running.current?.stop(); ty.setValue(0); sx.setValue(1); sy.setValue(1); wig.setValue(0); spin.setValue(0); };
  const play = (a: Animated.CompositeAnimation) => { running.current = a; a.start(() => { if (running.current === a) running.current = null; }); };
  const burst = (kind: 'hearts' | 'sparkles') => { setFx(kind); fxA.setValue(0); tm(fxA, 1, reduce ? 500 : 750, Easing.out(Easing.cubic)).start(({ finished }) => { if (finished) setFx(null); }); };   // a newer burst (spam taps) restarts it instead

  const react = (action: MascotAction) => {
    const r = pickReaction(action, Math.random, lastR.current); lastR.current = r;
    reset();
    if (reduce) { burst(r === 'hearts' ? 'hearts' : 'sparkles'); return; }               // no movement at all, just a soft fade
    if (calm) { play(Animated.sequence([Animated.parallel([tm(sx, 1.06, 90), tm(sy, 1.06, 90)]), Animated.parallel([sp(sx, 1, 6), sp(sy, 1, 6)])])); return; }
    const h = size * 0.32;
    switch (r) {
      case 'hop': play(Animated.sequence([
        Animated.parallel([tm(sx, 1.12, 70), tm(sy, 0.86, 70)]),
        Animated.parallel([tm(ty, -h, 160), tm(sx, 0.92, 160), tm(sy, 1.1, 160)]),
        Animated.parallel([tm(ty, 0, 150, Easing.in(Easing.quad)), tm(sx, 1, 150), tm(sy, 1, 150)]),
        Animated.parallel([tm(sx, 1.1, 60), tm(sy, 0.9, 60)]), Animated.parallel([sp(sx, 1), sp(sy, 1)])])); break;
      case 'squish': play(Animated.sequence([
        Animated.parallel([tm(sx, 1.22, 110), tm(sy, 0.8, 110)]), Animated.parallel([tm(sx, 0.9, 110), tm(sy, 1.14, 110)]),
        Animated.parallel([sp(sx, 1, 3), sp(sy, 1, 3)])])); break;
      case 'wiggle': play(Animated.sequence([tm(wig, -1, 80), tm(wig, 1, 120), tm(wig, -0.7, 110), tm(wig, 0.4, 100), sp(wig, 0, 5)])); break;
      case 'spin': play(Animated.sequence([Animated.parallel([tm(ty, -h * 0.5, 140), tm(spin, 1, 520, Easing.inOut(Easing.cubic))]), tm(ty, 0, 140, Easing.in(Easing.quad))])); break;
      case 'sparkles': case 'hearts': burst(r); play(Animated.sequence([tm(ty, -h * 0.45, 140), Animated.parallel([sp(ty, 0, 4), Animated.sequence([tm(sx, 1.08, 80), sp(sx, 1)])])])); break;
    }
  };

  // squish/pop morph into a pose (or back)
  const morph = (to: Sprite) => {
    reset();
    Animated.parallel([tm(sx, 1.18, 110), tm(sy, 0.62, 110)]).start(({ finished }) => {
      setSprite(to); if (!finished) { sx.setValue(1); sy.setValue(1); return; }
      Animated.parallel([sp(sx, 1, 3, 140), sp(sy, 1, 3, 140)]).start();
    });
  };
  const toPose = (p: IdlePose) => {
    clearLater();
    if (p === 'blink') { setSprite('blink'); later(() => setSprite('main'), 180); later(() => setSprite('blink'), 420); later(() => setSprite('main'), 600); return; }
    if (p === 'look') { setSprite('lookL'); later(() => setSprite('main'), 900); later(() => setSprite('lookR'), 1100); later(() => setSprite('main'), 2100); return; }
    if (p === 'yawn') { setSprite('yawn'); play(Animated.sequence([Animated.parallel([tm(sy, 1.1, 600), tm(sx, 0.95, 600)]), Animated.parallel([tm(sy, 1, 700), tm(sx, 1, 700)])])); return; }
    morph(p);
  };
  const toMain = () => { clearLater(); const s = spriteRef.current; if (s === 'main') return; if (s === 'blink' || s === 'lookL' || s === 'lookR' || s === 'yawn') setSprite('main'); else morph('main'); };

  const reactRef = useRef(react); reactRef.current = react;
  const idle = useRef<IdleTimer | null>(null);
  useEffect(() => {
    const t = new IdleTimer(p => toPoseRef.current(p), () => toMainRef.current());
    idle.current = t; if (!still) t.start();
    const off = mascotBus.on(e => { if (e.kind === 'poke') t.poke(); else { t.poke(); reactRef.current(e.action); } });
    const app = AppState.addEventListener('change', s => { if (s === 'active') { if (!still) t.start(); } else t.stop(); });
    return () => { t.stop(); off(); app.remove(); clearLater(); running.current?.stop(); };
  }, [still]);
  const toPoseRef = useRef(toPose); toPoseRef.current = toPose;
  const toMainRef = useRef(toMain); toMainRef.current = toMain;

  const bobY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.07] });
  const rot = wig.interpolate({ inputRange: [-1, 1], outputRange: ['-14deg', '14deg'] });
  const rot2 = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const fxY = fxA.interpolate({ inputRange: [0, 1], outputRange: [0, reduce ? 0 : -size * 0.35] });
  const fxO = fxA.interpolate({ inputRange: [0, 0.2, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const e = Math.round(size * 0.34);
  return (
    <Pressable testID={testID || 'lil'} onPress={() => { mascotBus.poke(); react('tap'); }} hitSlop={10} accessibilityRole="button" accessibilityLabel={LIL_A11Y}
      style={{ width: size, height: size, overflow: 'visible' }}>
      <Animated.View style={{ width: size, height: size, transform: [{ translateY: bobY }, { translateY: ty }, { translateY: size / 2 }, { scaleX: sx }, { scaleY: sy }, { translateY: -size / 2 }, { rotate: rot }, { rotate: rot2 }] }}>
        {outline ? OUTLINE.map(([dx, dy], i) => <Image key={'o' + i} source={SPRITES[sprite]} fadeDuration={0} tintColor={outline} style={{ position: 'absolute', width: size, height: size, left: dx, top: dy }} />) : null}
        {KEYS.map(k => <Image key={k} source={SPRITES[k]} fadeDuration={0} style={{ position: 'absolute', width: size, height: size, opacity: k === sprite ? 1 : 0 }} />)}
      </Animated.View>
      {fx ? <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, opacity: fxO, transform: [{ translateY: fxY }] }}>
        <Image source={fx === 'hearts' ? HEART : SPARKLE} fadeDuration={0} style={{ position: 'absolute', width: e, height: e, left: -e * 0.15, top: size * 0.05 }} />
        <Image source={fx === 'hearts' ? HEART : SPARKLE} fadeDuration={0} style={{ position: 'absolute', width: e * 0.75, height: e * 0.75, right: -e * 0.1, top: -e * 0.05 }} />
        {fx === 'sparkles' ? <Image source={SPARKLE} fadeDuration={0} style={{ position: 'absolute', width: e * 0.6, height: e * 0.6, right: size * 0.3, top: -e * 0.35 }} /> : null}
      </Animated.View> : null}
    </Pressable>
  );
});
