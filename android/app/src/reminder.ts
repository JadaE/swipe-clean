// Optional daily reminder: LOCAL notification scheduled on the phone (no push server, no network). Off by default.
import * as Notifications from 'expo-notifications';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) as any });
export async function setReminder(on: boolean, hour: number, minute: number, goalMin: number): Promise<boolean> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!on) return true;
  const p = await Notifications.requestPermissionsAsync();
  if (!p.granted) return false;
  await Notifications.setNotificationChannelAsync('daily', { name: 'Daily reminder', importance: Notifications.AndroidImportance.DEFAULT });
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Swipe Clean', body: `Your ${goalMin} minutes of sorting, whenever you're ready.` },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: 'daily' } as any,
  });
  return true;
}
