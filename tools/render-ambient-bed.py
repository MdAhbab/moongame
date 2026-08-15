#!/usr/bin/env python3
"""
Renders `public/audio/ambient-{stem}.{opus,m4a}` — the game's audio stems.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np

SAMPLE_RATE = 48_000
LOOP_SECONDS = 60
FRAMES = SAMPLE_RATE * LOOP_SECONDS

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "audio"

def bin_for(hz: float) -> int:
    return int(round(hz * LOOP_SECONDS))

def spectrum(rng: np.random.Generator, stem: str) -> np.ndarray:
    bins = FRAMES // 2 + 1
    spec = np.zeros(bins, dtype=np.complex128)
    freqs = np.arange(bins) / LOOP_SECONDS

    if stem == "bed":
        partials = [
            (55.0, 1.00),    # A1
            (82.5, 0.42),    # E2, the fifth
            (110.0, 0.30),   # A2
            (164.99, 0.11),  # E3
            (220.0, 0.07),   # A3
            (330.0, 0.03),
        ]
        for hz, amplitude in partials:
            centre = bin_for(hz)
            for offset, weight in ((-1, 0.5), (0, 1.0), (1, 0.5)):
                k = centre + offset
                if 0 < k < bins:
                    spec[k] += amplitude * weight * np.exp(2j * np.pi * rng.random())

        low, high = bin_for(70), bin_for(9_000)
        band = np.arange(low, min(high, bins))
        envelope = (freqs[band] / 70.0) ** -1.35
        envelope *= np.exp(-freqs[band] / 5_500.0)
        phases = np.exp(2j * np.pi * rng.random(band.size))
        spec[band] += 0.055 * envelope * phases

        lift = np.arange(bin_for(700), bin_for(2_400))
        spec[lift] *= 1.25

    elif stem == "tension":
        # slow pulse, a fifth above
        partials = [
            (82.5, 0.8),    # E2
            (164.99, 0.5),  # E3
            (329.63, 0.2),  # E4
        ]
        for hz, amplitude in partials:
            centre = bin_for(hz)
            for offset, weight in ((-1, 0.5), (0, 1.0), (1, 0.5)):
                k = centre + offset
                if 0 < k < bins:
                    spec[k] += amplitude * weight * np.exp(2j * np.pi * rng.random())
                    
    elif stem == "combat":
        # rhythmic low element
        partials = [
            (27.5, 1.0),    # A0
            (55.0, 0.8),    # A1
            (110.0, 0.3),   # A2
        ]
        for hz, amplitude in partials:
            centre = bin_for(hz)
            for offset, weight in ((-1, 0.5), (0, 1.0), (1, 0.5)):
                k = centre + offset
                if 0 < k < bins:
                    spec[k] += amplitude * weight * np.exp(2j * np.pi * rng.random())

    elif stem == "alarm":
        # dissonant high element
        partials = [
            (440.0, 0.5),   # A4
            (466.16, 0.5),  # Bb4 (minor second)
            (622.25, 0.4),  # Eb5 (tritone)
        ]
        for hz, amplitude in partials:
            centre = bin_for(hz)
            for offset, weight in ((-1, 0.5), (0, 1.0), (1, 0.5)):
                k = centre + offset
                if 0 < k < bins:
                    spec[k] += amplitude * weight * np.exp(2j * np.pi * rng.random())

    spec[0] = 0.0  # no DC
    return spec

def render(stem: str) -> np.ndarray:
    channels = []
    # Use stem hash so each stem sounds different but deterministic
    seed_offset = sum(ord(c) for c in stem)
    for channel in range(2):
        rng = np.random.default_rng(0x4D4152 + channel + seed_offset)
        signal = np.fft.irfft(spectrum(rng, stem), n=FRAMES)
        channels.append(signal)

    audio = np.stack(channels, axis=1)
    t = np.arange(FRAMES) / SAMPLE_RATE

    if stem == "bed":
        breath = (
            1.0
            + 0.13 * np.sin(2 * np.pi * t / 20.0)
            + 0.07 * np.sin(2 * np.pi * t / 12.0 + 1.1)
        )
        audio *= breath[:, None]
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio *= 10 ** (-20 / 20) / peak
            
    elif stem == "tension":
        # Slow pulse (4 seconds period = 0.25 Hz)
        pulse = 0.5 + 0.5 * np.sin(2 * np.pi * t * 0.25)
        audio *= pulse[:, None]
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio *= 10 ** (-20 / 20) / peak

    elif stem == "combat":
        # Rhythmic pulse (4 Hz)
        pulse = 0.3 + 0.7 * (np.sin(2 * np.pi * t * 4.0) > 0.0)
        # Smoothing
        pulse = np.convolve(pulse, np.ones(1000)/1000, mode='same')
        audio *= pulse[:, None]
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio *= 10 ** (-18 / 20) / peak

    elif stem == "alarm":
        # Dissonant fast pulse (8 Hz)
        pulse = 0.4 + 0.6 * np.sin(2 * np.pi * t * 8.0)
        audio *= pulse[:, None]
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio *= 10 ** (-18 / 20) / peak

    return audio

def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stems = ["bed", "tension", "combat", "alarm"]
    import wave

    for stem in stems:
        print(f"Rendering {stem}...")
        audio = render(stem)

        master = OUT_DIR / f"ambient-{stem}.wav"
        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
        with wave.open(str(master), "wb") as handle:
            handle.setnchannels(2)
            handle.setsampwidth(2)
            handle.setframerate(SAMPLE_RATE)
            handle.writeframes(pcm.tobytes())

        encodes = [
            (["-c:a", "libopus", "-b:a", "40k", "-vbr", "on", "-application", "audio"], f"ambient-{stem}.opus"),
            (["-c:a", "aac", "-b:a", "40k"], f"ambient-{stem}.m4a"),
        ]
        for args, name in encodes:
            target = OUT_DIR / name
            result = subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(master), *args, str(target)],
                check=False,
            )
            if result.returncode != 0:
                print(f"ffmpeg failed for {name}", file=sys.stderr)
                return 1
            print(f"{name}: {target.stat().st_size / 1024:.0f} KB")

        master.unlink()
        
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
