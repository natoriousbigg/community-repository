/**
 * @name Video - SubtitleEdit SRT Post-Processing
 * @uid 3f3f5e2f-8g8c-6c56-dh4c-hhe1e7f8h3cg
 * @description Post-processes SRT subtitle files using seconv CLI (SubtitleEdit). Includes pre-processing to strip RTL/LTR Unicode control characters and fix leading punctuation positioning. Fixes RTL (right-to-left) text encoding issues, applies professional subtitle standards: merges same timecodes/texts, balances and splits long lines, applies duration limits, and removes formatting. Optionally removes text for hearing impaired.
 * @author natoriousbigg
 * @revision 4
 * @output Subtitle Processed
 * @output No Subtitle Processing Needed
 * @param {bool} RemoveTextForHI Remove text for hearing impaired (brackets, sound effects). Default: false.
 * @param {string} Encoding Output encoding (default: UTF-8). Options: UTF-8, ASCII, etc.
 * @param {bool} ProcessExistingSrtFiles Process all .srt files in the original video folder instead of only Whisper-generated ones.
 */
function Script(RemoveTextForHI, Encoding, ProcessExistingSrtFiles) {
    // Pre-processing function to fix RTL issues
    const preprocessSrtFile = (srtPath) => {
        try {
            // Read the entire SRT file
            let content = System.IO.File.ReadAllText(srtPath);
            
            // Strip RTL/LTR Unicode control characters
            // U+200E (LTR Mark), U+200F (RTL Mark), U+202A (LTR Embedding), U+202B (RTL Embedding),
            // U+202C (Pop Directional Formatting), U+202D (LTR Override), U+202E (RTL Override),
            // U+2066 (LTR Isolate), U+2067 (RTL Isolate), U+2068 (First Strong Isolate), U+2069 (Pop Directional Isolate)
            content = content.replace(/[\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g, '');
            
            // Detect line ending style to preserve it
            const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
            
            // Fix punctuation positioning - split by lines and process each
            const lines = content.split(/\r?\n/);
            const processedLines = [];
            
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i];
                
                // Skip timestamp lines (e.g., "00:00:01,000 --> 00:00:03,000")
                // Skip sequence number lines (just digits)
                // Skip empty lines
                if (/^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}$/.test(line) ||
                    /^\d+$/.test(line) ||
                    line.trim() === '') {
                    processedLines.push(line);
                    continue;
                }
                
                // Fix leading punctuation: move it to the end
                // Pattern: Line starts with `. ` or `? ` or `! ` or `, ` followed by text (or empty)
                const punctMatch = line.match(/^([.?!,])\s+(.*)$/);
                if (punctMatch) {
                    const punct = punctMatch[1];
                    const text = punctMatch[2];
                    // Only transform if there's actual text after the punctuation
                    if (text.length > 0) {
                        line = text + punct;
                    }
                }
                
                processedLines.push(line);
            }
            
            // Write the cleaned content back to the file, preserving line endings
            const processedContent = processedLines.join(lineEnding);
            System.IO.File.WriteAllText(srtPath, processedContent);
            
            return true;
        } catch (err) {
            Logger.WLog('[subtitleedit-postproc] Pre-processing error for ' + srtPath + ': ' + err);
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
    
    const processExisting = parseBoolean(ProcessExistingSrtFiles, false);

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
            // Pre-process the SRT file to fix RTL issues
            Logger.ILog('[subtitleedit-postproc] Running pre-processing to strip RTL control characters and fix punctuation...');
            if (!preprocessSrtFile(srtPath)) {
                Logger.WLog('[subtitleedit-postproc] Pre-processing failed for: ' + srtPath);
                failedCount++;
                continue;
            }
            
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
