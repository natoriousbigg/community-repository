/**
 * @name Video - Create DoVi fallback (QSV)
 * @description Tonemaps DoVi without a fallback to HDR (QSV + opencl)
 * @help Put me before ffmpeg execute, supports Linux (VAAPI) and Windows (d3d11va)
 * @note Rev 23: only the Windows fallback argument builder was adjusted; Linux behavior is unchanged.
 * @author lawrence
 * @revision 23
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
  var d3dInitSet = false;
  var qsvInitSet = false;
    var tonemap = "hwmap=derive_device=opencl,tonemap_opencl=format=p010le:p=bt2020:t=smpte2084:m=bt2020:tonemap=bt2390:peak=100:desat=0,hwmap=derive_device=qsv:reverse=1:extra_hw_frames=64,format=qsv";

for (let i = 0; i < FFmpeg.Args.length - 1; i++) {
  if (FFmpeg.Args[i] === "-init_hw_device") {
    const initVal = String(FFmpeg.Args[i + 1] || "");
    if (initVal.startsWith("opencl=")) {
      openclInitSet = true;
      FFmpeg.Args[i + 1] = "opencl=ocl:0";
    } else if (initVal.startsWith("qsv=")) {
      qsvInitSet = true;
      FFmpeg.Args[i + 1] = "qsv=qsv:hw_any,child_device=d3d11";
    } else if (initVal.startsWith("d3d11va=")) {
      d3dInitSet = true;
      FFmpeg.Args[i + 1] = "d3d11va=d3d11";
    }
  }
  if (FFmpeg.Args[i] === "-hwaccel") {
    FFmpeg.Args[i + 1] = "d3d11va";
  }
  if (FFmpeg.Args[i] === "-hwaccel_output_format") {
    FFmpeg.Args[i + 1] = "d3d11";
  }
    if (FFmpeg.Args[i] === "-filter:v:0") {
      filtered = true;
      let existing = FFmpeg.Args[i + 1] || "";
      FFmpeg.Args[i + 1] = tonemap + (existing ? "," + existing : "");
    }
  }

if (!qsvInitSet) {
  FFmpeg.Args.unshift("-init_hw_device", "qsv=qsv:hw_any,child_device=d3d11");
  qsvInitSet = true;
}
if (!openclInitSet) {
  FFmpeg.Args.unshift("-init_hw_device", "opencl=ocl:0");
  openclInitSet = true;
}
if (!d3dInitSet) {
  FFmpeg.Args.unshift("-init_hw_device", "d3d11va=d3d11");
  d3dInitSet = true;
}
if (!FFmpeg.Args.includes("-hwaccel_output_format")) {
  const accelIdx = FFmpeg.Args.indexOf("-hwaccel");
  if (accelIdx !== -1) {
    FFmpeg.Args.splice(accelIdx + 2, 0, "-hwaccel_output_format", "d3d11");
  } else {
    FFmpeg.Args.unshift("-hwaccel", "d3d11va", "-hwaccel_output_format", "d3d11");
  }
}
if (!filtered) {
  for (let i = 0; i < FFmpeg.Args.length - 1; i++) {
    if (FFmpeg.Args[i] === "0:v:0") {
      FFmpeg.Args.splice(i + 1, 0, "-filter:v:0", tonemap);
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