/* 
  -------------------------------------------------------------------------------------------------------
  IllusorySoftware LAN Video Player 0.1.0
  -------------------------------------------------------------------------------------------------------
  By GHFear @ IllusorySoftware
  -------------------------------------------------------------------------------------------------------
  Project I started because I wanted to watch movies and TV shows I have on my computer, but on my phone. 
  -------------------------------------------------------------------------------------------------------
*/

// Source: ChatGPT

import { spawn } from "child_process";

class FfmpegManager {
  constructor() {
    this.processes = new Map(); // key: videoPath, value: { ffmpeg, usageCount, timeout }
  }

  /**
   * Start or reuse an FFmpeg process
   * @param {string} videoPath
   * @param {Array<string>} args FFmpeg args
   */
  start(videoPath, args) {
    // If already running, increase usage count and return the stdout
    if (this.processes.has(videoPath)) {
      const entry = this.processes.get(videoPath);
      entry.usageCount++;
      // cancel pending kill if it exists
      if (entry.timeout) clearTimeout(entry.timeout);
      return entry.ffmpeg;
    }

    // Spawn new process
    const ffmpeg = spawn("ffmpeg", args);

    // Track process
    this.processes.set(videoPath, {
      ffmpeg,
      usageCount: 1,
      timeout: null
    });

    ffmpeg.on("exit", () => {
      this.processes.delete(videoPath);
    });

    return ffmpeg;
  }

  /**
   * Mark usage done
   * @param {string} videoPath
   * @param {number} idleTime milliseconds before killing FFmpeg
   */
  release(videoPath, idleTime = 5000) {
    const entry = this.processes.get(videoPath);
    if (!entry) return;

    entry.usageCount--;
    if (entry.usageCount <= 0) {
      // schedule kill after idleTime
      entry.timeout = setTimeout(() => {
        entry.ffmpeg.kill("SIGKILL");
        this.processes.delete(videoPath);
      }, idleTime);
    }
  }

  /**
   * Kill all FFmpeg processes (e.g. on server shutdown)
   */
  killAll() {
    for (const entry of this.processes.values()) {
      entry.ffmpeg.kill("SIGKILL");
    }
    this.processes.clear();
  }
}

export const ffmpegManager = new FfmpegManager();
