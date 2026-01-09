/**
 * Whisper.cpp Audio Language Tag Fixer
 * 
 * This script processes video files using Whisper.cpp to detect and fix
 * audio language tags in their metadata. It uses the ggml-base.bin model
 * for efficient speech recognition and language detection.
 */

// Configuration
const MODEL_PATH = "./ggml-base.bin";
const WHISPER_PATH = "./whisper.cpp";
const TEMP_DIR = "./temp";
const MAX_CONCURRENT = 3;

// Helper function to check if file exists
function fileExists(path) {
  try {
    const fs = require('fs');
    return fs.existsSync(path);
  } catch (e) {
    return false;
  }
}

// Helper function to execute command
function executeCommand(command) {
  try {
    const { execSync } = require('child_process');
    const output = execSync(command, { encoding: 'utf8' });
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Initialize Whisper.cpp with ggml-base.bin model
function initializeWhisper() {
  if (!fileExists(MODEL_PATH)) {
    console.error(`Error: Model file not found at ${MODEL_PATH}`);
    return false;
  }
  
  if (!fileExists(WHISPER_PATH)) {
    console.error(`Error: Whisper.cpp not found at ${WHISPER_PATH}`);
    return false;
  }
  
  console.log(`Initialized Whisper.cpp with model: ${MODEL_PATH}`);
  return true;
}

// Detect language from audio file
function detectLanguage(audioPath) {
  const command = `${WHISPER_PATH} "${audioPath}" --model ${MODEL_PATH} --language auto --output-format json --output-dir ${TEMP_DIR}`;
  
  const result = executeCommand(command);
  
  if (!result.success) {
    console.error(`Failed to process audio: ${result.error}`);
    return null;
  }
  
  try {
    // Parse JSON output to extract detected language
    const jsonMatch = result.output.match(/"language":\s*"([^"]+)"/);
    if (jsonMatch && jsonMatch[1]) {
      return jsonMatch[1];
    }
  } catch (e) {
    console.error(`Failed to parse language detection result: ${e.message}`);
  }
  
  return null;
}

// Update video metadata with detected language
function updateVideoMetadata(videoPath, language) {
  if (!language) {
    console.warn(`No language detected for ${videoPath}`);
    return false;
  }
  
  // Use ffmpeg to update language tag
  const command = `ffmpeg -i "${videoPath}" -c:v copy -c:a copy -metadata language="${language}" "${videoPath}.temp.mp4" && mv "${videoPath}.temp.mp4" "${videoPath}"`;
  
  const result = executeCommand(command);
  
  if (result.success) {
    console.log(`Updated language tag for ${videoPath}: ${language}`);
    return true;
  } else {
    console.error(`Failed to update metadata: ${result.error}`);
    return false;
  }
}

// Main processing function
function processVideoFile(videoPath) {
  console.log(`Processing video: ${videoPath}`);
  
  // Extract audio from video
  const audioPath = `${TEMP_DIR}/audio_${Date.now()}.wav`;
  const extractCommand = `ffmpeg -i "${videoPath}" -q:a 9 -n "${audioPath}"`;
  
  const extractResult = executeCommand(extractCommand);
  if (!extractResult.success) {
    console.error(`Failed to extract audio: ${extractResult.error}`);
    return false;
  }
  
  // Detect language from audio
  const detectedLanguage = detectLanguage(audioPath);
  
  // Clean up temporary audio file
  try {
    const fs = require('fs');
    if (fileExists(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  } catch (e) {
    console.warn(`Failed to clean up temp audio: ${e.message}`);
  }
  
  if (!detectedLanguage) {
    console.error(`Failed to detect language for ${videoPath}`);
    return false;
  }
  
  // Update video metadata
  return updateVideoMetadata(videoPath, detectedLanguage);
}

// Main execution
function main() {
  console.log("=== Whisper.cpp Audio Language Tag Fixer ===");
  console.log(`Using model: ${MODEL_PATH}`);
  
  // Initialize Whisper
  if (!initializeWhisper()) {
    console.error("Failed to initialize Whisper.cpp");
    process.exit(1);
  }
  
  // Create temp directory if it doesn't exist
  try {
    const fs = require('fs');
    if (!fileExists(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  } catch (e) {
    console.error(`Failed to create temp directory: ${e.message}`);
    process.exit(1);
  }
  
  // Get video files from command line arguments
  const videoFiles = process.argv.slice(2);
  
  if (videoFiles.length === 0) {
    console.error("Usage: node script.js <video_file> [video_file2] ...");
    process.exit(1);
  }
  
  let processed = 0;
  let successful = 0;
  
  // Process each video file
  videoFiles.forEach((videoFile) => {
    if (fileExists(videoFile)) {
      if (processVideoFile(videoFile)) {
        successful++;
      }
      processed++;
    } else {
      console.error(`Video file not found: ${videoFile}`);
    }
  });
  
  console.log(`\n=== Processing Complete ===`);
  console.log(`Processed: ${processed} files`);
  console.log(`Successful: ${successful} files`);
  
  // Clean up temp directory
  try {
    const fs = require('fs');
    const path = require('path');
    const files = fs.readdirSync(TEMP_DIR);
    files.forEach((file) => {
      fs.unlinkSync(path.join(TEMP_DIR, file));
    });
    fs.rmdirSync(TEMP_DIR);
  } catch (e) {
    console.warn(`Failed to clean up temp directory: ${e.message}`);
  }
}

// Run the script
main();