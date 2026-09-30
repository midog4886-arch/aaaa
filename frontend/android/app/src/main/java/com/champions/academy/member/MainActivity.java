package com.champions.academy.member;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CertificateFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
