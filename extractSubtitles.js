/* 
  -------------------------------------------------------------------------------------------------------
  IllusorySoftware LAN Video Player 0.1.0
  -------------------------------------------------------------------------------------------------------
  By GHFear @ IllusorySoftware
  -------------------------------------------------------------------------------------------------------
  Project I started because I wanted to watch movies and TV shows I have on my computer, but on my phone. 
  -------------------------------------------------------------------------------------------------------
*/

import { execFile } from "child_process";
import path from "path";
import fs from "fs";

/**
 * Auto-extract embedded subtitles to VTT
 * @param {string} filePath Absolute path to the video
 * @returns {Promise<string[]>} Array of generated subtitle file names
 */

export async function extractSubtitles(videoPath) {
  const dir = path.dirname(videoPath);
  const base = path.parse(videoPath).name;

  const info = await new Promise((resolve, reject) => {
    execFile("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_streams",
      videoPath
    ], (err, out) => {
      if (err) reject(err);
      else resolve(JSON.parse(out));
    });
  });

  const subtitleStreams = info.streams.filter(s => s.codec_type === "subtitle");
  const outputs = [];

  for (let i = 0; i < subtitleStreams.length; i++) {
    const s = subtitleStreams[i];

    const lang = s.tags?.language || "und";
    const title = s.tags?.title || "sub";

    // 🔑 ALWAYS output VTT
    const outName = `${base}.${lang}.${title}.vtt`;
    const outPath = path.join(dir, outName);

    if (fs.existsSync(outPath)) {
      outputs.push(outName);
      continue;
    }

    await new Promise((resolve, reject) => {
      execFile("ffmpeg", [
        "-y",
        "-i", videoPath,
        "-map", `0:s:${i}`,
        "-c:s", "webvtt",
        outPath
      ], err => (err ? reject(err) : resolve()));
    });

    outputs.push(outName);
  }

  return outputs;
}
