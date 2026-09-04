# PoPo — Microsoft Partner Center Submission Guide

**App:** PoPo (AI Voice Dictation for Windows)  
**Package Type:** MSIX (Tauri v2 Desktop App)  
**Guide Version:** July 2026  
**Based on:** Microsoft Learn docs + Partner Center submission requirements

---

## Table of Contents

1. [Before You Start — Prerequisites](#1-before-you-start--prerequisites)
2. [Step-by-Step: Partner Center Submission](#2-step-by-step-partner-center-submission)
   - 2.1 [Account & Name Reservation](#21-account--name-reservation)
   - 2.2 [Pricing and Availability](#22-pricing-and-availability)
   - 2.3 [Properties](#23-properties)
   - 2.4 [Age Ratings](#24-age-ratings)
   - 2.5 [Packages](#25-packages)
   - 2.6 [Store Listings](#26-store-listings)
   - 2.7 [Submission Options](#27-submission-options)
3. [What Each Field Means + What to Fill for PoPo](#3-what-each-field-means--what-to-fill-for-popo)
4. [Common Mistakes That Block Submission](#4-common-mistakes-that-block-submission)
5. [After Submission — What Happens Next](#5-after-submission--what-happens-next)

---

## 1. Before You Start — Prerequisites

Make sure these are ready BEFORE you open Partner Center:

| # | Prerequisite | Status | Notes |
|---|-------------|--------|-------|
| 1 | **Microsoft Developer Account** | Required | One-time fee: $19 (individual) or $99 (company). Sign up at [Partner Center](https://partner.microsoft.com/dashboard). |
| 2 | **MSIX Package Built** | Required | Run `pnpm --filter desktop tauri build`. You need the `.msix` or `.msixbundle` file from `src-tauri/target/release/bundle/msix/`. |
| 3 | **App Manifest Correct** | Required | Check `tauri.conf.json` → `identifier` = `ai.popo.desktop`, `productName` = `PoPo`, version matches what you want to publish. |
| 4 | **Privacy Policy URL** | Required | PoPo collects/transmits personal data (Firebase Auth, GCP Speech-to-Text, optional cloud sync). You **MUST** provide a privacy policy URL. See section 3.3. |
| 5 | **Screenshots (4+ recommended)** | Required | At least 1 screenshot mandatory. 4+ recommended. Size: 1366×768 or 1920×1080 (16:9). PNG or JPEG. See section 3.6. |
| 6 | **Store Logo (300×300 PNG)** | Required | A square icon. Use your existing `icons/128x128.png` but upscale cleanly to 300×300. |
| 7 | **Support Email** | Required for company accounts | An email address for users to contact you. |

> **IMPORTANT:** For MSIX submissions to the Microsoft Store, you **DO NOT** need to buy a code signing certificate. Microsoft re-signs your MSIX package automatically with their own certificate after certification. Save your money — skip the DigiCert/Sectigo purchase for Store-only distribution.

---

## 2. Step-by-Step: Partner Center Submission

### 2.1 Account & Name Reservation

1. Go to [partner.microsoft.com/dashboard](https://partner.microsoft.com/dashboard) and sign in.
2. Click **"Apps and games"** → **"Create a new app"**.
3. Choose **"Create your app by reserving a name"**.
4. Enter **"PoPo"** as your app name.
   - If "PoPo" is taken, try "PoPo - AI Voice Dictation" or "PoPo Dictation".
   - Name reservation is valid for **3 months**.
5. Once reserved, you'll land on the **Application Overview** page for PoPo.

### 2.2 Pricing and Availability

**Navigation:** Application Overview → Start submission → Pricing and availability

| Field | What It Means | What to Select for PoPo |
|-------|--------------|------------------------|
| **Markets** | Which countries can download your app. | Select **"All possible markets"** (or choose specific ones if you want to limit). PoPo works globally since it uses Google Cloud which is global. |
| **Audience** | Who can see/download the app. | Select **"Public audience"** — anyone can find it in the Store. |
| **Discoverability** | Should the app be visible in Store search? | Select **"Make this product available and discoverable in the Microsoft Store"**. |
| **Schedule** | When to release / stop selling. | **Release:** "As soon as possible" (default). **Stop acquisition:** "Never" (default). |
| **Base price** | Is the app free or paid? | **Free** — PoPo is open-source/freemium. Users bring their own GCP credentials, so you don't need to charge for the app itself. |
| **Free trial** | Can users try before buying? | **Not available** (grayed out since base price is Free). |
| **Sale pricing** | Temporary discount? | **Skip** — not needed for free app. |
| **Organizational licensing** | Allow companies to bulk-purchase? | **Skip** — not needed for free app. |

> ✅ **Click Save. Section should show green checkmark.**

---

### 2.3 Properties

**Navigation:** Application Overview → Properties

This is where most people get stuck. Here's exactly what to fill:

#### Category, Subcategory, Secondary Category

| Field | What to Select | Why |
|-------|---------------|-----|
| **Category** | **Productivity** | PoPo is a voice dictation tool for writing/code/work. This is the best fit. Alternatives: "Utilities & tools" or "Business". I recommend **Productivity**. |
| **Subcategory** | **(none)** | Productivity doesn't have meaningful subcategories in the Store. Leave blank. |
| **Secondary category** | **(none)** | Optional. Leave blank unless you want to appear in a second category. |

#### Support Info

| Field | What to Fill | Notes |
|-------|-------------|-------|
| **Privacy policy URL** | **REQUIRED** — You MUST have this. | PoPo collects: Firebase Auth data, optional cloud-synced history/settings, audio sent to Google Cloud Speech-to-Text, transcripts sent to Gemini. See section 3.3 for what URL to use. |
| **Website** | Optional but recommended | Your GitHub repo URL: `https://github.com/Ganesh540-crypto/PoPo` or a landing page if you have one. |
| **Support contact info** | **Required if company account** | Your email address where users can reach you for support. |
| **Contact details** | **Required for company accounts** | Business address, contact person, etc. |

#### Game Settings

| Field | What to Do |
|-------|-----------|
| **All game settings** | **Skip entirely** — PoPo is not a game. This section won't appear if you selected "Productivity" as category. |

#### Display Mode

| Field | What to Do |
|-------|-----------|
| **Windows Mixed Reality / 4K / HDR** | **Leave ALL unchecked** — PoPo is a standard 2D desktop app with a floating pill overlay. It doesn't support VR, 4K special modes, or HDR. |

#### Product Declarations

| Declaration | Does PoPo Need It? | Explanation |
|------------|-------------------|-------------|
| **This app allows users to make purchases** | ❌ No | PoPo doesn't have in-app purchases. Users use their own GCP account. |
| **This app accesses, collects, or transmits personal information** | ✅ **YES — CHECK THIS** | PoPo accesses the microphone, collects speech audio, transmits it to Google Cloud, and optionally syncs user data to Firebase. **This is mandatory to disclose.** |
| **This app is suitable for children under 13** | ❌ No | PoPo is a general productivity tool, not specifically designed for children. |
| **This app has a trial experience** | ❌ No | The app is completely free. |
| **This app uses cryptography** | ⚠️ **Check YES** | PoPo uses TLS/HTTPS for all network connections (Firebase, Google APIs). TLS uses cryptography. Also, DPAPI encrypts the Gemini API key locally. Better to disclose than risk rejection. |
| **This app is a game** | ❌ No | Not a game. |
| **This app supports push notifications** | ❌ No | PoPo doesn't use push notifications. |
| **This app uses background audio** | ❌ No | The microphone is only active during dictation, not background audio playback. |
| **This app uses Xbox networking** | ❌ No | Not applicable. |
| **This app is a Microsoft Store device app** | ❌ No | Not applicable. |

#### System Requirements

| Field | What to Select | Why |
|-------|---------------|-----|
| **Keyboard** | Optional | PoPo works with keyboard (hotkeys) but can also be used with mouse/touch. |
| **Mouse** | Optional | Same reason. |
| **Touch** | Optional | PoPo is primarily keyboard-driven but UI elements are clickable. |
| **Camera** | **Not required** | PoPo doesn't use camera. |
| **NFC** | **Not required** | Not applicable. |
| **Bluetooth** | **Not required** | Not applicable. |
| **Telephone** | **Not required** | Not applicable. |
| **Microphone** | **Required** | ⚠️ **This is critical.** PoPo is a voice dictation app — the microphone is REQUIRED for core functionality. Select **"Minimum hardware"** or **"Required hardware"**. |
| **Memory** | Optional | Leave blank unless PoPo has specific RAM needs. It doesn't. |
| **DirectX** | **Not required** | Not applicable. |
| **Processor** | Optional | Leave blank. |
| **Graphics** | Optional | Leave blank. |
| **Windows Mixed Reality immersive headset** | **Not required** | Not applicable. |

> ✅ **Click Save. Section should show green checkmark.**

---

### 2.4 Age Ratings

**Navigation:** Application Overview → Age ratings

This is a **questionnaire** you must complete. Microsoft's certifiers use this to assign an age rating.

**For PoPo, here's how to answer:**

| Question | Answer | Explanation |
|----------|--------|-------------|
| Does your app contain violent content? | **No** | PoPo has no violence. |
| Does your app contain sexual content? | **No** | PoPo has no sexual content. |
| Does your app contain profanity or crude humor? | **No** | The app itself doesn't contain profanity. The user might dictate profanity, but the app doesn't generate it. The Chirp 3 profanity filter is OFF by default. |
| Does your app contain alcohol, tobacco, or drug references? | **No** | Not applicable. |
| Does your app contain gambling or casino content? | **No** | Not applicable. |
| Does your app contain scary or horror content? | **No** | Not applicable. |
| Does your app allow users to interact with each other? | **No** | PoPo is a single-user desktop tool. There's no chat, multiplayer, or social interaction. |
| Does your app share user-generated content? | ⚠️ **Yes** (if cloud sync enabled) / **No** (technically) | The safest answer: **"No"** for the rating questionnaire. PoPo doesn't have a public feed or social sharing. Cloud sync is private to the user's own Firebase account. |
| Does your app collect personal information? | **Yes** | Firebase Auth collects email/name. Audio is sent to Google Cloud. |
| Does your app contain advertising? | **No** | PoPo has no ads. |
| Does your app offer in-app purchases? | **No** | Free app, no purchases. |

**After answering, Partner Center will auto-assign an age rating.** For PoPo, expect:
- **ESRB: E (Everyone)** or **E10+ (Everyone 10+)**
- **PEGI: 3**
- **IARC: Generic**

> ✅ **Click Save. Section should show green checkmark.**

---

### 2.5 Packages

**Navigation:** Application Overview → Packages

| Field | What to Do |
|-------|-----------|
| **Device family availability** | Check **"Windows 10/11"** (default). PoPo targets Windows 10 21H2+ and Windows 11. |
| **App package upload** | Click **"Upload"** and select your `.msix` or `.msixbundle` file from `apps/desktop/src-tauri/target/release/bundle/msix/`. |

**About your package:**
- PoPo is built with Tauri, which outputs an MSIX. The package contains the Rust binary + WebView2 frontend.
- You likely only need **x64** architecture (most modern Windows PCs). If you also want to support older 32-bit Windows, build an x86 version too and bundle them into a `.msixbundle`.
- The package will be validated by Partner Center automatically after upload. Wait for "Validated" status.

> **Important:** The 4th digit of the version (e.g., `0.1.0.0`) is reserved for the Store. In your `tauri.conf.json`, keep the version as something like `"0.1.0"`. The Store may modify the 4th digit.

> ✅ **After upload + validation, this section shows green checkmark.**

---

### 2.6 Store Listings

**Navigation:** Application Overview → Store listings → English (United States)

This is what users SEE in the Microsoft Store. Make it compelling.

#### Product Name
```
PoPo
```
(Or whatever name you reserved. Must match exactly.)

#### Description (REQUIRED)

Here's pre-written copy based on your README. You can use this directly:

```
PoPo is a system-level AI voice dictation tool for Windows. Hold Ctrl+Shift+Space, speak, and release — your words appear instantly at your cursor in any app. No window switching. No manual copy-paste.

Key Features:
• One global hotkey works everywhere — Gmail, VS Code, Slack, Notepad, anywhere you type
• Lives quietly in your system tray with a barely-visible ambient pill at the bottom of your screen
• Powered by Google Chirp 3 Speech-to-Text — supports English, Hindi, Telugu, Tamil, Spanish, French, German, Japanese, and 100+ more languages with auto-detection
• Modes — create reusable AI post-processing prompts (Casual, Professional, Email, Code, or your own)
• Optional cloud sync — sign in with Google to keep history, settings, and modes across all your devices
• Privacy-first — the microphone only opens during active dictation. Raw audio retention is off by default. Audio goes directly from your machine to your own Google Cloud project — never through a middleman.

How it works:
1. Connect your own Google Cloud account (free tier works for casual use)
2. Hold Ctrl+Shift+Space and speak
3. Release — your transcript appears at your cursor in ~500–1200 ms

PoPo is designed for engineers, writers, and knowledge workers who want fast, dependable voice input without breaking their flow.
```

> **Tip:** Keep it under 2000 characters. Don't use ALL CAPS or excessive exclamation marks. Microsoft may flag overly promotional language.

#### What's New in This Version (Optional)
```
Initial release. Core features: voice dictation, AI transcript polishing, cloud sync, history, modes, and quick switcher.
```

#### App Features (Optional but Recommended)
```
• Global hotkey dictation (push-to-talk or toggle mode)
• Google Chirp 3 real-time speech recognition
• Gemini AI transcript formatting
• Custom dictation modes with per-app bindings
• Session history with search and export
• Optional Firebase cloud sync
• Per-app paste override shortcuts
• Silence auto-stop for toggle mode
• System tray integration with auto-start
```

#### Screenshots (REQUIRED — at least 1, 4+ recommended)

You need screenshots of PoPo running. Here's what to capture:

| # | Screenshot Description | Why It Matters |
|---|----------------------|---------------|
| 1 | **Main window — History page** showing past dictation sessions | Shows the core value prop |
| 2 | **Main window — Modes page** showing mode grid | Shows customization |
| 3 | **Main window — Settings page** | Shows configurability |
| 4 | **The pill in "active" state** (recording with waveform) | Shows the ambient UI |
| 5 | **Pill in "success" state** after a dictation | Shows completion feedback |
| 6 | **Dictation working in a real app** (e.g., VS Code or Notepad with text appearing) | Shows the actual use case |

**Screenshot specs:**
- **Minimum:** 1366×768 pixels (16:9)
- **Recommended:** 1920×1080 pixels
- **Format:** PNG or JPEG
- **No watermarks, no promotional text on screenshots**
- **No dark/empty/black screenshots**

> **How to capture:** Use Windows Snipping Tool or ShareX. Make sure the PoPo window is clearly visible with good contrast.

#### Store Logos (REQUIRED)

| Size | What to Upload | Source |
|------|---------------|--------|
| **300×300 PNG** | Square app icon | Upscale your `icons/128x128.png` to 300×300 using a tool like GIMP, Photoshop, or an online upscaler. Must look crisp. |
| **150×150 PNG** (optional) | Small tile icon | Same icon, 150×150 |
| **71×71 PNG** (optional) | Tiny tile icon | Same icon, 71×71 |

> **Tip:** Use a transparent background PNG if your icon looks good on both light and dark themes.

#### Trailers (Optional)

A 30-60 second video demo of PoPo in action would be amazing but is **not required**. If you make one:
- MP4 format
- 1920×1080 resolution
- Show real dictation into VS Code or Gmail
- No music with copyright issues

#### Keywords (Optional but Recommended)
```
voice dictation, speech to text, voice typing, AI transcription, speech recognition, dictation software, voice input, talk to type, hands free typing, productivity tool, voice keyboard, speech-to-text, voice assistant, writing tool, code dictation
```

#### Copyright and Trademark Info (Optional)
```
© 2026 PoPo contributors. All rights reserved.
```

#### Additional License Terms (Optional)
```
PoPo is open-source software. By using this application, you agree to the terms described in the application's license and privacy policy.
```

#### Developed By (Optional)
```
PoPo
```

> ✅ **Click Save. Section should show green checkmark.**

---

### 2.7 Submission Options

**Navigation:** Application Overview → Submission options

| Field | What to Select | Notes |
|-------|---------------|-------|
| **Publishing hold options** | **"Publish this submission as soon as it passes certification"** (default) — OR select manual if you want to control the exact release time. | For your first release, "as soon as possible" is fine. |
| **Notes for certification** | **HIGHLY RECOMMENDED — Fill this!** | See below for exactly what to write. |
| **Restricted capabilities** | **None** (unless PoPo declares any) | PoPo shouldn't need restricted capabilities. If the certifiers flag something, they'll tell you. |
| **Submission notification audience** | Default is fine. | Who gets email notifications about certification status. |

#### What to Write in "Notes for Certification"

This text box is read by Microsoft's human testers. Be helpful and thorough:

```
PoPo is a system-level AI voice dictation application built with Tauri v2 (Rust + React).

SETUP INSTRUCTIONS FOR TESTERS:
1. The app requires a Google Cloud account for speech-to-text functionality. If you do not have one, the app will show a friendly setup hint when you press the hotkey.
2. To test full dictation:
   a. Open PoPo → Settings → GCP Setup → Run setup wizard
   b. The wizard links directly to Google Cloud Console pages
   c. Create a service account with "Speech-to-Text Client" role
   d. Download the JSON key and point PoPo to it
   e. Enter your GCP project ID
   f. Click "Test Connection" to verify
3. Default hotkey: Ctrl+Shift+Space. Hold to record, release to stop.
4. The app can also be used without GCP setup — it will paste a branded reminder message instead.

SIGN-IN (OPTIONAL):
• Google Sign-In is optional. The app works fully without signing in.
• To test cloud sync: click "Sign in with Google" on the Account page.

KNOWN LIMITATIONS:
• Dictation does not work inside UAC prompts or fullscreen DirectX games (Windows UIPI restriction — expected behavior).
• Windows Terminal may require enabling "Paste with Ctrl+V" in its own settings.
• WebView2 Runtime is required. Windows 11 has it pre-installed. Windows 10 users will be prompted to install it.

PRIVACY & DATA:
• Microphone is accessed ONLY during active recording.
• No idle microphone capture.
• No analytics, advertising SDKs, or third-party crash reporters.
• Audio goes directly from the user's machine to their own Google Cloud project.

If you need any test credentials or have questions, please contact us at [YOUR_EMAIL].
```

> ✅ **Click Save. Section should show green checkmark.**

---

## 3. What Each Field Means + What to Fill for PoPo

### 3.1 Category Selection Rationale

**Why Productivity?**

Microsoft Store categories:
- **Productivity** → Office tools, writing assistants, note-taking, dictation software. ✅ Best fit.
- **Utilities & tools** → System tools, file managers, cleaners. Acceptable but less discoverable.
- **Business** → Enterprise software. PoPo is more personal productivity than enterprise.
- **Developer tools** → Code editors, IDEs. PoPo helps developers but isn't a dev tool per se.

**Recommendation:** Productivity primary, optionally Utilities & tools as secondary.

### 3.2 Privacy Policy — Why You NEED This

**PoPo handles personal data:**
- Firebase Auth → email, display name, photo URL
- Firestore → session transcripts, user settings, modes, snippets
- Firebase Storage → audio WAV files (optional)
- Google Cloud Speech-to-Text → voice audio
- Gemini API → transcript text + system prompts

**Microsoft REQUIRES a privacy policy URL if your app collects personal information.** No privacy policy = automatic certification rejection.

**Quick Privacy Policy Options:**

**Option A: Use GitHub Pages (Free)**
1. Create a file `PRIVACY.md` in your repo (you already have one).
2. Enable GitHub Pages for your repo (Settings → Pages → Source: main branch).
3. Your privacy policy will be at: `https://ganesh540-crypto.github.io/PoPo/PRIVACY.md`
4. Use this URL in Partner Center.

**Option B: Use a Simple Landing Page**
If you have a custom domain, host a simple privacy page there.

**Minimum Privacy Policy Content for PoPo:**
```markdown
# PoPo Privacy Policy

Last updated: July 2026

## What data we collect
- **Account info:** If you sign in with Google, we collect your email, name, and profile photo via Firebase Authentication.
- **Dictation data:** Your voice audio is sent directly to Google Cloud Speech-to-Text in YOUR configured Google Cloud project.
- **Transcripts:** Your dictated text is stored locally. If you enable cloud sync, transcripts are stored in YOUR Firebase account under YOUR user ID.
- **Settings & modes:** Your preferences and custom AI modes sync to YOUR Firebase account if signed in.
- **Audio files:** Optional. Only if you enable "Store audio" in Settings.

## What we do NOT collect
- We do NOT run our own transcription server.
- We do NOT sell or share your data.
- We do NOT use analytics, advertising, or third-party crash reporters.
- We do NOT capture screenshots or idle microphone audio.

## Third-party services
- Google Firebase (Auth, Firestore, Storage)
- Google Cloud Speech-to-Text
- Google Gemini / Vertex AI (optional, for transcript formatting)

## Data deletion
Use Settings → Account → Delete all my data to remove cloud data. Uninstalling removes local data.

## Contact
[YOUR_EMAIL]
```

### 3.3 Age Rating Deep Dive

Microsoft uses the **IARC (International Age Rating Coalition)** questionnaire. Your answers determine ratings across regions:

| Region | Expected Rating for PoPo |
|--------|-------------------------|
| ESRB (USA/Canada) | E (Everyone) |
| PEGI (Europe) | 3 |
| ACB (Australia) | G (General) |
| USK (Germany) | USK 0 |
| IARC (Global) | Generic / Suitable for all ages |

**Critical:** If you answer "Yes" to anything violent/sexual/gambling, your app may be restricted in certain markets or require additional review.

### 3.4 Screenshot Strategy

**Bad screenshots** (don't do these):
- Empty/dark screens
- Screenshots with "Lorem ipsum" placeholder text
- Screenshots showing error states
- Screenshots with personal data visible
- Screenshots with watermarks or promotional banners

**Good screenshots** (do these):
- Clean, professional-looking UI
- Show the app in a real usage context (e.g., dictating into VS Code)
- Good lighting and contrast
- English text (since your primary listing is English)

### 3.5 Notes for Certification — Why This Matters

Microsoft's testers are human. If they can't figure out how to test your app, they'll fail it.

**Common rejection reasons that "Notes for certification" prevents:**
1. "App requires login but no test credentials provided" → You explain GCP setup is optional and provide steps.
2. "App appears non-functional" → They didn't know to set up GCP. You explain the fallback behavior.
3. "Privacy policy missing" → Already handled in Properties.
4. "App accesses microphone without clear purpose" → You explain it's a dictation app.

---

## 4. Common Mistakes That Block Submission

| Mistake | Why It Happens | How to Avoid |
|---------|---------------|-------------|
| ❌ **Missing Privacy Policy URL** | Most common rejection reason. | Create a privacy policy page and paste the URL in Properties → Privacy policy URL. |
| ❌ **Screenshots don't match app** | Using mockups or screenshots from another app. | Use actual screenshots of PoPo running on Windows 11. |
| ❌ **App crashes on launch** | Package built incorrectly or missing dependencies. | Test the MSIX on a clean Windows VM before submitting. |
| ❌ **Wrong package architecture** | Uploading x86-only when most users are x64. | Build for x64 at minimum. x86 optional for older PCs. |
| ❌ **Version number issues** | 4th digit not 0, or version decreasing. | Keep version as `Major.Minor.Patch.0` in manifest. |
| ❌ **Incomplete age rating** | Skipping questions in the questionnaire. | Answer EVERY question. "No" is a valid answer. |
| ❌ **Inaccurate category** | Calling a productivity app a "game". | Select Productivity. |
| ❌ **Promotional text in description** | "BEST APP EVER!!!" or excessive caps. | Write clear, factual descriptions. |
| ❌ **Missing microphone declaration** | Not declaring microphone usage in system requirements. | Mark microphone as Required hardware. |
| ❌ **No notes for certification** | Testers can't figure out how to use the app. | Write detailed setup instructions. |

---

## 5. After Submission — What Happens Next

### Timeline

| Stage | Duration | What Happens |
|-------|----------|-------------|
| **Pre-processing** | 1–2 hours | Partner Center validates your MSIX package format and manifest. |
| **Certification** | 1–3 business days | Microsoft testers install and use your app. They check for crashes, policy violations, and correct metadata. |
| **Publishing** | Immediate (if auto-publish) | Once certified, your app goes live in the Microsoft Store. |

### Possible Outcomes

| Outcome | What It Means | What to Do |
|---------|--------------|-----------|
| ✅ **Passed certification** | Your app is approved. | It will auto-publish (or wait for manual release if you chose that). Celebrate! |
| ⚠️ **Certification report with warnings** | Minor issues found but app still approved. | Fix warnings in the next update. No action needed immediately. |
| ❌ **Failed certification** | App rejected. You'll get an email with specific reasons. | Read the failure report carefully. Fix the issues, create a new submission, and resubmit. |

### If Certification Fails — Common PoPo-Specific Reasons

| Potential Failure | Fix |
|------------------|-----|
| "App requires login without providing test credentials" | Add clearer notes: "Google Sign-In is OPTIONAL. App works without it." |
| "App appears to do nothing" | Explain: "App requires GCP setup for dictation. Without it, pressing the hotkey pastes a setup reminder." |
| "Privacy policy URL returns 404" | Ensure your privacy policy page is live BEFORE submitting. Test the URL in a browser. |
| "Microphone access not declared" | Go to Properties → System requirements → mark Microphone as Required. |
| "App crashes on Windows 10" | Test on a Windows 10 21H2 VM. Ensure WebView2 Runtime is available. |
| "Screenshots are low quality" | Retake at 1920×1080, PNG format, no compression artifacts. |

---

## Appendix A: Quick Reference Checklist

Use this checklist before hitting "Submit for certification":

- [ ] Developer account active and paid ($19 or $99)
- [ ] App name reserved ("PoPo" or similar)
- [ ] MSIX package built and tested on a clean Windows install
- [ ] `tauri.conf.json` version is correct (e.g., `0.1.0`)
- [ ] Pricing set to "Free"
- [ ] Category = "Productivity"
- [ ] Privacy policy URL is live and accessible
- [ ] Support email provided
- [ ] Age rating questionnaire fully completed
- [ ] Microphone marked as "Required hardware"
- [ ] MSIX package uploaded and validated
- [ ] At least 1 screenshot uploaded (4+ recommended)
- [ ] 300×300 store logo uploaded
- [ ] Description written and saved
- [ ] Notes for certification filled with setup instructions
- [ ] All sections show green checkmarks
- [ ] Clicked "Submit for certification"

---

## Appendix B: Pre-Written Text You Can Copy-Paste

### Description (Full Version)
```
PoPo is a system-level AI voice dictation tool for Windows. Hold Ctrl+Shift+Space, speak, and release — your words appear instantly at your cursor in any app. No window switching. No manual copy-paste.

Key Features:
• One global hotkey works everywhere — Gmail, VS Code, Slack, Notepad, anywhere you type
• Lives quietly in your system tray with a barely-visible ambient pill at the bottom of your screen
• Powered by Google Chirp 3 Speech-to-Text — supports 100+ languages with auto-detection
• Modes — create reusable AI post-processing prompts (Casual, Professional, Email, Code, or your own)
• Optional cloud sync — sign in with Google to keep history, settings, and modes across devices
• Privacy-first — microphone only opens during active dictation. Raw audio retention is off by default.

How it works:
1. Connect your own Google Cloud account (free tier works for casual use)
2. Hold Ctrl+Shift+Space and speak
3. Release — your transcript appears at your cursor in under a second

Designed for engineers, writers, and knowledge workers who want fast, dependable voice input without breaking their flow.
```

### Notes for Certification (Full Version)
```
PoPo is a system-level AI voice dictation application built with Tauri v2 (Rust + React).

SETUP FOR TESTERS:
1. The app requires a Google Cloud account for speech-to-text. If unavailable, the app shows a friendly setup hint when the hotkey is pressed.
2. To test full dictation: Settings → GCP Setup → Run setup wizard → follow the 5-step wizard.
3. Default hotkey: Ctrl+Shift+Space. Hold to record, release to stop.
4. The app works fully without GCP — it pastes a branded reminder message.

SIGN-IN: Optional. Google Sign-In enables cloud sync. The app works completely without it.

KNOWN LIMITATIONS:
• Dictation does not work in UAC prompts or fullscreen DirectX games (Windows UIPI restriction).
• Windows Terminal may need "Paste with Ctrl+V" enabled in its settings.
• WebView2 Runtime required. Windows 11 has it pre-installed.

PRIVACY: Microphone accessed ONLY during recording. No idle capture. No analytics or ads.

Questions? Contact: [YOUR_EMAIL]
```

### Privacy Policy (Minimum Viable)
```markdown
# PoPo Privacy Policy

Last updated: July 2026

## Data We Collect
- **Account:** Email, name, photo via Firebase Auth (optional sign-in).
- **Audio:** Voice sent to YOUR Google Cloud Speech-to-Text project.
- **Transcripts:** Stored locally. Synced to YOUR Firebase if signed in.
- **Settings:** Preferences sync to YOUR Firebase if signed in.

## Data We Do NOT Collect
- No own transcription server.
- No analytics, ads, or crash reporters.
- No screenshots or idle mic capture.

## Third Parties
Google Firebase, Google Cloud Speech-to-Text, Google Gemini (optional).

## Deletion
Settings → Account → Delete all my data.

Contact: [YOUR_EMAIL]
```

---

*Guide compiled from Microsoft Learn documentation, Partner Center submission requirements, and PoPo application analysis. Always refer to the official Microsoft docs for the most current requirements.*
