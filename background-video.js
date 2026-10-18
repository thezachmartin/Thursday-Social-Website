(() => {
  const video = document.querySelector("#background-video");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  async function playVideo() {
    try {
      await video.play();
    } catch (error) {
      // Keep the poster when autoplay is blocked.
      if (error.name !== "AbortError") {
        console.warn("Background video playback unavailable.", error);
      }
    }
  }

  function applyMotionPreference() {
    if (reducedMotion.matches) {
      video.pause();
      return;
    }

    if (!video.getAttribute("src")) {
      video.src = video.dataset.src;
    }
    if (!video.error) {
      playVideo();
    }
  }

  video.addEventListener("error", () => {
    console.warn("Background video could not load; using the poster.", video.error);
    video.hidden = true;
  });
  reducedMotion.addEventListener("change", applyMotionPreference);
  applyMotionPreference();
})();
