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

    function playCurrentTrack() {
        var result = audio.play();
        if (result && typeof result.catch === "function") {
            result.catch(function (error) {
                status.textContent = "Press Play to start the music.";
                if (error.name !== "NotAllowedError") {
                    showError("Could not play this track: " + error.message);
                }
                updateControls();
            });
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
        }
    });

    window.addEventListener("pablo-audio-ready", function (event) {
        audio = event.detail;
        ready = true;
        audio.addEventListener("play", updateControls);
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
    }, { once: true });

    var loadingObserver = new MutationObserver(function () {
        if (!document.querySelector(".loading")) {
            loadingComplete = true;
            loadingObserver.disconnect();
            updateControls();
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

            status.textContent = "If the music does not start, press Play.";
            updateControls();
        })
        .catch(function (error) {
            showError("Could not load the playlist: " + error.message);
        });
}());
