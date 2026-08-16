---
name: Building the Android AAB inside this Repl
description: The member-app AAB CAN be built here — SDK setup steps and gotchas
---
The signed release AAB builds fine inside the Repl (Java 17 already present, prebuilt aapt2 works — /lib64 linker exists).

**How:** download Android cmdline-tools to `/tmp/android-sdk`, `sdkmanager --sdk_root=/tmp/android-sdk "platform-tools" "platforms;android-36" "build-tools;36.0.0"`, then `cd frontend/android && ANDROID_HOME=/tmp/android-sdk ./gradlew bundleRelease --no-daemon`. Output: `app/build/outputs/bundle/release/app-release.aab`; copy to `exports/` and presentAsset for the user to download.

**Gotchas:**
- `/tmp` SDK is wiped on container restarts — re-download when needed.
- Upload keystore `frontend/android/newkey.jks` (alias `upload`) may be missing from the folder; the original lives in `attached_assets/newkey_*.jks` — copy it back before building.
- ALWAYS bump `versionCode` in `frontend/android/app/build.gradle` past the highest ever uploaded to Play (Play rejects reused codes even from discarded releases). Last used: 18 (v1.0.15, Aug 2026).
- User uploads the AAB manually via Play Console → Production → new release.
