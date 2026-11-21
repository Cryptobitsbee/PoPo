// gcp/cost.rs — per-session spend estimation.
//
// Replaces the Chirp-era formula `ceil(duration_ms / 15000) * $0.004`,
// which was correct for Speech-to-Text v2's 15-second billing
// increments but has no meaning for a token-billed model.
//
// Gemini 3.5 Transcribe Live bills tokens, not wall-clock:
//   - audio input at 25 tokens per second of audio
//   - text output as ordinary text tokens
//
// Tier 3 dictations additionally hit Gemini 3.5 Flash-Lite for
// mode-prompt polish. The Chirp-era code never counted that at all, so
// every polished dictation has under-reported since Session 34. It is
// counted here.
//
// UNCONFIRMED, deliberately not encoded: a Google pricing page mentions
// 30-second billing increments without attributing them to the Live
// API. Do not add an increment until it is confirmed against a real
// bill — rounding up every 4-second dictation to 30 seconds would
// overstate spend by ~7x.
//
// Everything here is an ESTIMATE surfaced as `gcpCostEstimate`. The
// authoritative number is the Cloud Billing console.

/// Transcribe Live input, USD per token. $3.50 / 1M.
pub const STT_INPUT_USD_PER_TOKEN: f64 = 3.50e-6;

/// Transcribe Live output, USD per token. $21.00 / 1M.
pub const STT_OUTPUT_USD_PER_TOKEN: f64 = 21.0e-6;

/// Audio input tokenisation rate published by Google.
pub const AUDIO_TOKENS_PER_SECOND: f64 = 25.0;

/// Gemini 3.5 Flash-Lite input, USD per token. $0.30 / 1M.
pub const POLISH_INPUT_USD_PER_TOKEN: f64 = 0.30e-6;

/// Gemini 3.5 Flash-Lite output, USD per token. $2.50 / 1M.
pub const POLISH_OUTPUT_USD_PER_TOKEN: f64 = 2.50e-6;

/// Rough tokens-per-word factor. The usual English approximation is
/// ~0.75 words per token, so tokens ≈ words / 0.75.
const WORDS_PER_TOKEN: f64 = 0.75;

/// Estimate token count for a piece of text.
///
/// Deriving this from the actual transcript is more accurate than
/// Google's published "~175 text tokens per minute" basis, which exists
/// only to turn token rates into a headline per-minute figure. We have
/// the real text, so we use it.
pub fn estimate_text_tokens(text: &str) -> f64 {
    let words = text.split_whitespace().count() as f64;
    if words == 0.0 {
        return 0.0;
    }
    words / WORDS_PER_TOKEN
}

/// Audio input tokens for a dictation of `duration_ms`.
///
/// Seconds are rounded up: a partial second still streams a frame.
pub fn audio_tokens(duration_ms: u64) -> f64 {
    let seconds = (duration_ms as f64 / 1000.0).ceil();
    seconds * AUDIO_TOKENS_PER_SECOND
}

/// Cost of the speech-to-text call itself.
pub fn stt_cost_usd(duration_ms: u64, transcript: &str) -> f64 {
    audio_tokens(duration_ms) * STT_INPUT_USD_PER_TOKEN
        + estimate_text_tokens(transcript) * STT_OUTPUT_USD_PER_TOKEN
}

/// Cost of the tier-3 Flash-Lite polish call.
///
/// Input is the system prompt plus the raw transcript; output is the
/// polished result.
pub fn polish_cost_usd(system_prompt: &str, raw_transcript: &str, polished: &str) -> f64 {
    let input_tokens = estimate_text_tokens(system_prompt) + estimate_text_tokens(raw_transcript);
    let output_tokens = estimate_text_tokens(polished);
    input_tokens * POLISH_INPUT_USD_PER_TOKEN + output_tokens * POLISH_OUTPUT_USD_PER_TOKEN
}

/// What the tier-3 polish call actually consumed, when it ran.
pub struct PolishUsage<'a> {
    pub system_prompt: &'a str,
    pub raw_transcript: &'a str,
    pub polished: &'a str,
}

/// Total estimated spend for one dictation, rounded to 4 decimal places
/// to match the precision `SessionPayload.gcp_cost_estimate` has always
/// carried.
///
/// `polish` is `None` for tiers 1 and 2, which make no LLM call at all.
pub fn session_cost_usd(
    duration_ms: u64,
    final_transcript: &str,
    polish: Option<PolishUsage<'_>>,
) -> f64 {
    // The STT call produced the RAW transcript. When polish ran, the
    // final transcript is Flash-Lite's output, so bill STT on the raw
    // text rather than on the polished text.
    let stt_text = match &polish {
        Some(p) => p.raw_transcript,
        None => final_transcript,
    };

    let mut total = stt_cost_usd(duration_ms, stt_text);
    if let Some(p) = polish {
        total += polish_cost_usd(p.system_prompt, p.raw_transcript, p.polished);
    }
    (total * 10_000.0).round() / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_tokens_round_seconds_up() {
        // 25 tokens/sec, and a partial second still counts.
        assert_eq!(audio_tokens(1_000), 25.0);
        assert_eq!(audio_tokens(1_001), 50.0);
        assert_eq!(audio_tokens(4_000), 100.0);
        assert_eq!(audio_tokens(60_000), 1_500.0);
    }

    #[test]
    fn zero_duration_costs_nothing_for_audio() {
        assert_eq!(audio_tokens(0), 0.0);
    }

    #[test]
    fn empty_text_has_no_tokens() {
        assert_eq!(estimate_text_tokens(""), 0.0);
        assert_eq!(estimate_text_tokens("   "), 0.0);
    }

    #[test]
    fn text_tokens_scale_with_word_count() {
        // 3 words / 0.75 = 4 tokens.
        assert!((estimate_text_tokens("one two three") - 4.0).abs() < 1e-9);
    }

    #[test]
    fn one_minute_of_audio_matches_googles_published_input_rate() {
        // 60s * 25 tokens = 1500 tokens * $3.50/1M = $0.00525/min,
        // which is what Google rounds to "$0.005/min".
        let input_only = audio_tokens(60_000) * STT_INPUT_USD_PER_TOKEN;
        assert!((input_only - 0.00525).abs() < 1e-9, "got {input_only}");
    }

    #[test]
    fn blended_minute_lands_near_googles_published_figure() {
        // Google states ~$0.009/min blended on a basis of ~175 text
        // tokens per minute of output. 175 tokens is ~131 words.
        let words = vec!["word"; 131].join(" ");
        let cost = stt_cost_usd(60_000, &words);
        assert!(
            (0.008..=0.010).contains(&cost),
            "expected roughly $0.009/min, got {cost}"
        );
    }

    #[test]
    fn transcribe_live_is_cheaper_than_chirp_was() {
        // Chirp: ceil(60/15) = 4 increments * $0.004 = $0.016/min.
        let chirp_per_minute = 4.0 * 0.004;
        let words = vec!["word"; 131].join(" ");
        assert!(stt_cost_usd(60_000, &words) < chirp_per_minute);
    }

    #[test]
    fn a_short_dictation_costs_a_hand_checkable_amount() {
        // 4s of audio, 8 words out.
        // audio: ceil(4) * 25 = 100 tokens * 3.50e-6 = 0.00035
        // text:  8 / 0.75 = 10.6667 tokens * 21e-6   = 0.000224
        // total ≈ 0.000574
        let transcript = "one two three four five six seven eight";
        let cost = stt_cost_usd(4_000, transcript);
        assert!((cost - 0.000574).abs() < 1e-6, "got {cost}");
    }

    #[test]
    fn tiers_one_and_two_make_no_polish_call() {
        let with_none = session_cost_usd(4_000, "hello there", None);
        let stt_only = stt_cost_usd(4_000, "hello there");
        assert_eq!(with_none, (stt_only * 10_000.0).round() / 10_000.0);
    }

    #[test]
    fn tier_three_costs_more_than_the_stt_call_alone() {
        // A realistic v10 mode prompt is long, so the polish input is
        // dominated by it.
        let prompt = vec!["rule"; 200].join(" ");
        let raw = "um so i think we should ship it";
        let polished = "I think we should ship it.";
        let tier3 = session_cost_usd(
            4_000,
            polished,
            Some(PolishUsage {
                system_prompt: &prompt,
                raw_transcript: raw,
                polished,
            }),
        );
        let tier2 = session_cost_usd(4_000, raw, None);
        assert!(tier3 > tier2, "tier3 {tier3} should exceed tier2 {tier2}");
    }

    #[test]
    fn stt_is_billed_on_the_raw_transcript_not_the_polished_one() {
        // Polish can shorten text a lot. STT output tokens must reflect
        // what the STT model actually emitted.
        let raw = vec!["word"; 100].join(" ");
        let polished = "short";
        let with_polish = session_cost_usd(
            4_000,
            polished,
            Some(PolishUsage {
                system_prompt: "",
                raw_transcript: &raw,
                polished,
            }),
        );
        let as_if_polished_were_stt_output = session_cost_usd(4_000, polished, None);
        assert!(with_polish > as_if_polished_were_stt_output);
    }

    #[test]
    fn result_is_rounded_to_four_decimals() {
        let cost = session_cost_usd(4_000, "hello", None);
        assert_eq!(cost, (cost * 10_000.0).round() / 10_000.0);
    }
}
