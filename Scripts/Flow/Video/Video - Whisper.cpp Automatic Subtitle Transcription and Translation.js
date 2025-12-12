/**
 * @name Video - Whisper.cpp Automatic Subtitle Transcription and Translation
 * @uid 1d1d3c0d-6e6b-4a34-bf2a-ffb9b5d6f1ae
 * @description Transcribes each audio track with whisper-cli into language-tagged SRT files using ggml-large-v3-turbo for all languages, with optional translation, flexible subtitle placement, and integrated post-processing.
 * @author Gas-X-Extra-Strength
 * @revision 1
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
 * @param {bool} DisableSubtitlePostProcessing Disable automatic post-processing of generated subtitles (removes duplicates, fixes hallucinations, rebalances sentence splits).
 */
function Script(TranslateToEnglish, SkipOriginalLanguage, OverWriteExistingSubtitles = false, DebugMode, NoGpu, FixAudioLanguages, SubtitleSaveDir, DisableVAD, DisableSubtitlePostProcessing) {
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
    const disableSubtitlePostProcessing = parseBoolean(typeof Variables['DisableSubtitlePostProcessing'] !== 'undefined' ? Variables['DisableSubtitlePostProcessing'] : DisableSubtitlePostProcessing, false);

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

    // Transcription model candidates - prioritize large-v3-turbo for best quality and speed
    const transcriptionCandidates = [
        'ggml-distil-large-v3.bin',
        'ggml-large-v3.bin',
        'ggml-large.bin',
        'ggml-medium.bin',
        'ggml-base.bin'
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

    // If override is a .bin file, use it as the transcription model
    const transcriptionModel = overrideIsFile
        ? modelOverride
        : resolveModel('', modelSearchDirs, transcriptionCandidates);

    // Use ggml-base.bin for faster language detection only
    const baseCandidates = ['ggml-base.bin'];
    const baseModel = resolveModel('', modelSearchDirs, baseCandidates) || transcriptionModel;

    const missing = [];
    if (!System.IO.File.Exists(whisperCli))
        missing.push(`binary at '${whisperCli}'`);
    if (!transcriptionModel)
        missing.push('Whisper.cpp transcription model (ggml-large-v3-turbo.bin recommended)');

    if (missing.length > 0) {
        Logger.ELog(`[whisper-sub] Whisper.cpp requirement missing: ${missing.join(' and ')}.`);
        const installMsg = "Install DockerMod 'Whisper.cpp - Binary and Models'  set variable 'whisper' and 'whisper-models'.";
        Logger.ELog(`[whisper-sub] ${installMsg}`);
        return Flow.Fail('Whisper.cpp and/or required model missing, please install and set variables');
    }

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

    // Initialize status
    Flow.AdditionalInfoRecorder("Whisper", "Initializing...", 1);

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
        // Remove from set even if file doesn't exist to maintain consistency
        existingSubtitleLanguages.delete(normalized);
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
            '--detect-language',
            '--language', 'auto'
        ];

        if (disableGpu)
            args.push('--no-gpu');

        const process = Flow.Execute({
            command: whisperCli,
            argumentList: args
        });
        
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
            '--output-srt',
            '--output-file', baseOutput,
            '--temperature', '0.0',
            '--temperature-inc', '0.0',
            '--max-context', '10',
            '--entropy-thold', '2.2',
            '--word-thold', '0.5',
            '--no-speech-thold', '0.8',
            '--logprob-thold', '-0.5',
            '--print-progress',
            '--split-on-word',
            '--max-len', '50',
            '--suppress-nst'
        ];

        if (vadModelPath) {
            args.push(
                '--vad',
                '--vad-model', vadModelPath,
                '--vad-threshold', '0.6',
                '--vad-min-speech-duration-ms', '250',
                '--vad-min-silence-duration-ms', '300',
                '--vad-speech-pad-ms', '47',
                '--vad-samples-overlap', '0.1',
                '--vad-max-speech-duration-s', '8'
            );
        }

        if (disableGpu)
            args.push('--no-gpu');

        if (!debugMode)
            args.push('--no-prints');

        if (translateFlag)
            args.push('--translate');

        const process = Flow.Execute({
            command: whisperCli,
            argumentList: args
        });
        
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
            return Flow.Fail('Whisper failed: Unable to extract audio sample for language detection');

        Flow.AdditionalInfoRecorder("Whisper", `Detecting language for track ${i + 1}/${audioStreams.length}...`, 1);
        const detectedFromSample = detectLanguage(samplePath);
        if (!detectedFromSample) {
            Logger.WLog(`[whisper-sub] Could not determine language for track ${i} during sample detection.`);
            return Flow.Fail('Whisper failed: Language detection failed on audio sample');
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
            return Flow.Fail('Whisper failed: Unable to extract full audio track for transcription');

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
            Flow.AdditionalInfoRecorder("Whisper", `Transcribing track ${i + 1}/${audioStreams.length} (${detected})`, 1);
            const tempBase = System.IO.Path.Combine(workingDir, `whisper_sub_track_${i}`);
            const process = runWhisper(audioSample, tempBase, detected || 'auto', false, transcriptionModel);

            if (process.exitCode !== 0 || process.hasFailed) {
                Logger.WLog(`[whisper-sub] whisper-cli failed for track ${i}: ${process.output}`);
                return Flow.Fail('Whisper failed: Transcription process returned error for original language');
            }

            const srtPathTemp = `${tempBase}.srt`;
            if (!System.IO.File.Exists(srtPathTemp)) {
                Logger.WLog(`[whisper-sub] Expected subtitle not found for track ${i} at ${srtPathTemp}.`);
                return Flow.Fail('Whisper failed: Original language subtitle file not created despite success exit code');
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
                return Flow.Fail('Whisper failed: Unable to move/save original language subtitle file to target location');
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

                    Flow.AdditionalInfoRecorder("Whisper", `Transcribing track ${i + 1}/${audioStreams.length} (English)`, 1);
                    const englishBase = System.IO.Path.Combine(targetDir, `${baseName}.en`);
                    const englishProcess = runWhisper(audioSample, englishBase, 'en', false, transcriptionModel);
                    if (englishProcess.exitCode !== 0 || englishProcess.hasFailed) {
                        Logger.WLog(`[whisper-sub] English transcription failed for track ${i}: ${englishProcess.output}`);
                        return Flow.Fail('Whisper failed: English transcription process returned error');
                    }

                    const englishSrt = `${englishBase}.srt`;
                    if (!System.IO.File.Exists(englishSrt)) {
                        Logger.WLog(`[whisper-sub] Expected English subtitle not found for track ${i} at ${englishSrt}.`);
                        return Flow.Fail('Whisper failed: English subtitle file not created despite success exit code');
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
            Flow.AdditionalInfoRecorder("Whisper", "Translating to English...", 1);
            const translateBase = System.IO.Path.Combine(targetDir, `${baseName}.en`);
            const translateProcess = runWhisper(audioSample, translateBase, sourceLang, true, transcriptionModel);
            if (translateProcess.exitCode !== 0 || translateProcess.hasFailed) {
                Logger.WLog(`[whisper-sub] Translation to English failed for track ${i}: ${translateProcess.output}`);
                return Flow.Fail('Whisper failed: Translation to English process returned error');
            }

            const translateOutput = [translateProcess.output, translateProcess.standardOutput, translateProcess.standardError].filter(Boolean).join('\n');
            const translateMatch = translateOutput.match(/auto-detected language:\s*([a-zA-Z-]+)/i);
            const translatedDetected = normalizeLanguage(translateMatch ? translateMatch[1] : '') || detected;

            const translatedSrt = `${translateBase}.srt`;
            if (!System.IO.File.Exists(translatedSrt)) {
                Logger.WLog(`[whisper-sub] Expected translated subtitle not found for track ${i} at ${translatedSrt}.`);
                return Flow.Fail('Whisper failed: Translated subtitle file not created despite success exit code');
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

    // Integrated subtitle post-processing
    if (!disableSubtitlePostProcessing && createdSubtitles.length > 0) {
        Flow.AdditionalInfoRecorder("Whisper", "Post-processing subtitles...", 1);
        Logger.ILog('[whisper-sub] Starting integrated subtitle post-processing...');
        
        // Default post-processing settings
        const postProcessSettings = {
            minDurationMs: 300,
            maxDurationMs: 7000,          // Increased from 6000 to 7000
            minGapMs: 50,
            minReadableDurationMs: 1000,
            maxCharsPerLine: 80,          // Increased from 60 to 80
            shortSegmentThreshold: 3,
            longSegmentThreshold: 10,
            similarityThreshold: 0.85,
            minWordsPerEntry: 3,          // Minimum words per subtitle entry
            maxMsPerWord: 3000,           // Maximum milliseconds per word (flag if exceeded)
            maxMergeGapMs: 2000,          // Max gap for merging fragments (2 seconds)
            maxRepetitiveDurationMs: 3000, // Max duration for repetitive text (3 seconds)
            repetitiveCheckThresholdMs: 3000, // Min duration to check for repetitive text (3 seconds)
            maxTimestampGapMs: 1800000,   // Max gap before treating as error (30 minutes)
            timestampCorrectionGapMs: 100, // Gap to add when correcting timestamp errors (100ms)
            timestampCorrectionDurationMs: 2000, // Duration to use when correcting malformed timestamps (2 seconds)
            minLogGapMs: 30000            // Min gap to log for debugging (30 seconds)
        };
        
        const postProcessSrt = (srtPath, settings) => {
            try {
                if (!System.IO.File.Exists(srtPath)) {
                    Logger.WLog(`[whisper-sub] Post-processing skipped: file not found at ${srtPath}`);
                    return false;
                }

                Logger.ILog(`[whisper-sub] Post-processing: ${srtPath}`);

                // Helper: Convert time to milliseconds
                const timeToMs = (timeStr) => {
                    const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
                    if (!match) return 0;
                    const [, h, m, s, ms] = match;
                    return parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + parseInt(ms);
                };

                // Helper: Convert milliseconds to time string
                const msToTime = (ms) => {
                    const hours = Math.floor(ms / 3600000);
                    const minutes = Math.floor((ms % 3600000) / 60000);
                    const seconds = Math.floor((ms % 60000) / 1000);
                    const milliseconds = ms % 1000;
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
                };

                // Helper: Normalize text for comparison
                const normalizeText = (text) => {
                    return text.toLowerCase()
                        .replace(/[^\w\s]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                };

                // Helper: Calculate text similarity (Jaccard similarity)
                const calculateSimilarity = (text1, text2) => {
                    const words1 = new Set(normalizeText(text1).split(' '));
                    const words2 = new Set(normalizeText(text2).split(' '));
                    const intersection = new Set([...words1].filter(x => words2.has(x)));
                    const union = new Set([...words1, ...words2]);
                    return union.size > 0 ? intersection.size / union.size : 0;
                };

                // Helper: Count words in text
                const countWords = (text) => {
                    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
                };

                // Helper: Detect suspicious entries (single words with very long duration)
                const isSuspiciousEntry = (entry) => {
                    const wordCount = countWords(entry.text);
                    const durationMs = entry.endMs - entry.startMs;
                    const msPerWord = durationMs / wordCount;
                    
                    // Normal speech is ~300-500ms per word
                    // Flag if >3 seconds per word (3000ms) - this is abnormally slow
                    return msPerWord > 3000;
                };

                // Helper: Split text into two balanced parts
                const splitTextEvenly = (text) => {
                    const words = text.trim().split(/\s+/);
                    const mid = Math.ceil(words.length / 2);
                    return [
                        words.slice(0, mid).join(' '),
                        words.slice(mid).join(' ')
                    ];
                };

                // Helper: Detect repetitive/musical text patterns
                const isRepetitiveText = (text) => {
                    const normalized = text.toLowerCase().replace(/[^\w\s]/g, '');
                    const words = normalized.split(/\s+/).filter(w => w.length > 0);
                    if (words.length < 3) return false;
                    
                    // Check if most words are the same (e.g., "doo doo doo doo")
                    const wordCounts = {};
                    words.forEach(w => { wordCounts[w] = (wordCounts[w] || 0) + 1; });
                    const maxCount = Math.max(...Object.values(wordCounts));
                    return maxCount >= words.length * 0.6; // 60% same word = repetitive
                };

                // Read and parse SRT file
                let content;
                try {
                    content = System.IO.File.ReadAllText(srtPath);
                } catch (readErr) {
                    Logger.ELog(`[whisper-sub] Post-processing: Failed to read file: ${readErr}`);
                    return false;
                }

                if (!content || content.trim().length === 0) {
                    Logger.WLog(`[whisper-sub] Post-processing: File is empty, skipping`);
                    return false;
                }

                const entries = [];
                const blocks = content.split(/\n\s*\n/).filter(block => block.trim());

                for (const block of blocks) {
                    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
                    if (lines.length < 3) continue;

                    const index = parseInt(lines[0]);
                    const timeLine = lines[1];
                    const text = lines.slice(2).join('\n');

                    const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
                    if (!match) continue;

                    entries.push({
                        index,
                        startTime: match[1],
                        endTime: match[2],
                        startMs: timeToMs(match[1]),
                        endMs: timeToMs(match[2]),
                        text,
                        originalText: text
                    });
                }

                if (entries.length === 0) {
                    Logger.WLog(`[whisper-sub] Post-processing: No valid entries found in ${srtPath}`);
                    return false;
                }

                let changeLog = [];

                // First pass: Fix individual entry timestamps before sorting
                // This ensures entries with backwards timestamps (endMs <= startMs) are corrected
                // before they are sorted, so they end up in the correct chronological position
                let fixedTimestampCount = 0;
                for (const entry of entries) {
                    if (entry.endMs <= entry.startMs) {
                        entry.endMs = entry.startMs + settings.timestampCorrectionDurationMs;
                        entry.endTime = msToTime(entry.endMs);
                        changeLog.push(`Fixed backwards timestamp in entry ${entry.index}: end time was before/equal to start time`);
                        fixedTimestampCount++;
                    }
                }
                
                if (fixedTimestampCount > 0) {
                    Logger.ILog(`[whisper-sub] Post-processing: Fixed ${fixedTimestampCount} backwards timestamp(s)`);
                }

                // Second pass: Sort entries chronologically by start time
                // Track original position of each entry to detect reordering
                entries.forEach((entry, idx) => {
                    entry.originalPosition = idx;
                });
                entries.sort((a, b) => a.startMs - b.startMs);
                
                // Count how many entries changed position after sorting
                let reorderedCount = 0;
                entries.forEach((entry, idx) => {
                    if (entry.originalPosition !== idx) {
                        reorderedCount++;
                    }
                    delete entry.originalPosition; // Clean up temporary property
                });
                
                if (reorderedCount > 0) {
                    changeLog.push(`Reordered ${reorderedCount} entries chronologically by start time`);
                    Logger.ILog(`[whisper-sub] Post-processing: Reordered ${reorderedCount} entries by timestamp`);
                }

                // Third pass: Re-index entries after sorting
                entries.forEach((entry, idx) => {
                    entry.index = idx + 1;
                });

                const processed = [];

                const totalEntries = entries.length;
                
                // Process entries
                for (let i = 0; i < entries.length; i++) {
                    const current = entries[i];
                    
                    // Update progress every 10 entries to avoid too many UI updates
                    if (i % 10 === 0 || i === totalEntries - 1) {
                        const progressPercent = Math.round(((i + 1) / totalEntries) * 100);
                        Flow.PartPercentageUpdate(progressPercent);
                        Flow.AdditionalInfoRecorder("Whisper", `Post-processing: ${i + 1} / ${totalEntries} entries`, 1);
                    }
                    
                    if (!current || !current.text) {
                        continue;
                    }
                    
                    const duration = current.endMs - current.startMs;

                    // Skip very short duration entries
                    if (duration < settings.minDurationMs) {
                        changeLog.push(`Removed entry ${current.index}: duration ${duration}ms < ${settings.minDurationMs}ms`);
                        continue;
                    }

                    // Remove or compress suspicious stretched entries
                    if (isSuspiciousEntry(current)) {
                        const wordCount = countWords(current.text);
                        const durationMs = current.endMs - current.startMs;
                        
                        // If a single word spans more than 5 seconds, it's likely a hallucination during music/silence
                        if (wordCount === 1 && durationMs > 5000) {
                            changeLog.push(`Removed hallucinated single word "${current.text}" (${Math.round(durationMs/1000)}s duration)`);
                            continue; // Skip this entry entirely
                        }
                        
                        // For multi-word entries that are stretched, compress the duration
                        if (wordCount > 1 && durationMs > wordCount * 3000) {
                            const newDuration = wordCount * 1500; // ~1.5 seconds per word max
                            current.endMs = current.startMs + newDuration;
                            current.endTime = msToTime(current.endMs);
                            changeLog.push(`Compressed stretched entry "${current.text}" from ${Math.round(durationMs/1000)}s to ${Math.round(newDuration/1000)}s`);
                        }
                    }

                    // Merge consecutive short entries (single/two words) that are close together
                    if (processed.length > 0) {
                        const prev = processed[processed.length - 1];
                        const prevWordCount = countWords(prev.text);
                        const currentWordCount = countWords(current.text);
                        const timeBetween = current.startMs - prev.endMs;
                        
                        // If both entries have 2 or fewer words and are within 500ms, merge them
                        if (prevWordCount <= 2 && currentWordCount <= 2 && timeBetween >= 0 && timeBetween < 500) {
                            changeLog.push(`Merged short fragments: "${prev.text}" + "${current.text}"`);
                            prev.text += ' ' + current.text;
                            prev.endMs = current.endMs;
                            prev.endTime = current.endTime;
                            continue; // Skip adding current as separate entry
                        }
                    }

                    // More aggressive fragment merging: merge entries with fewer than 3 words if within 2 seconds of previous
                    if (countWords(current.text) < settings.minWordsPerEntry && processed.length > 0) {
                        const prev = processed[processed.length - 1];
                        const timeBetween = current.startMs - prev.endMs;
                        // Only merge if entries are close together (non-negative gap within threshold)
                        if (timeBetween >= 0 && timeBetween < settings.maxMergeGapMs) {
                            prev.text = prev.text + ' ' + current.text;
                            prev.endMs = current.endMs;
                            prev.endTime = current.endTime;
                            changeLog.push(`Merged short fragment "${current.text}" into previous entry`);
                            continue;
                        }
                    }

                    // Minimum words per entry validation - look ahead to merge with next entry if possible
                    const currentWordCount = countWords(current.text);
                    if (currentWordCount < settings.minWordsPerEntry && i < entries.length - 1) {
                        // Look ahead to merge with next entry if possible
                        const next = entries[i + 1];
                        if (next && (next.startMs - current.endMs) < 2000) {
                            // Merge current into next by prepending
                            next.text = current.text + ' ' + next.text;
                            next.startMs = current.startMs;
                            next.startTime = current.startTime;
                            changeLog.push(`Merged short entry "${current.text}" with next entry`);
                            continue; // Skip current, it's been merged into next
                        }
                    }

                    // Detect and compress repetitive/musical text patterns
                    if (isRepetitiveText(current.text) && duration > settings.repetitiveCheckThresholdMs) {
                        const reasonableDuration = Math.min(duration, settings.maxRepetitiveDurationMs);
                        current.endMs = current.startMs + reasonableDuration;
                        current.endTime = msToTime(current.endMs);
                        changeLog.push(`Compressed repetitive text entry ${current.index} from ${duration}ms to ${reasonableDuration}ms`);
                    }

                    // Validate timestamp sequence (catch hour-wrap errors)
                    if (processed.length > 0) {
                        const prev = processed[processed.length - 1];
                        const timeDiff = current.startMs - prev.endMs;
                        
                        // If there's a massive jump (larger than maxTimestampGapMs), it's likely an error
                        if (timeDiff > settings.maxTimestampGapMs) {
                            changeLog.push(`Warning: Large timestamp gap detected at entry ${current.index} (${Math.round(timeDiff/60000)} minutes)`);
                            // Adjust to follow previous entry with a small gap
                            current.startMs = prev.endMs + settings.timestampCorrectionGapMs;
                            current.startTime = msToTime(current.startMs);
                            if (current.endMs <= current.startMs) {
                                current.endMs = current.startMs + settings.timestampCorrectionDurationMs;
                                current.endTime = msToTime(current.endMs);
                            }
                        }
                        
                        // If start time is before previous end time (overlap), adjust
                        if (current.startMs < prev.endMs) {
                            current.startMs = prev.endMs + settings.minGapMs;
                            current.startTime = msToTime(current.startMs);
                            changeLog.push(`Fixed overlapping timestamp at entry ${current.index}`);
                        }
                    }

                    // Log large gaps for debugging (but don't modify - these may be intentional silence)
                    if (processed.length > 0) {
                        const prev = processed[processed.length - 1];
                        const gapMs = current.startMs - prev.endMs;
                        
                        // Log gaps larger than minLogGapMs (may indicate missed audio)
                        if (gapMs > settings.minLogGapMs && gapMs < settings.maxTimestampGapMs) {
                            changeLog.push(`Note: ${Math.round(gapMs/1000)}s gap before entry ${current.index} (may be music/silence)`);
                        }
                    }

                    // Check for internal repetition (hallucination)
                    const lines = current.text.split('\n');
                    if (lines.length > 1) {
                        const normalizedLines = lines.map(l => normalizeText(l));
                        const uniqueNormalizedLines = [...new Set(normalizedLines)];
                        if (uniqueNormalizedLines.length < normalizedLines.length) {
                            // Keep first occurrence of each unique normalized line
                            const seen = new Set();
                            const dedupedLines = lines.filter((line, idx) => {
                                const normalized = normalizedLines[idx];
                                if (seen.has(normalized)) return false;
                                seen.add(normalized);
                                return true;
                            });
                            current.text = dedupedLines.join('\n');
                            changeLog.push(`Fixed internal repetition in entry ${current.index}`);
                        }
                    }

                    // Minimum gap enforcement - ensure at least minGapMs between subtitles
                    if (processed.length > 0) {
                        const prev = processed[processed.length - 1];
                        if (current.startMs < prev.endMs + settings.minGapMs) {
                            prev.endMs = current.startMs - settings.minGapMs;
                            prev.endTime = msToTime(prev.endMs);
                            changeLog.push(`Adjusted gap between entries ${prev.index} and ${current.index} to ${settings.minGapMs}ms`);
                        }
                    }

                    // Merge very short consecutive entries
                    if (duration < settings.minReadableDurationMs && processed.length > 0) {
                        const prev = processed[processed.length - 1];
                        const timeBetween = current.startMs - prev.endMs;
                        if (timeBetween < 500) {
                            // Merge with previous entry
                            changeLog.push(`Merged short entry ${current.index} (${duration}ms) with previous entry ${prev.index}`);
                            prev.text = prev.text + ' ' + current.text;
                            prev.endTime = current.endTime;
                            prev.endMs = current.endMs;
                            continue;
                        }
                    }

                    // Check for duplicate with previous entry
                    if (processed.length > 0) {
                        const prev = processed[processed.length - 1];
                        const similarity = calculateSimilarity(prev.text, current.text);

                        if (similarity >= settings.similarityThreshold) {
                            // Merge entries
                            changeLog.push(`Merged duplicate entries ${prev.index} and ${current.index} (similarity: ${similarity.toFixed(2)})`);
                            prev.endTime = current.endTime;
                            prev.endMs = current.endMs;
                            continue;
                        }
                    }

                    // Check for uneven sentence splits (long followed by short)
                    if (processed.length > 0) {
                        const prev = processed[processed.length - 1];
                        const prevWords = countWords(prev.text);
                        const currentWords = countWords(current.text);
                        const timeBetween = current.startMs - prev.endMs;

                        // Only rebalance if entries are close together (< 2 seconds gap)
                        if (prevWords >= settings.longSegmentThreshold && 
                            currentWords <= settings.shortSegmentThreshold && 
                            timeBetween < 2000) {
                            // Merge and re-split evenly (joins entries with space since they're separate segments)
                            const combinedText = prev.text + ' ' + current.text;
                            const combinedWords = countWords(combinedText);
                            
                            if (combinedWords > settings.shortSegmentThreshold) {
                                const [part1, part2] = splitTextEvenly(combinedText);
                                const words1 = countWords(part1);
                                const words2 = countWords(part2);
                                const totalDuration = current.endMs - prev.startMs;
                                const splitPoint = prev.startMs + Math.floor(totalDuration * words1 / combinedWords);

                                changeLog.push(`Rebalanced entries ${prev.index} and ${current.index} (${prevWords}w + ${currentWords}w → ${words1}w + ${words2}w)`);
                                prev.text = part1;
                                prev.endTime = msToTime(splitPoint);
                                prev.endMs = splitPoint;
                                current.text = part2;
                                current.startTime = msToTime(splitPoint);
                                current.startMs = splitPoint;
                            }
                        }
                    }

                    // Split overly long entries based on duration
                    const currentDuration = current.endMs - current.startMs;
                    if (currentDuration > settings.maxDurationMs) {
                        const currentWordCount = countWords(current.text);
                        if (currentWordCount > 1) {
                            // Split into chunks based on duration and word count
                            const numChunks = Math.ceil(currentDuration / settings.maxDurationMs);
                            const wordsPerChunk = Math.ceil(currentWordCount / numChunks);
                            const words = current.text.trim().split(/\s+/);
                            const chunks = [];
                            
                            for (let j = 0; j < words.length; j += wordsPerChunk) {
                                chunks.push(words.slice(j, j + wordsPerChunk).join(' '));
                            }
                            
                            if (chunks.length > 1) {
                                const timePerChunk = currentDuration / chunks.length;
                                changeLog.push(`Split entry ${current.index} (${currentDuration}ms) into ${chunks.length} chunks`);
                                
                                for (let j = 0; j < chunks.length; j++) {
                                    const chunkStart = current.startMs + Math.floor(j * timePerChunk);
                                    const chunkEnd = j === chunks.length - 1 ? current.endMs : current.startMs + Math.floor((j + 1) * timePerChunk);
                                    
                                    processed.push({
                                        index: current.index + (j * 0.1),
                                        startTime: msToTime(chunkStart),
                                        endTime: msToTime(chunkEnd),
                                        startMs: chunkStart,
                                        endMs: chunkEnd,
                                        text: chunks[j]
                                    });
                                }
                                continue;
                            }
                        } else {
                            // Single word or empty - just cap the duration
                            current.endMs = current.startMs + settings.maxDurationMs;
                            current.endTime = msToTime(current.endMs);
                            changeLog.push(`Capped duration of entry ${current.index} to ${settings.maxDurationMs}ms`);
                        }
                    }

                    // Split overly long entries by character count
                    const maxLength = settings.maxCharsPerLine * 2;
                    if (current.text.length > maxLength && !current.text.includes('\n')) {
                        const [part1, part2] = splitTextEvenly(current.text);
                        const words1 = countWords(part1);
                        const words2 = countWords(part2);
                        const totalWords = words1 + words2;
                        const duration = current.endMs - current.startMs;
                        const splitPoint = current.startMs + Math.floor(duration * words1 / totalWords);

                        changeLog.push(`Split long entry ${current.index} (${current.text.length} chars) into two parts`);

                        processed.push({
                            index: current.index,
                            startTime: current.startTime,
                            endTime: msToTime(splitPoint),
                            startMs: current.startMs,
                            endMs: splitPoint,
                            text: part1
                        });

                        processed.push({
                            index: current.index + 0.5,
                            startTime: msToTime(splitPoint),
                            endTime: current.endTime,
                            startMs: splitPoint,
                            endMs: current.endMs,
                            text: part2
                        });
                        continue;
                    }

                    // Maximum duration check - split entries longer than maxDurationMs
                    if (duration > settings.maxDurationMs) {
                        const [part1, part2] = splitTextEvenly(current.text);
                        const words1 = countWords(part1);
                        const words2 = countWords(part2);
                        const totalWords = words1 + words2;
                        const splitPoint = current.startMs + Math.floor(duration * words1 / totalWords);

                        changeLog.push(`Split entry ${current.index} exceeding max duration (${duration}ms > ${settings.maxDurationMs}ms)`);

                        processed.push({
                            index: current.index,
                            startTime: current.startTime,
                            endTime: msToTime(splitPoint),
                            startMs: current.startMs,
                            endMs: splitPoint,
                            text: part1
                        });

                        processed.push({
                            index: current.index + 0.5,
                            startTime: msToTime(splitPoint),
                            endTime: current.endTime,
                            startMs: splitPoint,
                            endMs: current.endMs,
                            text: part2
                        });
                        continue;
                    }

                    processed.push(current);
                }

                // Final 100% when done
                Flow.PartPercentageUpdate(100);

                // Final pass: Sort processed entries chronologically and re-index
                // This ensures all entries are in correct order after all modifications
                processed.sort((a, b) => a.startMs - b.startMs);
                
                // Re-index all entries sequentially after sorting
                processed.forEach((entry, idx) => {
                    entry.index = idx + 1;
                });
                
                // Validate and fix any remaining backwards timestamps between consecutive entries
                let finalFixCount = 0;
                for (let i = 1; i < processed.length; i++) {
                    const prev = processed[i - 1];
                    const current = processed[i];
                    
                    // If current entry starts before previous entry ends, fix it
                    if (current.startMs < prev.endMs) {
                        const gap = settings.minGapMs || 50;
                        current.startMs = prev.endMs + gap;
                        current.startTime = msToTime(current.startMs);
                        
                        // Ensure end time is after start time
                        if (current.endMs < current.startMs) {
                            current.endMs = current.startMs + (settings.timestampCorrectionDurationMs || 2000);
                            current.endTime = msToTime(current.endMs);
                            
                            // If there's a next entry, ensure we don't overlap with it
                            if (i < processed.length - 1) {
                                const next = processed[i + 1];
                                if (current.endMs > next.startMs) {
                                    // Cap current end time to not overlap with next entry
                                    const cappedEndMs = next.startMs - gap;
                                    // Only cap if it still results in a valid duration
                                    if (cappedEndMs > current.startMs) {
                                        current.endMs = cappedEndMs;
                                        current.endTime = msToTime(current.endMs);
                                    } else {
                                        // Entry is squeezed between prev and next, use minimal duration
                                        current.endMs = current.startMs + gap;
                                        current.endTime = msToTime(current.endMs);
                                    }
                                }
                            }
                        }
                        
                        changeLog.push(`Fixed backwards timestamp between entries ${prev.index} and ${current.index}: adjusted start time to maintain chronological order`);
                        finalFixCount++;
                    }
                }
                
                if (finalFixCount > 0) {
                    Logger.ILog(`[whisper-sub] Post-processing: Fixed ${finalFixCount} backwards timestamp(s) between consecutive entries`);
                }

                // Log changes
                if (changeLog.length > 0) {
                    Logger.ILog(`[whisper-sub] Post-processing changes for ${System.IO.Path.GetFileName(srtPath)}:`);
                    for (const log of changeLog) {
                        Logger.ILog(`  - ${log}`);
                    }
                } else {
                    Logger.ILog(`[whisper-sub] No post-processing changes needed for ${System.IO.Path.GetFileName(srtPath)}`);
                }

                // Write back to file
                const output = processed.map((entry) => {
                    return `${entry.index}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}\n`;
                }).join('\n');

                try {
                    System.IO.File.WriteAllText(srtPath, output);
                    const fileInfo = new System.IO.FileInfo(srtPath);
                    if (fileInfo.Exists && fileInfo.Length > 0) {
                        Logger.ILog(`[whisper-sub] Post-processing: Successfully completed for ${srtPath}`);
                    } else {
                        Logger.ELog(`[whisper-sub] Post-processing: File appears empty or missing after write`);
                        return false;
                    }
                } catch (writeErr) {
                    Logger.ELog(`[whisper-sub] Post-processing: Failed to write file: ${writeErr}`);
                    return false;
                }

                return true;
            } catch (err) {
                Logger.ELog(`[whisper-sub] Post-processing failed for ${srtPath}: ${err}`);
                return false;
            }
        };
        
        // Process each created subtitle file
        let postProcessedCount = 0;
        for (const srtPath of createdSubtitles) {
            if (postProcessSrt(srtPath, postProcessSettings)) {
                postProcessedCount++;
            }
        }
        
        Logger.ILog(`[whisper-sub] Post-processing complete: ${postProcessedCount} of ${createdSubtitles.length} subtitle(s) processed`);
        
        // Reset progress after post-processing
        Flow.PartPercentageUpdate(0);
    } else if (disableSubtitlePostProcessing) {
        Logger.ILog('[whisper-sub] Subtitle post-processing is disabled');
    }

    Flow.AdditionalInfoRecorder("Whisper", "Complete", 1);
    return 1;
}
