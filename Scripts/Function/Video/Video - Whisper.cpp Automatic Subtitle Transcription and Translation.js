/**
 * @name Video - Whisper.cpp Automatic Subtitle Transcription and Translation
 * @uid 1d1d3c0d-6e6b-4a34-bf2a-ffb9b5d6f1ae
 * @description Transcribes each audio track with whisper-cli into language-tagged SRT files, with optional translation and flexible subtitle placement.
 * @author OpenAI-Assistant
 * @revision 6
 * @output Subtitles created
 * @output No audio tracks found
 * @param {string} SubtitleLanguages Languages to process/translate (comma or space separated ISO 639-1/639-2 codes; leave blank to skip translation and include all).
 * @param {bool} DeleteOriginalAfterTranslation Delete the original-language subtitle when a translation is produced (default: false).
 * @param {('OrgDir'|'WorkingDir')} SubtitleSaveDir Directory to save subtitles to. OrgDir - Original Directory. WorkingDir - Fileflows working directory. Default: OrgDir.
 */
function Script(SubtitleLanguages, DeleteOriginalAfterTranslation, SubtitleSaveDir) {
    const vi = Variables.vi?.VideoInfo;
    const filePath = Variables.file?.FullName;

    if (!vi || !filePath) {
        Logger.ELog('[whisper-sub] Missing video info or working file.');
        return -1;
    }

    const audioStreams = vi.AudioStreams;
    if (!audioStreams || audioStreams.length === 0) {
        Logger.WLog('[whisper-sub] No audio streams available.');
        return 2;
    }

    const parseBoolean = (value, fallback = false) => {
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized))
                return true;
            if (['0', 'false', 'no', 'off', 'disabled', ''].includes(normalized))
                return false;
        }
        return typeof value === 'boolean' ? value : !!value || fallback;
    };

    const deleteOriginal = parseBoolean(typeof Variables['DeleteOriginalAfterTranslation'] !== 'undefined' ? Variables['DeleteOriginalAfterTranslation'] : DeleteOriginalAfterTranslation, false);

    const saveDirRaw = (typeof Variables['SubtitleSaveDir'] !== 'undefined' ? Variables['SubtitleSaveDir'] : SubtitleSaveDir || 'OrgDir').toString().trim();
    const saveDirNormalized = saveDirRaw.toLowerCase();
    const saveLocation = saveDirNormalized === 'workingdir' ? 'WorkingDir' : 'OrgDir';

    const languageListRaw = (typeof Variables['SubtitleLanguages'] !== 'undefined' ? Variables['SubtitleLanguages'] : SubtitleLanguages || '').toString();
    const languageTokens = languageListRaw.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    const languageFilter = new Set();
    for (let i = 0; i < languageTokens.length; i++) {
        const token = languageTokens[i].toLowerCase();
        const iso1 = LanguageHelper?.GetIso1Code?.(token) || '';
        const iso2 = LanguageHelper?.GetIso2Code?.(token) || '';
        languageFilter.add((iso1 || iso2 || token).toLowerCase());
    }

    const translate = languageFilter.size > 0;

    const normalizeLanguage = (value) => {
        const trimmed = (value || '').trim();
        if (!trimmed)
            return '';
        const iso1 = LanguageHelper?.GetIso1Code?.(trimmed) || '';
        const iso2 = LanguageHelper?.GetIso2Code?.(trimmed) || '';
        return (iso1 || iso2 || trimmed).toLowerCase();
    };

    const commonPath = ((Variables.common || System.Environment.GetEnvironmentVariable('common') || '/app/common').toString().trim() || '/app/common').replace(/[\\/]+$/, '');
    const ffmpegOverride = (Variables['ffmpeg8'] || '').toString().trim();
    const defaultFfmpeg = System.IO.Path.Combine(commonPath, 'ffmpeg-static', 'ffmpeg');
    const legacyFfmpeg = System.IO.Path.Combine(commonPath, 'ffmpeg-static', 'FFMPEG');
    let ffmpeg = Flow.GetToolPath('ffmpeg');

    if (ffmpegOverride && System.IO.File.Exists(ffmpegOverride)) {
        ffmpeg = ffmpegOverride;
    } else if (!ffmpeg || !System.IO.File.Exists(ffmpeg)) {
        if (System.IO.File.Exists(defaultFfmpeg)) {
            ffmpeg = defaultFfmpeg;
        } else if (System.IO.File.Exists(legacyFfmpeg)) {
            ffmpeg = legacyFfmpeg;
        }
    }

    if (!ffmpeg || !System.IO.File.Exists(ffmpeg)) {
        const missingMsg = "Please install DockerMod FFmpeg Fileflows Edition or BbtN FFmpeg static build, and set variable 'ffmpeg8'.";
        Logger.ELog(`[whisper-sub] ${missingMsg}`);
        Flow.Fail(missingMsg);
        return -1;
    }

    const isDocker = System.IO.File.Exists('/.dockerenv');
    const platform = System.Environment.OSVersion?.Platform?.toString?.() || '';
    const isWindows = platform === 'Win32NT' || platform === 'Win32Windows';

    const whisperOverride = (Variables['whisper'] || '').toString().trim();
    const modelOverride = (Variables['whisper-model'] || '').toString().trim();
    const vadOverride = (Variables['whisper-vad'] || '').toString().trim();

    const whisperCli = whisperOverride || Flow.GetToolPath('whisper-cli') || Flow.GetToolPath('whisper') || '/app/common/whispercpp/bin/whisper-cli';
    const modelPath = modelOverride || '/app/common/whispercpp/models/model.bin';
    const vadPath = vadOverride || '/app/common/whispercpp/models/vad-model.bin';

    const missing = [];
    if (!System.IO.File.Exists(whisperCli))
        missing.push(`binary at '${whisperCli}'`);
    if (!System.IO.File.Exists(modelPath))
        missing.push(`model at '${modelPath}'`);

    if (missing.length > 0) {
        Logger.ELog(`[whisper-sub] Whisper.cpp requirement missing: ${missing.join(' and ')}.`);
        if (isWindows) {
            Logger.ELog("[whisper-sub] Install whisper.cpp from https://github.com/ggml-org/whisper.cpp/releases/ and download models from https://huggingface.co/ggerganov/whisper.cpp/tree/main, then set 'whisper' (binary) and 'whisper-model' (model) variables in this node's settings or install the Whisper.cpp DockerMod and model DockerMods.");
        } else if (isDocker) {
            Logger.ELog("[whisper-sub] Install the Whisper.cpp DockerMod to provision the binary and /app/common/whispercpp/models/model.bin symlink. You can also install the 'Whisper.cpp - Medium Model & Solera VAD' DockerMod for additional models.");
        } else {
            Logger.ELog("[whisper-sub] Install whisper.cpp from https://github.com/ggml-org/whisper.cpp and download models from https://huggingface.co/ggerganov/whisper.cpp/tree/main, then set 'whisper' (binary) and 'whisper-model' (model) variables in this node's settings or install the Whisper.cpp DockerMod and model DockerMods.");
        }
        return Flow.Fail('Whisper.cpp and/or model missing, please install and set variables');
    }

    let hasVad = false;
    if (System.IO.File.Exists(vadPath)) {
        hasVad = true;
    } else {
        Logger.WLog("[whisper-sub] VAD Model missing and highly recommended. Download from https://huggingface.co/ggml-org/whisper-vad/tree/main and add variable 'whisper-vad'");
    }

    const workingDir = Flow.TempPath || System.IO.Path.GetTempPath();
    const originalDir = System.IO.Path.GetDirectoryName(filePath);
    const targetDir = saveLocation === 'WorkingDir' ? workingDir : originalDir;
    const baseName = System.IO.Path.GetFileNameWithoutExtension(filePath);

    const processedLanguages = new Set();
    let created = false;

    const extractAudio = (trackIndex, outputPath) => {
        if (System.IO.File.Exists(outputPath))
            System.IO.File.Delete(outputPath);

        const args = [
            '-hide_banner', '-y',
            '-i', filePath,
            '-map', `0:a:${trackIndex}`,
            '-vn', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000',
            outputPath
        ];

        const extract = Flow.Execute({ command: ffmpeg, argumentList: args, logOutput: false });
        if (extract.exitCode !== 0) {
            Logger.WLog(`[whisper-sub] Failed to extract audio track ${trackIndex}: ${extract.output}`);
            return false;
        }
        return true;
    };

    const runWhisper = (audioPath, baseOutput, language, translateFlag) => {
        const args = [
            '--model', modelPath,
            '--file', audioPath,
            '--language', language || 'auto',
            '--output-srt', 'true',
            '--output-file', baseOutput
        ];

        if (translateFlag)
            args.push('--translate');
        if (hasVad) {
            args.push('--vad', 'true');
            args.push('--vad-model', vadPath);
        }

        const process = Flow.Execute({ command: whisperCli, argumentList: args, logOutput: false });
        return process;
    };

    for (let i = 0; i < audioStreams.length; i++) {
        const audio = audioStreams[i];
        if (!audio || audio.Deleted)
            continue;

        const description = (audio.Description || '').toString().toLowerCase();
        if (description.includes('commentary')) {
            Logger.ILog(`[whisper-sub] Skipping track ${i} because it is commentary.`);
            continue;
        }

        const langMeta = normalizeLanguage(audio.Language);

        if (langMeta && processedLanguages.has(langMeta)) {
            Logger.ILog(`[whisper-sub] Skipping track ${i} because language '${langMeta}' was already processed.`);
            continue;
        }

        const audioSample = System.IO.Path.Combine(workingDir, `whisper_sub_track_${i}.wav`);
        if (!extractAudio(i, audioSample))
            return Flow.Fail('Whisper Execution Failed');

        const tempBase = System.IO.Path.Combine(workingDir, `whisper_sub_track_${i}`);
        const process = runWhisper(audioSample, tempBase, langMeta || 'auto', false);

        if (process.exitCode !== 0) {
            Logger.WLog(`[whisper-sub] whisper-cli failed for track ${i}: ${process.output}`);
            return Flow.Fail('Whisper Execution Failed');
        }

        const combinedOutput = [process.output, process.standardOutput, process.standardError].filter(Boolean).join('\n');
        const match = combinedOutput.match(/auto-detected language:\s*([a-zA-Z-]+)/i);
        const detected = normalizeLanguage(match ? match[1] : '') || langMeta || 'auto';

        const srtPathTemp = `${tempBase}.srt`;
        if (!System.IO.File.Exists(srtPathTemp)) {
            Logger.WLog(`[whisper-sub] Expected subtitle not found for track ${i} at ${srtPathTemp}.`);
            return Flow.Fail('Whisper Execution Failed');
        }

        const langForName = detected === 'auto' ? (langMeta || 'und') : detected;

        if (processedLanguages.has(langForName)) {
            Logger.ILog(`[whisper-sub] Skipping track ${i} because detected language '${langForName}' was already processed.`);
            if (System.IO.File.Exists(srtPathTemp))
                System.IO.File.Delete(srtPathTemp);
            continue;
        }
        const targetBase = System.IO.Path.Combine(targetDir, `${baseName}.${langForName}`);
        const targetSrt = `${targetBase}.srt`;

        try {
            if (System.IO.File.Exists(targetSrt))
                System.IO.File.Delete(targetSrt);
            System.IO.File.Move(srtPathTemp, targetSrt);
        } catch (err) {
            Logger.WLog(`[whisper-sub] Failed to move subtitle for track ${i} to ${targetSrt}: ${err}`);
            return Flow.Fail('Whisper Execution Failed');
        }

        created = true;
        processedLanguages.add(langForName);
        Logger.ILog(`[whisper-sub] Created subtitle for track ${i} -> ${targetSrt}.`);

        const translateThisTrack = translate && languageFilter.has(langForName);

        if (translateThisTrack) {
            const translateBase = System.IO.Path.Combine(targetDir, `${baseName}.en`);
            const translateProcess = runWhisper(audioSample, translateBase, detected === 'auto' ? 'auto' : detected, true);
            if (translateProcess.exitCode !== 0) {
                Logger.WLog(`[whisper-sub] Translation failed for track ${i}: ${translateProcess.output}`);
                return Flow.Fail('Whisper Execution Failed');
            }

            const translatedSrt = `${translateBase}.srt`;
            if (!System.IO.File.Exists(translatedSrt)) {
                Logger.WLog(`[whisper-sub] Expected translated subtitle not found for track ${i} at ${translatedSrt}.`);
                return Flow.Fail('Whisper Execution Failed');
            }

            Logger.ILog(`[whisper-sub] Created translated subtitle for track ${i} -> ${translatedSrt}.`);

            if (deleteOriginal) {
                try {
                    if (System.IO.File.Exists(targetSrt))
                        System.IO.File.Delete(targetSrt);
                    Logger.ILog(`[whisper-sub] Deleted original-language subtitle for track ${i} after translation.`);
                } catch (err) {
                    Logger.WLog(`[whisper-sub] Failed to delete original subtitle for track ${i}: ${err}`);
                }
            }
        }
    }

    if (!created) {
        Logger.WLog('[whisper-sub] No subtitles were created.');
        return 2;
    }

    return 1;
}
