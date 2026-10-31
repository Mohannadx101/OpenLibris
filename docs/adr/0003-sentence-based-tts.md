# 0003 — Drive text-to-speech one sentence at a time

Status: accepted

## Context

Requirements: adjustable speed, voice selection, pause/resume, and highlighting of the sentence being read. Chromium's `speechSynthesis.pause()`/`resume()` is unreliable, and word `boundary` events differ between operating systems and voices.

## Decision

The app owns the queue. Text is split into sentences with `Intl.Segmenter`; each sentence is spoken as its own utterance with a known text range. We highlight on the utterance's `start` event. Pause means cancel and remember the sentence index; resume re-speaks that sentence. Rate changes apply from the next sentence.

The engine sits behind a `TtsEngine` interface (initially the Web Speech API) so an offline neural engine can be added without touching the reader.

## Consequences

- Highlighting and pause/resume do not depend on engine events that vary by platform.
- Resuming repeats the interrupted sentence rather than continuing mid-word. For reading aloud this is natural and arguably better.
- A short gap between sentences is possible. Queuing the next utterance before the current one ends may reduce it; to be evaluated in Phase 8.
- Sentence-level (not word-level) highlighting is the granularity we commit to.
