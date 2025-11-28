/**
 * @name Video - faster-whisper Audio Track Language Code Fix
 * @uid 1a6d8f4b-1fcd-4db1-b534-44a3d4f72e5b
 * @description Samples each audio track and uses faster-whisper (distil-large-v3) to populate and standardize ISO 639-3 language codes.
 * @author OpenAI-Assistant
 * @revision 1
 * @param {string} device Device to run faster-whisper on (e.g. cpu, cuda, auto). Leave blank to default to cpu.
 * @param {string} compute_type Compute type for faster-whisper (e.g. int8, float16). Leave blank to default to int8.
 * @output Languages updated
 * @output No update required
 */
function Script(device, compute_type) {
    const ffModel = Variables.FfmpegBuilderModel;
    const vi = Variables.vi?.VideoInfo;

    if (!ffModel) {
        Logger.ELog('[faster-whisper] FFMPEG Builder model not found; cannot update languages.');
        return -1;
    }

    if (!vi || !vi.AudioStreams?.length) {
        Logger.WLog('[faster-whisper] No video info or audio streams available.');
        return 2;
    }

    const ffmpeg = Flow.GetToolPath('ffmpeg');
    if (!ffmpeg) {
        Logger.ELog('[faster-whisper] FFmpeg not found.');
        return -1;
    }

    const resolvedDevice = (device && device.trim().length > 0) ? device.trim() : 'cpu';
    const resolvedCompute = (compute_type && compute_type.trim().length > 0) ? compute_type.trim() : 'int8';
    const modelDir = '/app/data/faster-whisper/models/distil-large-v3';

    Logger.ILog(`[faster-whisper] Using device='${resolvedDevice}' compute_type='${resolvedCompute}'.`);
    Logger.ILog(`[faster-whisper] Model directory: ${modelDir}`);

    let durationSeconds = vi?.Duration?.TotalSeconds;
    if (!durationSeconds && vi.VideoStreams?.length) {
        durationSeconds = vi.VideoStreams[0]?.Duration?.TotalSeconds;
    }

    if (!durationSeconds) {
        Logger.WLog('[faster-whisper] Unable to determine duration; defaulting to 10 minute sample from start.');
        durationSeconds = 600;
    }

    let sampleStart = 0;
    let sampleLength = durationSeconds;

    if (durationSeconds >= 1800) {
        sampleStart = 600;
        sampleLength = Math.max(60, Math.min(600, durationSeconds - sampleStart));
    } else if (durationSeconds >= 300) {
        sampleStart = 300;
        sampleLength = Math.max(60, Math.min(300, durationSeconds - sampleStart));
    } else {
        sampleStart = 0;
        sampleLength = durationSeconds;
    }

    Logger.ILog(`[faster-whisper] Sampling from ${sampleStart}s for ${sampleLength}s (video length ${durationSeconds}s).`);

    const workingDir = Flow.TempPath || System.IO.Path.GetTempPath();
    const pythonScript = [
        'import json, os, sys',
        'from faster_whisper import WhisperModel',
        'audio_path = sys.argv[1]',
        'model_dir = sys.argv[2]',
        'device = sys.argv[3] or "cpu"',
        'compute_type = sys.argv[4] or "int8"',
        'print(f"[python faster-whisper] loading model {model_dir} on {device} ({compute_type})")',
        'model = WhisperModel(model_dir, device=device, compute_type=compute_type)',
        'segments, info = model.transcribe(audio_path, without_timestamps=True, vad_filter=False, beam_size=5)',
        'print(json.dumps({"language": info.language, "language_probability": info.language_probability}))'
    ].join('\n');

    let updated = false;

    for (let i = 0; i < vi.AudioStreams.length; i++) {
        let audio = vi.AudioStreams[i];
        if (audio?.Deleted) {
            Logger.ILog(`[faster-whisper] Skipping deleted audio track index ${i}.`);
            continue;
        }

        let builderAudio = ffModel.AudioStreams?.[i];
        if (!builderAudio) {
            Logger.WLog(`[faster-whisper] No builder audio stream for index ${i}; skipping.`);
            continue;
        }

        const originalFfLang = (builderAudio.Language || '').trim();
        const originalViLang = (audio.Language || '').trim();
        const normalizedFfLang = LanguageHelper.GetIso3Code(originalFfLang) || LanguageHelper.GetIso2Code(originalFfLang) || '';
        const normalizedViLang = LanguageHelper.GetIso3Code(originalViLang) || LanguageHelper.GetIso2Code(originalViLang) || '';
        const hadLanguage = normalizedFfLang.length > 0 || normalizedViLang.length > 0;

        if (hadLanguage) {
            const compareFf = normalizedFfLang || 'und';
            const compareVi = normalizedViLang || 'und';
            if (compareFf === compareVi && compareFf !== 'und') {
                Logger.ILog(`[faster-whisper] Audio track ${i} has matching language '${compareFf}' in builder/video info; verifying with detection and normalizing to ISO 639-3.`);
            } else {
                Logger.ILog(`[faster-whisper] Audio track ${i} existing languages -> builder: '${originalFfLang || 'missing'}' (norm: '${compareFf}'), video: '${originalViLang || 'missing'}' (norm: '${compareVi}'). Running detection to confirm or correct.`);
            }
        } else {
            Logger.ILog(`[faster-whisper] Audio track ${i} missing language codes in builder/video info; running detection.`);
        }

        const sampleFile = System.IO.Path.Combine(workingDir, `fw_track_${i}.wav`);
        if (System.IO.File.Exists(sampleFile)) {
            System.IO.File.Delete(sampleFile);
        }

        Logger.ILog(`[faster-whisper] Extracting sample for audio track ${i} to ${sampleFile}.`);

        let argsList = ['-hide_banner', '-y', '-ss', sampleStart.toFixed(2), '-i', Variables.file.FullName, '-map', `0:a:${i}`, '-t', sampleLength.toFixed(2), '-vn', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', sampleFile];
        let extract = Flow.Execute({
            command: ffmpeg,
            argumentList: argsList,
            logOutput: true
        });

        if (extract.exitCode !== 0) {
            Logger.WLog(`[faster-whisper] Failed to extract audio track ${i}: ${extract.output}`);
            continue;
        }

        Logger.ILog(`[faster-whisper] Running faster-whisper on track ${i}.`);
        let process = Flow.Execute({
            command: 'python3',
            argumentList: ['-c', pythonScript, sampleFile, modelDir, resolvedDevice, resolvedCompute],
            logOutput: true
        });

        if (process.exitCode !== 0) {
            Logger.WLog(`[faster-whisper] faster-whisper failed for track ${i}: ${process.output}`);
            continue;
        }

        let languageResult = null;
        let lines = (process.output || '').split(/\r?\n/).reverse();
        for (let line of lines) {
            try {
                let parsed = JSON.parse(line);
                if (parsed?.language) {
                    languageResult = parsed;
                    break;
                }
            } catch (err) {
                continue;
            }
        }

        if (!languageResult) {
            Logger.WLog(`[faster-whisper] Could not parse language output for track ${i}.`);
            continue;
        }

        const iso3 = LanguageHelper.GetIso3Code(languageResult.language) || LanguageHelper.GetIso2Code(languageResult.language) || languageResult.language;
        if (!iso3) {
            Logger.WLog(`[faster-whisper] Unable to normalize language '${languageResult.language}' for track ${i}.`);
            continue;
        }

        const normalizedDetected = iso3;
        const previous = normalizedFfLang || normalizedViLang || 'missing';
        if (previous !== 'missing' && previous === normalizedDetected) {
            Logger.ILog(`[faster-whisper] Detected language '${normalizedDetected}' matches existing language for track ${i}.`);
        } else if (previous !== 'missing' && previous !== normalizedDetected) {
            Logger.WLog(`[faster-whisper] Detected language '${normalizedDetected}' differs from existing '${previous}' for track ${i}; updating to detected value.`);
        } else {
            Logger.ILog(`[faster-whisper] No previous language for track ${i}; setting to detected '${normalizedDetected}'.`);
        }

        builderAudio.Language = normalizedDetected;
        audio.Language = normalizedDetected;
        ffModel.ForceEncode = true;
        updated = true;
        Logger.ILog(`[faster-whisper] Set language for track ${i} to '${normalizedDetected}' (p=${languageResult.language_probability}).`);
    }

    return updated ? 1 : 2;
}
