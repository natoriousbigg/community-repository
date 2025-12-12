/**
 * @name Video - Whisper.cpp Automatic Subtitle Transcription and Translation
 * @uid 1d1d3c0d-6e6b-4a34-bf2a-ffb9b5d6f1ae
 * @description Transcribes each audio track with whisper-cli into language-tagged SRT files, with optional translation and flexible subtitle placement.
 * @author OpenAI-Assistant
 * @revision 48
 * @output Subtitles created
 * @output No subtitle created
 * @param {bool} TranslateToEnglish Translate generated subtitles to English.
 * @param {bool} SkipOriginalLanguage Skip creating the original-language subtitle when a translation is produced.
 * @param {bool} OverWriteExistingSubtitles Overwrite existing subtitles instead of skipping generation when present.
 * @param {bool} DebugMode Disable quiet whisper-cli output (removes --no-prints).
 * @param {bool} NoGpu Disable GPU acceleration.
 * @param {bool} FixAudioLanguages Update audio track language tags using detected languages before transcription.
 * @param {('OrgDir'|'WorkingDir')} SubtitleSaveDir Directory to save subtitles to. OrgDir - Original Directory. WorkingDir - Fileflows working directory.
 * @param {bool} DisableVAD Disable Voice Activity Detection (VAD) even if the model is available.
 */
function Script(TranslateToEnglish, SkipOriginalLanguage, OverWriteExistingSubtitles = false, DebugMode, NoGpu, FixAudioLanguages, SubtitleSaveDir, DisableVAD) {
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
    const overwriteExistingSubtitles = parseBoolean(typeof Variables['OverWriteExistingSubtitles'] !== 'undefined' ? Variables['OverWriteExistingSubtitles'] : OverWriteExistingSubtitles, false);
    const skipExistingSubtitles = !overwriteExistingSubtitles;
    const debugMode = parseBoolean(typeof Variables['DebugMode'] !== 'undefined' ? Variables['DebugMode'] : DebugMode, false);
    const disableGpu = parseBoolean(typeof Variables['NoGpu'] !== 'undefined' ? Variables['NoGpu'] : NoGpu, false);
    const fixAudioLanguages = parseBoolean(typeof Variables['FixAudioLanguages'] !== 'undefined' ? Variables['FixAudioLanguages'] : FixAudioLanguages, false);
    const disableVAD = parseBoolean(typeof Variables['DisableVAD'] !== 'undefined' ? Variables['DisableVAD'] : DisableVAD, false);

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
    const modelOverride = (Variables['whisper-models'] || '').toString().trim();

    const whisperCandidates = [
        whisperOverride,
        Flow.GetToolPath('whisper-cli'),
        Flow.GetToolPath('whisper'),
        '/usr/local/bin/whisper-cli',
        '/app/common/whispercpp/bin/whisper-cli'
    ];

    const whisperCli = whisperOverride || whisperCandidates.find((candidate) => candidate && System.IO.File.Exists(candidate)) || whisperCandidates[whisperCandidates.length - 1];

    const installRoot = '/app/common/whispercpp';
    const modelDir = System.IO.Path.Combine(installRoot, 'models');
    const vadModelFilename = 'ggml-silero-v6.2.0.bin';
    const pickPreferredModel = (directories, candidates) => {
        const candidatesLower = candidates.map((c) => c.toLowerCase());
        for (const dir of directories) {
            if (!dir || !System.IO.Directory.Exists(dir))
                continue;
            const binFiles = System.IO.Directory.GetFiles(dir, '*.bin');
            if (!binFiles || binFiles.length === 0)
                continue;
            const binLookup = binFiles.reduce((acc, file) => {
                acc[System.IO.Path.GetFileName(file).toLowerCase()] = file;
                return acc;
            }, {});
            for (const candidate of candidatesLower) {
                if (binLookup[candidate])
                    return binLookup[candidate];
            }
            return binFiles.sort()[0];
        }
        return '';
    };

    const overrideLower = modelOverride.toLowerCase();
    const overrideIsFile = modelOverride && System.IO.File.Exists(modelOverride) && overrideLower.endsWith('.bin');
    const overrideIsDirectory = modelOverride && System.IO.Directory.Exists(modelOverride);

    // Validate whisper-models input: check for invalid file or empty folder
    if (modelOverride) {
        if (!overrideIsFile && !overrideIsDirectory) {
            Logger.ELog(`[whisper-sub] Invalid whisper-models path: '${modelOverride}' is not a valid .bin file or directory. Please download and set variable 'whisper-models'`);
            Flow.Fail(` Invalid whisper-models path: '${modelOverride}' is not a valid .bin file or directory.`);
            return -1;
        }
        if (overrideIsDirectory) {
            const binFiles = System.IO.Directory.GetFiles(modelOverride, '*.bin');
            if (!binFiles || binFiles.length === 0) {
                Logger.ELog(`[whisper-sub] whisper-models folder '${modelOverride}' contains no .bin files. Please download and set variable 'whisper-models'`);
                Flow.Fail(`whisper-models folder '${modelOverride}' contains no .bin files. Please download and set variable 'whisper-models'`);
                return -1;
            }
        }
    }

    const modelSearchDirs = [];
    if (overrideIsDirectory)
        modelSearchDirs.push(modelOverride);
    modelSearchDirs.push(modelDir);

    const multilingualCandidates = [
        'ggml-large-v3-turbo.bin',
        'ggml-large-v3.bin',
        'ggml-large.bin',
        'ggml-medium.bin',
        'ggml-base.bin'
    ];
    const englishCandidates = [
        'ggml-large-v3-turbo.bin',
        'ggml-large-v3.bin',
        'ggml-large.bin',
        'ggml-medium.en.bin',
        'ggml-base.en.bin'
    ];

    const resolveModel = (explicitPath, fallbackDirs, candidates) => {
        if (explicitPath) {
            if (System.IO.Directory.Exists(explicitPath)) {
                const found = pickPreferredModel([explicitPath], candidates);
                if (found)
                    return found;
            } else if (System.IO.File.Exists(explicitPath)) {
                return explicitPath;
            }
        }
        return pickPreferredModel(fallbackDirs, candidates);
    };

    // If override is a .bin file, use it as multilingual model
    const multilingualModel = overrideIsFile
        ? modelOverride
        : resolveModel('', modelSearchDirs, multilingualCandidates);

    // Always try to find dedicated English models (ggml-medium.en.bin preferred over ggml-base.en.bin)
    let englishModel = resolveModel('', modelSearchDirs, englishCandidates);
    let hasDedicatedEnglish = englishModel && System.IO.File.Exists(englishModel);
    // Fall back to the override file or multilingual model if no dedicated English model found
    if (!hasDedicatedEnglish) {
        englishModel = overrideIsFile ? modelOverride : multilingualModel;
    }

    // Use ggml-base.bin for faster language detection
    const baseCandidates = ['ggml-base.bin'];
    const baseModel = resolveModel('', modelSearchDirs, baseCandidates) || multilingualModel;

    const missing = [];
    if (!System.IO.File.Exists(whisperCli))
        missing.push(`binary at '${whisperCli}'`);
    if (!multilingualModel)
        missing.push('multilingual Whisper.cpp model (e.g., ggml-large-v3-turbo.bin, ggml-medium.bin or ggml-base.bin)');

    if (missing.length > 0) {
        Logger.ELog(`[whisper-sub] Whisper.cpp requirement missing: ${missing.join(' and ')}.`);
        const installMsg = "Install the 'Whisper.cpp - Binary and Base Model' DockerMod for the binary and base model, or download binary and models manually, and set variable 'whisper' and 'whisper-models'.";
        Logger.ELog(`[whisper-sub] ${installMsg}`);
        return Flow.Fail('Whisper.cpp and/or required model missing, please install and set variables');
    }

    if (!hasDedicatedEnglish)
        Logger.WLog('[whisper-sub] English Whisper.cpp model not found; using multilingual model for English audio.');

    // VAD model detection
    let vadModelPath = '';
    
    if (!disableVAD) {
        for (const dir of modelSearchDirs) {
            if (!dir || !System.IO.Directory.Exists(dir))
                continue;
            const candidatePath = System.IO.Path.Combine(dir, vadModelFilename);
            if (System.IO.File.Exists(candidatePath)) {
                vadModelPath = candidatePath;
                break;
            }
        }
        
        if (vadModelPath) {
            Logger.ILog(`[whisper-sub] VAD model found at: ${vadModelPath}`);
        } else {
            Logger.ILog('[whisper-sub] VAD model not found. Transcription will proceed without Voice Activity Detection.');
        }
    } else {
        Logger.ILog('[whisper-sub] VAD is disabled by user configuration.');
    }

    const workingDir = Flow.TempPath || System.IO.Path.GetTempPath();
    const originalDir = System.IO.Path.GetDirectoryName(filePath);
    const targetDir = saveLocation === 'WorkingDir' ? workingDir : originalDir;
    const baseName = System.IO.Path.GetFileNameWithoutExtension(filePath);

    const processedLanguages = new Set();
    const existingSubtitleLanguages = new Set();
    const ffModel = Variables.FfmpegBuilderModel;
    const createdSubtitles = [];

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

    const deleteExistingSubtitle = (lang) => {
        const normalized = normalizeLanguage(lang);
        if (!normalized)
            return false;
        const sidecarPath = System.IO.Path.Combine(targetDir, `${baseName}.${normalized}.srt`);
        if (System.IO.File.Exists(sidecarPath)) {
            try {
                System.IO.File.Delete(sidecarPath);
                Logger.ILog(`[whisper-sub] Deleted existing subtitle: ${sidecarPath}`);
                existingSubtitleLanguages.delete(normalized);
                return true;
            } catch (err) {
                Logger.WLog(`[whisper-sub] Failed to delete existing subtitle ${sidecarPath}: ${err}`);
                return false;
            }
        }
        return false;
    };
    let created = false;

    const durationSeconds = vi?.Duration?.TotalSeconds || vi?.VideoStreams?.[0]?.Duration?.TotalSeconds || 0;
    const sampleStart = durationSeconds >= 300 ? 300 : 0;
    const sampleLength = Math.min(300, Math.max(1, (durationSeconds || 0) - sampleStart || durationSeconds || 300));

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

    const detectLanguage = (audioPath) => {
        const args = [
            '--model', baseModel,
            '--file', audioPath,
            '--detect-language', 'true',
            '--language', 'auto'
        ];

        if (disableGpu)
            args.push('--no-gpu', 'true');

        const process = Flow.Execute({ command: whisperCli, argumentList: args, logOutput: false });
        if (process.exitCode !== 0) {
            Logger.WLog(`[whisper-sub] Language detection failed: ${process.output}`);
            return '';
        }

        const combinedOutput = [process.output, process.standardOutput, process.standardError].filter(Boolean).join('\n');
        const match = combinedOutput.match(/auto-detected language:\s*([a-zA-Z-]+)/i);
        return normalizeLanguage(match ? match[1] : '');
    };

    const runWhisper = (audioPath, baseOutput, language, translateFlag, modelToUse) => {
        const args = [
            '--model', modelToUse,
            '--file', audioPath,
            '--language', language || 'auto',
            '--output-srt', 'true',
            '--output-file', baseOutput,
            '--temperature', '0.0',
            '--temperature-inc', '0.0',
            '--max-context', '0',
            '--entropy-thold', '2.4',
            '--word-thold', '0.01',
            '--no-speech-thold', '0.6',
            '--logprob-thold', '-0.5',
            '--print-progress', 'true',
            '--split-on-word', 'true',
            '--max-len', '47',
            '--suppress-nst', 'true'
        ];

        if (vadModelPath) {
            args.push(
                '--vad', 'true',
                '--vad-model', vadModelPath,
                '--vad-threshold', '0.5',
                '--vad-min-speech-duration-ms', '250',
                '--vad-min-silence-duration-ms', '300',
                '--vad-speech-pad-ms', '20',
                '--vad-samples-overlap', '0.1'
            );
        }

        if (disableGpu)
            args.push('--no-gpu', 'true');

        if (!debugMode)
            args.push('--no-prints', 'true');

        if (translateFlag)
            args.push('--translate', 'true');

        const process = Flow.Execute({ command: whisperCli, argumentList: args, logOutput: false });
        
        // Check for actual errors
        const combinedOutput = [process.output, process.standardOutput, process.standardError].filter(Boolean).join('\n');
        if (process.exitCode !== 0 || combinedOutput.match(/^error:/im)) {
            Logger.ELog(`[whisper-sub] whisper-cli failed: ${combinedOutput}`);
            return { ...process, hasFailed: true };
        }
        
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

        const detectedFromSample = detectLanguage(samplePath);
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

        if (overwriteExistingSubtitles) {
            deleteExistingSubtitle(detected);
        } else if (hasExistingSubtitle(detected)) {
            Logger.ILog(`[whisper-sub] Skipping track ${i} because subtitles for language '${detected}' already exist.`);
            processedLanguages.add(detected);
            continue;
        }

        if (keepOriginal) {
            const tempBase = System.IO.Path.Combine(workingDir, `whisper_sub_track_${i}`);
            const assumedLanguage = normalizeLanguage(detectedFromAudio || langMeta);
            const transcriptModel = assumedLanguage === 'en' ? englishModel : multilingualModel;
            const process = runWhisper(audioSample, tempBase, detected || 'auto', false, transcriptModel);

            if (process.exitCode !== 0 || process.hasFailed) {
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

            if (overwriteExistingSubtitles) {
                deleteExistingSubtitle(langForName);
            } else if (hasExistingSubtitle(langForName)) {
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
            createdSubtitles.push(targetSrt);
        }

        if (translateToEnglish) {
            const sourceLang = detected !== 'auto' ? detected : (langMeta || 'auto');
            const normalizedSourceLang = normalizeLanguage(sourceLang);

            if (normalizedSourceLang === 'en') {
                Logger.ILog(`[whisper-sub] Skipping translation for track ${i} because language is already English.`);

                if (!keepOriginal) {
                    if (overwriteExistingSubtitles) {
                        deleteExistingSubtitle('en');
                    } else if (hasExistingSubtitle('en')) {
                        Logger.ILog(`[whisper-sub] Skipping English transcription for track ${i} because an English subtitle already exists.`);
                        processedLanguages.add('en');
                        continue;
                    }

                    const englishBase = System.IO.Path.Combine(targetDir, `${baseName}.en`);
                    const englishProcess = runWhisper(audioSample, englishBase, 'en', false, englishModel);
                    if (englishProcess.exitCode !== 0 || englishProcess.hasFailed) {
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
                    createdSubtitles.push(englishSrt);
                }

                continue;
            }

            if (overwriteExistingSubtitles) {
                deleteExistingSubtitle('en');
            } else if (hasExistingSubtitle('en')) {
                Logger.ILog(`[whisper-sub] Skipping English translation for track ${i} because an English subtitle already exists.`);
                continue;
            }
            const translateBase = System.IO.Path.Combine(targetDir, `${baseName}.en`);
            const translateProcess = runWhisper(audioSample, translateBase, sourceLang, true, multilingualModel);
            if (translateProcess.exitCode !== 0 || translateProcess.hasFailed) {
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
            createdSubtitles.push(translatedSrt);

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

    // Store created subtitle paths for optional post-processing
    if (createdSubtitles.length > 0) {
        Variables.CreatedSubtitlePaths = createdSubtitles.join('|');
        Logger.ILog(`[whisper-sub] Stored ${createdSubtitles.length} subtitle path(s) for post-processing`);
    }

    return 1;
}
