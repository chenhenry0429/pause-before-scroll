package io.github.chenhenry0429.pausebeforescroll;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import org.json.JSONObject;
import org.json.JSONException;

final class LocalReminders {
    private static final String CHANNEL = "pause-reminders";
    private static final long EXPIRY = 30 * 60 * 1000L;
    private static final long MAX_DURATION = 181 * 60 * 1000L;

    static JSONObject json(Object... keysAndValues) {
        JSONObject result = new JSONObject();
        try {
            for (int i = 0; i < keysAndValues.length; i += 2) {
                result.put((String) keysAndValues[i], keysAndValues[i + 1]);
            }
        } catch (JSONException impossible) { throw new IllegalArgumentException(impossible); }
        return result;
    }

    static SharedPreferences state(Context context) {
        return context.getSharedPreferences("pause-alarms", Context.MODE_PRIVATE);
    }

    private static NotificationManager notifications(Context context) {
        return context.getSystemService(NotificationManager.class);
    }

    static void createChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "到点提醒", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("观看计时到点和测试提醒");
        notifications(context).createNotificationChannel(channel);
    }

    static boolean canNotify(Context context) {
        NotificationManager manager = notifications(context);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled() && channel != null
            && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    static boolean exactAllowed(Context context) {
        return Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager.class).canScheduleExactAlarms();
    }

    private static String slot(boolean test) { return test ? "test" : "session"; }
    private static int request(boolean test) { return test ? 2 : 1; }

    private static Intent alarmIntent(Context c, boolean test, String id) {
        // The unique data URI prevents a queued old broadcast from adopting a new reminder's ID.
        return new Intent(c, ReminderReceiver.class)
            .setData(Uri.parse("pause-reminder://" + slot(test) + "/" + id))
            .putExtra("test", test).putExtra("id", id);
    }

    static synchronized JSONObject schedule(Context c, boolean test, String id, long end) {
        long remaining = end - System.currentTimeMillis();
        if (id == null || !id.matches("[A-Za-z0-9-]{8,80}") || remaining <= 0 || remaining > MAX_DURATION)
            return json("ok", false);
        if (!canNotify(c)) return json("ok", false);
        SharedPreferences p = state(c);
        String slot = slot(test), oldId = p.getString(slot + "Id", "");
        boolean exact = exactAllowed(c);
        boolean same = id.equals(oldId) && p.getLong(slot + "End", 0) == end;
        if (same && p.getBoolean(slot + "Posted", false)) return json("ok", true, "mode", "posted");
        if (same && p.getBoolean(slot + "Exact", false) == exact
                && PendingIntent.getBroadcast(c, request(test), alarmIntent(c, test, id),
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE) != null)
            return json("ok", true, "mode", exact ? "exact" : "approximate");
        if (!oldId.isEmpty()) cancel(c, test, oldId);
        PendingIntent pending = PendingIntent.getBroadcast(c, request(test), alarmIntent(c, test, id),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarms = c.getSystemService(AlarmManager.class);
        long trigger = SystemClock.elapsedRealtime() + remaining;
        try {
            if (exact) {
                try { alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pending); }
                catch (SecurityException changed) { exact = false; }
            }
            if (!exact) alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pending);
            if (!p.edit().putString(slot + "Id", id).putLong(slot + "End", end)
                    .putBoolean(slot + "Exact", exact).putBoolean(slot + "Posted", false).commit()) {
                alarms.cancel(pending);
                pending.cancel();
                return json("ok", false);
            }
            return json("ok", true, "mode", exact ? "exact" : "approximate");
        } catch (RuntimeException unavailable) {
            pending.cancel();
            return json("ok", false);
        }
    }

    static synchronized void cancel(Context c, boolean test, String id) {
        if (id == null) return;
        String slot = slot(test);
        SharedPreferences p = state(c);
        if (!id.equals(p.getString(slot + "Id", ""))) return;
        p.edit().remove(slot + "Id").remove(slot + "End")
            .remove(slot + "Posted").remove(slot + "Exact").commit();
        PendingIntent pending = PendingIntent.getBroadcast(c, request(test), alarmIntent(c, test, id),
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (pending != null) {
            c.getSystemService(AlarmManager.class).cancel(pending);
            pending.cancel();
        }
        notifications(c).cancel(request(test));
    }

    static synchronized void deliver(Context c, boolean test, String id) {
        if (id == null) return;
        String slot = slot(test);
        SharedPreferences p = state(c);
        long elapsed = System.currentTimeMillis() - p.getLong(slot + "End", 0);
        if (!id.equals(p.getString(slot + "Id", "")) || p.getBoolean(slot + "Posted", false)) return;
        if (!canNotify(c) || elapsed > EXPIRY || elapsed < -60_000) { cancel(c, test, id); return; }
        PendingIntent open = PendingIntent.getActivity(c, 0,
            new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.notification).setContentTitle(test ? "停一下 · 测试提醒" : "停一下 · 时间到了")
            .setContentText(test ? "回到停一下，确认这台手机收到了提醒。" : "这次先看到这里。回来留一句回顾。")
            .setVisibility(Notification.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(open).build();
        try {
            notifications(c).notify(request(test), notification);
            p.edit().putBoolean(slot + "Posted", true).commit();
        } catch (SecurityException denied) { cancel(c, test, id); }
    }

    static synchronized JSONObject status(Context c) {
        SharedPreferences p = state(c);
        String permission = canNotify(c) ? "allowed" : p.getBoolean("asked", false) ? "denied" : "off";
        String id = p.getString("sessionId", "");
        boolean posted = p.getBoolean("sessionPosted", false);
        boolean exact = exactAllowed(c);
        boolean wasExact = p.getBoolean("sessionExact", false);
        boolean pending = !id.isEmpty() && (!wasExact || exact)
            && p.getLong("sessionEnd", 0) > System.currentTimeMillis()
            && PendingIntent.getBroadcast(c, request(false), alarmIntent(c, false, id),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE) != null;
        return json("notifications", permission, "exact", exact,
            "id", posted || pending ? id : "", "posted", posted,
            "mode", pending ? (wasExact ? "exact" : "approximate") : "");
    }
}
