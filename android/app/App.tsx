// Swipe Clean v0.01: sort your phone's photos and videos yourself, one swipe at a time.
// The app never decides, suggests or pre-selects anything. Removal only happens through Android's own confirmation dialog.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Modal, FlatList, AppState, Vibration, Linking, Alert, BackHandler, ActivityIndicator, Switch } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { C, G } from './src/theme';
import { Ring, Btn, Card, T, Thumb, Bar } from './src/ui';
import { SwipeCard, CardHandle } from './src/SwipeCard';
import * as L from './src/logic';
import { native, checkAccess, requestAccess, Access, shareItem } from './src/media';
import * as Store from './src/store';
import * as Stats from './src/stats';
import { fetchLatest, isNewer, openDownload, UpdateInfo } from './src/update';
import { setReminder } from './src/reminder';
import { VERSION_NAME } from './src/version';

type Screen = { name: 'welcome' } | { name: 'access' } | { name: 'home' } | { name: 'swipe'; deck: L.Deck } | { name: 'months' } | { name: 'compare' } | { name: 'pile' } | { name: 'removed' } | { name: 'settings' } | { name: 'about' } | { name: 'stats' };
const BATCH = 250;

export default function App() {
  return <SafeAreaProvider><StatusBar style="light" /><Main /></SafeAreaProvider>;
}

function Main() {
  const [saved, setSaved] = useState<Store.Saved | null>(null);
  const [items, setItems] = useState<L.Media[] | null>(null);
  const [access, setAccess] = useState<Access>('denied');
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [storage, setStorage] = useState<{ total: number; free: number } | null>(null);
  const [trash, setTrash] = useState<{ supported: boolean; bytes: number; count: number } | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [otdOffset, setOtdOffset] = useState(0); const [otdWeek, setOtdWeek] = useState(false); const [moreOpen, setMoreOpen] = useState(false);
  const toastT = useRef<any>(null);
  const say = (m: string, ms = 2600) => { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(null), ms); };

  const commit = useCallback((f: (s: Store.Saved) => Store.Saved) => setSaved(prev => { if (!prev) return prev; const n = f(prev); Store.save(n); return n; }), []);

  const refreshDevice = useCallback(async () => {
    if (!native) return;
    try { setStorage(await native.storage()); } catch {}
    try { setTrash(await native.trashInfo()); } catch {}
  }, []);
  const loadMedia = useCallback(async () => {
    if (!native) { setItems([]); return; }
    setLoading(true);
    try { setItems(await native.queryAll()); } catch (e: any) { say('Couldn’t read your photos: ' + (e?.message || e)); setItems([]); }
    setLoading(false); refreshDevice();
  }, [refreshDevice]);

  // boot
  useEffect(() => { (async () => {
    const s = await Store.load(); setSaved(s);
    const a = await checkAccess().catch(() => 'denied' as Access); setAccess(a);
    if (!s.settings.seenWelcome) setScreen({ name: 'welcome' }); else if (a === 'denied') setScreen({ name: 'access' }); else { setScreen({ name: 'home' }); loadMedia(); }
    // update check: at most once a day, version file only
    if (Date.now() - s.settings.lastUpdateCheck > L.DAY) fetchLatest().then(u => { if (isNewer(u)) setUpdate(u); }).catch(() => {}).finally(() => commit(x => ({ ...x, settings: { ...x.settings, lastUpdateCheck: Date.now() } })));
  })(); }, []);
  useEffect(() => { const sub = AppState.addEventListener('change', st => { if (st === 'background') Store.flush(); if (st === 'active') refreshDevice(); }); return () => sub.remove(); }, [refreshDevice]);
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (screen.name !== 'home' && screen.name !== 'welcome' && screen.name !== 'access') { setScreen({ name: 'home' }); return true; } return false; }); return () => sub.remove(); }, [screen]);

  useEffect(() => { if (!storage || !saved || saved.storageLog.some(x => x.tag === 'baseline')) return;
    commit(s => ({ ...s, statsSince: s.statsSince || Date.now(), storageLog: [{ at: Date.now(), used: storage.total - storage.free, total: storage.total, tag: 'baseline' as const }, ...s.storageLog] })); }, [storage, !!saved]);
  const removedIds = useMemo(() => new Set(Object.values(saved?.removed || {}).filter(r => !r.restored).map(r => r.id)), [saved?.removed]);
  const live = useMemo(() => (items || []).filter(m => !removedIds.has(m.id)), [items, removedIds]);
  const byId = useMemo(() => new Map(live.map(m => [m.id, m])), [live]);
  const decks = useMemo(() => L.buildDecks(live), [live]);

  if (!saved) return <View style={st.fill} />;
  const S = saved;
  const today = S.days[L.dayKey(Date.now())] || { date: '', activeMs: 0, decided: 0, trashedBytes: 0, deletedBytes: 0 };
  const pile = live.filter(m => S.decisions[m.id] === 'remove');
  const pileBytes = pile.reduce((a, m) => a + m.size, 0);
  const sortedCount = live.filter(m => S.decisions[m.id]).length;
  const totals = Object.values(S.removed).filter(r => !r.restored).reduce((a, r) => { a[r.mode] += r.bytes; return a; }, { trash: 0, delete: 0 });

  const decide = (id: string, d: L.Decision) => {
    commit(s => { const r = L.applyDecision(s.decisions, s.history, id, d); const days = L.logDecision(s.days);
      const before = s.days[L.dayKey(Date.now())]?.activeMs || 0, after = days[L.dayKey(Date.now())].activeMs, goal = s.settings.goalMin * 60000;
      if (before < goal && after >= goal) setTimeout(() => say(`${s.settings.goalMin} minutes today. That’s your daily goal.`, 3500), 0);
      return { ...s, ...r, days, front: s.front.filter(x => x !== id) }; });
    try { Vibration.vibrate(d === 'remove' ? 10 : 5); } catch {}
  };
  const undo = () => {
    const r = L.undoLast(S.decisions, S.history); if (!r) { say('Nothing to undo'); return; }
    commit(s => ({ ...s, decisions: r.decisions, history: r.history, front: r.entry.prev ? s.front : [r.entry.id, ...s.front.filter(x => x !== r.entry.id)] }));
    const m = byId.get(r.entry.id); say('Undone' + (m?.filename ? ': ' + m.filename : ''));
  };

  const body = (() => {
    switch (screen.name) {
      case 'welcome': return <Welcome onDone={async () => { commit(s => ({ ...s, settings: { ...s.settings, seenWelcome: true } })); const a = await checkAccess(); setAccess(a); if (a === 'denied') setScreen({ name: 'access' }); else { setScreen({ name: 'home' }); loadMedia(); } }} />;
      case 'access': return <AccessScreen onAsk={async () => { const a = await requestAccess(); setAccess(a); if (a !== 'denied') { setScreen({ name: 'home' }); loadMedia(); } else say('No access yet. You can allow it in Settings → Apps → Swipe Clean → Permissions.', 4500); }} />;
      case 'swipe': return <SwipeScreen deck={screen.deck} S={S} onSound={on => commit(x => ({ ...x, settings: { ...x.settings, soundOn: on } }))} byId={byId} today={today} onDecide={decide} onUndo={undo} onBack={() => setScreen({ name: 'home' })} onPile={() => setScreen({ name: 'pile' })} pileCount={pile.length} />;
      case 'pile': return <PileScreen pile={pile} bytes={pileBytes} S={S} onBack={() => setScreen({ name: 'home' })} onUndo={undo}
        onKeep={id => { commit(s => ({ ...s, ...L.applyDecision(s.decisions, s.history, id, 'keep') })); say('Moved back to Keep (undo is available)'); }}
        onRemoved={(list, mode) => { commit(s => { const removed = { ...s.removed }; let days = s.days; let bytes = 0;
          for (const m of list) { removed[m.id] = { id: m.id, uri: m.uri, filename: m.filename, bytes: m.size, at: Date.now(), mode, kind: m.type === 'VIDEO' ? 'video' : 'photo' }; bytes += m.size; }
          days = L.logRemoval(days, bytes, mode); return { ...s, removed, days }; }); refreshDevice(); }}
        onSnaps={snaps => commit(s => ({ ...s, storageLog: s.storageLog.concat(snaps).slice(-400) }))} />;
      case 'removed': return <RemovedScreen S={S} onBack={() => setScreen({ name: 'home' })} onRestored={ids => { commit(s => { const removed = { ...s.removed }; const decisions = { ...s.decisions };
          for (const id of ids) { removed[id] = { ...removed[id], restored: true }; delete decisions[id]; } return { ...s, removed, decisions }; }); loadMedia(); }} />;
      case 'settings': return <SettingsScreen S={S} update={update} setUpdate={setUpdate} onBack={() => setScreen({ name: 'home' })} commit={commit} say={say}
        onClear={async () => { await Store.clearAll(); const s = await Store.load(); setSaved({ ...s, settings: { ...s.settings, seenWelcome: true } }); setScreen({ name: 'home' }); say('Cleared. Nothing is saved on this phone now.'); }} />;
      case 'about': return <About onBack={() => setScreen({ name: 'home' })} />;
      case 'stats': return <StatsScreen S={S} storage={storage} say={say} onBack={() => setScreen({ name: 'home' })} />;
      case 'months': return <MonthsScreen live={live} S={S} commit={commit} go={setScreen} onBack={() => setScreen({ name: 'home' })} />;
      case 'compare': return <CompareScreen live={live} S={S} onDecide={decide} onUndo={undo} onBack={() => setScreen({ name: 'home' })} />;
      default: return <Home otd={{ offset: otdOffset, setOffset: setOtdOffset, week: otdWeek, setWeek: setOtdWeek }} more={{ open: moreOpen, setOpen: setMoreOpen }} S={S} live={live} decks={decks} byId={byId} today={today} storage={storage} trash={trash} totals={totals} pile={pile} pileBytes={pileBytes} sortedCount={sortedCount}
        access={access} loading={loading || items === null} update={update} go={setScreen}
        onMoreAccess={async () => { const a = await requestAccess(); setAccess(a); loadMedia(); }} />;
    }
  })();
  return (
    <SafeAreaView style={st.fill} edges={['top', 'bottom']}>
      {body}
      {toast ? <View style={st.toast} pointerEvents="none"><Text style={{ color: C.ink, fontSize: 14 }}>{toast}</Text></View> : null}
    </SafeAreaView>
  );
}

/* ---------------- screens ---------------- */
function BackupNotice({ compact }: { compact?: boolean }) {
  return (
    <Card style={{ borderWidth: 1, borderColor: '#4a4226', backgroundColor: '#1f1d16' }}>
      <Text style={[T.h2, { color: C.warn, fontSize: compact ? 16 : 19 }]}>Before you remove anything</Text>
      <Text style={[T.b, { marginTop: 6 }]}>Removing a photo or video here takes it off <Text style={{ fontWeight: '700' }}>this phone</Text>. It does not touch the copy in Google Photos.</Text>
      <Text style={[T.b, { marginTop: 6 }]}>This app <Text style={{ fontWeight: '700' }}>can’t tell</Text> whether an item has been backed up. Android doesn’t share that with other apps. Before removing, open <Text style={{ fontWeight: '700' }}>Google Photos → your profile picture → Backup</Text> and check it says <Text style={{ fontWeight: '700' }}>Backup complete</Text>.</Text>
      {!compact ? <Text style={[T.m, { marginTop: 6 }]}>Also note: if Google Photos’ own “Free up space” or a sync setting is on, deleting a local copy can behave differently. Check backup first and you’ll be fine.</Text> : null}
    </Card>
  );
}
function Welcome({ onDone }: { onDone: () => void }) {
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <Text style={[T.h1, { marginTop: 12 }]}>Swipe Clean</Text>
      <Text style={[T.b, { color: C.mut, marginVertical: 8 }]}>Go through your phone’s photos and videos at your own pace. Swipe right to keep, left to put it on your Remove pile. You decide every single one. The app never picks for you.</Text>
      <BackupNotice />
      <Card><Text style={T.b}>Nothing leaves your phone unless you tap ⇪ Share and pick an app yourself. The only time it goes online is to check for app updates.</Text></Card>
      <Btn kind="pri" title="I understand. Continue" onPress={onDone} testID="welcome-continue" />
    </ScrollView>
  );
}
function AccessScreen({ onAsk }: { onAsk: () => void }) {
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <Text style={[T.h1, { marginTop: 12 }]}>Allow access to photos & videos</Text>
      <Text style={[T.b, { color: C.mut, marginVertical: 8 }]}>Android will ask. Choose <Text style={{ fontWeight: '700', color: C.ink }}>Allow all</Text> to sort everything, or <Text style={{ fontWeight: '700', color: C.ink }}>Select photos and videos</Text> to sort just some. You can change this later.</Text>
      <Text style={[T.m, { marginBottom: 8 }]}>Read access can’t remove anything. Removing always shows a separate Android confirmation that you have to approve.</Text>
      <Btn kind="pri" title="Continue" onPress={onAsk} testID="ask-access" />
      <Btn kind="ghost" title="Open app settings" onPress={() => Linking.openSettings()} />
    </ScrollView>
  );
}
function GradCard({ children, colors = G.ring, style }: { children: React.ReactNode; colors?: readonly [string, string, ...string[]]; style?: any }) {
  return <LinearGradient colors={colors as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: 20, padding: 16, marginVertical: 6, borderWidth: 1, borderColor: '#343a66' }, style]}>{children}</LinearGradient>;
}
function Home(p: { otd: { offset: number; setOffset: (n: number) => void; week: boolean; setWeek: (b: boolean) => void }; more: { open: boolean; setOpen: (b: boolean) => void };
  S: Store.Saved; live: L.Media[]; decks: L.Deck[]; byId: Map<string, L.Media>; today: L.DayLog; storage: { total: number; free: number } | null; trash: { supported: boolean; bytes: number; count: number } | null;
  totals: { trash: number; delete: number }; pile: L.Media[]; pileBytes: number; sortedCount: number; access: Access; loading: boolean; update: UpdateInfo | null; go: (s: Screen) => void; onMoreAccess: () => void }) {
  const { S, today } = p;
  const goalMs = S.settings.goalMin * 60000, streak = L.streak(S.days), monthDays = L.daysThisMonth(S.days);
  const pct = p.live.length ? p.live.filter(m => L.isFinal(S.decisions[m.id])).length / p.live.length : 0;
  const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + p.otd.offset);
  const groups = L.onThisDayGroups(p.live, date, p.otd.week ? 3 : 0);
  const allOtd = groups.flatMap(g => g.items);
  const dayTitle = p.otd.week ? `The week around ${L.fmtShortDay(date.getTime())}` : (p.otd.offset === 0 ? 'Today, ' : '') + L.fmtShortDay(date.getTime());
  const mkDeck = (id: string, title: string, its: L.Media[]): L.Deck => ({ id, title, subtitle: '', ids: its.map(m => m.id), labels: Object.fromEntries(its.map(m => [m.id, `${new Date(date).getFullYear() - new Date(m.takenAt).getFullYear()} yr ago · ${L.fmtShortDay(m.takenAt)}, ${new Date(m.takenAt).getFullYear()}`])) });
  const ms = useMemo(() => L.months(p.live, S.decisions), [p.live, S.decisions]);
  const monthsDone = ms.filter(m => m.reviewed).length;
  const later = p.live.filter(m => S.decisions[m.id] === 'later');
  const sections: [string, L.Deck['group']][] = [['Sort', 'main'], ['Moments', 'moments'], ['By kind', 'kinds'], ['Folders', 'folders']];
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <View style={st.row}><Text style={[T.h1, { color: C.ink }]}>Swipe <Text style={{ color: C.acc }}>Clean</Text></Text><View style={{ flex: 1 }} />
        <Pressable onPress={() => p.go({ name: 'settings' })} style={st.chip}><Text style={T.m}>⚙︎</Text></Pressable>
        <Pressable onPress={() => p.go({ name: 'about' })} style={st.chip}><Text style={T.m}>Privacy</Text></Pressable></View>
      {p.update ? <Card style={{ borderColor: C.acc, borderWidth: 1 }}><Text style={T.b}>Version {p.update.versionName} is available.</Text><Btn title="Download update" kind="pri" onPress={() => openDownload(p.update!)} /></Card> : null}
      {p.access === 'partial' ? <Card><Text style={T.b}>You’ve given access to some photos and videos only.</Text><Btn title="Choose more" onPress={p.onMoreAccess} /></Card> : null}

      {/* HOME DECK: On this day */}
      <GradCard colors={G.hero}>
        <Text style={[T.s, { color: '#c9cff5', letterSpacing: 1 }]}>ON THIS DAY</Text>
        <View style={[st.row, { marginTop: 4 }]}>
          <Pressable testID="otd-prev" onPress={() => p.otd.setOffset(p.otd.offset - (p.otd.week ? 7 : 1))} style={st.arrow}><Text style={T.h2}>‹</Text></Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}><Text style={[T.h2, { fontSize: 21 }]}>{dayTitle}</Text>
            <Text style={[T.s, { color: '#c9cff5' }]}>{allOtd.length ? `${allOtd.length} from ${groups.length} earlier year${groups.length > 1 ? 's' : ''}` : 'Nothing from earlier years'}</Text></View>
          <Pressable testID="otd-next" onPress={() => p.otd.setOffset(p.otd.offset + (p.otd.week ? 7 : 1))} style={st.arrow}><Text style={T.h2}>›</Text></Pressable>
        </View>
        <View style={[st.row, { justifyContent: 'center', marginTop: 8 }]}>
          <Pressable onPress={() => p.otd.setWeek(false)} style={[st.seg, !p.otd.week && st.segOn]}><Text style={[T.m, !p.otd.week && st.segTxt]}>This day</Text></Pressable>
          <Pressable onPress={() => p.otd.setWeek(true)} style={[st.seg, p.otd.week && st.segOn]}><Text style={[T.m, p.otd.week && st.segTxt]}>This week</Text></Pressable>
          {p.otd.offset !== 0 ? <Pressable onPress={() => p.otd.setOffset(0)} style={st.seg}><Text style={T.m}>Back to today</Text></Pressable> : null}
        </View>
        {groups.map(g => { const left = g.items.filter(m => !S.decisions[m.id]).length; return (
          <Pressable key={g.year} testID={'otd-year-' + g.year} onPress={() => p.go({ name: 'swipe', deck: mkDeck('otd:' + g.year, `${g.year} · ${dayTitle}`, g.items) })} style={st.yearRow}>
            <View style={{ width: 74 }}><Text style={[T.h2, { fontSize: 18 }]}>{g.year}</Text><Text style={T.s}>{g.ago} yr ago</Text></View>
            <View style={[st.row, { flex: 1 }]}>{g.items.slice(0, 4).map(m => <Thumb key={m.id} uri={m.uri} size={200} style={st.mini} badge={m.type === 'VIDEO' ? '▶' : undefined} />)}</View>
            <View style={{ alignItems: 'flex-end' }}><Text style={T.b}>{left ? `${left} left` : '✓'}</Text><Text style={T.s}>{g.items.length} items</Text></View>
          </Pressable>); })}
        {allOtd.length ? <Btn kind="pri" testID="otd-all" title={`Sort all ${allOtd.filter(m => !S.decisions[m.id]).length} from ${p.otd.week ? 'this week' : 'this day'}`} onPress={() => p.go({ name: 'swipe', deck: mkDeck('otd:all', dayTitle, allOtd) })} style={{ marginTop: 10 }} /> : null}
      </GradCard>

      {/* calm progress */}
      <GradCard style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ring pct={pct} size={104} color={C.keep}><Text style={[T.h2, { fontSize: 20 }]}>{Math.floor(pct * 100)}%</Text><Text style={T.s}>reviewed</Text></Ring>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <View style={st.row}><Ring pct={today.activeMs / goalMs} size={30} stroke={4} color={C.acc2} /><Text style={[T.b, { marginLeft: 8 }]}>Today {Math.floor(today.activeMs / 60000)} of {S.settings.goalMin} min</Text></View>
          <Text style={[T.m, { marginTop: 4 }]}>{today.decided} sorted · {L.fmtBytes(today.trashedBytes + today.deletedBytes)} cleared today</Text>
          <Text style={[T.m, { marginTop: 2 }]}>{monthsDone} of {ms.length} months reviewed</Text>
          {S.settings.showStreak && (streak >= 2 || monthDays) ? <Text style={[T.s, { marginTop: 2 }]}>{streak >= 2 ? `${streak} days in a row · ` : ''}{monthDays} day{monthDays === 1 ? '' : 's'} this month</Text> : null}
        </View>
      </GradCard>

      <Card>
        <Text style={T.m}>This phone</Text>
        {p.storage ? <>
          <Text style={[T.b, { marginVertical: 4 }]}>{L.fmtBytes(p.storage.total - p.storage.free)} used of {L.fmtBytes(p.storage.total)} · {L.fmtBytes(p.storage.free)} free</Text>
          <Bar pct={(p.storage.total - p.storage.free) / p.storage.total} color={C.acc2} h={8} />
        </> : <Text style={T.b}>Storage info not available</Text>}
        <Text style={[T.b, { marginTop: 8 }]}>Cleared with Swipe Clean: <Text style={{ fontWeight: '700', color: C.keep }}>{L.fmtBytes(p.totals.trash + p.totals.delete)}</Text></Text>
        {p.totals.trash ? <Text style={T.m}>{L.fmtBytes(p.totals.trash)} of that is sitting in Android’s trash and still takes up space. It’s freed when the trash is emptied: automatically after about 30 days, or sooner if you empty it in your Gallery or Files app.</Text> : null}
        {p.trash?.supported && p.trash.count ? <Text style={[T.s, { marginTop: 4 }]}>Trash right now (all apps): {p.trash.count} items · {L.fmtBytes(p.trash.bytes)} still using space</Text> : null}
      </Card>

      <View style={st.row}>
        <Pressable style={{ flex: 1 }} onPress={() => p.go({ name: 'pile' })} testID="open-pile"><Card style={{ marginRight: 4, borderLeftWidth: 3, borderLeftColor: C.remove }}>
          <Text style={[T.b, { fontWeight: '700' }]}>Remove pile</Text><Text style={T.s}>{p.pile.length ? `${p.pile.length} · ${L.fmtBytes(p.pileBytes)}` : 'Empty'}</Text></Card></Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => p.go({ name: 'swipe', deck: { id: 'later', title: 'Decide later', subtitle: '', ids: later.map(m => m.id), laterDeck: true } })} testID="open-later"><Card style={{ marginLeft: 4, borderLeftWidth: 3, borderLeftColor: C.later }}>
          <Text style={[T.b, { fontWeight: '700' }]}>Decide later</Text><Text style={T.s}>{later.length ? `${later.length} waiting` : 'Empty'}</Text></Card></Pressable>
      </View>
      <Pressable onPress={() => p.go({ name: 'stats' })} testID="open-stats"><Card style={{ ...st.row, borderLeftWidth: 3, borderLeftColor: C.keep }}>
        <View style={{ flex: 1 }}><Text style={[T.b, { fontWeight: '700' }]}>Stats</Text><Text style={T.s}>{(() => { const a = Stats.summary(Stats.daily(S.removed, S.days)).all; return a.bytes ? `${L.fmtBytes(a.bytes)} moved to trash or deleted · ${L.fmtBytes(a.freedBytes)} fully freed` : 'Space removed per day, and your running total'; })()}</Text></View><Text style={T.h2}>›</Text></Card></Pressable>
      <Pressable onPress={() => p.go({ name: 'months' })} testID="open-months"><Card style={{ ...st.row, borderLeftWidth: 3, borderLeftColor: C.teal }}>
        <View style={{ flex: 1 }}><Text style={[T.b, { fontWeight: '700' }]}>Month by month</Text><Text style={T.s}>{monthsDone} of {ms.length} reviewed · one month at a time</Text></View><Text style={T.h2}>›</Text></Card></Pressable>
      {Object.keys(S.removed).length ? <Pressable onPress={() => p.go({ name: 'removed' })}><Text style={[T.m, { textAlign: 'center', marginVertical: 4 }]}>Removed history · put back from trash ›</Text></Pressable> : null}

      {p.loading ? <View style={{ padding: 30 }}><ActivityIndicator color={C.acc} /><Text style={[T.m, { textAlign: 'center', marginTop: 8 }]}>Reading your photos and videos on this phone…</Text></View> : null}
      {!p.loading && !p.live.length ? <Text style={[T.m, { textAlign: 'center', marginTop: 20 }]}>No photos or videos found.</Text> : null}
      <Pressable onPress={() => p.more.setOpen(!p.more.open)} testID="more-decks"><Text style={[T.m, { marginTop: 14, textTransform: 'uppercase', letterSpacing: 1 }]}>More ways to sort {p.more.open ? '▾' : '▸'}</Text></Pressable>
      {p.more.open ? sections.map(([title, g]) => { const ds = p.decks.filter(d => d.group === g && d.id !== 'otd'); if (!ds.length) return null; return (
        <View key={title}><Text style={[T.s, { marginTop: 10, marginBottom: 2 }]}>{title}</Text>
          {(g === 'folders' ? ds.slice(0, 12) : ds).map(d => { const s = L.deckStats(d, p.byId, S.decisions); return (
            <Pressable key={d.id} onPress={() => p.go(d.compare ? { name: 'compare' } : { name: 'swipe', deck: d })} testID={'deck-' + d.id}><View style={st.deck}>
              <View style={{ flex: 1 }}><Text style={[T.b, { fontWeight: '700' }]}>{d.title}</Text><Text style={T.s}>{d.subtitle}</Text></View>
              <View style={{ alignItems: 'flex-end' }}><Text style={T.b}>{s.left} left</Text><Text style={T.s}>{L.fmtBytes(s.leftBytes)}</Text></View>
            </View></Pressable>); })}
        </View>); }) : null}
      <Text style={[T.s, { textAlign: 'center', marginTop: 16 }]}>Swipe Clean v{VERSION_NAME} · everything stays on this phone</Text>
    </ScrollView>
  );
}

function MonthsScreen(p: { live: L.Media[]; S: Store.Saved; commit: (f: (s: Store.Saved) => Store.Saved) => void; go: (s: Screen) => void; onBack: () => void }) {
  const sort = p.S.settings.monthSort;
  let ms = L.months(p.live, p.S.decisions); if (sort === 'size') ms = ms.slice().sort((a, b) => b.bytes - a.bytes);
  const done = ms.filter(m => m.reviewed).length;
  return (
    <View style={{ flex: 1 }}>
      <View style={[st.row, { padding: 14 }]}><Pressable onPress={p.onBack} style={st.chip}><Text style={T.b}>‹</Text></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}><Text style={T.h2}>Month by month</Text><Text style={T.s}>{done} of {ms.length} months reviewed</Text></View>
        <Pressable onPress={() => p.commit(x => ({ ...x, settings: { ...x.settings, monthSort: sort === 'date' ? 'size' : 'date' } }))} style={st.chip}><Text style={T.m}>Sort: {sort === 'date' ? 'newest' : 'size'}</Text></Pressable></View>
      <View style={{ paddingHorizontal: 14 }}><Bar pct={ms.length ? done / ms.length : 0} color={C.teal} h={5} /></View>
      <FlatList data={ms} keyExtractor={m => m.key} contentContainerStyle={{ padding: 14 }} renderItem={({ item: m }) => (
        <Pressable onPress={() => p.go({ name: 'swipe', deck: { id: 'month:' + m.key, title: m.title, subtitle: '', ids: m.items.map(i => i.id), labels: Object.fromEntries(m.items.map(i => [i.id, L.fmtShortDay(i.takenAt)])) } })}>
          <View style={[st.deck, m.reviewed && { borderLeftWidth: 3, borderLeftColor: C.keep }]}>
            <View style={{ flex: 1 }}><Text style={[T.b, { fontWeight: '700' }]}>{m.title}</Text><Text style={T.s}>{m.count} items · {L.fmtBytes(m.bytes)}{m.later ? ` · ${m.later} for later` : ''}</Text></View>
            {m.reviewed ? <Text style={{ color: C.keep, fontSize: 13 }}>✓ reviewed</Text> : <Text style={T.m}>{m.count - m.done} left</Text>}
          </View></Pressable>)} />
    </View>
  );
}

/** Side-by-side compare for bursts/look-alikes. Nothing is marked best and nothing is pre-selected. */
function CompareScreen(p: { live: L.Media[]; S: Store.Saved; onDecide: (id: string, d: L.Decision) => void; onUndo: () => void; onBack: () => void }) {
  const groups = useMemo(() => L.lookAlikeGroups(p.live), [p.live]);
  const open = groups.filter(g => g.some(m => !p.S.decisions[m.id]));
  const [gi, setGi] = useState(0);
  const g = open[Math.min(gi, Math.max(0, open.length - 1))];
  const Choice = ({ m, d, label, color }: { m: L.Media; d: L.Decision; label: string; color: string }) => { const on = p.S.decisions[m.id] === d; return (
    <Pressable onPress={() => p.onDecide(m.id, d)} style={[st.cmpBtn, on && { backgroundColor: color }]}><Text style={[T.s, { color: on ? '#0e1020' : C.ink, fontWeight: on ? '700' : '400' }]}>{label}</Text></Pressable>); };
  return (
    <View style={{ flex: 1 }}>
      <View style={[st.row, { padding: 14 }]}><Pressable onPress={p.onBack} style={st.chip}><Text style={T.b}>‹</Text></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}><Text style={T.h2}>Compare look-alikes</Text><Text style={T.s}>{open.length} groups with undecided items · you choose for each one</Text></View>
        <Pressable onPress={p.onUndo} style={st.chip}><Text style={T.m}>↶</Text></Pressable></View>
      {!g ? <Text style={[T.m, { textAlign: 'center', marginTop: 40 }]}>No look-alike groups left to compare.</Text> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 30 }}>
          <Text style={[T.m, { marginHorizontal: 4, marginBottom: 6 }]}>{L.fmtDay(g[0].takenAt)} · {g.length} shots within {Math.max(1, Math.round((g[g.length - 1].takenAt - g[0].takenAt) / 1000))} s</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {g.map(m => (
              <View key={m.id} style={{ width: '50%', padding: 4 }}>
                <Thumb uri={m.uri} size={600} style={{ aspectRatio: 0.8, borderRadius: 14 }} badge={m.type === 'VIDEO' ? '▶ video' : undefined} />
                <Text style={[T.s, { marginTop: 3 }]}>{L.fmtTime(m.takenAt)} · {L.fmtBytes(m.size)} · {L.fmtRes(m)}</Text>
                <View style={[st.row, { marginTop: 4 }]}><Choice m={m} d="keep" label="Keep" color={C.keep} /><Choice m={m} d="remove" label="Remove pile" color={C.remove} /><Choice m={m} d="later" label="Later" color={C.later} /></View>
              </View>))}
          </View>
          <View style={[st.row, { marginTop: 10 }]}>
            <Btn title="‹ Previous group" onPress={() => setGi(Math.max(0, gi - 1))} style={{ flex: 1, marginRight: 4 }} disabled={gi === 0} />
            <Btn title="Next group ›" kind="pri" onPress={() => setGi(Math.min(open.length - 1, gi + 1))} style={{ flex: 1, marginLeft: 4 }} />
          </View>
          <Text style={[T.s, { textAlign: 'center' }]}>Items you leave untouched stay undecided.</Text>
        </ScrollView>)}
    </View>
  );
}

function SwipeScreen(p: { deck?: L.Deck; S: Store.Saved; byId: Map<string, L.Media>; today: L.DayLog; onDecide: (id: string, d: L.Decision) => void; onUndo: () => void; onBack: () => void; onPile: () => void; pileCount: number; onSound: (on: boolean) => void }) {
  const ref = useRef<CardHandle>(null);
  if (!p.deck) return <View style={st.pad}><Btn title="‹ Back" onPress={p.onBack} /></View>;
  const q = L.queueFor(p.deck, p.S.decisions, p.S.front).filter(id => p.byId.has(id));
  const stats = L.deckStats(p.deck, p.byId, p.S.decisions);
  const done = stats.total - stats.left;
  const [a, b] = [p.byId.get(q[0]), p.byId.get(q[1])];
  const goal = p.S.settings.goalMin, mins = Math.floor(p.today.activeMs / 60000);
  return (
    <LinearGradient colors={G.bg as any} style={{ flex: 1, paddingHorizontal: 14 }}>
      <View style={[st.row, { paddingVertical: 8 }]}>
        <Pressable onPress={p.onBack} style={st.chip} testID="back"><Text style={T.b}>‹</Text></Pressable>
        <View style={{ flex: 1, marginHorizontal: 8 }}><Text style={[T.b, { fontWeight: '700' }]} numberOfLines={1}>{p.deck.title}</Text><Text style={T.s}>{done} of {stats.total}{stats.later && !p.deck.laterDeck ? ` · ${stats.later} for later` : ''} · {mins} of {goal} min today</Text></View>
        <Pressable onPress={p.onPile} style={[st.chip, { backgroundColor: '#3a2430' }]}><Text style={[T.m, { color: C.remove }]}>Pile {p.pileCount}</Text></Pressable>
      </View>
      <Bar pct={stats.total ? done / stats.total : 0} color={C.keep} h={4} />
      <View style={{ flex: 1, marginVertical: 12 }}>
        {!a ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={T.h2}>{p.deck.laterDeck ? 'Nothing waiting for later' : 'All sorted here'}</Text>
          <Text style={[T.m, { marginTop: 6, textAlign: 'center' }]}>{p.pileCount ? `${p.pileCount} items are waiting in your Remove pile. Nothing has been removed.` : 'All done for this one.'}</Text>
          {p.pileCount ? <Btn title="Review Remove pile" kind="pri" onPress={p.onPile} style={{ marginTop: 12, alignSelf: 'stretch' }} /> : null}
          <Btn title="Back" onPress={p.onBack} style={{ alignSelf: 'stretch' }} />
        </View> : null}
        {b ? <SwipeCard key={b.id} item={b} top={false} soundOn={p.S.settings.soundOn} onSound={p.onSound} recent={L.isRecent(b, p.S.settings.cautionDays)} label={p.deck.labels?.[b.id]} onDecide={() => {}} /> : null}
        {a ? <SwipeCard key={a.id} ref={ref} item={a} top soundOn={p.S.settings.soundOn} onSound={p.onSound} recent={L.isRecent(a, p.S.settings.cautionDays)} label={p.deck.labels?.[a.id]} onDecide={d => p.onDecide(a.id, d)} /> : null}
      </View>
      <View style={[st.row, { justifyContent: 'center', paddingBottom: 4 }]}>
        <Pressable testID="btn-remove" accessibilityLabel="Add to Remove pile" disabled={!a} onPress={() => ref.current?.fling('remove')} style={[st.round, { borderColor: C.remove, backgroundColor: '#2a1d2c' }]}><Text style={{ color: C.remove, fontSize: 26 }}>✕</Text></Pressable>
        <View style={{ alignItems: 'center', marginHorizontal: 14 }}>
          <Pressable testID="btn-later" accessibilityLabel="Decide later" disabled={!a || p.deck.laterDeck} onPress={() => ref.current?.fling('later')} style={[st.round, { width: 50, height: 50, borderColor: C.later, backgroundColor: '#231f3a', opacity: p.deck.laterDeck ? 0.3 : 1 }]}><Text style={{ color: C.later, fontSize: 16 }}>⏱</Text></Pressable>
          <View style={[st.row, { marginTop: 6 }]}>
            <Pressable testID="btn-undo" accessibilityLabel="Undo" onPress={p.onUndo} style={[st.round, { width: 42, height: 42, borderColor: C.line }]}><Text style={{ color: C.mut, fontSize: 18 }}>↶</Text></Pressable>
            {/* Share: opens Android's share sheet for the current item only. Not a decision; the card stays put. */}
            <Pressable testID="btn-share" accessibilityLabel="Share this item" disabled={!a} hitSlop={4}
              onPress={() => { if (a) shareItem(a).catch(e => Alert.alert('Couldn’t share', String(e?.message || e))); }}
              style={[st.round, { width: 42, height: 42, borderColor: C.teal, backgroundColor: '#18302f', marginLeft: 8, opacity: a ? 1 : 0.3 }]}><Text style={{ color: C.teal, fontSize: 17 }}>⇪</Text></Pressable>
          </View>
        </View>
        <Pressable testID="btn-keep" accessibilityLabel="Keep on phone" disabled={!a} onPress={() => ref.current?.fling('keep')} style={[st.round, { borderColor: C.keep, backgroundColor: '#1b2c2a' }]}><Text style={{ color: C.keep, fontSize: 26 }}>♥</Text></Pressable>
      </View>
      <Text style={[T.s, { textAlign: 'center', marginBottom: 6 }]}>← Remove pile · ⏱ Decide later · ⇪ Share · Keep on phone →</Text>
    </LinearGradient>
  );
}

function StatsScreen(p: { S: Store.Saved; storage: { total: number; free: number } | null; say: (m: string, ms?: number) => void; onBack: () => void }) {
  const [period, setPeriod] = useState<Stats.Period>('day');
  const now = Date.now();
  const log = useMemo(() => Stats.daily(p.S.removed, p.S.days, now), [p.S.removed, p.S.days]);
  const sm = Stats.summary(log, now); const bars = Stats.series(log, period, now); const max = Math.max(1, ...bars.map(b => b.bytes));
  const restored = Object.values(p.S.removed).filter(r => r.restored).length;
  const oldest = Object.values(p.S.removed).reduce((a, r) => Math.min(a, r.at || Infinity), Infinity);
  const inTrash = sm.all.bytes - sm.all.freedBytes;
  const base = p.S.storageLog.find(x => x.tag === 'baseline'); const lastAfter = [...p.S.storageLog].reverse().find(x => x.tag === 'after');
  const lastBefore = lastAfter ? [...p.S.storageLog].reverse().find(x => x.tag === 'before' && x.at <= lastAfter.at) : undefined;
  const PHONE = 512e9; const split = sm.all.bytes ? sm.all.photoBytes / sm.all.bytes : 0;
  const Tile = ({ label, t }: { label: string; t: Stats.Totals }) => (
    <View style={{ flex: 1, backgroundColor: C.card2, borderRadius: 14, padding: 10, margin: 3 }}>
      <Text style={T.s}>{label}</Text><Text style={[T.b, { fontWeight: '700', color: C.keep }]}>{L.fmtBytes(t.bytes)}</Text>
      <Text style={T.s}>{t.photos} photos · {t.videos} videos</Text></View>);
  const exportCsv = async (share: boolean) => {
    if (!native) return; const name = `swipeclean-stats-${L.dayKey(now)}.csv`;
    try { const u = await native.exportCsv(name, Stats.csv(log), share); p.say(u ? `Saved to Downloads/SwipeClean/${name}` : 'Opened the share sheet', 3500); }
    catch (e: any) { Alert.alert('Couldn’t export', String(e?.message || e)); }
  };
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <View style={[st.row, { marginBottom: 6 }]}><Pressable onPress={p.onBack} style={st.chip} testID="back"><Text style={T.b}>‹</Text></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}><Text style={T.h2}>Stats</Text><Text style={T.s}>Only counts items Android confirmed removed in its own dialog</Text></View></View>
      <GradCard colors={G.hero}>
        <View style={{ flex: 1 }}>
          <Text style={T.m}>All time · moved to trash or deleted</Text>
          <Text testID="stats-total" style={{ color: C.ink, fontSize: 40, fontWeight: '800', marginVertical: 2 }}>{L.fmtBytes(sm.all.bytes)}</Text>
          <Text style={T.b}>{sm.all.photos} photos · {sm.all.videos} videos</Text>
          <Text style={[T.b, { marginTop: 6 }]}><Text style={{ color: C.keep, fontWeight: '700' }}>{L.fmtBytes(sm.all.freedBytes)}</Text> fully freed</Text>
          {inTrash > 0 ? <Text style={T.m}>{L.fmtBytes(inTrash)} is still in Android’s trash and still takes up space. Android empties the trash after about 30 days (or sooner if you empty it in your Gallery or Files app). Each item counts as fully freed 30 days after it was moved, or straight away if it was deleted.</Text> : null}
        </View>
      </GradCard>
      <View style={st.row}><Tile label="Today" t={sm.today} /><Tile label="This week (from Mon)" t={sm.week} /><Tile label="This month" t={sm.month} /></View>
      <Card>
        <View style={st.row}><Text style={[T.b, { fontWeight: '700', flex: 1 }]}>Moved to trash or deleted</Text>
          {(['day', 'week', 'month'] as const).map(k => <Pressable key={k} testID={'stats-period-' + k} onPress={() => setPeriod(k)} style={[st.chip, { marginLeft: 4, paddingHorizontal: 10, backgroundColor: period === k ? '#2b3366' : C.card2 }]}>
            <Text style={[T.s, { color: period === k ? C.ink : C.mut }]}>{k === 'day' ? '30 days' : k === 'week' ? 'Weekly' : 'Monthly'}</Text></Pressable>)}</View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, marginTop: 12 }}>
          {bars.map(b => <View key={b.key} style={{ flex: 1, marginHorizontal: period === 'day' ? 1 : 3, height: '100%', justifyContent: 'flex-end' }}>
            <View style={{ height: `${Math.max(b.bytes ? 3 : 1, (b.bytes / max) * 100)}%`, backgroundColor: b.bytes ? C.keep : C.line, borderRadius: 3 }} /></View>)}
        </View>
        <View style={[st.row, { justifyContent: 'space-between', marginTop: 4 }]}><Text style={T.s}>{bars[0]?.label}</Text><Text style={T.s}>peak {L.fmtBytes(max > 1 ? max : 0)}</Text><Text style={T.s}>{bars[bars.length - 1]?.label}</Text></View>
      </Card>
      <Card>
        <Text style={T.b}>Best day: <Text style={{ fontWeight: '700' }}>{sm.best ? `${L.fmtBytes(sm.best.bytes)} on ${new Date(sm.best.date + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'none yet'}</Text></Text>
        <Text style={[T.b, { marginTop: 4 }]}>Average per active day: <Text style={{ fontWeight: '700' }}>{L.fmtBytes(sm.avgPerActiveDay)}</Text>{sm.activeDays ? ` (${sm.activeDays} day${sm.activeDays === 1 ? '' : 's'} with removals)` : ''}</Text>
        <Text style={[T.b, { marginTop: 10 }]}>Photos vs videos</Text>
        <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: C.line, marginVertical: 6 }}>
          <View style={{ flex: split, backgroundColor: C.acc }} /><View style={{ flex: sm.all.bytes ? 1 - split : 0, backgroundColor: C.acc2 }} /></View>
        <Text style={T.m}><Text style={{ color: C.acc }}>■</Text> Photos {L.fmtBytes(sm.all.photoBytes)} ({sm.all.photos})   <Text style={{ color: C.acc2 }}>■</Text> Videos {L.fmtBytes(sm.all.videoBytes)} ({sm.all.videos})</Text>
        <Text style={[T.s, { marginTop: 6 }]}>{sm.all.reviewed} items reviewed · {sm.all.minutes} min sorting</Text>
      </Card>
      <Card>
        <Text style={[T.b, { fontWeight: '700' }]}>Against your 512 GB phone</Text>
        <Text style={[T.m, { marginVertical: 4 }]}>{L.fmtBytes(sm.all.bytes)} moved to trash or deleted is {(sm.all.bytes / PHONE * 100).toFixed(2)}% of 512 GB · {L.fmtBytes(sm.all.freedBytes)} fully freed</Text>
        <Bar pct={sm.all.bytes / PHONE} color={C.keep} h={8} />
        {p.storage ? <Text style={[T.b, { marginTop: 8 }]}>Used now: {L.fmtBytes(p.storage.total - p.storage.free)} of {L.fmtBytes(p.storage.total)} ({L.fmtBytes(p.storage.free)} free)</Text> : <Text style={[T.m, { marginTop: 8 }]}>Phone storage isn’t readable right now.</Text>}
        {base && p.storage ? <Text style={T.m}>When stats began ({new Date(base.at).toLocaleDateString()}): {L.fmtBytes(base.used)} used → now {L.fmtBytes(p.storage.total - p.storage.free)}</Text> : null}
        {lastBefore && lastAfter ? <Text style={T.m}>Last removal: {L.fmtBytes(lastBefore.used)} used before → {L.fmtBytes(lastAfter.used)} right after</Text> : null}
        <Text style={[T.s, { marginTop: 4 }]}>Used storage also changes as you take photos, install apps and so on, and trashed items keep using space until the trash empties, so these numbers won’t match the totals exactly.</Text>
      </Card>
      <Card>
        <Text style={T.m}>{isFinite(oldest) ? `Includes every confirmed removal recorded since ${new Date(oldest).toLocaleDateString()}, including those from earlier versions.` : 'Tracking starts with your first removal.'}{restored ? ` ${restored} item${restored === 1 ? '' : 's'} you put back from the trash ${restored === 1 ? 'isn’t' : 'aren’t'} counted.` : ''} Items you only swiped never count.</Text>
        <Btn title="Export CSV (save to Downloads + share…)" onPress={() => exportCsv(true)} testID="stats-export" />
        <Btn kind="ghost" title="Just save CSV to Downloads" onPress={() => exportCsv(false)} testID="stats-save" />
        <Text style={T.s}>The CSV stays on this phone unless you pick an app in the share sheet.</Text>
      </Card>
    </ScrollView>
  );
}
function PileScreen(p: { pile: L.Media[]; bytes: number; S: Store.Saved; onBack: () => void; onUndo: () => void; onKeep: (id: string) => void; onRemoved: (list: L.Media[], mode: 'trash' | 'delete') => void; onSnaps: (s: Stats.StorageSnap[]) => void }) {
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const recent = p.pile.filter(m => L.isRecent(m, p.S.settings.cautionDays)).length;
  const run = async (mode: 'trash' | 'delete') => {
    setSheet(false); if (!native) return;
    if (!native.canTrash) { setResult('Removing needs Android 11 or newer.'); return; }
    const batches = L.chunk(p.pile, BATCH); let ok = 0, bytes = 0, stopped = false;
    let before: { total: number; free: number } | null = null; try { before = await native.storage(); } catch {}
    for (let i = 0; i < batches.length; i++) {
      setBusy(`Batch ${i + 1} of ${batches.length}: waiting for your confirmation in Android’s dialog…`);
      let allowed = false;
      try { allowed = await native.requestSystemAction(batches[i].map(m => m.uri), mode); } catch (e: any) { setResult('Couldn’t open Android’s dialog: ' + (e?.message || e)); stopped = true; break; }
      if (!allowed) { stopped = true; break; }
      const still = new Set(await native.stillPresent(batches[i].map(m => m.uri)));
      const gone = batches[i].filter(m => !still.has(m.uri)); // count only what Android actually removed
      p.onRemoved(gone, mode); ok += gone.length; bytes += gone.reduce((a, m) => a + m.size, 0);
    }
    setBusy(null);
    if (ok && before) { try { const af = await native.storage(); p.onSnaps([{ at: Date.now() - 1, used: before.total - before.free, total: before.total, tag: 'before' }, { at: Date.now(), used: af.total - af.free, total: af.total, tag: 'after' }]); } catch {} }
    const what = mode === 'trash' ? `moved to Android’s trash (${L.fmtBytes(bytes)}). Trashed items still take up space until the trash is emptied: automatically after about 30 days, or sooner from your Gallery or Files app` : `deleted (${L.fmtBytes(bytes)} freed)`;
    setResult(ok ? `${ok} items ${what}.${stopped ? ' You stopped at a batch, so the rest are still on your phone and in your pile.' : ''}` : 'Nothing was removed. Everything is still on your phone and in your pile.');
  };
  return (
    <View style={{ flex: 1 }}>
      <View style={[st.row, { padding: 14 }]}><Pressable onPress={p.onBack} style={st.chip}><Text style={T.b}>‹</Text></Pressable>
        <View style={{ flex: 1, marginLeft: 8 }}><Text style={T.h2}>Remove pile</Text><Text style={T.s}>{p.pile.length} items · {L.fmtBytes(p.bytes)} · tap one to move it back to Keep</Text></View>
        <Pressable onPress={p.onUndo} style={st.chip}><Text style={T.m}>↶ Undo</Text></Pressable></View>
      {result ? <Card style={{ marginHorizontal: 14 }}><Text style={T.b}>{result}</Text><Btn title="OK" onPress={() => setResult(null)} /></Card> : null}
      <FlatList data={p.pile} keyExtractor={m => m.id} numColumns={3} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 120 }}
        ListEmptyComponent={<Text style={[T.m, { textAlign: 'center', marginTop: 40 }]}>Your Remove pile is empty.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => p.onKeep(item.id)} style={{ width: '33.33%', padding: 3 }} accessibilityLabel={'Move ' + item.filename + ' back to Keep'}>
            <Thumb uri={item.uri} style={{ aspectRatio: 1, borderRadius: 10 }} badge={(item.type === 'VIDEO' ? '▶ ' : '') + L.fmtBytes(item.size)} />
          </Pressable>)} />
      {p.pile.length ? <View style={st.footer}><Btn kind="pri" title={`Remove ${p.pile.length} from phone…`} onPress={() => setSheet(true)} testID="remove-start" /></View> : null}
      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <View style={st.sheetWrap}><ScrollView style={st.sheet} contentContainerStyle={{ paddingBottom: 30 }}>
          <BackupNotice compact />
          {recent ? <Text style={[T.m, { color: C.warn, marginVertical: 4 }]}>🕒 {recent} of these are from the last {p.S.settings.cautionDays} days. Google Photos may not have backed them up yet. This is only based on the date.</Text> : null}
          <Text style={[T.b, { marginVertical: 8 }]}>Android will show its own confirmation{p.pile.length > BATCH ? ` (${Math.ceil(p.pile.length / BATCH)} times, ${BATCH} at a time)` : ''}. Nothing happens unless you tap Allow there.</Text>
          <Btn kind="pri" title="Move to trash (restorable ~30 days; space freed when trash empties)" onPress={() => run('trash')} testID="mode-trash" />
          <Btn kind="danger" title="Delete permanently (frees space now, can’t undo)" onPress={() => run('delete')} testID="mode-delete" />
          <Btn kind="ghost" title="Cancel" onPress={() => setSheet(false)} />
        </ScrollView></View>
      </Modal>
      <Modal visible={!!busy} transparent><View style={st.sheetWrap}><View style={st.sheet}><ActivityIndicator color={C.acc} /><Text style={[T.b, { textAlign: 'center', marginTop: 10 }]}>{busy}</Text></View></View></Modal>
    </View>
  );
}

function RemovedScreen(p: { S: Store.Saved; onBack: () => void; onRestored: (ids: string[]) => void }) {
  const list = Object.values(p.S.removed).filter(r => !r.restored).sort((a, b) => b.at - a.at);
  const trashed = list.filter(r => r.mode === 'trash');
  const [msg, setMsg] = useState<string | null>(null);
  const restore = async (rs: Store.Removed[]) => {
    if (!native || !rs.length) return; let ok: string[] = [];
    for (const b of L.chunk(rs, BATCH)) { let allowed = false; try { allowed = await native.requestSystemAction(b.map(r => r.uri), 'restore'); } catch (e: any) { setMsg(String(e?.message || e)); break; }
      if (!allowed) break; const back = new Set(await native.stillPresent(b.map(r => r.uri))); ok = ok.concat(b.filter(r => back.has(r.uri)).map(r => r.id)); }
    if (ok.length) p.onRestored(ok); setMsg(ok.length ? `${ok.length} put back on your phone. They’re undecided again.` : 'Nothing was put back.');
  };
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <View style={st.row}><Pressable onPress={p.onBack} style={st.chip}><Text style={T.b}>‹</Text></Pressable><Text style={[T.h2, { marginLeft: 8 }]}>Removed with Swipe Clean</Text></View>
      <Text style={[T.m, { marginVertical: 8 }]}>Items moved to trash can be put back for about 30 days, until Android empties the trash. Permanently deleted items can’t.</Text>
      {msg ? <Card><Text style={T.b}>{msg}</Text></Card> : null}
      {trashed.length ? <Btn title={`Put back all ${trashed.length} from trash…`} onPress={() => restore(trashed)} /> : null}
      {list.map(r => (
        <View key={r.id} style={st.deck}><View style={{ flex: 1 }}><Text style={T.b} numberOfLines={1}>{r.filename}</Text><Text style={T.s}>{r.mode === 'trash' ? 'In trash' : 'Deleted'} · {L.fmtBytes(r.bytes)} · {L.fmtShortDay(r.at)}</Text></View>
          {r.mode === 'trash' ? <Pressable onPress={() => restore([r])} style={st.chip}><Text style={T.m}>Put back</Text></Pressable> : null}</View>))}
    </ScrollView>
  );
}

function SettingsScreen(p: { S: Store.Saved; update: UpdateInfo | null; setUpdate: (u: UpdateInfo | null) => void; onBack: () => void; commit: (f: (s: Store.Saved) => Store.Saved) => void; say: (m: string) => void; onClear: () => void }) {
  const s = p.S.settings; const set = (patch: Partial<Store.Settings>) => p.commit(x => ({ ...x, settings: { ...x.settings, ...patch } }));
  const [checking, setChecking] = useState(false);
  const applyReminder = async (on: boolean, h = s.remHour, m = s.remMin, g = s.goalMin) => {
    try { const ok = await setReminder(on, h, m, g); if (!ok) { p.say('Notifications are blocked for Swipe Clean in Android settings.'); set({ reminder: false }); return; } set({ reminder: on, remHour: h, remMin: m }); }
    catch (e: any) { p.say('Couldn’t set the reminder: ' + (e?.message || e)); }
  };
  const Opt = ({ v, cur, on, label }: { v: number; cur: number; on: (v: number) => void; label: string }) => (
    <Pressable onPress={() => on(v)} style={[st.chip, cur === v && { backgroundColor: C.acc }]}><Text style={[T.m, cur === v && { color: '#0f1730', fontWeight: '700' }]}>{label}</Text></Pressable>);
  const hh = (s.remHour % 12 || 12) + ':' + String(s.remMin).padStart(2, '0') + (s.remHour >= 12 ? ' PM' : ' AM');
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <View style={st.row}><Pressable onPress={p.onBack} style={st.chip}><Text style={T.b}>‹</Text></Pressable><Text style={[T.h2, { marginLeft: 8 }]}>Settings</Text></View>
      <Card><Text style={T.b}>Daily goal</Text><View style={[st.row, { flexWrap: 'wrap', marginTop: 6 }]}>{[5, 10, 15, 20, 30].map(v => <Opt key={v} v={v} cur={s.goalMin} on={v => { set({ goalMin: v }); if (s.reminder) applyReminder(true, s.remHour, s.remMin, v); }} label={v + ' min'} />)}</View>
        <Text style={[T.s, { marginTop: 6 }]}>Counts active sorting time. Breaks longer than a minute don’t count.</Text></Card>
      <Card><View style={st.row}><Text style={[T.b, { flex: 1 }]}>Daily reminder</Text><Switch value={s.reminder} onValueChange={v => applyReminder(v)} /></View>
        <Text style={T.s}>Off by default. A quiet notification scheduled on this phone. No server.</Text>
        <View style={[st.row, { marginTop: 8 }]}><Text style={[T.b, { flex: 1 }]}>Time: {hh}</Text>
          <Pressable style={st.chip} onPress={() => applyReminder(s.reminder, (s.remHour + 23) % 24, s.remMin)}><Text style={T.b}>− h</Text></Pressable>
          <Pressable style={st.chip} onPress={() => applyReminder(s.reminder, (s.remHour + 1) % 24, s.remMin)}><Text style={T.b}>+ h</Text></Pressable>
          <Pressable style={st.chip} onPress={() => applyReminder(s.reminder, s.remHour, (s.remMin + 15) % 60)}><Text style={T.b}>+15m</Text></Pressable></View></Card>
      <Card><View style={st.row}><Text style={[T.b, { flex: 1 }]}>Show days-in-a-row</Text><Switch value={s.showStreak} onValueChange={v => set({ showStreak: v })} /></View>
        <Text style={T.s}>Optional. It only counts up. Missing a day is fine and nothing is lost.</Text></Card>
      <Card><Text style={T.b}>“Recent” caution</Text><Text style={T.s}>Shows a note on items newer than this, since Google Photos may not have backed them up yet. It’s only a date check. The app can’t see backup status.</Text>
        <View style={[st.row, { flexWrap: 'wrap', marginTop: 6 }]}>{[0, 7, 14, 30, 60].map(v => <Opt key={v} v={v} cur={s.cautionDays} on={v => set({ cautionDays: v })} label={v ? v + ' days' : 'Off'} />)}</View></Card>
      <Card><Text style={T.b}>App version {VERSION_NAME}</Text>
        <Btn title={checking ? 'Checking…' : 'Check for updates'} disabled={checking} onPress={async () => { setChecking(true); try { const u = await fetchLatest(); if (isNewer(u)) { p.setUpdate(u); p.say('Version ' + u!.versionName + ' is available.'); } else p.say('You have the latest version.'); } catch { p.say('Couldn’t reach the update page.'); } setChecking(false); }} />
        {p.update ? <Btn kind="pri" title={'Download ' + p.update.versionName} onPress={() => openDownload(p.update!)} /> : null}</Card>
      <Btn kind="danger" title="Clear my data on this phone" onPress={() => Alert.alert('Clear your data?', 'This forgets your keep/remove choices, pile, history and stats. Your photos and videos are not touched.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: p.onClear }])} />
    </ScrollView>
  );
}
function About({ onBack }: { onBack: () => void }) {
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <View style={st.row}><Pressable onPress={onBack} style={st.chip}><Text style={T.b}>‹</Text></Pressable><Text style={[T.h2, { marginLeft: 8 }]}>About & privacy</Text></View>
      <Card><Text style={T.b}><Text style={{ fontWeight: '700' }}>You decide everything.</Text> Every photo and video starts undecided. The app never suggests, flags or pre-selects anything. Decks are just different ways to sort and group.</Text></Card>
      <Card><Text style={T.b}><Text style={{ fontWeight: '700' }}>Nothing leaves your phone.</Text> Photos and videos are read from the phone itself and never uploaded. ⇪ Share opens Android’s share sheet for one item, and it goes only where you send it. The only internet use is a once-a-day check of a small version file on the app’s own download page, to tell you when there’s an update.</Text></Card>
      <Card><Text style={T.b}><Text style={{ fontWeight: '700' }}>Removing is always your call.</Text> The app can only ask Android to remove items. Android shows its own confirmation, and nothing happens unless you tap Allow. “Move to trash” can be undone for about 30 days.</Text></Card>
      <BackupNotice />
      <Card><Text style={T.b}><Text style={{ fontWeight: '700' }}>What’s saved:</Text> your keep/remove choices, the pile, removal history and daily stats, only on this phone. “Clear my data” in Settings erases them.</Text></Card>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg }, pad: { padding: 16, paddingBottom: 40 }, row: { flexDirection: 'row', alignItems: 'center' },
  chip: { backgroundColor: C.card2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginLeft: 6, marginVertical: 3 },
  deck: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 14, marginVertical: 4 },
  round: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  toast: { position: 'absolute', bottom: 30, left: 20, right: 20, backgroundColor: C.card2, padding: 12, borderRadius: 14, alignItems: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: 'rgba(15,17,21,0.95)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  arrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  seg: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: 3 }, segOn: { backgroundColor: C.acc }, segTxt: { color: '#0e1020', fontWeight: '700' },
  yearRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(14,16,32,0.45)', borderRadius: 14, padding: 10, marginTop: 8 },
  mini: { width: 44, height: 44, borderRadius: 8, marginRight: 4 },
  cmpBtn: { flex: 1, paddingVertical: 7, borderRadius: 10, backgroundColor: C.card2, alignItems: 'center', marginHorizontal: 2 },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, maxHeight: '90%' },
});
