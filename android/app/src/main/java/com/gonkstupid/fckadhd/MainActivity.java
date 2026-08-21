package com.gonkstupid.fckadhd;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.gonkstupid.fckadhd.plugins.BlockerPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BlockerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
