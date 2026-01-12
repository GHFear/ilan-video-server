/* 
  -------------------------------------------------------------------------------------------------------
  IllusorySoftware LAN Video Player 0.1.0
  -------------------------------------------------------------------------------------------------------
  By GHFear @ IllusorySoftware
  -------------------------------------------------------------------------------------------------------
  Project I started because I wanted to watch movies and TV shows I have on my computer, but on my phone. 
  -------------------------------------------------------------------------------------------------------
*/

const list = document.getElementById("list");
const player = document.getElementById("player");
const audioSelect = document.getElementById("audioSelect");
const videoTitle = document.getElementById("video-title");

let currentPath = ""; // relative to VIDEO_DIR

// Populate the audiomodes in the selector dropdown
function populateAudioTracks(audioTracks) {
  audioSelect.innerHTML = `
    <option value="" disabled selected hidden>
      Select audio mode
    </option>
  `;

  let defaultIndex = null; // Default audio track index

  audioTracks.forEach(track => {
    const opt = document.createElement("option");

    // Build channel type
    const channels =
      track.channels === 1 ? "Mono" :
      track.channels === 2 ? "Stereo" :
      `${track.channels}.1`;

    // Create label
    const labelParts = [
      track.language.toUpperCase(),
      channels,
      track.codec.toUpperCase(),
      track.title && `– ${track.title}`
    ].filter(Boolean);

    opt.value = track.index;
    opt.textContent = labelParts.join(" ");

    // Set default audio track based on flag
    if (track.default) {
      opt.selected = true;
      defaultIndex = track.index;
    }

    audioSelect.appendChild(opt);
  });

  // If browser didn't auto-select, force it
  if (defaultIndex !== null) {
    audioSelect.value = defaultIndex;
  }
}


// Create subtitle name from filename
function getSubtitleTitle(filename) {
  // Remove the extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, ""); // removes .vtt, .srt, etc.

  // Split by dots
  const parts = nameWithoutExt.split(".");

  // Take last 1 or 2 parts (language + description)
  if (parts.length >= 2) {
    return parts.slice(-2).join(" ");
  } else if (parts.length === 1) {
    return parts[0];
  } else {
    return "Sub";
  }
}

// Load a folder (root by default)
async function loadFolder(folder = "") {
  currentPath = folder;
  list.innerHTML = "";

  const res = await fetch(`/api/browse?path=${encodeURIComponent(folder)}`);
  const data = await res.json();

  // "Up" button if not root
  if (folder) {
    const upBtn = document.createElement("div");
    upBtn.className = "thumb";
    upBtn.innerHTML = `<span>..</span>`;
    upBtn.onclick = () => {
      const parent = folder.split("/").slice(0, -1).join("/");
      loadFolder(parent);
    };
    list.appendChild(upBtn);
  }

  // Folders
  for (const f of data.folders) {
    const folderEl = document.createElement("div");
    folderEl.className = "thumb";

    const thumbUrl = f.thumbnail || "/folder.png";
    folderEl.innerHTML = `<img src="${thumbUrl}" alt="${f.name}" /><span>${f.name}</span>`;
    folderEl.onclick = () => loadFolder(f.path);

    list.appendChild(folderEl);
  }

  // Videos
  for (const video of data.videos) {
    const videoRelPath = currentPath ? `${currentPath}/${video.name}` : video.name;
    const videoUrl = `/video/${encodeURIComponent(videoRelPath)}`;
    const thumbUrl = `/thumbnail/${encodeURIComponent(videoRelPath)}`;

    const thumbEl = document.createElement("div");
    thumbEl.className = "thumb";

    const img = document.createElement("img");
    img.src = thumbUrl;
    img.alt = video.name;
    img.loading = "lazy";
    img.onerror = () => { img.src = "/no-thumb.png"; };

    const label = document.createElement("span");
    label.textContent = video.name;

    thumbEl.appendChild(img);
    thumbEl.appendChild(label);
    list.appendChild(thumbEl);

    thumbEl.onclick = () => {
      document.querySelectorAll(".thumb").forEach(t => t.classList.remove("active"));
      thumbEl.classList.add("active");

      player.src = videoUrl;
      player.innerHTML = "";

      // Set video title for the on click event
      videoTitle.textContent = video.name.replace(/\.(mp4|mkv)$/i, "");

      // Populate the audio track dropdown
      populateAudioTracks(video.audioTracks);

      video.subtitles.forEach(sub => {
        const track = document.createElement("track");
        const subName = sub.split("/").pop();
        const lang = subName.split(".").slice(-2, -1)[0] || "Sub";

        track.kind = "subtitles";
        track.label = getSubtitleTitle(subName);
        track.srclang = lang;
        track.src = `/subtitles/${encodeURIComponent(sub)}`;
        player.appendChild(track);
      });

      // Set selected audio and reload player
      audioSelect.onchange = () => {
        const audioIndex = audioSelect.value;
        player.src = `/video/${encodeURIComponent(videoRelPath)}?audio=${audioIndex}`;
        player.load();
        player.play();
        videoTitle.textContent = video.name.replace(/\.(mp4|mkv)$/i, "");
      }

      player.load();
      player.play();
    };
  }
}

// Load root folder on start
loadFolder();
