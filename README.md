# Halloween porch ghost

A Bun app for a Mac by the door. It listens for a trick-or-treater, looks at one webcam frame, and answers in a ghost voice. Audio and photos stay in memory. A wav file exists only while the reply is playing, then it is deleted.

Motors for a mouth or eyes are not part of this version.

## Setup

Install the system tools:

```bash
brew install ffmpeg whisper-cpp ollama
```

Install JavaScript dependencies:

```bash
bun install
```

Download the English whisper model (about 500 MB) into `models/`:

```bash
mkdir -p models
curl -L -o models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

Start Ollama and pull the glance model and the reply model:

```bash
brew services start ollama
ollama pull qwen2.5vl:3b
ollama pull qwen2.5:7b
```

Glances use the vision model. Replies use the text model. The first launch also downloads the Kokoro voice (once, then cached). Later nights can run offline as long as Ollama and those models are already on the machine. Whisper stays loaded while the app is running.

macOS will ask for Camera and Microphone permission for the terminal you run this from. Allow both.

## Devices

```bash
bun run devices
```

Put a device name or its bracketed index into `config.json` as `cameraDevice` and `micDevice`. Names are steadier: indexes shift when another device appears. The checked-in config uses this Mac's FaceTime camera and built-in microphone.

If the camera opens and immediately fails, change `cameraPixelFormat`. This Mac's FaceTime camera needs `uyvy422`. `nv12` is the other format to try.

## Run

Check the whole path once. This opens the camera and microphone, transcribes a test phrase, asks for a reply, and plays it:

```bash
bun run check
```

Then leave it running:

```bash
bun run start
```

Talk to the webcam indoors before moving the Mac to the door. The terminal prints `listening`, `thinking`, `heard: ...`, and `speaking: ...`. A background glance checks the camera about every five seconds and logs `glance: ...`. Listening logs what people say. The speaker reads the last few seen, heard, and said lines, answers the latest thing it heard, and does not work through a backlog. Speech during a reply is remembered for next time (`noted`) and is not answered on its own. If the camera is not allowed yet, it keeps listening and skips costume comments.

Every few seconds it prints a mic level. Quiet room level should sit below `levelThreshold`, and a normal speaking voice should sit above it. Raise the threshold if wind or the street keeps waking it. Lower it if the ghost ignores people.

`character` in `config.json` picks who is on the porch: `ghost`, `scientist`, or `witch`. A character is a voice, delay phrases, and a role in `prompts/`.

The porch light needs to be on, or the photo is useless. Aim the speaker toward the walk and keep the mic off to the side of the speaker. While the ghost is thinking or talking, microphone samples are discarded, plus a short tail after playback, so it does not answer itself or work through a backlog. Speech that arrives during a reply is ignored.

## Config

`config.json` holds the character, device indexes, the Ollama models, silence timing, and the level threshold. Replies are one short sentence, spoken as soon as that sentence is ready. The speaker remembers the last 50 events: glances, what was heard, and what it said.
