/**
 * @name Video - Whisper.cpp Automatic Subtitle Transcription and Translation
 * @uid 1d1d3c0d-6e6b-4a34-bf2a-ffb9b5d6f1ae
 * @description Transcribes each audio track with whisper-cli into language-tagged SRT files, with optional translation and flexible subtitle placement.
 * @author OpenAI-Assistant
 * @revision 31
 * @output Subtitles created
 * @output No subtitle created
 * @param {bool} TranslateToEnglish Translate generated subtitles to English.
 * @param {bool} SkipOriginalLanguage Skip creating the original-language subtitle when a translation is produced.
 * @param {bool} SkipExistingSubtitles Skip generation if a subtitle for the language already exists (embedded or sidecar).
 * @param {bool} DebugMode Disable quiet whisper-cli output (removes --no-prints).
 * @param {bool} NoGpu Disable GPU acceleration.
 * @param {bool} FixAudioLanguages Update audio track language tags using detected languages before transcription.
 * @param {('OrgDir'|'WorkingDir')} SubtitleSaveDir Directory to save subtitles to. OrgDir - Original Directory. WorkingDir - Fileflows working directory.
 */
function Script(TranslateToEnglish, SkipOriginalLanguage, SkipExistingSubtitles = true, DebugMode, NoGpu, FixAudioLanguages, SubtitleSaveDir) {
    const vi = Variables.vi?.VideoInfo;
    const filePath = Variables.file?.FullName;

    if (!vi || !filePath) {
        Logger.ELog('[whisper-sub] Missing video info or working file.');
        return -1;
    }

    const audioStreams = vi.AudioStreams;
    if (!audioStreams || audioStreams.length === 0) {
        Logger.ELog('[whisper-sub] No audio streams available.');
        Flow.Fail('No audio tracks found');
        return -1;
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

    const translateToEnglish = parseBoolean(typeof Variables['TranslateToEnglish'] !== 'undefined' ? Variables['TranslateToEnglish'] : TranslateToEnglish, false);
    const skipOriginal = parseBoolean(typeof Variables['SkipOriginalLanguage'] !== 'undefined' ? Variables['SkipOriginalLanguage'] : SkipOriginalLanguage, false);
    const keepOriginal = !skipOriginal;
    const skipExistingSubtitles = parseBoolean(typeof Variables['SkipExistingSubtitles'] !== 'undefined' ? Variables['SkipExistingSubtitles'] : SkipExistingSubtitles, true);
    const debugMode = parseBoolean(typeof Variables['DebugMode'] !== 'undefined' ? Variables['DebugMode'] : DebugMode, false);
    const disableGpu = parseBoolean(typeof Variables['NoGpu'] !== 'undefined' ? Variables['NoGpu'] : NoGpu, false);
    const fixAudioLanguages = parseBoolean(typeof Variables['FixAudioLanguages'] !== 'undefined' ? Variables['FixAudioLanguages'] : FixAudioLanguages, false);

    if (!keepOriginal && !translateToEnglish) {
        Logger.ELog('[whisper-sub] Whisper.cpp Aborted - Neither original Language or English translation were selected.');
        return -1;
    }

    const saveDirRaw = (typeof Variables['SubtitleSaveDir'] !== 'undefined' ? Variables['SubtitleSaveDir'] : SubtitleSaveDir || 'OrgDir').toString().trim();
    const saveDirNormalized = saveDirRaw.toLowerCase();
    const saveLocation = saveDirNormalized === 'workingdir' ? 'WorkingDir' : 'OrgDir';

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
    const englishOverride = (Variables['whisper-en-model'] || '').toString().trim();
    const vadOverride = (Variables['whisper-vad'] || '').toString().trim();

    const whisperCandidates = [
        whisperOverride,
        '/usr/local/bin/whisper-cli',
        Flow.GetToolPath('whisper-cli'),
        Flow.GetToolPath('whisper'),
        '/app/common/whispercpp/bin/whisper-cli'
    ];

    const whisperCli = whisperCandidates.find((candidate) => candidate && System.IO.File.Exists(candidate)) || whisperCandidates[whisperCandidates.length - 1];

    const installRoot = '/app/common/whispercpp';
    const modelDir = System.IO.Path.Combine(installRoot, 'models');
    const legacyModelLink = System.IO.Path.Combine(modelDir, 'model.bin');
    const pickFirstExisting = (candidates) => candidates.find((candidate) => candidate && System.IO.File.Exists(candidate)) || '';

    const overrideLower = modelOverride.toLowerCase();
    const multilingualModel = pickFirstExisting([
        modelOverride && !overrideLower.includes('.en.') ? modelOverride : '',
        System.IO.Path.Combine(modelDir, 'ggml-large-v3.bin'),
        System.IO.Path.Combine(modelDir, 'ggml-large.bin'),
        System.IO.Path.Combine(modelDir, 'ggml-medium.bin'),
        System.IO.Path.Combine(modelDir, 'ggml-small.bin'),
        legacyModelLink
    ]);

    const tinyDiarizeEnglishModel = System.IO.Path.Combine(modelDir, 'ggml-small.en-tdrz.bin');

    let englishModel = pickFirstExisting([
        englishOverride,
        modelOverride && overrideLower.includes('.en.') ? modelOverride : '',
        tinyDiarizeEnglishModel,
        System.IO.Path.Combine(modelDir, 'ggml-large-v3.en.bin'),
        System.IO.Path.Combine(modelDir, 'ggml-large.en.bin'),
        System.IO.Path.Combine(modelDir, 'ggml-medium.en.bin'),
        System.IO.Path.Combine(modelDir, 'ggml-small.en.bin')
    ]);

    const hasDedicatedEnglish = !!englishModel;
    if (!englishModel || !System.IO.File.Exists(englishModel))
        englishModel = multilingualModel;

    const vadCandidates = [
        vadOverride,
        System.IO.Path.Combine(modelDir, 'ggml-silero-v6.2.0.bin'),
        System.IO.Path.Combine(modelDir, 'vad-model.bin')
    ];
    const vadPath = pickFirstExisting(vadCandidates);

    const missing = [];
    if (!System.IO.File.Exists(whisperCli))
        missing.push(`binary at '${whisperCli}'`);
    if (!multilingualModel)
        missing.push('multilingual Whisper.cpp model (e.g., ggml-medium.bin or ggml-small.bin)');

    if (missing.length > 0) {
        Logger.ELog(`[whisper-sub] Whisper.cpp requirement missing: ${missing.join(' and ')}.`);
        const installMsg = "Install the Whisper.cpp DockerMod for the binary and small models plus the 'Whisper.cpp - Medium Model & Solera VAD' DockerMod for medium and VAD support, or provide paths via 'whisper' and 'whisper-model' (and optionally 'whisper-en-model').";
        Logger.ELog(`[whisper-sub] ${installMsg}`);
        return Flow.Fail('Whisper.cpp and/or required model missing, please install and set variables');
    }

    if (!hasDedicatedEnglish)
        Logger.WLog('[whisper-sub] English Whisper.cpp model not found; using multilingual model for English audio.');

    let hasVad = false;
    if (System.IO.File.Exists(vadPath)) {
        hasVad = true;
    } else {
        Logger.WLog("[whisper-sub] VAD Model missing and highly recommended. Download from https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin and add variable 'whisper-vad'");
    }

    const workingDir = Flow.TempPath || System.IO.Path.GetTempPath();
    const originalDir = System.IO.Path.GetDirectoryName(filePath);
    const targetDir = saveLocation === 'WorkingDir' ? workingDir : originalDir;
    const baseName = System.IO.Path.GetFileNameWithoutExtension(filePath);

    const processedLanguages = new Set();
    const existingSubtitleLanguages = new Set();
    const ffModel = Variables.FfmpegBuilderModel;

    const subtitleStreams = vi.SubtitleStreams || vi.Subtitles || vi.SubtitleTracks || [];
    if (Array.isArray(subtitleStreams)) {
        for (const sub of subtitleStreams) {
            const lang = normalizeLanguage(sub?.Language || sub?.Lang || '');
            if (lang)
                existingSubtitleLanguages.add(lang);
        }
    }

    try {
        const sidecars = System.IO.Directory.GetFiles(targetDir, `${baseName}*.srt`);
        for (const srtPath of sidecars) {
            const nameWithoutExt = System.IO.Path.GetFileNameWithoutExtension(srtPath);
            if (nameWithoutExt && nameWithoutExt.startsWith(`${baseName}.`)) {
                const langPart = nameWithoutExt.substring(baseName.length + 1);
                const lang = normalizeLanguage(langPart);
                if (lang)
                    existingSubtitleLanguages.add(lang);
            }
        }
    } catch (err) {
        Logger.WLog(`[whisper-sub] Failed to scan existing subtitles: ${err}`);
    }

    const hasExistingSubtitle = (lang) => {
        const normalized = normalizeLanguage(lang);
        if (!normalized)
            return false;
        if (existingSubtitleLanguages.has(normalized))
            return true;
        const sidecarPath = System.IO.Path.Combine(targetDir, `${baseName}.${normalized}.srt`);
        return System.IO.File.Exists(sidecarPath);
    };
    let created = false;

    const durationSeconds = vi?.Duration?.TotalSeconds || vi?.VideoStreams?.[0]?.Duration?.TotalSeconds || 0;
    const sampleStart = durationSeconds >= 600 ? 600 : 0;
    const sampleLength = Math.min(600, Math.max(1, (durationSeconds || 0) - sampleStart || durationSeconds || 600));

    const extractAudioSample = (trackIndex, outputPath) => {
        if (System.IO.File.Exists(outputPath))
            System.IO.File.Delete(outputPath);

        const args = [
            '-hide_banner', '-y',
            '-ss', sampleStart.toFixed(2),
            '-t', sampleLength.toFixed(2),
            '-i', filePath,
            '-map', `0:a:${trackIndex}`,
            '-vn', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000',
            outputPath
        ];

        const extract = Flow.Execute({ command: ffmpeg, argumentList: args, logOutput: false });
        if (extract.exitCode !== 0) {
            Logger.WLog(`[whisper-sub] Failed to extract sample for track ${trackIndex}: ${extract.output}`);
            return false;
        }
        return true;
    };

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

    const detectLanguage = (audioPath, useVad = true) => {
        const args = [
            '--model', multilingualModel,
            '--file', audioPath,
            '--detect-language', 'true',
            '--language', 'auto'
        ];

        if (disableGpu)
            args.push('--no-gpu', 'true');

        if (useVad && hasVad) {
            args.push('--vad', 'true');
            args.push('--vad-model', vadPath);
            args.push('--vad-threshold', '0.7');
        }

        const process = Flow.Execute({ command: whisperCli, argumentList: args, logOutput: false });
        if (process.exitCode !== 0) {
            Logger.WLog(`[whisper-sub] Language detection failed: ${process.output}`);
            return '';
        }

        const combinedOutput = [process.output, process.standardOutput, process.standardError].filter(Boolean).join('\n');
        const match = combinedOutput.match(/auto-detected language:\s*([a-zA-Z-]+)/i);
        return normalizeLanguage(match ? match[1] : '');
    };

    const runWhisper = (audioPath, baseOutput, language, translateFlag, modelToUse, diarizationMode = 'none') => {
        const args = [
            '--model', modelToUse,
            '--file', audioPath,
            '--language', language || 'auto',
            '--output-srt', 'true',
            '--output-file', baseOutput,
            '--max-context', '48',
            '--entropy-thold', '2.8',
            '--freq-thold', '100',
            '--suppress-blank', 'true',
            '--no-speech-thold', '0.6',
            '--print-progress', 'true'
        ];

        if (diarizationMode === 'tinydiarize')
            args.push('--tinydiarize', 'true');

        if (diarizationMode === 'diarize')
            args.push('--diarize', 'true');

        if (disableGpu)
            args.push('--no-gpu', 'true');

        if (!debugMode)
            args.push('--no-prints', 'true');

        if (translateFlag)
            args.push('--translate', 'true');
        if (hasVad) {
            args.push('--vad', 'true');
            args.push('--vad-model', vadPath);
            args.push('--vad-threshold', '0.7');
        }

        const process = Flow.Execute({ command: whisperCli, argumentList: args, logOutput: false });
        return process;
    };

    const detectedLanguages = new Map();

    for (let i = 0; i < audioStreams.length; i++) {
        const audio = audioStreams[i];
        if (!audio || audio.Deleted)
            continue;

        const description = (audio.Description || '').toString().toLowerCase();
        if (description.includes('commentary')) {
            Logger.ILog(`[whisper-sub] Skipping track ${i} because it is commentary.`);
            continue;
        }

        const samplePath = System.IO.Path.Combine(workingDir, `whisper_sub_track_${i}_sample.wav`);
        if (!extractAudioSample(i, samplePath))
            return Flow.Fail('Whisper Execution Failed');

        const detectedFromSample = detectLanguage(samplePath, false);
        if (!detectedFromSample) {
            Logger.WLog(`[whisper-sub] Could not determine language for track ${i} during sample detection.`);
            return Flow.Fail('Whisper Execution Failed');
        }

        if (fixAudioLanguages) {
            const existingLang = normalizeLanguage(audio.Language);
            const builderAudio = ffModel?.AudioStreams?.[i];

            if (existingLang !== detectedFromSample) {
                const changeDescriptor = existingLang ? `differs from detected '${detectedFromSample}'` : 'missing; updating to detected language';
                Logger.WLog(`[whisper-sub] Track ${i} language ${existingLang ? `'${existingLang}' ` : ''}${changeDescriptor}.`);
                if (builderAudio)
                    builderAudio.Language = detectedFromSample;
                audio.Language = detectedFromSample;
                if (ffModel)
                    ffModel.ForceEncode = true;
            } else {
                Logger.ILog(`[whisper-sub] Track ${i} language already set to '${detectedFromSample}'. No change needed.`);
            }
        }

        detectedLanguages.set(i, detectedFromSample);

        try {
            if (System.IO.File.Exists(samplePath))
                System.IO.File.Delete(samplePath);
        } catch { }
    }

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

        const detectedFromAudio = detectedLanguages.get(i) || '';
        const audioSample = System.IO.Path.Combine(workingDir, `whisper_sub_track_${i}.wav`);
        if (!extractAudio(i, audioSample))
            return Flow.Fail('Whisper Execution Failed');

        const detected = detectedFromAudio || langMeta || 'auto';
        let targetSrt = null;

        if (processedLanguages.has(detected)) {
            Logger.ILog(`[whisper-sub] Skipping track ${i} because language '${detected}' was already processed.`);
            continue;
        }

        if (skipExistingSubtitles && hasExistingSubtitle(detected)) {
            Logger.ILog(`[whisper-sub] Skipping track ${i} because subtitles for language '${detected}' already exist.`);
            processedLanguages.add(detected);
            continue;
        }

        if (keepOriginal) {
            const tempBase = System.IO.Path.Combine(workingDir, `whisper_sub_track_${i}`);
            const assumedLanguage = normalizeLanguage(detectedFromAudio || langMeta);
            const transcriptModel = assumedLanguage === 'en' ? englishModel : multilingualModel;
            const diarizationMode = assumedLanguage === 'en' ? 'tinydiarize' : 'diarize';
            const process = runWhisper(audioSample, tempBase, detected || 'auto', false, transcriptModel, diarizationMode);

            if (process.exitCode !== 0) {
                Logger.WLog(`[whisper-sub] whisper-cli failed for track ${i}: ${process.output}`);
                return Flow.Fail('Whisper Execution Failed');
            }

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

            if (skipExistingSubtitles && hasExistingSubtitle(langForName)) {
                Logger.ILog(`[whisper-sub] Skipping creation for track ${i} because subtitles for '${langForName}' already exist.`);
                if (System.IO.File.Exists(srtPathTemp))
                    System.IO.File.Delete(srtPathTemp);
                processedLanguages.add(langForName);
                continue;
            }

            const targetBase = System.IO.Path.Combine(targetDir, `${baseName}.${langForName}`);
            targetSrt = `${targetBase}.srt`;

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
        }

        if (translateToEnglish) {
            const sourceLang = detected !== 'auto' ? detected : (langMeta || 'auto');
            const normalizedSourceLang = normalizeLanguage(sourceLang);

            if (normalizedSourceLang === 'en') {
                Logger.ILog(`[whisper-sub] Skipping translation for track ${i} because language is already English.`);

                if (!keepOriginal) {
                    if (skipExistingSubtitles && hasExistingSubtitle('en')) {
                        Logger.ILog(`[whisper-sub] Skipping English transcription for track ${i} because an English subtitle already exists.`);
                        processedLanguages.add('en');
                        continue;
                    }

                    const englishBase = System.IO.Path.Combine(targetDir, `${baseName}.en`);
                    const englishProcess = runWhisper(audioSample, englishBase, 'en', false, englishModel, 'tinydiarize');
                    if (englishProcess.exitCode !== 0) {
                        Logger.WLog(`[whisper-sub] English transcription failed for track ${i}: ${englishProcess.output}`);
                        return Flow.Fail('Whisper Execution Failed');
                    }

                    const englishSrt = `${englishBase}.srt`;
                    if (!System.IO.File.Exists(englishSrt)) {
                        Logger.WLog(`[whisper-sub] Expected English subtitle not found for track ${i} at ${englishSrt}.`);
                        return Flow.Fail('Whisper Execution Failed');
                    }

                    Logger.ILog(`[whisper-sub] Created English subtitle for track ${i} -> ${englishSrt}.`);
                    processedLanguages.add('en');
                    created = true;
                }

                continue;
            }

            if (skipExistingSubtitles && hasExistingSubtitle('en')) {
                Logger.ILog(`[whisper-sub] Skipping English translation for track ${i} because an English subtitle already exists.`);
                continue;
            }
            const translateBase = System.IO.Path.Combine(targetDir, `${baseName}.en`);
            const translateProcess = runWhisper(audioSample, translateBase, sourceLang, true, multilingualModel, 'diarize');
            if (translateProcess.exitCode !== 0) {
                Logger.WLog(`[whisper-sub] Translation to English failed for track ${i}: ${translateProcess.output}`);
                return Flow.Fail('Whisper Execution Failed');
            }

            const translateOutput = [translateProcess.output, translateProcess.standardOutput, translateProcess.standardError].filter(Boolean).join('\n');
            const translateMatch = translateOutput.match(/auto-detected language:\s*([a-zA-Z-]+)/i);
            const translatedDetected = normalizeLanguage(translateMatch ? translateMatch[1] : '') || detected;

            const translatedSrt = `${translateBase}.srt`;
            if (!System.IO.File.Exists(translatedSrt)) {
                Logger.WLog(`[whisper-sub] Expected translated subtitle not found for track ${i} at ${translatedSrt}.`);
                return Flow.Fail('Whisper Execution Failed');
            }

            Logger.ILog(`[whisper-sub] Created translated subtitle for track ${i} -> ${translatedSrt}.`);

            if (!keepOriginal) {
                processedLanguages.add(translatedDetected || langMeta || 'auto');
            }

            created = true;
        }
    }

    if (!created) {
        Logger.WLog('[whisper-sub] No subtitles were created.');
        return 2;
    }

    return 1;
}
