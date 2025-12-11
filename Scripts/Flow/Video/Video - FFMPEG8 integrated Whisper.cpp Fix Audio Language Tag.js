/**
 * @name Video - FFMPEG8 integrated Whisper.cpp Fix Audio Language Tag
 * @uid 1c6d6885-2cda-45bb-b38d-bb3c53809d7c
 * @description Uses ffmpeg with the integrated Whisper.cpp filter to detect spoken languages per audio track and normalizes the track language tags (ISO 639-1) without extracting audio.
 * @author OpenAI-Assistant
 * @revision 13
 * @output Languages updated
 * @output Languages unchanged
 * @output No audio tracks found
 * @param {bool} UseGpuAcceleration Enable GPU acceleration for whisper processing (default: false).
 * @param {string} GpuDevice GPU device index or identifier when GPU is enabled (default: 0 when left empty).
 */
function Script(UseGpuAcceleration, GpuDevice) {
    const ffModel = Variables.FfmpegBuilderModel;
    const vi = Variables.vi?.VideoInfo;
    const filePath = Variables.file?.FullName;

    if (!ffModel || !filePath) {
        Logger.ELog('[ffmpeg-whisper] Missing FFMPEG Builder model or working file.');
        return -1;
    }

    const audioStreams = vi?.AudioStreams;
    if (!audioStreams || audioStreams.length === 0) {
        Logger.WLog('[ffmpeg-whisper] No audio streams available.');
        return 3;
    }

    const commonPath = ((Variables.common || System.Environment.GetEnvironmentVariable('common') || '/app/common').toString().trim() || '/app/common').replace(/[\\/]+$/, '');
    const ffmpegOverride = (Variables['ffmpeg8'] || '').toString().trim();
    const defaultFfmpeg = System.IO.Path.Combine(commonPath, 'ffmpeg-static', 'ffmpeg');
    const legacyFfmpeg = System.IO.Path.Combine(commonPath, 'ffmpeg-static', 'FFMPEG');

    let ffmpeg = '';
    if (ffmpegOverride && System.IO.File.Exists(ffmpegOverride)) {
        ffmpeg = ffmpegOverride;
    } else if (System.IO.File.Exists(defaultFfmpeg)) {
        ffmpeg = defaultFfmpeg;
    } else if (System.IO.File.Exists(legacyFfmpeg)) {
        ffmpeg = legacyFfmpeg;
    } else {
        const missingMsg = "Please install DockerMod FFmpeg Fileflows Edition or BbtN FFmpeg static build, and set variable 'ffmpeg8'.";
        Logger.ELog(`[ffmpeg-whisper] ${missingMsg}`);
        Flow.Fail(missingMsg);
        return -1;
    }

    // Whisper filter availability check; use "-hide_banner -h filter=whisper" to see supported options on this binary.
    const filterProbe = Flow.Execute({ command: ffmpeg, argumentList: ['-hide_banner', '-filters'], logOutput: false });
    const filterOutput = [filterProbe.output, filterProbe.standardOutput, filterProbe.standardError].filter(Boolean).join('\n');
    if (filterProbe.exitCode !== 0 || !/\bwhisper\b/i.test(filterOutput)) {
        const missingFilter = 'This version of FFMPEG does not have the whisper filter integrated.';
        Logger.ELog(`[ffmpeg-whisper] ${missingFilter}`);
        Flow.Fail(missingFilter);
        return -1;
    }

    const installRoot = '/app/common/whispercpp';
    const modelDir = System.IO.Path.Combine(installRoot, 'models');
    const legacyModelLink = System.IO.Path.Combine(modelDir, 'model.bin');
    const modelOverride = (Variables['whisper-models'] || '').toString().trim();
    const overrideLower = modelOverride.toLowerCase();
    const overrideIsFile = modelOverride && System.IO.File.Exists(modelOverride) && overrideLower.endsWith('.bin');
    const overrideIsDirectory = modelOverride && System.IO.Directory.Exists(modelOverride);

    // Validate whisper-models input: check for invalid file or empty folder
    if (modelOverride) {
        if (!overrideIsFile && !overrideIsDirectory) {
            Logger.ELog(`[ffmpeg-whisper] Invalid whisper-models path: '${modelOverride}' is not a valid .bin file or directory.`);
            Flow.Fail('Whisper Model Folder Empty');
            return -1;
        }
        if (overrideIsDirectory) {
            const binFiles = System.IO.Directory.GetFiles(modelOverride, '*.bin');
            if (!binFiles || binFiles.length === 0) {
                Logger.ELog(`[ffmpeg-whisper] whisper-models folder '${modelOverride}' contains no .bin files.`);
                Flow.Fail('Whisper Model Folder Empty');
                return -1;
            }
        }
    }

    // If override is a .bin file, use it directly for both English and Multilanguage tasks
    let modelPath = '';
    if (overrideIsFile) {
        modelPath = modelOverride;
    } else {
        const modelCandidates = [];
        const addModelCandidate = (candidate) => {
            if (candidate && System.IO.File.Exists(candidate) && !modelCandidates.includes(candidate))
                modelCandidates.push(candidate);
        };

        // If override is a directory, search there first
        const searchDir = overrideIsDirectory ? modelOverride : modelDir;
        addModelCandidate(System.IO.Path.Combine(searchDir, 'ggml-large-v3-turbo.bin'));
        addModelCandidate(System.IO.Path.Combine(searchDir, 'ggml-large-v3.bin'));
        addModelCandidate(System.IO.Path.Combine(searchDir, 'ggml-large.bin'));
        addModelCandidate(System.IO.Path.Combine(searchDir, 'ggml-medium.bin'));
        addModelCandidate(System.IO.Path.Combine(searchDir, 'ggml-base.bin'));
        
        // Also search default modelDir if override is a directory
        if (overrideIsDirectory) {
            addModelCandidate(System.IO.Path.Combine(modelDir, 'ggml-large-v3-turbo.bin'));
            addModelCandidate(System.IO.Path.Combine(modelDir, 'ggml-large-v3.bin'));
            addModelCandidate(System.IO.Path.Combine(modelDir, 'ggml-large.bin'));
            addModelCandidate(System.IO.Path.Combine(modelDir, 'ggml-medium.bin'));
            addModelCandidate(System.IO.Path.Combine(modelDir, 'ggml-base.bin'));
        }
        
        addModelCandidate(legacyModelLink);
        addModelCandidate(System.IO.Path.Combine(searchDir, 'ggml-medium.en.bin'));
        addModelCandidate(System.IO.Path.Combine(searchDir, 'ggml-base.en.bin'));
        
        if (overrideIsDirectory) {
            addModelCandidate(System.IO.Path.Combine(modelDir, 'ggml-medium.en.bin'));
            addModelCandidate(System.IO.Path.Combine(modelDir, 'ggml-base.en.bin'));
        }

        modelPath = modelCandidates.find((candidate) => candidate && System.IO.File.Exists(candidate)) || '';
    }

    if (!modelPath) {
        const missingModelMsg = "Install the Whisper.cpp DockerMod for the binary and base models or provide paths via 'whisper' and 'whisper-models'.";
        Logger.ELog(`[ffmpeg-whisper] ${missingModelMsg}`);
        Flow.Fail(missingModelMsg);
        return -1;
    }
    const gpuParam = Variables['UseGpuAcceleration'];
    const gpuDeviceParam = Variables['GpuDevice'];
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
    const useGpu = parseBoolean(typeof gpuParam !== 'undefined' ? gpuParam : UseGpuAcceleration, false);
    const gpuDevice = (typeof gpuDeviceParam !== 'undefined' ? gpuDeviceParam : GpuDevice || '').toString().trim();
    const gpuIndex = gpuDevice || '0';
    if (!System.IO.File.Exists(modelPath)) {
        Logger.ELog(`[ffmpeg-whisper] Whisper.cpp model not found at '${modelPath}'.`);
        return Flow.Fail('Missing Whisper.cpp model for ffmpeg whisper filter');
    }

    const durationSeconds = vi?.Duration?.TotalSeconds || vi?.VideoStreams?.[0]?.Duration?.TotalSeconds || 0;
    const targetSample = 60;
    const sampleLength = Math.min(targetSample, Math.max(1, durationSeconds || targetSample));
    const sampleStart = Math.max(0, (durationSeconds - sampleLength) / 2);

    let updated = false;

    const normalizeLanguage = (value) => {
        const trimmed = (value || '').trim();
        if (!trimmed)
            return '';
        const iso1 = LanguageHelper?.GetIso1Code?.(trimmed) || '';
        const iso2 = LanguageHelper?.GetIso2Code?.(trimmed) || '';
        return (iso1 || iso2 || trimmed).toLowerCase();
    };

    const escapeFilterValue = (value) => (value || '').replace(/([\\:])/g, '\\$1').replace(/ /g, '\\ ');

    for (let i = 0; i < audioStreams.length; i++) {
        const audio = audioStreams[i];
        const builderAudio = ffModel.AudioStreams?.[i];

        if (!audio || audio.Deleted) {
            Logger.ILog(`[ffmpeg-whisper] Skipping audio track ${i} (missing or marked deleted).`);
            continue;
        }

        const existingLang = normalizeLanguage(builderAudio?.Language || audio.Language);

        const filterParts = [
            `[0:a:${i}]whisper=model=${escapeFilterValue(modelPath)}`,
            'language=auto',
            'queue=3',
            `use_gpu=${useGpu ? 1 : 0}`
        ];

        if (useGpu && gpuIndex)
            filterParts.push(`gpu_device=${escapeFilterValue(gpuIndex)}`);

        const filter = filterParts.join(':');

        const args = [
            '-hide_banner', '-y',
            '-ss', sampleStart.toFixed(2),
            '-t', sampleLength.toFixed(2),
            '-i', filePath,
            '-vn',
            '-filter_complex', filter,
            '-f', 'null', '-'
        ];

        Logger.ILog(`[ffmpeg-whisper] Detecting language for track ${i} using ffmpeg whisper filter.`);
        const process = Flow.Execute({ command: ffmpeg, argumentList: args, logOutput: false });

        const combinedOutput = [process.output, process.standardOutput, process.standardError].filter(Boolean).join('\n');
        if (process.exitCode !== 0) {
            Logger.WLog(`[ffmpeg-whisper] ffmpeg whisper filter failed for track ${i}: ${combinedOutput}`);
            return Flow.Fail('Whisper Execution Failed');
        }

        const match = combinedOutput.match(/auto-detected language:\s*([a-zA-Z-]+)/i) || combinedOutput.match(/detected language:\s*([a-zA-Z-]+)/i);
        const detectedRaw = match ? match[1] : '';
        const detected = normalizeLanguage(detectedRaw);

        if (!detected) {
            Logger.WLog(`[ffmpeg-whisper] Could not determine language for track ${i}. Output: ${combinedOutput}`);
            return Flow.Fail('Whisper Execution Failed');
        }

        if (existingLang === detected) {
            Logger.ILog(`[ffmpeg-whisper] Track ${i} language already '${detected}'. No change needed.`);
            continue;
        }

        if (!existingLang) {
            Logger.ILog(`[ffmpeg-whisper] Track ${i} language missing; setting to '${detected}'.`);
        } else {
            Logger.WLog(`[ffmpeg-whisper] Track ${i} language '${existingLang}' differs from detected '${detected}'; updating.`);
        }

        if (builderAudio)
            builderAudio.Language = detected;
        audio.Language = detected;
        ffModel.ForceEncode = true;
        updated = true;
    }

    if (!updated) {
        Logger.ILog('[ffmpeg-whisper] No language changes were required.');
        return 2;
    }

    return 1;
}
