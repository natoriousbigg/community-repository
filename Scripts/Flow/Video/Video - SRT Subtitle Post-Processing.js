/**
 * @name Video - SRT Subtitle Post-Processing
 * @uid 2e2e4d1e-7f7c-5b45-cg3b-ggc0c6e7g2bf
 * @description Post-processes SRT subtitle files to remove duplicates, fix hallucinations, and rebalance uneven sentence splits. Can process Whisper-generated subtitles or existing .srt files in the original folder.
 * @author OpenAI-Assistant
 * @revision 1
 * @output Subtitles post-processed
 * @output No subtitles to process
 * @param {int} MinDurationMs Minimum subtitle duration in milliseconds (default: 500).
 * @param {int} MaxCharsPerLine Maximum characters per line before splitting (default: 47).
 * @param {int} ShortSegmentThreshold Word count to consider a segment "short" for rebalancing (default: 3).
 * @param {int} LongSegmentThreshold Word count to consider a segment "long" for rebalancing (default: 10).
 * @param {int} SimilarityThreshold Similarity percentage (0-100) to consider texts as duplicates (default: 85).
 * @param {bool} ProcessExistingSrtFiles Process all .srt files in the original video folder instead of only Whisper-generated ones.
 */
function Script(MinDurationMs, MaxCharsPerLine, ShortSegmentThreshold, LongSegmentThreshold, SimilarityThreshold, ProcessExistingSrtFiles) {
    const processExisting = typeof ProcessExistingSrtFiles === 'boolean' ? ProcessExistingSrtFiles : false;
    
    let paths = [];
    
    if (processExisting) {
        // Process all .srt files in the original video folder
        const workingFile = Variables.file?.FullName;
        
        if (!workingFile) {
            Logger.ELog('[srt-postproc] Cannot process existing SRT files: working file path not available');
            return -1;
        }
        
        const originalDir = System.IO.Path.GetDirectoryName(workingFile);
        const baseName = System.IO.Path.GetFileNameWithoutExtension(workingFile);
        
        Logger.ILog(`[srt-postproc] Searching for .srt files in: ${originalDir}`);
        
        try {
            // Get all .srt files that match the base video filename
            const allSrtFiles = System.IO.Directory.GetFiles(originalDir, '*.srt');
            
            for (const srtFile of allSrtFiles) {
                const srtBaseName = System.IO.Path.GetFileNameWithoutExtension(srtFile);
                // Check if it matches: basename.srt or basename.xx.srt (where xx is language code)
                if (srtBaseName === baseName) {
                    // Exact match: basename.srt
                    paths.push(srtFile);
                } else if (srtBaseName.startsWith(baseName + '.')) {
                    // Check for language code pattern: basename.xx.srt or basename.xxx.srt
                    const suffix = srtBaseName.substring(baseName.length + 1);
                    if (/^[a-z]{2,3}$/i.test(suffix)) {
                        paths.push(srtFile);
                    }
                }
            }
            
            if (paths.length === 0) {
                Logger.WLog(`[srt-postproc] No .srt files found matching '${baseName}' in ${originalDir}`);
                return 2;
            }
            
            Logger.ILog(`[srt-postproc] Found ${paths.length} existing .srt file(s) to process`);
            
        } catch (err) {
            Logger.ELog(`[srt-postproc] Error scanning directory for .srt files: ${err}`);
            return -1;
        }
        
    } else {
        // Use paths from Variables.CreatedSubtitlePaths (Whisper-generated)
        const subtitlePaths = Variables.CreatedSubtitlePaths;
        
        if (!subtitlePaths || subtitlePaths.trim() === '') {
            Logger.WLog('[srt-postproc] No subtitle paths found in Variables.CreatedSubtitlePaths');
            Logger.ILog('[srt-postproc] Tip: Enable "ProcessExistingSrtFiles" to process existing .srt files instead');
            return 2;
        }
        
        paths = subtitlePaths.split('|').filter(p => p.trim());
        
        if (paths.length === 0) {
            Logger.WLog('[srt-postproc] No valid subtitle paths to process');
            return 2;
        }
        
        Logger.ILog(`[srt-postproc] Found ${paths.length} Whisper-generated subtitle file(s) to post-process`);
    }
    
    // Parse settings with defaults
    const settings = {
        minDurationMs: parseInt(MinDurationMs) || 500,
        maxCharsPerLine: parseInt(MaxCharsPerLine) || 47,
        shortSegmentThreshold: parseInt(ShortSegmentThreshold) || 3,
        longSegmentThreshold: parseInt(LongSegmentThreshold) || 10,
        similarityThreshold: (parseInt(SimilarityThreshold) || 85) / 100.0  // Convert percentage to decimal
    };
    
    Logger.ILog(`[srt-postproc] Settings: minDuration=${settings.minDurationMs}ms, maxChars=${settings.maxCharsPerLine}, shortWords=${settings.shortSegmentThreshold}, longWords=${settings.longSegmentThreshold}, similarity=${settings.similarityThreshold}`);
    
    const postProcessSrt = (srtPath, settings) => {
        try {
            if (!System.IO.File.Exists(srtPath)) {
                Logger.WLog(`[srt-postproc] Post-processing skipped: file not found at ${srtPath}`);
                return false;
            }

            Logger.ILog(`[srt-postproc] Post-processing SRT: ${srtPath}`);

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

            // Helper: Split text into two balanced parts
            const splitTextEvenly = (text) => {
                const words = text.trim().split(/\s+/);
                const mid = Math.ceil(words.length / 2);
                return [
                    words.slice(0, mid).join(' '),
                    words.slice(mid).join(' ')
                ];
            };

            // Read and parse SRT file
            Logger.ILog(`[srt-postproc] Post-processing: Reading file...`);
            let content;
            try {
                content = System.IO.File.ReadAllText(srtPath);
                Logger.ILog(`[srt-postproc] Post-processing: Read ${content.length} characters from file`);
            } catch (readErr) {
                Logger.ELog(`[srt-postproc] Post-processing: Failed to read file: ${readErr}`);
                return false;
            }

            if (!content || content.trim().length === 0) {
                Logger.WLog(`[srt-postproc] Post-processing: File is empty, skipping`);
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

            Logger.ILog(`[srt-postproc] Post-processing: Parsed ${entries.length} subtitle entries`);

            if (entries.length === 0) {
                Logger.WLog(`[srt-postproc] No valid entries found in ${srtPath}`);
                return false;
            }

            let changeLog = [];
            const processed = [];

            // Process entries
            Logger.ILog(`[srt-postproc] Post-processing: Processing ${entries.length} entries...`);
            for (let i = 0; i < entries.length; i++) {
                const current = entries[i];
                
                if (!current || !current.text) {
                    Logger.WLog(`[srt-postproc] Post-processing: Skipping invalid entry at index ${current?.index || i}`);
                    continue;
                }
                
                const duration = current.endMs - current.startMs;

                // Skip very short duration entries
                if (duration < settings.minDurationMs) {
                    changeLog.push(`Removed entry ${current.index}: duration ${duration}ms < ${settings.minDurationMs}ms`);
                    continue;
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

                // Split overly long entries
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

                processed.push(current);
            }

            // Log changes
            if (changeLog.length > 0) {
                Logger.ILog(`[srt-postproc] Post-processing changes for ${System.IO.Path.GetFileName(srtPath)}:`);
                for (const log of changeLog) {
                    Logger.ILog(`  - ${log}`);
                }
            } else {
                Logger.ILog(`[srt-postproc] No post-processing changes needed for ${System.IO.Path.GetFileName(srtPath)}`);
            }

            // Write back to file
            Logger.ILog(`[srt-postproc] Post-processing: Writing ${processed.length} entries back to file...`);
            const output = processed.map((entry, idx) => {
                return `${idx + 1}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}\n`;
            }).join('\n');

            try {
                System.IO.File.WriteAllText(srtPath, output);
                // Verify write was successful
                const fileInfo = new System.IO.FileInfo(srtPath);
                if (fileInfo.Exists && fileInfo.Length > 0) {
                    Logger.ILog(`[srt-postproc] Post-processing: Successfully wrote ${output.length} characters (${fileInfo.Length} bytes)`);
                } else {
                    Logger.ELog(`[srt-postproc] Post-processing: File appears empty or missing after write`);
                    return false;
                }
            } catch (writeErr) {
                Logger.ELog(`[srt-postproc] Post-processing: Failed to write file: ${writeErr}`);
                return false;
            }

            Logger.ILog(`[srt-postproc] Post-processing: Successfully completed for ${srtPath}`);
            return true;
        } catch (err) {
            Logger.ELog(`[srt-postproc] Post-processing failed for ${srtPath}: ${err}`);
            Logger.ELog(`[srt-postproc] Stack trace: ${err.stack || 'No stack trace available'}`);
            return false;
        }
    };
    
    // Process each subtitle file
    let processedCount = 0;
    let failedCount = 0;
    
    for (const srtPath of paths) {
        Logger.ILog(`[srt-postproc] Processing: ${srtPath}`);
        
        if (!System.IO.File.Exists(srtPath)) {
            Logger.WLog(`[srt-postproc] File not found: ${srtPath}`);
            failedCount++;
            continue;
        }
        
        const fileInfo = new System.IO.FileInfo(srtPath);
        if (fileInfo.Length === 0) {
            Logger.WLog(`[srt-postproc] File is empty: ${srtPath}`);
            failedCount++;
            continue;
        }
        
        Logger.ILog(`[srt-postproc] File verified: ${System.IO.Path.GetFileName(srtPath)} (${fileInfo.Length} bytes)`);
        
        const result = postProcessSrt(srtPath, settings);
        
        if (result) {
            processedCount++;
        } else {
            failedCount++;
        }
    }
    
    Logger.ILog(`[srt-postproc] Complete: ${processedCount} succeeded, ${failedCount} failed`);
    
    if (processedCount > 0) {
        return 1; // Success
    } else {
        return 2; // No subtitles processed
    }
}
