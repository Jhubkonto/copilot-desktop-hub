# Security and package-boundary contract

NEXY source and release packages contain source code, documentation, licenses,
and synthetic fixtures only. They must not contain user/runtime state,
credentials, provider configuration, browser state, build output, or machine
paths.

## Android Firebase configuration

`android/app/google-services.json` is a protected build input and is ignored by
Git. The checked-in `android/app/google-services.json.example` is documentation
only and contains no usable project credentials.

For a Firebase-enabled build, CI must expose the protected file through
`NEXY_FIREBASE_GOOGLE_SERVICES_PATH`, copy it to
`android/app/google-services.json` for the duration of the Gradle invocation,
and remove it in a cleanup step that runs on success and failure. The file must
never be placed in a source archive, desktop package, or release artifact.

The Android Build Dashboard uses the same contract when the desktop process is
started with `NEXY_FIREBASE_GOOGLE_SERVICES_PATH` set. It also discovers the
standard Android Studio SDK location, so `android/local.properties` is not
required. On Windows, for example:

```powershell
$env:NEXY_FIREBASE_GOOGLE_SERVICES_PATH = 'C:\path\outside\repo\google-services.json'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npm run dev
```

Then run `assembleRelease` from Settings → Developer → Android. The dashboard
removes the temporary Firebase file after the build or cancellation.

Android signing remains environment-based through the existing
`NEXY_KEYSTORE_*` variables; keystores and signing passwords are never checked
in.

## Required checks

Run these checks before publishing or creating an archive:

```text
npm run security:scan
npm run check:package-boundary
```

The temporary Firebase contract can be used by CI as follows (the protected
path is never printed or committed):

```text
NEXY_FIREBASE_GOOGLE_SERVICES_PATH=/run/secrets/nexy-google-services.json node scripts/with-android-firebase.mjs -- ./gradlew assembleRelease
```

Build packages from a clean Git archive or the electron-builder allowlist, not
by archiving the repository directory.
