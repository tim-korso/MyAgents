//! Canonical PCM range at the decoder → inference boundary.

use zeroize::Zeroize;

/// Lossy float decoding and sinc resampling can overshoot full scale for valid
/// audio. Match the live PCM16 path before passing samples to the native ABI.
/// Non-finite values remain a decoding failure, never silent audio.
pub(crate) fn normalize_pcm(samples: &mut [f32]) -> Result<(), ()> {
    if samples.iter().any(|sample| !sample.is_finite()) {
        samples.zeroize();
        return Err(());
    }
    for sample in samples {
        *sample = sample.clamp(-1.0, 1.0);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_in_range_audio_and_rejects_non_finite_samples() {
        let mut samples = [-1.2, -0.5, 0.0, 0.75, 1.1];
        normalize_pcm(&mut samples).unwrap();
        assert_eq!(samples, [-1.0, -0.5, 0.0, 0.75, 1.0]);
        for invalid in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut samples = [0.5, invalid];
            assert!(normalize_pcm(&mut samples).is_err());
            assert_eq!(samples, [0.0, 0.0]);
        }
    }
}
