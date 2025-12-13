/**
 * @name Video - Whisper.cpp Automatic Subtitle Transcription and Translation
 * @uid 1d1d3c0d-6e6b-4a34-bf2a-ffb9b5d6f1ae
 * @description Transcribes each audio track with whisper-cli into language-tagged SRT files using optimized models (ggml-distil-large-v3.5 for English, ggml-large-v3-turbo for other languages), with optional translation and flexible subtitle placement.
 * @author Gas-X-Extra-Strength
 * @revision 2
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
    const vi = Variables['vi']?.VideoInfo;
    const filePath = Variables['file']?.FullName;

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

    const commonPath = ((Variables['common'] || System.Environment.GetEnvironmentVariable('common') || '/app/common').toString().trim() || '/app/common').replace(/[\\/]+$/, '');
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

    // English-optimized model candidates (faster and more accurate for English)
    const englishCandidates = [
        'ggml-distil-large-v3.5.bin'
    ];
    
    // Multi-language model candidates (best for non-English languages)
    const multilingualCandidates = [
        'ggml-large-v3-turbo.bin',
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

    // Resolve English and multi-language models
    const englishModel = overrideIsFile
        ? modelOverride
        : resolveModel('', modelSearchDirs, englishCandidates);
    
    const multilingualModel = overrideIsFile
        ? modelOverride
        : resolveModel('', modelSearchDirs, multilingualCandidates);

    // Use ggml-base.bin for faster language detection only
    const baseCandidates = ['ggml-base.bin'];
    let baseModel = resolveModel('', modelSearchDirs, baseCandidates);
    
    if (!baseModel) {
        // Fallback to transcription models for language detection if base model not available
        baseModel = multilingualModel || englishModel;
        if (baseModel) {
            Logger.WLog(`[whisper-sub] ggml-base.bin not found for language detection, falling back to: ${System.IO.Path.GetFileName(baseModel)}`);
        }
    }

    const missing = [];
    if (!System.IO.File.Exists(whisperCli))
        missing.push(`binary at '${whisperCli}'`);
    if (!englishModel && !multilingualModel)
        missing.push('Whisper.cpp transcription models (ggml-distil-large-v3.5.bin for English or ggml-large-v3-turbo.bin for multi-language)');

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
    const ffModel = Variables['FfmpegBuilderModel'];
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

    const selectTranscriptionModel = (detectedLanguage) => {
        // Select model based on detected language
        if (detectedLanguage === 'en' && englishModel) {
            Logger.ILog(`[whisper-sub] Using English-optimized model: ${System.IO.Path.GetFileName(englishModel)}`);
            return englishModel;
        } else if (multilingualModel) {
            Logger.ILog(`[whisper-sub] Using multi-language model: ${System.IO.Path.GetFileName(multilingualModel)}`);
            return multilingualModel;
        } else if (englishModel) {
            // Fallback to English model if multi-language not available
            Logger.WLog(`[whisper-sub] Multi-language model not found, falling back to English model: ${System.IO.Path.GetFileName(englishModel)}`);
            return englishModel;
        }
        return null;
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
            const transcriptionModel = selectTranscriptionModel(detected);
            if (!transcriptionModel) {
                Logger.ELog('[whisper-sub] No suitable transcription model available');
                return Flow.Fail('Whisper failed: No transcription model available');
            }
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
                    const englishTranscriptionModel = selectTranscriptionModel('en');
                    if (!englishTranscriptionModel) {
                        Logger.ELog('[whisper-sub] No suitable transcription model available for English');
                        return Flow.Fail('Whisper failed: No English transcription model available');
                    }
                    const englishProcess = runWhisper(audioSample, englishBase, 'en', false, englishTranscriptionModel);
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
            const translateModel = selectTranscriptionModel(detected);
            if (!translateModel) {
                Logger.ELog('[whisper-sub] No suitable transcription model available for translation');
                return Flow.Fail('Whisper failed: No transcription model available for translation');
            }
            const translateProcess = runWhisper(audioSample, translateBase, sourceLang, true, translateModel);
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

    // Store created subtitle paths for downstream processing
    if (createdSubtitles.length > 0) {
        Variables['CreatedSubtitlePaths'] = createdSubtitles.join('|');
        Logger.ILog(`[whisper-sub] Created ${createdSubtitles.length} subtitle file(s)`);
    }

    Flow.AdditionalInfoRecorder("Whisper", "Complete", 1);
    return 1;
}
