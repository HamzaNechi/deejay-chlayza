(function () {
    var originalCreateElement = Document.prototype.createElement;

    Document.prototype.createElement = function (tagName) {
        var element = originalCreateElement.call(this, tagName);

        if (typeof tagName === "string" && tagName.toLowerCase() === "audio") {
            Document.prototype.createElement = originalCreateElement;
            window.dispatchEvent(new CustomEvent("pablo-audio-ready", { detail: element }));
        }

        return element;
    };

    var toggle = document.querySelector(".playlist-toggle");
    var panel = document.querySelector(".playlist-panel");
    var select = document.querySelector("#playlist-tracks");
    var previous = document.querySelector(".playlist-previous");
    var play = document.querySelector(".playlist-play");
    var next = document.querySelector(".playlist-next");
    var status = document.querySelector(".playlist-status");
    var tracks = [];
    var audio = null;
    var currentTrack = 0;
    var ready = false;
    var loadingComplete = !document.querySelector(".loading");
    var startupAttempted = false;
    var waitingForGesture = false;
    var animationPausedByPlayer = false;
    var sceneEngine = null;

    function updateControls() {
        var hasTracks = tracks.length > 0;
        var canUsePlayer = ready && loadingComplete;

        select.disabled = !canUsePlayer || !hasTracks;
        previous.disabled = !canUsePlayer || tracks.length < 2;
        next.disabled = !canUsePlayer || tracks.length < 2;
        play.disabled = !canUsePlayer || !hasTracks;
        play.textContent = audio && !audio.paused ? "Pause" : "Play";
        play.setAttribute("aria-label", audio && !audio.paused ? "Pause" : "Play");
    }

    function showError(message) {
        status.textContent = message;
        status.classList.add("error");
    }

    function resumeAfterGesture(event) {
        if (!waitingForGesture || (event.target.closest && event.target.closest(".playlist"))) {
            return;
        }

        clearGestureWait();
        playCurrentTrack();
    }

    function clearGestureWait() {
        waitingForGesture = false;
        window.removeEventListener("pointerdown", resumeAfterGesture);
    }

    function waitForGesture() {
        waitingForGesture = true;
        status.textContent = "Click anywhere or press Play to start the music.";
        toggle.setAttribute("aria-expanded", "true");
        panel.hidden = false;
        window.addEventListener("pointerdown", resumeAfterGesture);
    }

    function resumeAnimation() {
        if (!animationPausedByPlayer) {
            return;
        }

        if (sceneEngine) {
            sceneEngine.enabled = true;
        } else if (window.TweenMax && typeof window.TweenMax.resumeAll === "function") {
            window.TweenMax.resumeAll();
        }
        animationPausedByPlayer = false;
    }

    function pauseAnimation() {
        if (sceneEngine) {
            sceneEngine.enabled = false;
        } else if (window.TweenMax && typeof window.TweenMax.pauseAll === "function") {
            window.TweenMax.pauseAll();
        }
        animationPausedByPlayer = !!sceneEngine || (!sceneEngine && !!window.TweenMax);
    }

    function playCurrentTrack() {
        resumeAnimation();
        var result = audio.play();
        if (result && typeof result.catch === "function") {
            result.catch(function (error) {
                if (error.name === "NotAllowedError") {
                    waitForGesture();
                } else {
                    showError("Could not play this track: " + error.message);
                }
                updateControls();
            });
        }
    }

    function startInitialTrack() {
        if (startupAttempted || !ready || !loadingComplete || !tracks.length) {
            return;
        }

        startupAttempted = true;
        selectTrack(0, false);
        if (audio.paused) {
            playCurrentTrack();
        }
    }

    function selectTrack(index, shouldPlay) {
        if (!tracks.length) {
            return;
        }

        currentTrack = (index + tracks.length) % tracks.length;
        select.value = String(currentTrack);

        var track = tracks[currentTrack];
        var source = new URL(track.src, document.baseURI).href;
        if (audio.src !== source) {
            audio.src = source;
            audio.load();
        }

        status.textContent = track.title;
        status.classList.remove("error");
        updateControls();
        if (shouldPlay) {
            playCurrentTrack();
        }
    }

    toggle.addEventListener("click", function () {
        var isExpanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!isExpanded));
        panel.hidden = isExpanded;
    });

    select.addEventListener("change", function () {
        selectTrack(Number(select.value), true);
    });

    previous.addEventListener("click", function () {
        selectTrack(currentTrack - 1, true);
    });

    next.addEventListener("click", function () {
        selectTrack(currentTrack + 1, true);
    });

    play.addEventListener("click", function () {
        if (audio.paused) {
            playCurrentTrack();
        } else {
            audio.pause();
            pauseAnimation();
        }
    });

    window.addEventListener("pablo-audio-ready", function (event) {
        var matterEngine = window.Matter && window.Matter.Engine;
        if (matterEngine && typeof matterEngine.run === "function") {
            var originalRun = matterEngine.run;
            matterEngine.run = function (engine) {
                sceneEngine = engine;
                matterEngine.run = originalRun;
                return originalRun.apply(this, arguments);
            };
        }

        audio = event.detail;
        ready = true;
        var originalPlay = audio.play.bind(audio);
        audio.play = function () {
            var result = originalPlay();
            if (result && typeof result.catch === "function") {
                return result.catch(function (error) {
                    if (error.name === "NotAllowedError") {
                        if (loadingComplete && tracks.length && !waitingForGesture) {
                            waitForGesture();
                        }
                        return;
                    }
                    throw error;
                });
            }
            return result;
        };
        audio.addEventListener("play", function () {
            clearGestureWait();
            updateControls();
        });
        audio.addEventListener("pause", updateControls);
        audio.addEventListener("error", function () {
            if (audio.error) {
                showError("Could not load this track (media error " + audio.error.code + ").");
            }
        });
        audio.addEventListener("ended", function () {
            window.setTimeout(function () {
                selectTrack(currentTrack + 1, true);
            }, 0);
        });
        updateControls();
        startInitialTrack();
    }, { once: true });

    var loadingObserver = new MutationObserver(function () {
        if (!document.querySelector(".loading")) {
            loadingComplete = true;
            loadingObserver.disconnect();
            updateControls();
            startInitialTrack();
        }
    });
    loadingObserver.observe(document.body, { childList: true, subtree: true });

    fetch("assets/audio/playlist.json")
        .then(function (response) {
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            return response.json();
        })
        .then(function (playlist) {
            if (!Array.isArray(playlist) || playlist.length === 0) {
                throw new Error("The playlist is empty.");
            }

            playlist.forEach(function (track) {
                if (!track || typeof track.title !== "string" || typeof track.src !== "string") {
                    throw new Error("Each track needs a title and a source.");
                }

                var option = document.createElement("option");
                option.value = String(tracks.length);
                option.textContent = track.title;
                select.appendChild(option);
                tracks.push(track);
            });

            if (!waitingForGesture) {
                status.textContent = "If the music does not start, click anywhere or press Play.";
            }
            updateControls();
            startInitialTrack();
        })
        .catch(function (error) {
            showError("Could not load the playlist: " + error.message);
        });
}());
