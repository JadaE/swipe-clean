// Thin wrapper around the local SwipeCleanMedia native module (Kotlin, MediaStore). No network.
import { PermissionsAndroid, Platform } from 'react-native';
import Native from 'swipeclean-media';
import type { Media } from './logic';

export const native = Native as null | {
  sdkInt: number; canTrash: boolean;
  queryAll(): Promise<Media[]>;
  stillPresent(uris: string[]): Promise<string[]>;
  trashInfo(): Promise<{ supported: boolean; bytes: number; count: number }>;
  storage(): Promise<{ total: number; free: number }>;
  thumbnail(uri: string, size: number): Promise<string>;
  requestSystemAction(uris: string[], mode: 'trash' | 'delete' | 'restore'): Promise<boolean>;
  share(uri: string, mime: string | null): Promise<boolean>;
  exportCsv(name: string, content: string, share: boolean): Promise<string>;
};
export type Access = 'full' | 'partial' | 'denied';
const P = {
  IMG: 'android.permission.READ_MEDIA_IMAGES', VID: 'android.permission.READ_MEDIA_VIDEO',
  SEL: 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED', OLD: 'android.permission.READ_EXTERNAL_STORAGE'
} as const;
const sdk = () => (Platform.OS === 'android' ? Number(Platform.Version) : 0);
const G = PermissionsAndroid.RESULTS.GRANTED;

export async function checkAccess(): Promise<Access> {
  if (sdk() >= 33) {
    const [i, v] = await Promise.all([PermissionsAndroid.check(P.IMG as any), PermissionsAndroid.check(P.VID as any)]);
    if (i && v) return 'full';
    if (sdk() >= 34 && (await PermissionsAndroid.check(P.SEL as any))) return 'partial';
    return i || v ? 'partial' : 'denied';
  }
  return (await PermissionsAndroid.check(P.OLD as any)) ? 'full' : 'denied';
}
/** Shows Android's own permission prompt. On Android 14+ she can choose "Allow all" or "Select photos and videos". */
export async function requestAccess(): Promise<Access> {
  if (sdk() >= 33) {
    const perms = [P.IMG, P.VID, ...(sdk() >= 34 ? [P.SEL] : [])] as any[];
    const r = await PermissionsAndroid.requestMultiple(perms);
    if (r[P.IMG] === G && r[P.VID] === G) return 'full';
    if ((r as any)[P.SEL] === G || r[P.IMG] === G || r[P.VID] === G) return 'partial';
    return 'denied';
  }
  return (await PermissionsAndroid.request(P.OLD as any)) === G ? 'full' : 'denied';
}
const thumbs = new Map<string, Promise<string | null>>();
export function thumb(uri: string, size = 360): Promise<string | null> {
  const k = uri + '@' + size; if (!native) return Promise.resolve(null);
  if (!thumbs.has(k)) thumbs.set(k, native.thumbnail(uri, size).catch(() => null));
  return thumbs.get(k)!;
}

/** Share one item through Android's share sheet. Not a decision; doesn't touch the queue. */
export async function shareItem(m: { uri: string; mime: string | null }) { if (!native) throw new Error('Sharing isn’t available'); return native.share(m.uri, m.mime || null); }
