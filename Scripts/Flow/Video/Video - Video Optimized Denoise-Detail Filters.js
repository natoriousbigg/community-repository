/**
 * @name Video - Video Optimized Denoise-Detail Filters
 * @author Ken
 * @revision 9
 * @minimumVersion 1.0.0.0
 * @output Output 1
 * @output Output 2
 * @output Output 3
 * @output Output 4
 */
function Script()
{
    // ----------------------------------------------------
    // 0) Get first video stream (same style as sample scripts)
    // ----------------------------------------------------
    let video = Variables.vi?.VideoInfo?.VideoStreams[0];
    if (!video)
    {
        Logger.ELog("[AIO] No video stream in Variables.vi.VideoInfo.VideoStreams[0] → return -1.");
        Variables.VppFilterDenoiseDetail = "";
        return -1;
    }

    Logger.ILog("[AIO] ---- Start ----");

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
        Logger.ILog("[AIO] Parsed width  = " + w);
        if (w >= 3800)
            is4k = true;
    }
    if (h != null && !isNaN(h))
    {
        h = Number(h);
        Logger.ILog("[AIO] Parsed height = " + h);
        if (h >= 2000)
            is4k = true;
    }

    Logger.ILog("[AIO] is4k = " + is4k);

    // ----------------------------------------------------
    // 2) Get or compute est = bytes/hr
    // ----------------------------------------------------
    let est = Variables.OptimizedEstimatePerHour;
    let needFallback = (est == null || est === "" || isNaN(est) || Number(est) <= 0);

    if (needFallback)
    {
        Logger.WLog("[AIO] OptimizedEstimatePerHour missing/invalid → fallback to filesize + duration.");

        // Prefer original size, fall back to current file size
        let size = null;
        if (Variables.file && Variables.file.Orig && Variables.file.Orig.Size)
            size = Variables.file.Orig.Size;
        else if (Variables.file && Variables.file.Size)
            size = Variables.file.Size;

        // Use TotalMinutes as per sample script
        let minutes = 0;
        if (video.Duration && typeof video.Duration.TotalMinutes === "number")
        {
            minutes = Math.ceil(video.Duration.TotalMinutes);
        }
        else if (video.Duration && typeof video.Duration.TotalMinutes === "string")
        {
            let m = Number(video.Duration.TotalMinutes);
            if (!isNaN(m))
                minutes = Math.ceil(m);
        }

        const GB = 1024 * 1024 * 1024;

        Logger.ILog("[AIO] Raw file.(Orig.)Size or file.Size = " + size);
        if (size != null && !isNaN(size))
            Logger.ILog("[AIO] Filesize ≈ " + (size / GB).toFixed(2) + " GB");

        Logger.ILog("[AIO] video.Duration.TotalMinutes = "
            + (video.Duration ? video.Duration.TotalMinutes : "null"));
        Logger.ILog("[AIO] Parsed durationMinutes = " + minutes + " min");

        // If we still don't have valid size/duration → fail with -1
        if (!size || isNaN(size) || !minutes || isNaN(minutes) || size <= 0 || minutes <= 0)
        {
            Logger.ELog("[AIO] Fallback failed (invalid size/duration) → return -1.");
            Variables.VppFilterDenoiseDetail = "";
            return -1;
        }

        let hours = minutes / 60.0;
        est = size / hours; // bytes per hour

        Logger.ILog("[AIO] Fallback est = " + est + " bytes/hr");
    }
    else
    {
        est = Number(est);
        Logger.ILog("[AIO] Using provided OptimizedEstimatePerHour = " + est + " bytes/hr");
    }

    // ----------------------------------------------------
    // 3) Thresholds
    // ----------------------------------------------------
    const GB = 1024 * 1024 * 1024;

    // Debug GB/hr
    let estGBhr = est / GB;
    Logger.ILog("[AIO] est ≈ " + estGBhr.toFixed(2) + " GB/hr");

    // 4K thresholds
    const T4K1 = 20 * GB;
    const T4K2 = 10 * GB;
    const T4K3 = 5  * GB;

    // non-4K thresholds (1080p and below)
    const T1080_1 = 9    * GB;
    const T1080_2 = 4.5  * GB;
    const T1080_3 = 2.25 * GB;

    // ----------------------------------------------------
    // 4) Classify + set Variables.VppFilterDenoiseDetail
    // ----------------------------------------------------
    if (is4k)
    {
        Logger.ILog("[AIO] Using 4K thresholds");

        if (est > T4K1)
        {
            Logger.ILog("[AIO] Bucket 1 (4K, >20 GB/hr) → strong denoise");
            Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=45:detail=30";
            return 1;
        }
        if (est > T4K2)
        {
            Logger.ILog("[AIO] Bucket 2 (4K, >10 GB/hr)");
            Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=36:detail=24";
            return 2;
        }
        if (est > T4K3)
        {
            Logger.ILog("[AIO] Bucket 3 (4K, >5 GB/hr)");
            Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=28:detail=18";
            return 3;
        }

        Logger.ILog("[AIO] Bucket 4 (4K, <=5 GB/hr) → no denoise/detail");
        Variables.VppFilterDenoiseDetail = "";
        return 4;
    }

    // --- Non-4K (1080p and below) ---
    Logger.ILog("[AIO] Using 1080p / non-4K thresholds");

    if (est > T1080_1)
    {
        Logger.ILog("[AIO] Bucket 1 (non-4K, >9 GB/hr) → strong denoise");
        Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=45:detail=30";
        return 1;
    }
    if (est > T1080_2)
    {
        Logger.ILog("[AIO] Bucket 2 (non-4K, >4.5 GB/hr)");
        Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=36:detail=24";
        return 2;
    }
    if (est > T1080_3)
    {
        Logger.ILog("[AIO] Bucket 3 (non-4K, >2.25 GB/hr)");
        Variables.VppFilterDenoiseDetail = "vpp_qsv=denoise=28:detail=18";
        return 3;
    }

    Logger.ILog("[AIO] Bucket 4 (non-4K, <=2.25 GB/hr) → no denoise/detail");
    Variables.VppFilterDenoiseDetail = "";
    return 4;
}