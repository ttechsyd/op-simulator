package com.opsim.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

// Pulls a release apk with the system download manager and hands it to the package
// installer, so a native update is one tap from inside the app instead of a browser trip.
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

  @PluginMethod
  public void install(PluginCall call) {
    String url = call.getString("url");
    if (url == null) {
      call.reject("url missing");
      return;
    }
    Context ctx = getContext();
    File out = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "opsim.apk");
    if (out.exists()) out.delete();

    DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
    req.setDestinationUri(Uri.fromFile(out));
    req.setTitle("OP Sim update");
    req.setMimeType("application/vnd.android.package-archive");
    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
    long id = dm.enqueue(req);

    BroadcastReceiver done = new BroadcastReceiver() {
      @Override
      public void onReceive(Context c, Intent intent) {
        if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
        c.unregisterReceiver(this);
        if (!finished(dm, id)) {
          call.reject("download failed");
          return;
        }
        Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", out);
        Intent open = new Intent(Intent.ACTION_VIEW);
        open.setDataAndType(uri, "application/vnd.android.package-archive");
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        c.startActivity(open);
        call.resolve(new JSObject());
      }
    };
    IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
    if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(done, filter, Context.RECEIVER_EXPORTED);
    else ctx.registerReceiver(done, filter);
  }

  private static boolean finished(DownloadManager dm, long id) {
    try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
      if (c == null || !c.moveToFirst()) return false;
      int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
      return status == DownloadManager.STATUS_SUCCESSFUL;
    }
  }
}
