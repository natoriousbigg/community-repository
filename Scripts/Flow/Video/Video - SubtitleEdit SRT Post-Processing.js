/**
 * @name Video - SubtitleEdit SRT Post-Processing
 * @uid 3f3f5e2f-8g8c-6c56-dh4c-hhe1e7f8h3cg
 * @description Post-processes SRT subtitle files using seconv CLI (SubtitleEdit). Automatically scans for .srt files matching the video basename. Applies professional subtitle standards: fixes RTL issues, merges same timecodes/texts, splits long lines, applies duration limits, removes formatting.
 * @author natoriousbigg
 * @revision 7
 * @output Subtitle Processed
 * @output No Subtitle Processing Needed
 * @param {bool} RemoveTextForHI Remove text for hearing impaired (brackets, sound effects). Default: false.
 * @param {string} Encoding Output encoding (default: UTF-8). Options: UTF-8, ASCII, etc.
 * @param {('OrgDir'|'WorkingDir')} SubtitleScanDir Directory to scan for subtitles. OrgDir - Original Directory. WorkingDir - FileFlows working directory.
 */
function Script(RemoveTextForHI, Encoding, SubtitleScanDir) {
    const preProcessRtlPunctuation = (srtPath) => {
        try {
            let content = System.IO.File.ReadAllText(srtPath);
            
            // Remove RTL/LTR Unicode control characters
            content = content.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
            
            // Detect line ending style to preserve it
            const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
            
            // Fix punctuation at start of lines - move to end
            const lines = content.split(/\r?\n/);
            const fixedLines = lines.map(line => {
                // Skip timestamp lines and sequence numbers
                if (/^\d+$/.test(line.trim()) || /-->/.test(line)) {
                    return line;
                }
                // Match leading punctuation followed by optional space and text
                const match = line.match(/^([.?!,])\s*(.+)$/);
                if (match) {
                    return match[2] + match[1];
                }
                return line;
            });
            
            System.IO.File.WriteAllText(srtPath, fixedLines.join(lineEnding));
            return true;
        } catch (err) {
            Logger.WLog('[subtitleedit-postproc] RTL pre-processing failed: ' + err);
            return false;
        }
    };

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

    const removeTextForHI = parseBoolean(RemoveTextForHI, false);
    
    // Validate and sanitize encoding parameter
    let encoding = (Encoding || 'UTF-8').toString().trim();
    // Only allow alphanumeric characters, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(encoding)) {
        Logger.WLog('[subtitleedit-postproc] Invalid encoding value: ' + encoding + ', defaulting to UTF-8');
        encoding = 'UTF-8';
    }

    // Detect SubtitleEdit CLI (seconv) - check Variables first, then fallback to default path
    const subtitleEditPath = Variables['seconv'] || Variables['subtitleedit'] || '/usr/local/bin/seconv';

    // Verify SubtitleEdit exists
    if (!System.IO.File.Exists(subtitleEditPath)) {
        Logger.ELog('[subtitleedit-postproc] SubtitleEdit CLI (seconv) not found at ' + subtitleEditPath);
        Logger.ELog('[subtitleedit-postproc] Please install the SubtitleEdit DockerMod first.');
        return -1;
    }

    Flow.AdditionalInfoRecorder("SubtitleEdit", "Initializing...", 1);
    Logger.ILog('[subtitleedit-postproc] Found SubtitleEdit CLI at: ' + subtitleEditPath);

    // Try multiple methods to get the file path
    let workingFile = null;

    // Method 1: Try Variables['file'].FullName
    const fileVar = Variables['file'];
    if (fileVar && fileVar.FullName) {
        workingFile = fileVar.FullName;
    }

    // Method 2: Try Variables.file.FullName (alternative syntax)
    if (!workingFile && Variables.file && Variables.file.FullName) {
        workingFile = Variables.file.FullName;
    }

    // Method 3: Try Flow.WorkingFile
    if (!workingFile && Flow.WorkingFile) {
        workingFile = Flow.WorkingFile;
    }

    if (!workingFile) {
        Logger.ELog('[subtitleedit-postproc] Cannot process SRT files: working file path not available');
        return -1;
    }

    // Determine which directory to scan based on SubtitleScanDir parameter
    const saveDirRaw = (typeof Variables['SubtitleScanDir'] !== 'undefined' ? Variables['SubtitleScanDir'] : SubtitleScanDir || 'OrgDir').toString().trim();
    const saveDirNormalized = saveDirRaw.toLowerCase();
    const saveLocation = saveDirNormalized === 'workingdir' ? 'WorkingDir' : 'OrgDir';

    const workingDir = Flow.TempPath || System.IO.Path.GetTempPath();
    const originalDir = System.IO.Path.GetDirectoryName(workingFile);
    const scanDir = saveLocation === 'WorkingDir' ? workingDir : originalDir;
    const baseName = System.IO.Path.GetFileNameWithoutExtension(workingFile);

    Logger.ILog('[subtitleedit-postproc] Searching for .srt files in: ' + scanDir);

    // Find SRT files to process
    let srtPaths = [];

    try {
        const allSrtFiles = System.IO.Directory.GetFiles(scanDir, '*.srt');
        
        for (const srtFile of allSrtFiles) {
            const srtBaseName = System.IO.Path.GetFileNameWithoutExtension(srtFile);
            // Check if it matches: basename.srt or basename.xx.srt (where xx is language code)
            if (srtBaseName === baseName) {
                srtPaths.push(srtFile);
            } else if (srtBaseName.startsWith(baseName + '.')) {
                const suffix = srtBaseName.substring(baseName.length + 1);
                // Match language codes (2-3 letters) or language.forced pattern
                if (/^[a-z]{2,3}$/i.test(suffix) || /^[a-z]{2,3}\.forced$/i.test(suffix)) {
                    srtPaths.push(srtFile);
                }
            }
        }
        
        Logger.ILog('[subtitleedit-postproc] Found ' + srtPaths.length + ' .srt file(s) to process');
    } catch (err) {
        Logger.ELog('[subtitleedit-postproc] Error scanning for SRT files: ' + err);
        return -1;
    }

    // Check if we have any files to process
    if (srtPaths.length === 0) {
        Logger.ILog('[subtitleedit-postproc] No subtitle files to process');
        Flow.AdditionalInfoRecorder("SubtitleEdit", "No files to process", 1);
        return 2;
    }

    Flow.AdditionalInfoRecorder("SubtitleEdit", "Processing " + srtPaths.length + " subtitle file(s)...", 1);

    // Build seconv CLI command arguments
    const buildCommand = (srtPath) => {
        const dir = System.IO.Path.GetDirectoryName(srtPath);
        const filename = System.IO.Path.GetFileName(srtPath);
        
        // Note: Flow.Execute with argumentList handles special characters and escaping automatically
        const args = [
            subtitleEditPath,
            filename,     // File pattern (just the filename)
            'subrip',     // Format name (subrip for SRT)
            '/overwrite', // Overwrite original files
            '/inputfolder:' + dir,   // Input folder
            '/outputfolder:' + dir   // Output folder (same as input)
        ];

        // Mandatory operations (always applied)
        // 1. RTL/Unicode fixes FIRST - clean the text before any other operations
        args.push('/FixRtlViaUnicodeChars');
        args.push('/ReverseRtlStartEnd');
        args.push('/RemoveUnicodeControlChars');
        
        // 2. Merging operations - combine related content
        args.push('/MergeSameTimeCodes');
        args.push('/MergeSameTexts');
        
        // 3. Formatting and structure
        args.push('/RemoveFormatting');
        args.push('/BalanceLines');
        args.push('/SplitLongLines');
        
        // 4. Timing LAST - adjust durations after content is finalized
        args.push('/ApplyDurationLimits');

        // Optional: Remove text for hearing impaired
        if (removeTextForHI) {
            args.push('/RemoveTextForHI');
        }

        // Set encoding if not default
        if (encoding && encoding !== 'UTF-8') {
            args.push('/encoding:' + encoding);
        }

        return args;
    };

    // Process each SRT file
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < srtPaths.length; i++) {
        const srtPath = srtPaths[i];
        
        if (!System.IO.File.Exists(srtPath)) {
            Logger.WLog('[subtitleedit-postproc] File not found, skipping: ' + srtPath);
            failedCount++;
            continue;
        }

        Flow.AdditionalInfoRecorder("SubtitleEdit", "Processing file " + (i + 1) + "/" + srtPaths.length, 1);
        Logger.ILog('[subtitleedit-postproc] Processing: ' + System.IO.Path.GetFileName(srtPath));

        try {
            // Pre-process the SRT file to fix RTL punctuation issues
            Logger.ILog('[subtitleedit-postproc] Pre-processing RTL punctuation: ' + srtPath);
            preProcessRtlPunctuation(srtPath);
            
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
                Logger.WLog('[subtitleedit-postproc] Failed to process ' + srtPath + ' - exit code: ' + result.exitCode);
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
        Flow.AdditionalInfoRecorder("SubtitleEdit", "Complete - " + processedCount + " file(s) processed", 1);
        return 1; // Success
    } else if (failedCount > 0) {
        Flow.AdditionalInfoRecorder("SubtitleEdit", "Failed - " + failedCount + " error(s)", 1);
        return -1; // Failure
    } else {
        Flow.AdditionalInfoRecorder("SubtitleEdit", "Complete - No files processed", 1);
        return 2; // No subtitles processed
    }
}
