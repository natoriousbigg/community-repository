/**
 * @name Video - SubtitleEdit SRT Post-Processing
 * @uid 3f3f5e2f-8g8c-6c56-dh4c-hhe1e7f8h3cg
 * @description Post-processes SRT subtitle files using SubtitleEdit CLI. Fixes common errors, removes formatting, removes HI text, and applies professional subtitle standards.
 * @author natoriousbigg
 * @revision 1
 * @output Subtitle Processed
 * @output No Subtitle Processing Needed
 * @param {bool} FixCommonErrors Fix common subtitle errors (timing, overlaps, gaps, etc.).
 * @param {bool} RemoveFormatting Remove font tags, color codes, and formatting.
 * @param {bool} RemoveTextForHI Remove text for hearing impaired (brackets, sound effects).
 * @param {bool} RedoCasing Apply smart capitalization rules.
 * @param {string} Encoding Output encoding (default: UTF-8). Options: UTF-8, ASCII, etc.
 * @param {bool} ProcessExistingSrtFiles Process all .srt files in the original video folder instead of only Whisper-generated ones.
 */
function Script(FixCommonErrors, RemoveFormatting, RemoveTextForHI, RedoCasing, Encoding, ProcessExistingSrtFiles) {
    // Parse parameters
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

    const fixCommonErrors = parseBoolean(FixCommonErrors, true);
    const removeFormatting = parseBoolean(RemoveFormatting, true);
    const removeTextForHI = parseBoolean(RemoveTextForHI, false);
    const redoCasing = parseBoolean(RedoCasing, false);
    const encoding = (Encoding || 'UTF-8').toString().trim();
    const processExisting = parseBoolean(ProcessExistingSrtFiles, false);

    // Detect SubtitleEdit CLI
    let subtitleEditPath = '/usr/local/bin/subtitleedit';
    
    // Check if custom path is set in Variables
    if (Variables['subtitleedit']) {
        const customPath = Variables['subtitleedit'].toString().trim();
        if (customPath && System.IO.File.Exists(customPath)) {
            subtitleEditPath = customPath;
        }
    }

    // Verify SubtitleEdit exists
    if (!System.IO.File.Exists(subtitleEditPath)) {
        Logger.ELog('[subtitleedit-postproc] SubtitleEdit CLI not found at ' + subtitleEditPath);
        Logger.ELog('[subtitleedit-postproc] Please install the SubtitleEdit DockerMod first.');
        return -1;
    }

    Logger.ILog('[subtitleedit-postproc] Found SubtitleEdit CLI at: ' + subtitleEditPath);

    // Find SRT files to process
    let srtPaths = [];
    
    if (processExisting) {
        // Process all .srt files in the original video folder
        const workingFile = Variables.file?.FullName;
        
        if (!workingFile) {
            Logger.ELog('[subtitleedit-postproc] Cannot process existing SRT files: working file path not available');
            return -1;
        }
        
        const originalDir = System.IO.Path.GetDirectoryName(workingFile);
        const baseName = System.IO.Path.GetFileNameWithoutExtension(workingFile);
        
        Logger.ILog('[subtitleedit-postproc] Searching for .srt files in: ' + originalDir);
        
        try {
            const allSrtFiles = System.IO.Directory.GetFiles(originalDir, '*.srt');
            
            for (const srtFile of allSrtFiles) {
                const srtBaseName = System.IO.Path.GetFileNameWithoutExtension(srtFile);
                // Check if it matches: basename.srt or basename.xx.srt (where xx is language code)
                if (srtBaseName === baseName) {
                    srtPaths.push(srtFile);
                } else if (srtBaseName.startsWith(baseName + '.')) {
                    const suffix = srtBaseName.substring(baseName.length + 1);
                    if (/^[a-z]{2,3}$/i.test(suffix)) {
                        srtPaths.push(srtFile);
                    }
                }
            }
            
            Logger.ILog('[subtitleedit-postproc] Found ' + srtPaths.length + ' .srt file(s) to process');
        } catch (err) {
            Logger.ELog('[subtitleedit-postproc] Error scanning for SRT files: ' + err);
            return -1;
        }
    } else {
        // Use Whisper-generated subtitles from Variables.CreatedSubtitlePaths
        const createdPaths = Variables.CreatedSubtitlePaths;
        
        if (!createdPaths) {
            Logger.ILog('[subtitleedit-postproc] No subtitles found in Variables.CreatedSubtitlePaths');
            return 2;
        }
        
        // Split pipe-separated paths
        srtPaths = createdPaths.toString().split('|').map(p => p.trim()).filter(p => p.length > 0);
        
        Logger.ILog('[subtitleedit-postproc] Processing ' + srtPaths.length + ' Whisper-generated subtitle(s)');
    }

    // Check if we have any files to process
    if (srtPaths.length === 0) {
        Logger.ILog('[subtitleedit-postproc] No subtitle files to process');
        return 2;
    }

    // Build SubtitleEdit CLI command arguments
    const buildCommand = (srtPath) => {
        const args = [
            subtitleEditPath
        ];

        if (fixCommonErrors) {
            args.push('--fix-common-errors');
        }

        if (removeFormatting) {
            args.push('--remove-formatting');
        }

        if (removeTextForHI) {
            args.push('--remove-text-for-hi');
        }

        if (redoCasing) {
            args.push('--redo-casing');
        }

        if (encoding && encoding !== 'UTF-8') {
            args.push('--encoding');
            args.push(encoding);
        }

        // Input file must be last
        args.push(srtPath);

        return args;
    };

    // Process each SRT file
    let processedCount = 0;
    let failedCount = 0;

    for (const srtPath of srtPaths) {
        if (!System.IO.File.Exists(srtPath)) {
            Logger.WLog('[subtitleedit-postproc] File not found, skipping: ' + srtPath);
            failedCount++;
            continue;
        }

        Logger.ILog('[subtitleedit-postproc] Processing: ' + System.IO.Path.GetFileName(srtPath));

        try {
            const args = buildCommand(srtPath);
            
            // Log the command for debugging
            const cmdDisplay = args.join(' ');
            Logger.ILog('[subtitleedit-postproc] Running: ' + cmdDisplay);

            // Use Flow.Execute with argumentList for proper argument handling
            const result = Flow.Execute({
                command: args[0],
                argumentList: args.slice(1),
                logOutput: false
            });

            if (result.exitCode === 0) {
                Logger.ILog('[subtitleedit-postproc] Successfully processed: ' + System.IO.Path.GetFileName(srtPath));
                if (result.standardOutput) {
                    Logger.ILog('[subtitleedit-postproc] Output: ' + result.standardOutput);
                }
                processedCount++;
            } else {
                Logger.WLog('[subtitleedit-postproc] SubtitleEdit returned exit code ' + result.exitCode);
                if (result.standardError) {
                    Logger.WLog('[subtitleedit-postproc] Error: ' + result.standardError);
                }
                failedCount++;
            }
        } catch (err) {
            Logger.ELog('[subtitleedit-postproc] Error processing ' + srtPath + ': ' + err);
            failedCount++;
        }
    }

    // Log summary
    Logger.ILog('[subtitleedit-postproc] Post-processing complete: ' + processedCount + ' succeeded, ' + failedCount + ' failed out of ' + srtPaths.length + ' total');

    if (processedCount > 0) {
        return 1; // Success
    } else if (failedCount > 0) {
        return -1; // Failure
    } else {
        return 2; // No subtitles processed
    }
}
