package io.github.chenhenry0429.pausebeforescroll;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        LocalReminders.deliver(context, intent.getBooleanExtra("test", false), intent.getStringExtra("id"));
    }
}
