/**
 * @name Video - Create DoVi fallback (QSV)
 * @description Tonemaps DoVi without a fallback to HDR (QSV + opencl)
 * @help Put me before ffmpeg execute, supports Linux (VAAPI) and Windows (d3d11va)
 * @author lawrence
 * @revision 21
 * @param {string} VaapiDevice Optional VAAPI device path (e.g. /dev/dri/renderD128)
 * @output Setup DoVi tonemapping
 * @output Did nothing
 */
function Script(VaapiDevice) {
  const ff = Variables?.FfmpegBuilderModel;
  const video = ff?.VideoStreams?.[0];
  const isWindows = typeof Flow !== "undefined" && Flow.IsWindows;
  const vaapiDevicePath = (() => {
    const preferred = "/dev/dri/renderD128";
    const fallback = "/dev/dri/renderD129";

    if (VaapiDevice && String(VaapiDevice).trim()) return String(VaapiDevice).trim();

    const canCheck = typeof Flow !== "undefined" && typeof Flow.FileExists === "function";
    if (canCheck && Flow.FileExists(preferred)) return preferred;
    if (canCheck && Flow.FileExists(fallback)) return fallback;
    return preferred;
  })();

  // Only run for DoVi-without-HDR fallback
  if (!video || !video.Stream?.DolbyVision || video.Stream?.HDR) return 2;

  video.ForcedChange = true;

  Variables.FfmpegBuilderModel.PreExecuteCode = isWindows
    ? `
Variables.NoQSV = true;

var filtered = false;
var openclInitSet = false;
var filterDeviceSet = false;
var pixFmtInserted = false;
  var tonemap = "hwupload,tonemap_opencl=format=p010le:p=bt2020:t=smpte2084:m=bt2020:tonemap=bt2390:peak=100:desat=0,hwdownload";

function convertVppCropToCpu(filterStr) {
  if (typeof filterStr !== "string") return filterStr;

  // vpp_qsv=cw=3840:ch=2076:cx=0:cy=42 -> crop=3840:2076:0:42
  return filterStr.replace(/vpp_qsv=cw=([0-9]+):ch=([0-9]+):cx=([0-9]+):cy=([0-9]+)/g, "crop=$1:$2:$3:$4");
}

function reorderCropAfterHwdownload(filterStr) {
  if (typeof filterStr !== "string" || !filterStr.trim()) return "";

  var parts = filterStr.split(",").map(function (p) { return p.trim(); }).filter(Boolean);
  var crops = [];
  var others = [];

  for (var idx = 0; idx < parts.length; idx++) {
    var part = parts[idx];
    if (part.startsWith("crop=")) {
      crops.push(part);
    } else {
      others.push(part);
    }
  }

  if (!crops.length) return others.join(",");
  return crops.join(",") + (others.length ? "," + others.join(",") : "");
}

for (let i = 0; i < FFmpeg.Args.length - 1; i++) {
  if (FFmpeg.Args[i] === "-init_hw_device") {
    openclInitSet = true;
    if (!String(FFmpeg.Args[i + 1]).startsWith("opencl=")) {
      FFmpeg.Args[i + 1] = "opencl=ocl:0";
    }
  }
  if (FFmpeg.Args[i] === "-filter_hw_device") {
    filterDeviceSet = true;
    FFmpeg.Args[i + 1] = "ocl";
  }
  if (FFmpeg.Args[i] === "-hwaccel") {
    FFmpeg.Args[i + 1] = "d3d11va";
  }
  if (FFmpeg.Args[i] === "-hwaccel_output_format") {
    FFmpeg.Args.splice(i, 2);
    i -= 2;
    continue;
  }
  if (FFmpeg.Args[i] === "-pix_fmt") {
    FFmpeg.Args.splice(i, 2);
    i -= 2;
    continue;
  }

  if (FFmpeg.Args[i] === "-filter:v:0") {
    filtered = true;
    let existing = FFmpeg.Args[i + 1] || "";
    existing = convertVppCropToCpu(existing);
    const reordered = reorderCropAfterHwdownload(existing);
    FFmpeg.Args[i + 1] = tonemap + (reordered ? "," + reordered : "");
  }
}

if (!filterDeviceSet) {
  FFmpeg.Args.unshift("-filter_hw_device", "ocl");
  filterDeviceSet = true;
}
if (!openclInitSet) {
  FFmpeg.Args.unshift("-init_hw_device", "opencl=ocl:0");
}

for (let i = 0; i < FFmpeg.Args.length; i++) {
  if (FFmpeg.Args[i] === "-i" && i + 1 < FFmpeg.Args.length) {
    FFmpeg.Args.splice(i + 2, 0, "-pix_fmt", "p010le");
    pixFmtInserted = true;
    break;
  }
}

if (!pixFmtInserted) {
  FFmpeg.Args.push("-pix_fmt", "p010le");
}

if (!filtered) {
  for (let i = 0; i < FFmpeg.Args.length - 1; i++) {
    if (FFmpeg.Args[i] === "0:v:0") {
      FFmpeg.Args.splice(i + 1, 0, "-filter:v:0", tonemap);
      if (!filterDeviceSet) {
        FFmpeg.Args.splice(i + 3, 0, "-filter_hw_device", "ocl");
      }
      break;
    }
  }
}
`
    : `
Variables.NoQSV = true;

// --- helpers ---
function ensureVaapiInitFrom(initVal) {
  // Try to pull a device path from "child_device=" or any /dev/dri path, else default
  const DEFAULT_DEV = "${vaapiDevicePath}";

  // example patterns we might see:
  //   "qsv=hw"
  //   "qsv=gpu"
  //   "qsv=hw_any,child_device=/dev/dri/renderD129"
  //   "vaapi=va:/dev/dri/renderD129" (already VAAPI)
  if (!initVal || typeof initVal !== "string") return "vaapi=va:" + DEFAULT_DEV;

  if (initVal.startsWith("vaapi=")) {
    // normalize alias and ensure path
    const parts = initVal.split("=");
    const right = parts.slice(1).join("="); // "va:/dev/dri/renderD129" or "va"
    if (right.includes("/dev/dri/")) return "vaapi=va:" + right.split(":").pop();
    return "vaapi=va:" + DEFAULT_DEV;
  }

  // Extract device path, if present
  const childMatch = initVal.match(/child_device=([^,:]+)/);
  if (childMatch && childMatch[1]) return "vaapi=va:" + childMatch[1];

  const devMatch = initVal.match(/(\\/dev\\/dri\\/[^,:]+)/);
  if (devMatch && devMatch[1]) return "vaapi=va:" + devMatch[1];

  return "vaapi=va:" + DEFAULT_DEV;
}

function extractDeviceType(initVal) {
  // "qsv=hw" -> "qsv", "vaapi=va:/dev/dri/renderD128" -> "vaapi"
  if (!initVal) return "qsv";
  return String(initVal).split("=")[0];
}

// --- configure tonemap chain ---
var filtered = false;
var tonemap = "hwmap=derive_device=opencl,tonemap_opencl=format=p010le:p=bt2020:t=smpte2084:m=bt2020:tonemap=bt2390:peak=100:desat=0";

// Pass 1: Normalize devices and swap to vaapi path + qsv@va
for (let i = 0; i < FFmpeg.Args.length - 1; i++) {
  if (FFmpeg.Args[i] === "-init_hw_device") {
    const original = FFmpeg.Args[i + 1];       // e.g., "qsv=hw"
    const typeName = extractDeviceType(original); // e.g., "qsv"
    const vaInit = ensureVaapiInitFrom(original); // e.g., "vaapi=va:/dev/dri/renderD129"

    // Replace current with VAAPI init, then add "<type>@va"
    FFmpeg.Args[i + 1] = vaInit;
    FFmpeg.Args.splice(i + 2, 0, "-init_hw_device", typeName + "@va");
    i += 2; // skip the thing we just inserted
  }

  if (FFmpeg.Args[i] === "-hwaccel") {
    FFmpeg.Args[i + 1] = "vaapi";
  }
  if (FFmpeg.Args[i] === "-filter_hw_device") {
    FFmpeg.Args[i + 1] = "va";
  }
  if (FFmpeg.Args[i] === "-hwaccel_output_format") {
    FFmpeg.Args[i + 1] = "vaapi";
  }

  // If a video filter already exists, prepend tonemap + qsv remap to it
  if (FFmpeg.Args[i] === "-filter:v:0") {
    filtered = true;
    const existing = FFmpeg.Args[i + 1] || "";
    FFmpeg.Args[i + 1] = tonemap + ",hwmap=derive_device=qsv:reverse=1:extra_hw_frames=64,format=qsv"
      + (existing ? ("," + existing) : "");
  }
}

// Pass 2: If no -filter:v:0 set, inject one after the first "0:v:0"
if (!filtered) {
  for (let i = 0; i < FFmpeg.Args.length - 1; i++) {
    if (FFmpeg.Args[i] === "0:v:0") {
      FFmpeg.Args.splice(
        i + 1,
        0,
        "-filter:v:0",
        tonemap + ",hwmap=derive_device=qsv:reverse=1:extra_hw_frames=64,format=qsv",
        "-filter_hw_device",
        "va"
      );
      break;
    }
  }
}
`;

  return 1;
}