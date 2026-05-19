# Chirp 3 Transcription: Enhanced multilingual accuracy

> Saved Session 29. Source: Google Cloud Speech-to-Text v2 documentation.
> This is the canonical reference for popo's STT integration — every design
> question ("does Chirp 3 support X?") resolves here first.

[Try Chirp 3 in the Google Cloud console](https://console.cloud.google.com/speech) · [Try in Colab](https://colab.research.google.com/github/GoogleCloudPlatform/generative-ai/blob/main/audio/speech/getting-started/get_started_with_chirp_3_transcription.ipynb) · [View notebook on GitHub](https://github.com/GoogleCloudPlatform/generative-ai/blob/main/audio/speech/getting-started/get_started_with_chirp_3_transcription.ipynb)

Chirp 3 is the latest generation of Google's multilingual Automatic Speech Recognition (ASR)-specific
generative models, designed to meet user needs based on feedback and experience. Chirp 3 provides enhanced accuracy and speed beyond previous Chirp models and provides diarization and automatic language detection.

## Model details

Chirp 3: Transcription, is exclusively available within the Speech-to-Text API V2.

### Model identifiers

You can use Chirp 3: Transcription just like any other model by specifying the appropriate model identifier in your recognition request when using the API or the model name while in the Google Cloud console. Specify the appropriate identifier in your recognition.

| Model | Model identifier |
|---|---|
| Chirp 3 | `chirp_3` |

### API methods

Not all recognition methods support the same language availability sets,
because Chirp 3 is available in the Speech-to-Text API V2, it supports the
following recognition methods:

| API version | API method | Support |
|---|---|---|
| V2 | `Speech.StreamingRecognize` (good for streaming and real-time audio) | Supported |
| V2 | `Speech.Recognize` (good for audio shorter than one minute) | Supported |
| V2 | `Speech.BatchRecognize` (good for long audio 1 minute to 1 hour in general, but up to 20 minutes with word-level timestamp enabled) | Supported |

> **Note:** You can always find the latest list of supported locales and features for each transcription model, using the locations API.

### Regional availability

Chirp 3 is available in the following Google Cloud regions, with more planned:

| Google Cloud Zone | Launch Readiness |
|---|---|
| `us (multi-region)` | GA |
| `eu (multi-region)` | GA |

### Language availability for transcription

Chirp 3 supports transcription in `StreamingRecognize`, `Recognize`, and `BatchRecognize` in the
following languages:

| Language | BCP-47 Code | Launch Readiness |
|---|---|---|
| Catalan (Spain) | `ca-ES` | GA |
| Chinese (Simplified, China) | `cmn-Hans-CN` | GA |
| Croatian (Croatia) | `hr-HR` | GA |
| Danish (Denmark) | `da-DK` | GA |
| Dutch (Netherlands) | `nl-NL` | GA |
| English (Australia) | `en-AU` | GA |
| English (India) | `en-IN` | GA |
| English (United Kingdom) | `en-GB` | GA |
| English (United States) | `en-US` | GA |
| Finnish (Finland) | `fi-FI` | GA |
| French (Canada) | `fr-CA` | GA |
| French (France) | `fr-FR` | GA |
| German (Germany) | `de-DE` | GA |
| Greek (Greece) | `el-GR` | GA |
| Hindi (India) | `hi-IN` | GA |
| Italian (Italy) | `it-IT` | GA |
| Japanese (Japan) | `ja-JP` | GA |
| Korean (Korea) | `ko-KR` | GA |
| Polish (Poland) | `pl-PL` | GA |
| Portuguese (Brazil) | `pt-BR` | GA |
| Portuguese (Portugal) | `pt-PT` | GA |
| Romanian (Romania) | `ro-RO` | GA |
| Russian (Russia) | `ru-RU` | GA |
| Spanish (Spain) | `es-ES` | GA |
| Spanish (United States) | `es-US` | GA |
| Swedish (Sweden) | `sv-SE` | GA |
| Turkish (Turkey) | `tr-TR` | GA |
| Ukrainian (Ukraine) | `uk-UA` | GA |
| Vietnamese (Vietnam) | `vi-VN` | GA |
| Afrikaans (South Africa) | `af-ZA` | Preview |
| Albanian (Albania) | `sq-AL` | Preview |
| Amharic (Ethiopia) | `am-ET` | Preview |
| Arabic (Algeria) | `ar-DZ` | Preview |
| Arabic (Bahrain) | `ar-BH` | Preview |
| Arabic (Egypt) | `ar-EG` | Preview |
| Arabic (Israel) | `ar-IL` | Preview |
| Arabic (Jordan) | `ar-JO` | Preview |
| Arabic (Kuwait) | `ar-KW` | Preview |
| Arabic (Lebanon) | `ar-LB` | Preview |
| Arabic (Mauritania) | `ar-MR` | Preview |
| Arabic (Morocco) | `ar-MA` | Preview |
| Arabic (Oman) | `ar-OM` | Preview |
| Arabic (Qatar) | `ar-QA` | Preview |
| Arabic (Saudi Arabia) | `ar-SA` | Preview |
| Arabic (State of Palestine) | `ar-PS` | Preview |
| Arabic (Syria) | `ar-SY` | Preview |
| Arabic (Tunisia) | `ar-TN` | Preview |
| Arabic (United Arab Emirates) | `ar-AE` | Preview |
| Arabic (Yemen) | `ar-YE` | Preview |
| Arabic | `ar-XA` | Preview |
| Armenian (Armenia) | `hy-AM` | Preview |
| Assamese (India) | `as-IN` | Preview |
| Asturian (Spain) | `ast-ES` | Preview |
| Azerbaijani (Azerbaijan) | `az-AZ` | Preview |
| Basque (Spain) | `eu-ES` | Preview |
| Bengali (Bangladesh) | `bn-BD` | Preview |
| Bengali (India) | `bn-IN` | Preview |
| Bulgarian (Bulgaria) | `bg-BG` | Preview |
| Burmese (Myanmar) | `my-MM` | Preview |
| Central Kurdish (Iraq) | `ar-IQ` | Preview |
| Chinese, Cantonese (Traditional Hong Kong) | `yue-Hant-HK` | Preview |
| Chinese, Mandarin (Traditional, Taiwan) | `cmn-Hant-TW` | Preview |
| Czech (Czech Republic) | `cs-CZ` | Preview |
| English (Philippines) | `en-PH` | Preview |
| Estonian (Estonia) | `et-EE` | Preview |
| Filipino (Philippines) | `fil-PH` | Preview |
| Galician (Spain) | `gl-ES` | Preview |
| Georgian (Georgia) | `ka-GE` | Preview |
| Gujarati (India) | `gu-IN` | Preview |
| Hausa (Nigeria) | `ha-NG` | Preview |
| Hebrew (Israel) | `iw-IL` | Preview |
| Hungarian (Hungary) | `hu-HU` | Preview |
| Icelandic (Iceland) | `is-IS` | Preview |
| Indonesian (Indonesia) | `id-ID` | Preview |
| Javanese (Indonesia) | `jv-ID` | Preview |
| Kannada (India) | `kn-IN` | Preview |
| Kazakh (Kazakhstan) | `kk-KZ` | Preview |
| Khmer (Cambodia) | `km-KH` | Preview |
| Kyrgyz (Kyrgyzstan) | `ky-KG` | Preview |
| Lao (Laos) | `lo-LA` | Preview |
| Latvian (Latvia) | `lv-LV` | Preview |
| Lithuanian (Lithuania) | `lt-LT` | Preview |
| Luxembourgish (Luxembourg) | `lb-LU` | Preview |
| Macedonian (North Macedonia) | `mk-MK` | Preview |
| Malay (Malaysia) | `ms-MY` | Preview |
| Malayalam (India) | `ml-IN` | Preview |
| Maltese (Malta) | `mt-MT` | Preview |
| Maori (New Zealand) | `mi-NZ` | Preview |
| Marathi (India) | `mr-IN` | Preview |
| Mongolian (Mongolia) | `mn-MN` | Preview |
| Nepali (Nepal) | `ne-NP` | Preview |
| Northern Sotho (South Africa) | `nso-ZA` | Preview |
| Norwegian (Norway) | `no-NO` | Preview |
| Oriya (India) | `or-IN` | Preview |
| Persian (Iran) | `fa-IR` | Preview |
| Punjabi (Gurmukhi India) | `pa-Guru-IN` | Preview |
| Serbian (Serbia) | `sr-RS` | Preview |
| Slovak (Slovakia) | `sk-SK` | Preview |
| Slovenian (Slovenia) | `sl-SI` | Preview |
| Spanish (Mexico) | `es-MX` | Preview |
| Swahili (Kenya) | `sw-KE` | Preview |
| Swahili | `sw` | Preview |
| Tamil (India) | `ta-IN` | Preview |
| Telugu (India) | `te-IN` | Preview |
| Thai (Thailand) | `th-TH` | Preview |
| Uzbek (Uzbekistan) | `uz-UZ` | Preview |
| Welsh (United Kingdom) | `cy-GB` | Preview |
| Wolof (Senegal) | `wo-SN` | Preview |
| Xhosa (South Africa) | `xh-ZA` | Preview |
| Yoruba (Nigeria) | `yo-NG` | Preview |
| Zulu (South Africa) | `zu-ZA` | Preview |

### Language availability for diarization

Chirp 3 supports transcription and diarization only in `BatchRecognize` and `Recognize` in the following languages:

| Language | BCP-47 Code |
|---|---|
| Chinese (Simplified, China) | cmn-Hans-CN |
| German (Germany) | de-DE |
| English (United Kingdom) | en-GB |
| English (India) | en-IN |
| English (United States) | en-US |
| Spanish (Spain) | es-ES |
| Spanish (United States) | es-US |
| French (Canada) | fr-CA |
| French (France) | fr-FR |
| Hindi (India) | hi-IN |
| Italian (Italy) | it-IT |
| Japanese (Japan) | ja-JP |
| Korean (Korea) | ko-KR |
| Portuguese (Brazil) | pt-BR |

## Feature support and limitations

Chirp 3 **supports** the following features:

| Feature | Description | Launch stage |
|---|---|---|
| Automatic punctuation | Automatically generated by the model and can be optionally disabled. | GA |
| Automatic capitalization | Automatically generated by the model and can be optionally disabled. | GA |
| Utterance-level timestamps | Automatically generated by the model. Available only in `Speech.StreamingRecognize` | GA |
| Speaker Diarization | Automatically identifies the different speakers in a single-channel audio sample. Available only in `Speech.BatchRecognize` | GA |
| Speech adaptation (Biasing) | Provides hints to the model in the form of phrases or words to improve recognition accuracy for specific terms or proper nouns. | GA |
| Language-agnostic audio transcription | Automatically infers and transcribes in the most prevalent language. | GA |
| Custom prompt | Provide customized transcription formatting instructions to the model. | Preview |

Chirp 3 **doesn't support** the following features:

| Feature | Description |
|---|---|
| Word-level timestamps | Automatically generated by the model and can be optionally enabled, which some transcription degradation is expected. Available only in `Speech.Recognize` and `Speech.BatchRecognize` |
| Word-level confidence scores | The API returns a value, but it isn't truly a confidence score. |

**popo-specific notes (Session 29)**:
- `enable_spoken_punctuation`, `enable_spoken_emojis`, and `profanity_filter` are NOT in the supported-features table above. Setting them on a Chirp 3 request produces `INVALID_ARGUMENT`. These toggles are hidden in popo's Settings UI (Phase C UI trimmed).
- `denoiser_config { denoise_audio: true, snr_threshold: 0.0 }` IS supported on Chirp 3 — see the "Enable denoiser" section below for the official example. snr_threshold is deprecated on Chirp 3 but must be 0.0 for compatibility.
- `CustomPromptConfig` is the Chirp-3-native way to apply formatting instructions (e.g. mode prompts). It's PREVIEW, and could replace our Gemini Flash post-processing round-trip entirely. Worth a look after Silero VAD lands.

## Transcribe using Chirp 3

### Perform streaming speech recognition (Python)

```python
import os

from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech
from google.api_core.client_options import ClientOptions

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT")
REGION = "us"

def transcribe_streaming_chirp3(audio_file: str) -> cloud_speech.StreamingRecognizeResponse:
    """Transcribes audio from audio file stream using the Chirp 3 model of Google Cloud Speech-to-Text v2 API."""

    client = SpeechClient(
        client_options=ClientOptions(
            api_endpoint=f"{REGION}-speech.googleapis.com",
        )
    )

    with open(audio_file, "rb") as f:
        content = f.read()

    chunk_length = len(content) // 5
    stream = [
        content[start : start + chunk_length]
        for start in range(0, len(content), chunk_length)
    ]
    audio_requests = (
        cloud_speech.StreamingRecognizeRequest(audio=audio) for audio in stream
    )

    recognition_config = cloud_speech.RecognitionConfig(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=["en-US"],
        model="chirp_3",
    )
    streaming_config = cloud_speech.StreamingRecognitionConfig(config=recognition_config)
    config_request = cloud_speech.StreamingRecognizeRequest(
        recognizer=f"projects/{PROJECT_ID}/locations/{REGION}/recognizers/_",
        streaming_config=streaming_config,
    )

    def requests(config, audio):
        yield config
        yield from audio

    responses_iterator = client.streaming_recognize(
        requests=requests(config_request, audio_requests)
    )
    responses = []
    for response in responses_iterator:
        responses.append(response)
        for result in response.results:
            print(f"Transcript: {result.alternatives[0].transcript}")

    return responses
```

### Perform synchronous speech recognition (Python)

```python
def transcribe_sync_chirp3(audio_file: str) -> cloud_speech.RecognizeResponse:
    client = SpeechClient(
        client_options=ClientOptions(
            api_endpoint=f"{REGION}-speech.googleapis.com",
        )
    )

    with open(audio_file, "rb") as f:
        audio_content = f.read()

    config = cloud_speech.RecognitionConfig(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=["en-US"],
        model="chirp_3",
    )

    request = cloud_speech.RecognizeRequest(
        recognizer=f"projects/{PROJECT_ID}/locations/{REGION}/recognizers/_",
        config=config,
        content=audio_content,
    )

    response = client.recognize(request=request)

    for result in response.results:
        print(f"Transcript: {result.alternatives[0].transcript}")

    return response
```

### Perform batch speech recognition (Python)

```python
def transcribe_batch_3(audio_uri: str) -> cloud_speech.BatchRecognizeResults:
    client = SpeechClient(
        client_options=ClientOptions(
            api_endpoint=f"{REGION}-speech.googleapis.com",
        )
    )

    config = cloud_speech.RecognitionConfig(
        auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
        language_codes=["en-US"],
        model="chirp_3",
    )

    file_metadata = cloud_speech.BatchRecognizeFileMetadata(uri=audio_uri)

    request = cloud_speech.BatchRecognizeRequest(
        recognizer=f"projects/{PROJECT_ID}/locations/{REGION}/recognizers/_",
        config=config,
        files=[file_metadata],
        recognition_output_config=cloud_speech.RecognitionOutputConfig(
            inline_response_config=cloud_speech.InlineOutputConfig(),
        ),
    )

    operation = client.batch_recognize(request=request)
    response = operation.result(timeout=120)

    for result in response.results[audio_uri].transcript.results:
        print(f"Transcript: {result.alternatives[0].transcript}")

    return response.results[audio_uri].transcript
```

## Use Chirp 3 features

### Perform a language-agnostic transcription

Chirp 3 can automatically identify and transcribe in the dominant language spoken in the audio which is essential for multilingual applications. To achieve this set `language_codes=["auto"]`:

```python
config = cloud_speech.RecognitionConfig(
    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
    language_codes=["auto"],  # Set language code to auto to detect language.
    model="chirp_3",
)
```

### Perform a language-restricted transcription

Chirp 3 can automatically identify and transcribe the dominant language in an audio file. You can also condition it on specific locales you expect, for example: `["en-US", "fr-FR"]`:

```python
config = cloud_speech.RecognitionConfig(
    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
    language_codes=["en-US", "fr-FR"],  # Expected spoken locales
    model="chirp_3",
)
```

### Perform transcription and speaker diarization (batch only)

```python
config = cloud_speech.RecognitionConfig(
    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
    language_codes=["en-US"],
    model="chirp_3",
    features=cloud_speech.RecognitionFeatures(
        diarization_config=cloud_speech.SpeakerDiarizationConfig(),
    ),
)
```

### Improve accuracy with model adaptation

```python
config = cloud_speech.RecognitionConfig(
    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
    language_codes=["en-US"],
    model="chirp_3",
    adaptation=cloud_speech.SpeechAdaptation(
        phrase_sets=[
            cloud_speech.SpeechAdaptation.AdaptationPhraseSet(
                inline_phrase_set=cloud_speech.PhraseSet(phrases=[
                    {"value": "alphabet"},
                    {"value": "cell phone service"},
                ])
            )
        ]
    )
)
```

> **Note:** `chirp_3` supports a dictionary of up to 1,000 phrases for adaptation. Use as few entries as possible to prevent degradation on non-adaptation terms.

### Use custom prompt to format the transcription

Chirp 3 accepts a custom prompt as the formatting instructions to the model.

```python
config = cloud_speech.RecognitionConfig(
    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
    language_codes=["en-US"],
    model="chirp_3",
    features=cloud_speech.RecognitionFeatures(
        custom_prompt_config=cloud_speech.CustomPromptConfig(
            custom_prompt=custom_prompt,
            # e.g. "Capitalize the following special words: GOOGLE, CHIRP."
            # or   "For dates don't use the 'December 23rd, 1939' format!
            #       Use the '12/23/1939' format."
        )
    ),
)
```

### Enable denoiser

Chirp 3 can enhance audio quality by reducing background noise. Setting `denoiser_audio=True` effectively reduces background music or noises like rain and street traffic.

> **Note:** The denoiser can't remove background human voices.

```python
config = cloud_speech.RecognitionConfig(
    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
    language_codes=["en-US"],
    model="chirp_3",
    denoiser_config={
        "denoise_audio": True,
        "snr_threshold": 0.0,  # snr_threshold is deprecated in Chirp3; set to 0.0 to maintain compatibility.
    }
)
```

### Adjust endpointing sensitivity

The Cloud Speech-to-Text API lets you control the trade-off between latency and accuracy for streaming and real-time applications for Chirp 3. By default, the recognition model waits for a brief period of silence after speech is detected to ensure that a user has finished a complete sentence or phrase.

`endpointing_sensitivity` can be adjusted for time-sensitive applications like voice commands or voice bots to finalize results more quickly.

> **Note:** If the user pauses briefly while speaking, increasing the bot's sensitivity to minimize latency might result in the system "cutting off" a user.

#### Sensitivity levels

- **`ENDPOINTING_SENSITIVITY_STANDARD`** (default): Balances latency and accuracy. Optimized for most use cases, including long-form dictation and natural conversation. The model waits to help ensure the utterance is complete before finalizing the result.
- **`ENDPOINTING_SENSITIVITY_SHORT`**: Optimized for short utterances, such as single sentences or commands ("Remind me to call the dentist tomorrow"). Reduces wait time while maintaining reasonable sentence-level accuracy.
- **`ENDPOINTING_SENSITIVITY_SUPERSHORT`**: Optimized for very short commands or single words ("Yes", "No", "Stop"). Lowest latency; finalizes immediately upon detecting end of speech. Recommended only for time-critical applications with brief utterances.

```python
config_request = speech_v2.StreamingRecognizeRequest(
    recognizer=recognizer_path,
    streaming_config=speech_v2.StreamingRecognitionConfig(
        config=recognition_config_obj,
        streaming_features=speech_v2.StreamingRecognitionFeatures(
            interim_results=False,
            enable_voice_activity_events=True,
            endpointing_sensitivity=speech_v2.StreamingRecognitionFeatures.EndpointingSensitivity.ENDPOINTING_SENSITIVITY_SUPERSHORT,
        ),
    )
)
```

## popo integration summary (Session 29)

| Our configuration | Current value | Notes |
|---|---|---|
| Model | `chirp_3` | ✅ correct |
| Endpoint | `us-speech.googleapis.com` | ✅ Chirp 3 GA region |
| `language_codes` | `["auto"]` (when auto) or user's selection or multi-array | ✅ matches Chirp 3 expectations |
| `features` | `None` | ⚠️ considering adding `enable_automatic_punctuation: true` for explicitness (it's on by default anyway) |
| `denoiser_config` | `None` (Session 28 reverted) | 🔁 to be re-added per Chirp 3 docs: `{denoise_audio: true, snr_threshold: 0.0}` |
| `streaming_features.interim_results` | not set (= false) | 🔁 to enable so logs visibly prove real-time streaming is happening |
| `streaming_features.endpointing_sensitivity` | not set (= STANDARD default) | Optional: could expose in Settings for advanced users |
| `streaming_features.enable_voice_activity_events` | not set (= false) | Optional: could replace/supplement our local silence detection |

## What's next

- [Transcribe short audio files](https://cloud.google.com/speech-to-text/docs/sync-recognize)
- [Transcribe streaming audio](https://cloud.google.com/speech-to-text/docs/streaming-recognize)
- [Transcribe long audio files](https://cloud.google.com/speech-to-text/docs/batch-recognize)
- [Best practices](https://cloud.google.com/speech-to-text/docs/best-practices)
