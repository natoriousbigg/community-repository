/**
 * @name Video - Video Optimized Denoise-Detail Filters
 * @description
 *  Uses OptimizedEstimatePerHour (or falls back to file.Orig.Size + duration)
 *  to:
 *   - classify video into 4K vs non-4K
 *   - split into 4 GB/hr buckets
 *   - set Variables.VppFilterDenoiseDetail with vpp_qsv denoise/detail
 *   - return Output 1–4 for routing
 *
 *  4K buckets (in GB/hr):
 *      1) > 20
 *      2) > 10
 *      3) > 5
 *      4) ≤ 5 (no denoise/detail)
 *
 *  non-4K (1080p and below) buckets (in GB/hr):
 *      1) > 9
 *      2) > 4.5
 *      3) > 2.25
 *      4) ≤ 2.25 (no denoise/detail)
 *
 *  Fallback GB/hr:
 *      estBytesPerHour = file.Orig.Size (bytes) / (durationHours)
 *
 *  If GB/hr cannot be calculated, returns -1.
 *
 * @author Ken
 * @revision 25
 * @outputs 4
 */

function Script()
{
    const GB = 1024 * 1024 * 1024;

    Logger.ILog("[AIO] ---- Start ----");

    // ----------------------------------------------------
    // 0) Get first video stream
    // ----------------------------------------------------
    let video = Variables.vi?.VideoInfo?.VideoStreams?.[0];
    if (!video)
    {
        Logger.ELog("[AIO] No video stream in Variables.vi?.VideoInfo?.VideoStreams[0] → return -1.");
        Variables.VppFilterDenoiseDetail = "";
        return -1;
    }

    // ----------------------------------------------------
    // 1) Resolution detection: 4K vs non-4K
    // ----------------------------------------------------
    let w = video.Width;
    let h = video.Height;

    Logger.ILog("[AIO] video.Width  = " + w);
    Logger.ILog("[AIO] video.Height = " + h);

    let is4k = false;

    if (w != null && !isNaN(w))
    {
        w = Number(w);
        if (w >= 3800)
            is4k = true;
    }
    if (h != null && !isNaN(h))
    {
        h = Number(h);
        if (h >= 2000)
            is4k = true;
    }

    Logger.ILog("[AIO] is4k = " + is4k);

    // ----------------------------------------------------
    // 2) Filesize (bytes) – prefer file.Orig.Size
    // ----------------------------------------------------
    let sizeBytes = null;

    if (Variables["file.Orig.Size"] != null && !isNaN(Variables["file.Orig.Size"]))
        sizeBytes = Number(Variables["file.Orig.Size"]);
    else if (Variables["file.Size"] != null && !isNaN(Variables["file.Size"]))
        sizeBytes = Number(Variables["file.Size"]);

    let sizeGB = sizeBytes ? (sizeBytes / GB) : 0;

    // ----------------------------------------------------
    // 3) Duration in minutes from video.Duration.TotalMinutes
    // ----------------------------------------------------
    let videoMinutes = null;
    if (video.Duration && typeof video.Duration.TotalMinutes !== "undefined")
    {
        let rawMinutes = video.Duration.TotalMinutes;
        if (typeof rawMinutes === "number")
            videoMinutes = Math.ceil(rawMinutes);
        else
        {
            let num = Number(rawMinutes);
            if (!isNaN(num))
                videoMinutes = Math.ceil(num);
        }
    }

    Logger.ILog("[AIO] file.Orig.Size (bytes): " + Variables["file.Orig.Size"]);
    Logger.ILog("[AIO] file.Size (bytes):      " + Variables["file.Size"]);
    Logger.ILog("[AIO] Chosen filesize (bytes): " + sizeBytes);
    Logger.ILog("[AIO] Chosen filesize (GB):    " + (sizeGB ? sizeGB.toFixed(3) : "NaN"));
    Logger.ILog("[AIO] Video length raw TotalMinutes: " + (video.Duration ? video.Duration.TotalMinutes : "null"));
    Logger.ILog("[AIO] Video length (min, rounded):   " + videoMinutes);

    // ----------------------------------------------------
    // 4) Determine estBytesPerHour (bytes/hr)
    // ----------------------------------------------------
    let estBytesPerHour = null;

    // 4a) Use OptimizedEstimatePerHour if valid
    let estVar = Variables.OptimizedEstimatePerHour;
    if (estVar != null && estVar !== "" && !isNaN(estVar) && Number(estVar) > 0)
    {
        estBytesPerHour = Number(estVar);
        Logger.ILog("[AIO] Using Variables.OptimizedEstimatePerHour: " + estBytesPerHour + " bytes/hr");
    }
    else
    {
        Logger.WLog("[AIO] OptimizedEstimatePerHour missing/invalid → fallback to file.Orig.Size + duration.");

        if (sizeBytes && !isNaN(sizeBytes) &&
            videoMinutes && !isNaN(videoMinutes) &&
            sizeBytes > 0 && videoMinutes > 0)
        {
            let hours = videoMinutes / 60.0;
            estBytesPerHour = sizeBytes / hours;

            Logger.ILog("[AIO] Fallback sizeBytes: " + sizeBytes + " bytes (" + sizeGB.toFixed(3) + " GB)");
            Logger.ILog("[AIO] Fallback duration:  " + videoMinutes + " minutes");
            Logger.ILog("[AIO] Fallback est (bytes/hr): " + estBytesPerHour);
        }
    }

    // 4b) Bail if we still can't compute GB/hr
    if (!estBytesPerHour || isNaN(estBytesPerHour) || estBytesPerHour <= 0)
    {
        Logger.ELog("[AIO] Cannot calculate GB/hr (no valid estBytesPerHour) → return -1.");
        Variables.VppFilterDenoiseDetail = "";
        return -1;
    }

    let estGBhr = estBytesPerHour / GB;
    Logger.ILog("[AIO] Final est ≈ " + estGBhr.toFixed(3) + " GB/hr");

    // ----------------------------------------------------
    // 5) Thresholds (bytes/hr)
    // ----------------------------------------------------
    // 4K thresholds
    const T4K1    = 20 * GB;   // >20 GB/hr
    const T4K2    = 10 * GB;   // >10 GB/hr
    const T4K3    = 5  * GB;   // > 5 GB/hr

    // 1080p / non-4K thresholds
    const T1080_1 = 9    * GB; // > 9 GB/hr
    const T1080_2 = 4.5  * GB; // > 4.5 GB/hr
    const T1080_3 = 2.25 * GB; // > 2.25 GB/hr

    // ----------------------------------------------------
    // 6) Bucket classification + VppFilterDenoiseDetail
    // ----------------------------------------------------
    if (is4k)
    {
        Logger.ILog("[AIO] Using 4K thresholds: >20 / >10 / >5 GB/hr");

        if (estBytesPerHour > T4K1)
        {
            Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=45:detail=30";
            Logger.ILog("[AIO] 4K → Bucket 1, filter: " + Variables.VppFilterDenoiseDetail);
            return 1;
        }
        if (estBytesPerHour > T4K2)
        {
            Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=36:detail=24";
            Logger.ILog("[AIO] 4K → Bucket 2, filter: " + Variables.VppFilterDenoiseDetail);
            return 2;
        }
        if (estBytesPerHour > T4K3)
        {
            Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=28:detail=18";
            Logger.ILog("[AIO] 4K → Bucket 3, filter: " + Variables.VppFilterDenoiseDetail);
            return 3;
        }

        Variables.VppFilterDenoiseDetail = "";
        Logger.ILog("[AIO] 4K → Bucket 4, no denoise/detail");
        return 4;
    }

    // Non-4K path
    Logger.ILog("[AIO] Using 1080p/non-4K thresholds: >9 / >4.5 / >2.25 GB/hr");

    if (estBytesPerHour > T1080_1)
    {
        Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=45:detail=30";
        Logger.ILog("[AIO] HD → Bucket 1, filter: " + Variables.VppFilterDenoiseDetail);
        return 1;
    }
    if (estBytesPerHour > T1080_2)
    {
        Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=36:detail=24";
        Logger.ILog("[AIO] HD → Bucket 2, filter: " + Variables.VppFilterDenoiseDetail);
        return 2;
    }
    if (estBytesPerHour > T1080_3)
    {
        Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=28:detail=18";
        Logger.ILog("[AIO] HD → Bucket 3, filter: " + Variables.VppFilterDenoiseDetail);
        return 3;
    }

    Variables.VppFilterDenoiseDetail = "";
    Logger.ILog("[AIO] HD → Bucket 4, no denoise/detail");
    return 4;
}
