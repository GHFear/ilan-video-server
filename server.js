/* 
  -------------------------------------------------------------------------------------------------------
  IllusorySoftware LAN Video Player 0.1.0
  -------------------------------------------------------------------------------------------------------
  By GHFear @ IllusorySoftware
  -------------------------------------------------------------------------------------------------------
  Project I started because I wanted to watch movies and TV shows I have on my computer, but on my phone. 
  -------------------------------------------------------------------------------------------------------
*/

import express from "express";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";
import { execFile, spawn } from "child_process";
import { extractSubtitles } from "./extractSubtitles.js";
import { ffmpegManager } from "./ffmpegManager.js";

const app = express();
const PORT = 3000;

const VIDEO_DIR = path.resolve("./videos");
const PUBLIC_DIR = path.resolve("./public");
const THUMB_DIR = path.resolve("./thumbs");
await fsPromises.mkdir(THUMB_DIR, { recursive: true });

let activeStream = null; // Keep track if stream is active or not

// Get video duration from into
function getDuration(info) {
  return Number(info.format?.duration || 0);
}

// Estimate the bitrate from filesize and duration
function estimateBitrate(fileSize, duration) {
  return duration > 0 ? fileSize / duration : 0; // bytes/sec
}

// Calc range to seconds
function rangeToSeconds(rangeHeader, bitrate) {
  if (!rangeHeader || !bitrate) return 0;

  const match = rangeHeader.match(/bytes=(\d+)/);
  if (!match) return 0;

  const byteOffset = Number(match[1]);
  return Math.floor(byteOffset / bitrate);
}



// Thumbnail path
function getThumbPath(videoPath) {
  const relPath = path.relative(VIDEO_DIR, videoPath);
  const safeName = relPath.replace(/\//g, "__"); // nested folder safe
  return path.join(THUMB_DIR, safeName + ".png");
}

// Generate thumbnail
async function generateThumbnail(videoPath, time = 3) {
  const thumbPath = getThumbPath(videoPath);

  try {
    const [videoStat, thumbStat] = await Promise.allSettled([
      fsPromises.stat(videoPath),
      fsPromises.stat(thumbPath)
    ]);

    if (
      videoStat.status === "fulfilled" &&
      thumbStat.status === "fulfilled" &&
      thumbStat.value.mtimeMs > videoStat.value.mtimeMs
    ) return thumbPath;

    const args = [
      "-ss", String(time),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", "scale=320:-1",
      "-f", "image2",
      thumbPath
    ];

    const ffmpeg = ffmpegManager.start(videoPath + ":thumb", args);

    return new Promise((resolve, reject) => {
      ffmpeg.on("exit", code => {
        ffmpegManager.release(videoPath + ":thumb");
        code === 0 ? resolve(thumbPath) : reject(new Error("FFmpeg thumbnail failed"));
      });
    });
  } catch (err) {
    console.error("Thumbnail generation failed:", err);
    return null;
  }
}

// Probe video
function probe(filePath) {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", filePath], (err, stdout) => {
      if (err) return reject(err);
      resolve(JSON.parse(stdout));
    });
  });
}

// Get audio information from probe
function getAudioTracks(info) {
  return info.streams
    .filter(s => s.codec_type === "audio")
    .map((s, i) => ({
      index: s.index - 1,
      codec: s.codec_name,
      channels: s.channels,
      layout: s.channel_layout || "",
      language: s.tags?.language || "und",
      title: s.tags?.title || `Track ${i + 1}`,
      default: s.disposition?.default === 1
    }));
}

// Decide how to play the video
function decideAction(info) {
  const video = info.streams.find(s => s.codec_type === "video");
  const audio = info.streams.find(s => s.codec_type === "audio");
  if (!video || !audio) return "unsupported";

  const videoOk = video.codec_name === "h264";
  const audioOk = audio.codec_name === "aac";

  if (videoOk && audioOk) return "direct";
  if (videoOk) return "transmux";
  return "transcode";
}

// Live stream
function liveStream(filePath, req, res, mode, audioIndex) {
  if (activeStream) {
    activeStream.kill("SIGKILL");
    activeStream = null;
  }

  const args = mode === "transmux"
  ? [
      "-i", filePath,
      "-map", "0:v:0",
      "-map", audioIndex !== undefined ? `0:a:${audioIndex}` : "0:a:0",
      "-c", "copy",
      "-movflags", "frag_keyframe+empty_moov",
      "-f", "mp4",
      "pipe:1"
    ]
  : [
      "-i", filePath,
      "-map", "0:v:0",
      "-map", audioIndex !== undefined ? `0:a:${audioIndex}` : "0:a:0",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-ac", "2",
      "-af", "pan=stereo|FL=0.5*FL+0.707*FC+0.5*BL|FR=0.5*FR+0.707*FC+0.5*BR",
      "-movflags", "frag_keyframe+empty_moov",
      "-f", "mp4",
      "pipe:1"
    ];

  const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
  activeStream = ffmpeg;

  res.writeHead(200, { "Content-Type": "video/mp4", "Transfer-Encoding": "chunked", "Cache-Control": "no-store" });
  ffmpeg.stdout.pipe(res);

  const cleanup = () => {
    if (activeStream === ffmpeg) {
      ffmpeg.kill("SIGKILL");
      activeStream = null;
    }
  };

  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
  ffmpeg.on("exit", cleanup);
}

// Stream directly, if supported
function streamDirect(filePath, req, res, audioIndex) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".mp4" ? "video/mp4" : ext === ".mkv" ? "video/x-matroska" : null;
  if (!mime) return res.status(415).send("Unsupported media type");

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const [start, end] = range.replace(/bytes=/, "").split("-").map(Number);
    const chunkEnd = end || stat.size - 1;
    res.writeHead(206, { "Content-Range": `bytes ${start}-${chunkEnd}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": chunkEnd - start + 1, "Content-Type": mime });
    fs.createReadStream(filePath, { start, end: chunkEnd }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": stat.size, "Content-Type": mime });
    fs.createReadStream(filePath).pipe(res);
  }
}

// Enable trust proxy
app.set("trust proxy", true);

// Print user interaction information (For security)
app.use((req, res, next) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress;

  console.log(`[${new Date().toISOString()}] ${ip} → ${req.method} ${req.originalUrl}`);
  next();
})

// Serve static
app.use(express.static(PUBLIC_DIR));

// Browse folders api
app.get("/api/browse", async (req, res) => {
  try {
    const folder = req.query.path || "";
    const requestedPath = path.join(VIDEO_DIR, folder);
    if (!requestedPath.startsWith(VIDEO_DIR)) return res.status(403).json({ error: "Access denied" });

    const entries = await fsPromises.readdir(requestedPath, { withFileTypes: true });
    const folders = [], videos = [];
    const allFilenames = entries.map(e => e.name);

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = folder ? `${folder}/${entry.name}` : entry.name;

        // Look for first video inside folder
        const subEntries = await fsPromises.readdir(path.join(requestedPath, entry.name), { withFileTypes: true });
        const firstVideo = subEntries.find(e => e.isFile() && /\.(mp4|mkv)$/i.test(e.name));

        const folderThumbnail = firstVideo
          ? `/thumbnail/${encodeURIComponent(subPath + "/" + firstVideo.name)}`
          : null;

        folders.push({
          name: entry.name,
          path: subPath,
          thumbnail: folderThumbnail
        });
      } else if (entry.isFile() && /\.(mp4|mkv)$/i.test(entry.name)) {
        const videoPath = path.join(requestedPath, entry.name);

        const subs = (await extractSubtitles(videoPath)).map(f => folder ? `${folder}/${f}` : f);
        const externalSubs = entries
          .map(e => e.name)
          .filter(f => f.startsWith(path.parse(entry.name).name) && /\.(srt|vtt)$/i.test(f))
          .map(f => folder ? `${folder}/${f}` : f);

        const info = await probe(videoPath);
        const audioTracks = getAudioTracks(info);

        videos.push({
          name: entry.name,
          subtitles: [...new Set([...subs, ...externalSubs])],
          audioTracks
        });
      }
    }

    res.json({ path: folder, folders, videos });
  } catch (err) {
    console.error("Browse error:", err);
    res.status(500).json({ folders: [], videos: [] });
  }
});

// Video streaming
app.get("/video/:name", async (req, res) => {
  try {
    const filePath = path.join(VIDEO_DIR, decodeURIComponent(req.params.name));
    if (!filePath.startsWith(VIDEO_DIR) || !fs.existsSync(filePath)) return res.sendStatus(404);

    const info = await probe(filePath);
    const action = decideAction(info);
    const audioIndex = Number(req.query.audio ?? 0);
    if (action === "direct") return streamDirect(filePath, req, res, audioIndex);
    if (action === "transmux") return liveStream(filePath, req, res, "transmux", audioIndex, info);
    if (action === "transcode") return liveStream(filePath, req, res, "transcode", audioIndex, info);

    res.sendStatus(415);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// Subtitles
app.get("/subtitles/:name", (req, res) => {
  try {
    const relPath = decodeURIComponent(req.params.name);
    const filePath = path.join(VIDEO_DIR, relPath);
    if (!filePath.startsWith(VIDEO_DIR)) return res.status(403).send("Access denied");
    if (!fs.existsSync(filePath)) return res.sendStatus(404);

    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".srt") res.type("text/srt");
    else if (ext === ".vtt") res.type("text/vtt");
    else return res.status(415).send("Unsupported subtitle format");

    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("Subtitle serve error:", err);
    res.sendStatus(500);
  }
});

// Thumbnails
app.get("/thumbnail/:name", async (req, res) => {
  try {
    const relPath = decodeURIComponent(req.params.name);
    const videoPath = path.join(VIDEO_DIR, relPath);
    if (!videoPath.startsWith(VIDEO_DIR) || !fs.existsSync(videoPath)) return res.sendStatus(404);

    const thumbPath = await generateThumbnail(videoPath);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err) {
    console.error("Thumbnail error:", err);
    res.sendStatus(500);
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running:`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) console.log(`➡ http://${net.address}:${PORT}`);
    }
  }
});
