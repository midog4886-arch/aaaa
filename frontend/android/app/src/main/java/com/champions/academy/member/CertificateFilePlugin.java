package com.champions.academy.member;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "CertificateFile")
public class CertificateFilePlugin extends Plugin {
    @PluginMethod
    public void savePdf(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename", "certificate.pdf");
        if (data == null || data.isEmpty() || data.length() > 20_000_000) {
            call.reject("Invalid PDF data");
            return;
        }
        filename = filename.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
        if (!filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "onSaveResult");
    }

    @ActivityCallback
    private void onSaveResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Save cancelled", "CANCELLED");
            return;
        }
        Uri destination = result.getData().getData();
        if (destination == null) {
            call.reject("No file selected");
            return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(destination, "w")) {
            if (stream == null) throw new IOException("Cannot open selected file");
            stream.write(Base64.decode(call.getString("data"), Base64.DEFAULT));
            JSObject response = new JSObject();
            response.put("uri", destination.toString());
            call.resolve(response);
        } catch (IllegalArgumentException | IOException error) {
            call.reject("Could not save PDF", error);
        }
    }
}
