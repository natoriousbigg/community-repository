# Using whisper.cpp with OpenVINO

This note captures practical ways to run `whisper-cli` (from `whisper.cpp`) with Intel OpenVINO. The upstream project supports an optional OpenVINO backend that replaces the default CPU GGML kernels with OpenVINO execution on Intel CPUs/GPUs/NPU when built with the correct flags and model format.

## 1) Install OpenVINO runtime and headers
- Recommended: install the C/C++ developer package (for example `intel-openvino-dev` or the tarball install from Intel) so CMake can find OpenVINO.
- Source the environment before building:
  ```bash
  source /opt/intel/openvino/setupvars.sh
  ```
- Minimal tools: `cmake`, `pkg-config`, and a C++17 compiler.

## 2) Convert a Whisper model to OpenVINO IR
whisper.cpp’s OpenVINO backend expects an OpenVINO IR pair (`.xml` + `.bin`). You can export from a Hugging Face checkpoint with `optimum-intel` or OpenVINO’s CLI:
```bash
pip install "optimum-intel[openvino]" transformers
optimum-cli export openvino \
  --model openai/whisper-small \
  --task automatic-speech-recognition \
  --weight-format fp16 \
  ./models/whisper-small-openvino
```
This produces `whisper-small.xml` and `whisper-small.bin` under `./models/whisper-small-openvino/`.

## 3) Build whisper.cpp with OpenVINO enabled
From the whisper.cpp source directory:
```bash
cmake -B build -S . \
  -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_OPENVINO=ON
cmake --build build -j
```
This builds `build/bin/whisper-cli` linked against OpenVINO. Keep the OpenVINO environment sourced when running to ensure runtime libraries are found.

## 4) Run language detection with OpenVINO backend
Use the exported IR model and the OpenVINO-enabled binary:
```bash
./build/bin/whisper-cli \
  -m ./models/whisper-small-openvino/whisper-small.xml \
  -f sample.wav \
  -l auto \
  --output-json \
  --output-file /tmp/whisper-openvino
```
Notes:
- The `-m` path must point to the `.xml` file; the `.bin` sits beside it.
- OpenVINO still runs the decode pipeline (no true “detect only” mode), but setting `-l auto` exposes the detected language at startup so you can stop processing early if desired.

## 5) Troubleshooting
- If `cmake` cannot find OpenVINO, confirm `setupvars.sh` is sourced in the same shell and that `pkg-config --modversion openvino` returns a version.
- If the binary at runtime reports missing OpenVINO shared libraries, re-source `setupvars.sh` or add the OpenVINO `lib` folders to `LD_LIBRARY_PATH`.
- Throughput benefits show on recent Intel CPUs/GPUs with AVX512/VNNI/Xe; fallback to CPU GGML will occur if the OpenVINO backend is not enabled at build time.
