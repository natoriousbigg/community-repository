# Whisper.cpp Subtitle Post-Processing with SubtitleEdit

## Overview

This guide explains how to use the new SubtitleEdit post-processing workflow with Whisper.cpp transcription in FileFlows. The post-processing functionality has been separated from the transcription script to provide more flexibility and professional subtitle editing capabilities.

## Architecture

The new workflow separates transcription and post-processing into two distinct components:

1. **Whisper.cpp Transcription** - Generates raw SRT subtitle files from audio tracks
2. **SubtitleEdit Post-Processing** - Applies professional corrections and formatting to SRT files

## Setup

### 1. Install Required DockerMods

#### Whisper.cpp DockerMod
Install the `Whisper.cpp - Binary and Models` DockerMod first to enable transcription capabilities.

#### SubtitleEdit DockerMod
Install the `SubtitleEdit - Binary and CLI` DockerMod to enable post-processing capabilities. This will:
- Install SubtitleEdit CLI from https://github.com/SubtitleEdit/subtitleedit-cli
- Create a system-wide `subtitleedit` command
- No additional .NET installation needed (SubtitleEdit CLI is self-contained)

### 2. Configure Flow Scripts

Add both scripts to your FileFlows workflow in sequence:

1. **Video - Whisper.cpp Automatic Subtitle Transcription and Translation**
   - Transcribes audio tracks to SRT files
   - Stores subtitle paths in `Variables.CreatedSubtitlePaths`
   
2. **Video - SubtitleEdit SRT Post-Processing**
   - Processes subtitles created by Whisper.cpp
   - Applies professional corrections and standards

## Recommended Workflow

### Basic Setup
```
[Video File] → [Whisper Transcription] → [SubtitleEdit Post-Processing] → [Next Step]
```

### Whisper.cpp Configuration
- **TranslateToEnglish**: Enable if you want English translations
- **SkipOriginalLanguage**: Disable to keep original language subtitles
- **SubtitleSaveDir**: Choose where to save subtitles (OrgDir recommended)
- **DisableVAD**: Keep disabled for better accuracy

### SubtitleEdit Configuration
- **FixCommonErrors**: ✓ Recommended - Fixes timing overlaps, gaps, and common issues
- **RemoveFormatting**: ✓ Recommended - Removes font tags, colors, and HTML formatting
- **RemoveTextForHI**: Optional - Removes hearing impaired text (brackets, sound effects)
- **RedoCasing**: Optional - Applies smart capitalization rules
- **Encoding**: UTF-8 (default)
- **ProcessExistingSrtFiles**: Disable to process only Whisper-generated files

## Available SubtitleEdit CLI Options

### Fix Common Errors (`--fix-common-errors`)
Automatically corrects:
- Subtitle timing overlaps
- Gaps between subtitles that are too large or too small
- Display duration issues (too short or too long)
- Line length issues
- Invalid timestamps

### Remove Formatting (`--remove-formatting`)
Removes:
- HTML tags (`<b>`, `<i>`, `<u>`, `<font>`)
- Color codes
- Font specifications
- Style attributes

### Remove Text for Hearing Impaired (`--remove-text-for-hi`)
Removes:
- Text in brackets like `[Music]`, `[Door closes]`
- Speaker names in parentheses
- Sound effect descriptions
- Background music indicators

### Redo Casing (`--redo-casing`)
Applies smart capitalization:
- Proper sentence capitalization
- Name capitalization
- Preserves intentional all-caps (like acronyms)

## Comparison: Old vs New Approach

### Old Built-in Post-Processing (Removed)
The Whisper script previously included integrated post-processing that:
- Removed duplicate entries based on text similarity
- Fixed hallucinations (repeated text, musical patterns)
- Corrected timestamp errors
- Rebalanced uneven sentence splits
- Was always-on or always-off (single parameter)

**Limitations:**
- All-or-nothing approach
- Limited configuration options
- Mixed transcription and post-processing concerns

### New SubtitleEdit Approach
**Advantages:**
- Professional subtitle editing tool
- Granular control over corrections
- Industry-standard subtitle formatting
- Separates transcription from post-processing
- Can process any SRT files (not just Whisper-generated)
- Can be used standalone or in workflows
- Actively maintained open-source project

**Flexibility:**
- Enable/disable individual corrections
- Process existing subtitle files
- Chain with other processing steps
- Reprocess without re-transcribing

## Advanced Usage

### Processing Existing SRT Files
Enable `ProcessExistingSrtFiles` to process all SRT files in the video directory, not just Whisper-generated ones:
```
- video.mkv
- video.en.srt (will be processed)
- video.es.srt (will be processed)
- video.ja.srt (will be processed)
```

### Custom SubtitleEdit Path
Set the `subtitleedit` variable in FileFlows to use a custom binary location:
```javascript
Variables['subtitleedit'] = '/custom/path/to/se-cli';
```

### Chaining Multiple Processing Steps
```
[Whisper Transcription] 
  → [SubtitleEdit: Fix Errors + Remove Formatting]
  → [SubtitleEdit: Remove HI Text]
  → [Custom SRT Processing]
  → [Final Output]
```

## Troubleshooting

### SubtitleEdit Not Found
**Error:** `SubtitleEdit CLI not found at /usr/local/bin/subtitleedit`

**Solution:** Install the `SubtitleEdit - Binary and CLI` DockerMod

### No Subtitles to Process
**Output:** `No Subtitle Processing Needed`

**Causes:**
1. Whisper script didn't create subtitles
2. `ProcessExistingSrtFiles` is disabled and `Variables.CreatedSubtitlePaths` is empty
3. No matching SRT files found in directory

**Solution:** 
- Verify Whisper script ran successfully
- Check that `Variables.CreatedSubtitlePaths` contains paths
- Enable `ProcessExistingSrtFiles` if processing existing files

### Permission Errors
**Error:** Cannot read/write SRT files

**Solution:** Ensure FileFlows has write permissions to the subtitle directory

## Migration from Old Post-Processing

If you were using the old `DisableSubtitlePostProcessing` parameter:

### Before (Old)
```javascript
Whisper Script:
- DisableSubtitlePostProcessing: false (enabled integrated post-processing)
```

### After (New)
```javascript
Whisper Script:
- (Parameter removed)

SubtitleEdit Script:
- FixCommonErrors: true
- RemoveFormatting: true
- RemoveTextForHI: false
- RedoCasing: false
```

The new approach provides more control and better results with professional subtitle editing tools.

## References

- [SubtitleEdit CLI GitHub](https://github.com/SubtitleEdit/subtitleedit-cli)
- [SubtitleEdit Main Project](https://github.com/SubtitleEdit/subtitleedit)
- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp)
