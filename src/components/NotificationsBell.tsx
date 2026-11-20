import React, { useEffect, useState } from 'react';
import { Bell, BellRing, Check } from 'lucide-react';
import type { AppNotification } from '../types/fikaboda';
import {
  markNotificationRead,
  subscribeToNotifications,
  updateUserFcmToken,
} from '../services/firestoreService';
import { requestFcmTokenIfConfigured } from '../firebase/config';
import { formatTimestamp } from '../utils/crypto';
import { useToast } from './ToastProvider';

export const NotificationsBell: React.FC<{ uid: string }> = ({ uid }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [fcmStatus, setFcmStatus] = useState<string | null>(null);
  const { pushToast } = useToast();

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeToNotifications(uid, setItems);
    return () => unsub();
  }, [uid]);

  const unreadCount = items.filter((i) => !i.read).length;

  const handleEnablePush = async () => {
    const res = await requestFcmTokenIfConfigured();
    setFcmStatus(res.status);
    if (res.status === 'ENABLED' && res.token) {
      await updateUserFcmToken(uid, res.token);
      pushToast({
        kind: 'success',
        title: 'Push notifications enabled',
        description: 'This device will receive live dispatch updates via FCM.',
      });
    } else if (res.status === 'AWAITING_VAPID_KEY') {
      pushToast({
        kind: 'info',
        title: 'FCM Web Push awaiting VAPID key',
        description: 'Set VITE_FIREBASE_VAPID_KEY in environment configuration to activate browser push.',
      });
    } else {
      pushToast({
        kind: 'error',
        title: `Push status: ${res.status}`,
      });
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg border border-[#E3E7E2] bg-white hover:bg-[#F7F8F5] text-[#17231F] transition-colors cursor-pointer"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#123C32] text-[#D5FF70] text-[10px] font-bold flex items-center justify-center tabular-nums">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-[#E3E7E2] rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E3E7E2] flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#17231F]">Notifications</h3>
              <p className="text-[11px] text-[#77827B]">
                {unreadCount} unread {fcmStatus ? `· FCM: ${fcmStatus}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleEnablePush()}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#123C32] hover:underline cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5" />
              <span>Enable Push</span>
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-[#E3E7E2]">
            {items.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#77827B]">
                No notifications yet. Dispatch and verification updates appear here in real time.
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.notificationId}
                  className={`px-4 py-3 text-left transition-colors ${
                    item.read ? 'bg-white' : 'bg-[#F7F8F5]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-[#17231F]">{item.title}</p>
                    {!item.read && (
                      <button
                        type="button"
                        onClick={() => void markNotificationRead(item.notificationId)}
                        className="text-[11px] text-[#123C32] hover:underline inline-flex items-center gap-0.5 shrink-0 cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        Mark read
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[#77827B] mt-0.5 leading-relaxed">{item.message}</p>
                  <p className="text-[10px] font-mono-tabular text-[#77827B] mt-1">
                    {formatTimestamp(item.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
