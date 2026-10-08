# Android release signing

The release keystore is a private build secret. Never commit a `.jks` or
`.keystore` file, passwords, or a populated Gradle properties file.

Provide these environment variables to the Android build process:

| Variable | Value |
| --- | --- |
| `ANDROID_KEYSTORE_PATH` | Absolute path to the existing upload keystore, or a path relative to `android/app` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Signing key alias |
| `ANDROID_KEY_PASSWORD` | Signing key password |

`assembleRelease` and `bundleRelease` fail if any value is missing or the
keystore is unreadable. Debug builds do not require release secrets. Store the
keystore in a restricted secret store and back it up securely outside Git.

The previously committed `newkey.jks` and its password remain recoverable from
Git history even after removal from the current tree. Treat that upload key as
compromised. If the app uses Play App Signing, arrange an upload key reset in
Play Console, register the new upload certificate, and then update the build
secrets. If the key is also the app signing key for installs outside Play,
verify the update path before replacing it; changing that key can prevent
existing installs from accepting updates.
