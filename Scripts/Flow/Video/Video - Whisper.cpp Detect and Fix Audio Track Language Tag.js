/**
 * @name Video - Whisper.cpp Detect and Fix Audio Track Language Tag
 * @uid 08cf6e37-0c77-4c08-b8d3-2794f200882c
 * @description Samples each audio track with whisper-cli to detect the spoken language and normalizes the track language tags (ISO 639-1) without running a full transcription.
 * @author OpenAI-Assistant
 * @revision 9
 * @output Languages updated
 * @output Languages unchanged
 * @output No audio tracks found
 */
function Script() {
    const ffModel = Variables.FfmpegBuilderModel;
    const vi = Variables.vi?.VideoInfo;
    const filePath = Variables.file?.FullName;

    if (!ffModel || !filePath) {
        Logger.ELog('[whisper-cli] Missing FFMPEG Builder model or working file.');
        return -1;
    }

    const audioStreams = vi?.AudioStreams;
    if (!audioStreams || audioStreams.length === 0) {
        Logger.WLog('[whisper-cli] No audio streams available.');
        return 3;
    }

    const isDocker = System.IO.File.Exists('/.dockerenv');
    const platform = System.Environment.OSVersion?.Platform?.toString?.() || '';
    const isWindows = platform === 'Win32NT' || platform === 'Win32Windows';

    const variableWhisper = (Variables['whisper'] || '').toString().trim();
    const variableModel = (Variables['whisper-model'] || '').toString().trim();
    const whisperCli = variableWhisper || Flow.GetToolPath('whisper-cli') || Flow.GetToolPath('whisper') || '/usr/local/bin/whisper-cli';
    const modelPath = variableModel || '/app/data/whispercpp/models/ggml-small.bin';

    const missing = [];
    if (!System.IO.File.Exists(whisperCli))
        missing.push(`binary at '${whisperCli}'`);
    if (!System.IO.File.Exists(modelPath))
        missing.push(`model at '${modelPath}'`);

    if (missing.length > 0) {
        Logger.ELog(`[whisper-cli] Whisper.cpp requirement missing: ${missing.join(' and ')}.`);
        if (isWindows) {
            Logger.ELog("[whisper-cli] Install whisper.cpp from https://github.com/ggml-org/whisper.cpp/releases/ and download models from https://huggingface.co/ggerganov/whisper.cpp/tree/main, then set 'whisper' (binary) and 'whisper-model' (model) variables in this node's settings.");
        } else if (isDocker) {
            Logger.ELog('[whisper-cli] Install the Whisper.cpp DockerMod to provision the binary and model.');
        } else {
            Logger.ELog("[whisper-cli] Install whisper.cpp from https://github.com/ggml-org/whisper.cpp and download models from https://huggingface.co/ggerganov/whisper.cpp/tree/main, then set 'whisper' (binary) and 'whisper-model' (model) variables in this node's settings.");
        }
        return Flow.Fail('Whisper.cpp and/or model missing, please install and set variables');
    }

    const durationSeconds = vi?.Duration?.TotalSeconds || vi?.VideoStreams?.[0]?.Duration?.TotalSeconds || 0;
    const sampleStart = durationSeconds >= 1200 ? 600 : Math.max(0, durationSeconds - 600);
    const sampleLength = Math.min(600, Math.max(60, durationSeconds - sampleStart));

    const workingDir = Flow.TempPath || System.IO.Path.GetTempPath();
    let updated = false;

    const normalizeLanguage = (value) => {
        const trimmed = (value || '').trim();
        if (!trimmed)
            return '';
        const iso1 = LanguageHelper?.GetIso1Code?.(trimmed) || '';
        const iso2 = LanguageHelper?.GetIso2Code?.(trimmed) || '';
        return (iso1 || iso2 || trimmed).toLowerCase();
    };

    for (let i = 0; i < audioStreams.length; i++) {
        const audio = audioStreams[i];
        const builderAudio = ffModel.AudioStreams?.[i];

        if (!audio || audio.Deleted) {
            Logger.ILog(`[whisper-cli] Skipping audio track ${i} (missing or marked deleted).`);
            continue;
        }

        const existingLang = normalizeLanguage(builderAudio?.Language || audio.Language);
        const sampleFile = System.IO.Path.Combine(workingDir, `whispercpp_track_${i}.wav`);
        if (System.IO.File.Exists(sampleFile))
            System.IO.File.Delete(sampleFile);

        Logger.ILog(`[whisper-cli] Extracting 10-minute sample from 10:00 for track ${i} to ${sampleFile}.`);
        const ffmpeg = Flow.GetToolPath('ffmpeg');
        if (!ffmpeg) {
            Logger.ELog('[whisper-cli] ffmpeg not found in PATH.');
            return -1;
        }

        const extractArgs = [
            '-hide_banner', '-y',
            '-ss', sampleStart.toFixed(2),
            '-i', filePath,
            '-map', `0:a:${i}`,
            '-t', sampleLength.toFixed(2),
            '-vn', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000',
            sampleFile
        ];

        const extract = Flow.Execute({ command: ffmpeg, argumentList: extractArgs, logOutput: true });
        if (extract.exitCode !== 0) {
            Logger.WLog(`[whisper-cli] Failed to extract audio track ${i}: ${extract.output}`);
            continue;
        }

        Logger.ILog(`[whisper-cli] Detecting language for track ${i} using whisper-cli (detection only).`);
        const process = Flow.Execute({
            command: whisperCli,
            argumentList: ['-m', modelPath, '-f', sampleFile, '-l', 'auto'],
            logOutput: false
        });

        if (process.exitCode !== 0) {
            Logger.WLog(`[whisper-cli] whisper-cli failed for track ${i}: ${process.output}`);
            continue;
        }

        const match = (process.output || '').match(/auto-detected language:\s*([a-zA-Z-]+)/i);
        const detectedRaw = match ? match[1] : '';
        const detected = normalizeLanguage(detectedRaw);

        if (!detected) {
            Logger.WLog(`[whisper-cli] Could not determine language for track ${i}. Output: ${process.output}`);
            continue;
        }

        if (existingLang === detected) {
            Logger.ILog(`[whisper-cli] Track ${i} language already '${detected}'. No change needed.`);
            continue;
        }

        if (!existingLang) {
            Logger.ILog(`[whisper-cli] Track ${i} language missing; setting to '${detected}'.`);
        } else {
            Logger.WLog(`[whisper-cli] Track ${i} language '${existingLang}' differs from detected '${detected}'; updating.`);
        }

        if (builderAudio)
            builderAudio.Language = detected;
        audio.Language = detected;
        ffModel.ForceEncode = true;
        updated = true;
    }

    if (!updated) {
        Logger.ILog('[whisper-cli] No language changes were required.');
        return 2;
    }

    return 1;
}
